// Мини-игра «Сейф-пазл»: поле 8×8 — это сейф, фигуры собраны из щитов.
// Заполненный ряд или столбец «запирается на замок» и исчезает: очки, комбо, рекорд.
//
// Два режима:
//   junior (1–6 классы) — яркие щиты, фигуры мельче;
//   senior (7+ классы, колледжи, вузы) — «оперативный режим» в стиле оперативной карты:
//     строгие плитки, крупнее и сложнее фигуры, комбо держится меньше ходов.
//
// Игра — награда за миссии, а не замена им (правила одинаковы для младших и старших):
//   • открывается после первой миссии; каждая пройденная миссия — ROUNDS_PER_MISSION раунд;
//   • «Новые фигуры» (🔄, сменить три фигуры) — только за миссию на 3 звезды (как на
//     праздничном экране, starsFor), по одной; это общий запас, он тратится в любом раунде;
//   • после сертификата раунды не ограничены (запас «Новых фигур» — по-прежнему за звёзды).
// Счёт сыгранных раундов, потраченных «Новых фигур» и незаконченный раунд хранятся
// на устройстве (SB.store, отдельно для каждого участника).
//
// Рейтинг (если включён в настройках) — первое, что видит ученик при входе в игру:
// вкладки «Моя школа / колледж / вуз» и «Жамбылская область» (/api/game/board).
// В начале раунда — тот же запрос для «Ты обогнал(а)…», обгоны считаются здесь, в браузере;
// результат уходит на сервер только в конце раунда или при выходе с новым рекордом.
//
// Перетаскивание — Pointer Events; фигура под пальцем двигается только через transform
// в requestAnimationFrame, поле рисуется на canvas (готовые картинки клеток, без пересчёта
// градиентов на каждом кадре) — чтобы игра не тормозила на недорогих телефонах.
(function () {
  'use strict';
  const { h, store, sheet, toast, confetti, icon, fmt, reducedMotion, t, pick } = SB;

  const N = 8;
  const ROUNDS_PER_MISSION = 1;
  // Звёзды за миссию — те же, что на праздничном экране (app.js берёт эту функцию отсюда)
  const starsFor = (score, max) => {
    const pct = max ? score / max : 1;
    return pct >= 0.9 ? 3 : pct >= 0.6 ? 2 : 1;
  };
  const LINE_POINTS = [0, 100, 300, 600, 1000, 1500, 2100];
  const CLEAN_BONUS = 1000;
  const MAX_COMBO = 10;

  // Цвета плиток: светлый, основной, тёмный
  const COLORS_JR = [
    ['#8fe9ff', '#16a9d6', '#0a6f9c'],
    ['#ffe68a', '#f5b800', '#b98a00'],
    ['#a6f2c0', '#22b864', '#0f7a40'],
    ['#ffb8bd', '#ef5560', '#b02a33'],
    ['#dcc4ff', '#8f5cf0', '#5b2fb8'],
    ['#ffd0a8', '#ff8a2a', '#c45a0a'],
    ['#b6caff', '#4c74f0', '#2a47b0'],
  ];
  const COLORS_OPS = [
    ['#7cecff', '#14b4d6', '#0a6684'],
    ['#ffd978', '#e6a100', '#8f6200'],
    ['#86f2c8', '#17b282', '#0a6e4f'],
    ['#ff9fa6', '#de4550', '#8c2129'],
    ['#a8c2ff', '#3f6fe6', '#223f96'],
    ['#cdb8ff', '#7d5ae3', '#47299b'],
    ['#dbe3ef', '#8d9ab0', '#4b586e'],
  ];

  // Логотипы (свои картинки): сейф с закрытым рядом и замком
  const LOGO = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="5" y="5" width="110" height="110" rx="24" fill="#13284f" stroke="#f5b800" stroke-width="6"/>
  <rect x="20" y="20" width="24" height="24" rx="7" fill="#16a9d6"/>
  <rect x="48" y="20" width="24" height="24" rx="7" fill="#16a9d6"/>
  <rect x="76" y="20" width="24" height="24" rx="7" fill="#ffffff" fill-opacity=".1"/>
  <rect x="20" y="48" width="24" height="24" rx="7" fill="#f5b800"/>
  <rect x="48" y="48" width="24" height="24" rx="7" fill="#f5b800"/>
  <rect x="76" y="48" width="24" height="24" rx="7" fill="#f5b800"/>
  <rect x="20" y="76" width="24" height="24" rx="7" fill="#22b864"/>
  <rect x="48" y="76" width="24" height="24" rx="7" fill="#ffffff" fill-opacity=".1"/>
  <path d="M60 52 l7 2.4 v5.4 c0 4.4 -3 7.4 -7 9 c-4 -1.6 -7 -4.6 -7 -9 v-5.4 z" fill="#fff" fill-opacity=".55"/>
  <circle cx="96" cy="96" r="19" fill="#f5b800" stroke="#13284f" stroke-width="4"/>
  <path d="M89.5 95 v-5 a6.5 6.5 0 0 1 13 0 v5" fill="none" stroke="#13284f" stroke-width="3.6" stroke-linecap="round"/>
  <rect x="86" y="94" width="20" height="14" rx="3.5" fill="#13284f"/>
</svg>`;
  const LOGO_OPS = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <rect x="5" y="5" width="110" height="110" rx="14" fill="#0b1a2c" stroke="#3fd6ff" stroke-width="3"/>
  <path d="M5 26 V12 a7 7 0 0 1 7 -7 H26 M94 5 H108 a7 7 0 0 1 7 7 V26 M115 94 V108 a7 7 0 0 1 -7 7 H94 M26 115 H12 a7 7 0 0 1 -7 -7 V94" fill="none" stroke="#9cf0ff" stroke-width="3"/>
  <rect x="20" y="20" width="24" height="24" rx="4" fill="#8d9ab0" fill-opacity=".55"/>
  <rect x="48" y="20" width="24" height="24" rx="4" fill="#ffffff" fill-opacity=".06" stroke="#3fd6ff" stroke-opacity=".3"/>
  <rect x="76" y="20" width="24" height="24" rx="4" fill="#8d9ab0" fill-opacity=".55"/>
  <rect x="20" y="48" width="24" height="24" rx="4" fill="#14b4d6"/>
  <rect x="48" y="48" width="24" height="24" rx="4" fill="#14b4d6"/>
  <rect x="76" y="48" width="24" height="24" rx="4" fill="#14b4d6"/>
  <rect x="20" y="76" width="24" height="24" rx="4" fill="#ffffff" fill-opacity=".06" stroke="#3fd6ff" stroke-opacity=".3"/>
  <rect x="48" y="76" width="24" height="24" rx="4" fill="#8d9ab0" fill-opacity=".55"/>
  <circle cx="96" cy="96" r="18" fill="#0b1a2c" stroke="#3fd6ff" stroke-width="3.5"/>
  <path d="M90 95 v-4.5 a6 6 0 0 1 12 0 v4.5" fill="none" stroke="#3fd6ff" stroke-width="3.2" stroke-linecap="round"/>
  <rect x="87" y="94" width="18" height="12" rx="2.5" fill="#3fd6ff"/>
</svg>`;

  // ─── Фигуры ───────────────────────────────────────────────────────────
  const BASE = {
    dot: [[0, 0]],
    i2: [[0, 0], [0, 1]],
    i3: [[0, 0], [0, 1], [0, 2]],
    i4: [[0, 0], [0, 1], [0, 2], [0, 3]],
    i5: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
    o2: [[0, 0], [0, 1], [1, 0], [1, 1]],
    r23: [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]],
    v3: [[0, 0], [1, 0], [1, 1]],
    l4: [[0, 0], [1, 0], [2, 0], [2, 1]],
    t4: [[0, 0], [0, 1], [0, 2], [1, 1]],
    s4: [[0, 1], [0, 2], [1, 0], [1, 1]],
    v5: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]],
  };

  // Режимы: частота фигур и сколько ходов без закрытого ряда держится комбо.
  // Сложность проверена прогоном жадного бота (по 250 раундов, тройки — «решаемые», см. newTray):
  //   без «Новых фигур»  — младшие: медиана ~44 хода, старшие ~35;
  //   с двумя «Новыми»   — младшие ~130 ходов, старшие ~105.
  // Квадрат 3×3 и Т из 5 клеток пробовали — с ними раунды становятся слишком короткими.
  const MODES = {
    junior: {
      ops: false, colors: COLORS_JR, idle: 3,
      weights: { dot: 4, i2: 8, i3: 7, i4: 3, o2: 7, r23: 2, v3: 8, l4: 3, t4: 3, s4: 2, v5: 1 },
    },
    senior: {
      ops: true, colors: COLORS_OPS, idle: 2,
      weights: { dot: 3, i2: 8, i3: 7, i4: 4, i5: 1, o2: 7, r23: 3, v3: 8, l4: 4, t4: 4, s4: 3, v5: 2 },
    },
  };
  const modeOf = (me) => (me && me.level === 'junior' ? 'junior' : 'senior');

  const norm = (cells) => {
    const r0 = Math.min(...cells.map((c) => c[0]));
    const c0 = Math.min(...cells.map((c) => c[1]));
    return cells.map(([r, c]) => [r - r0, c - c0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  };
  // Все повороты и отражения каждой фигуры (без повторов)
  const VARIANTS = {};
  for (const [name, cells] of Object.entries(BASE)) {
    const seen = new Map();
    for (const start of [cells, cells.map(([r, c]) => [r, -c])]) {
      let cur = start;
      for (let k = 0; k < 4; k++) {
        const n = norm(cur);
        seen.set(JSON.stringify(n), n);
        cur = cur.map(([r, c]) => [c, -r]);
      }
    }
    VARIANTS[name] = [...seen.values()];
  }
  const cellsOf = (p) => (VARIANTS[p.s] || VARIANTS.dot)[p.v] || VARIANTS.dot[0];
  const sizeOf = (cells) => ({ rows: Math.max(...cells.map((c) => c[0])) + 1, cols: Math.max(...cells.map((c) => c[1])) + 1 });

  const fits = (grid, cells, r0, c0) => cells.every(([r, c]) => {
    const R = r0 + r;
    const C = c0 + c;
    return R >= 0 && R < N && C >= 0 && C < N && !grid[R * N + C];
  });
  function canPlace(grid, cells) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (fits(grid, cells, r, c)) return true;
    return false;
  }
  function fullLines(grid) {
    const rows = [];
    const cols = [];
    for (let i = 0; i < N; i++) {
      let row = true;
      let col = true;
      for (let j = 0; j < N; j++) {
        if (!grid[i * N + j]) row = false;
        if (!grid[j * N + i]) col = false;
      }
      if (row) rows.push(i);
      if (col) cols.push(i);
    }
    return { rows, cols };
  }

  function randomShape(mode) {
    const w = mode.weights;
    let x = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
    for (const [name, n] of Object.entries(w)) {
      x -= n;
      if (x < 0) return name;
    }
    return 'i2';
  }
  // Можно ли выложить все три фигуры хотя бы в одном порядке (каждую — туда, где закрывается
  // больше рядов). Около 6×3×64 проверок — доли миллисекунды, и только при новой тройке.
  const ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  function solvable(grid, tray) {
    return ORDERS.some((order) => {
      let g = grid;
      for (const i of order) {
        const cells = cellsOf(tray[i]);
        let best = null;
        for (let r = 0; r < N; r++) {
          for (let c = 0; c < N; c++) {
            if (!fits(g, cells, r, c)) continue;
            const next = g.slice();
            for (const [a, b] of cells) next[(r + a) * N + c + b] = 1;
            const { rows, cols } = fullLines(next);
            if (!best || rows.length + cols.length > best.lines) best = { next, rows, cols, lines: rows.length + cols.length };
          }
        }
        if (!best) return false;
        best.rows.forEach((R) => { for (let c = 0; c < N; c++) best.next[R * N + c] = 0; });
        best.cols.forEach((C) => { for (let r = 0; r < N; r++) best.next[r * N + C] = 0; });
        g = best.next;
      }
      return true;
    });
  }

  // Три новые фигуры разных цветов. Подбираем так, чтобы тройку можно было выложить целиком:
  // «Новые фигуры» теперь редкость (только за 3 звезды), и проигрыш должен быть от тесноты
  // на поле, а не от невезения с фигурами. Если за 30 попыток не вышло — лучшая из найденных.
  function newTray(grid, mode) {
    let best = null;
    for (let tries = 0; tries < 30; tries++) {
      const colors = SB.shuffle(mode.colors.map((_, i) => i));
      const tray = [0, 1, 2].map((i) => {
        const s = randomShape(mode);
        return { s, v: Math.floor(Math.random() * VARIANTS[s].length), k: colors[i] };
      });
      const ok = tray.filter((p) => canPlace(grid, cellsOf(p))).length;
      if (ok === 3 && solvable(grid, tray)) return tray;
      if (!best || ok > best.ok) best = { tray, ok };
    }
    if (!best.ok) best.tray[0] = { s: 'dot', v: 0, k: best.tray[0].k };
    return best.tray;
  }

  // ─── Картинки клеток (рисуются один раз на каждый размер) ─────────────
  function roundRect(g, x, y, w, hh, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + hh, r);
    g.arcTo(x + w, y + hh, x, y + hh, r);
    g.arcTo(x, y + hh, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function shieldPath(g, cx, cy, w) {
    const hw = w / 2;
    const hh = w * 0.58;
    g.beginPath();
    g.moveTo(cx, cy - hh);
    g.lineTo(cx + hw, cy - hh * 0.62);
    g.lineTo(cx + hw, cy - hh * 0.02);
    g.quadraticCurveTo(cx + hw * 0.92, cy + hh * 0.66, cx, cy + hh);
    g.quadraticCurveTo(cx - hw * 0.92, cy + hh * 0.66, cx - hw, cy - hh * 0.02);
    g.lineTo(cx - hw, cy - hh * 0.62);
    g.closePath();
  }
  // k: индекс цвета; -1 — белая вспышка (замок защёлкнулся)
  function makeSprite(mode, k, size) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.max(4, size);
    const g = c.getContext('2d');
    const r = size * (mode.ops ? 0.12 : 0.22);
    if (k < 0) {
      roundRect(g, 0, 0, size, size, r);
      g.fillStyle = mode.ops ? '#e6fbff' : '#fffbe6';
      g.fill();
      return c;
    }
    const [light, mid, dark] = mode.colors[k];
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, light);
    grad.addColorStop(mode.ops ? 0.3 : 0.45, mid);
    grad.addColorStop(1, dark);
    roundRect(g, 0, 0, size, size, r);
    g.fillStyle = grad;
    g.fill();
    const inset = size * 0.1;
    if (mode.ops) {
      // Строгая плитка: ровная грань, тонкий блик и «прорезь» посередине
      roundRect(g, inset, inset, size - inset * 2, size - inset * 2, r * 0.6);
      g.fillStyle = mid;
      g.fill();
      g.fillStyle = 'rgba(255, 255, 255, 0.35)';
      g.fillRect(inset, inset, size - inset * 2, Math.max(1, size * 0.045));
      g.fillStyle = 'rgba(0, 0, 0, 0.22)';
      g.fillRect(size * 0.3, size * 0.47, size * 0.4, Math.max(1, size * 0.07));
      return c;
    }
    roundRect(g, inset, inset, size - inset * 2, size - inset * 2, r * 0.7);
    g.fillStyle = mid;
    g.fill();
    g.globalAlpha = 0.32;
    roundRect(g, inset * 1.3, inset, size - inset * 2.6, size * 0.3, r * 0.6);
    g.fillStyle = '#fff';
    g.fill();
    g.globalAlpha = 1;
    shieldPath(g, size / 2, size * 0.54, size * 0.38);
    g.fillStyle = 'rgba(255, 255, 255, 0.3)';
    g.fill();
    g.lineWidth = Math.max(1, size * 0.035);
    g.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    g.stroke();
    return c;
  }

  // ─── Звуки (синтез, без файлов; молчат, если звук выключен) ───────────
  const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98, 1760];
  const sfx = {
    pick: () => SB.tone(740, 0, 0.05, 'sine', 0.035),
    place: () => { SB.tone(300, 0, 0.08, 'triangle', 0.08); SB.tone(150, 0.004, 0.1, 'sine', 0.05); },
    back: () => SB.tone(150, 0, 0.12, 'square', 0.02),
    clear: (lines, combo) => {
      SB.tone(118, 0, 0.05, 'square', 0.045); // щелчок замка
      SB.tone(1900, 0.004, 0.03, 'square', 0.015);
      const from = Math.min(Math.max(0, combo - 1), 4);
      const n = Math.min(2 + lines, 6);
      for (let j = 0; j < n; j++) SB.tone(NOTES[Math.min(from + j, NOTES.length - 1)], 0.05 + j * 0.065, 0.24, 'triangle', 0.06);
    },
    overtake: () => [1046.5, 1318.51, 1567.98].forEach((f, j) => SB.tone(f, 0.25 + j * 0.07, 0.18, 'sine', 0.05)),
    refresh: () => [660, 990].forEach((f, j) => SB.tone(f, j * 0.07, 0.12, 'sine', 0.05)),
    over: () => [392, 329.63, 261.63].forEach((f, j) => SB.tone(f, j * 0.17, 0.32, 'sine', 0.06)),
    best: () => [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, j) => SB.tone(f, j * 0.1, 0.32, 'triangle', 0.06)),
  };
  // Вибрация — только после настоящего касания (иначе браузер пишет ошибку в консоль)
  const buzz = (ms) => {
    try {
      const touched = !navigator.userActivation || navigator.userActivation.hasBeenActive;
      if (SB.soundOn() && navigator.vibrate && touched) navigator.vibrate(ms);
    } catch { /* нет вибро */ }
  };

  // ─── Сохранение на устройстве ─────────────────────────────────────────
  const keyOf = () => 'game:' + String(store.get('token') || 'guest').slice(0, 12);
  function load() {
    try {
      const d = JSON.parse(store.get(keyOf()) || '{}');
      return d && typeof d === 'object' ? d : {};
    } catch { return {}; }
  }
  const save = (d) => store.set(keyOf(), JSON.stringify(d));

  // ─── Рейтинг на сервере ───────────────────────────────────────────────
  let boardCache = null; // { at, tok, data } — чтобы не спрашивать сервер чаще раза в минуту
  async function fetchBoard() {
    const tok = store.get('token');
    if (!tok) return null;
    if (boardCache && boardCache.tok === tok && Date.now() - boardCache.at < 60_000) return boardCache.data;
    try {
      const data = await SB.api('/api/game/board');
      boardCache = { at: Date.now(), tok, data };
      return data;
    } catch { return null; } // без связи игра работает, просто без соперников
  }
  // keepalive — запрос дойдёт, даже если ученик сразу закрыл вкладку
  function sendScore(score, final) {
    const tok = store.get('token');
    if (!tok || !(score > 0)) return Promise.resolve();
    if (boardCache) boardCache.at = 0;
    try {
      return fetch('/api/game/score', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', 'X-Participant-Token': tok, 'X-Lang': SB.lang },
        body: JSON.stringify({ score: Math.round(score), final: !!final }),
      }).catch(() => {});
    } catch { return Promise.resolve(); } // без связи — рекорд останется на устройстве
  }

  // Что открыто участнику: раунды за миссии, после сертификата — без ограничений;
  // «Новые фигуры» — по одной за каждую миссию на 3 звезды (лучший результат миссии)
  function info(me) {
    const d = load();
    const done = Number(me && me.missionsDone) || 0;
    const unlimited = !!(me && me.passed);
    const missions = (me && me.missions) || {};
    const ids = (me && me.missionIds) || Object.keys(missions);
    const spinsEarned = ids.filter((id) => missions[id] && starsFor(missions[id].score, missions[id].max) === 3).length;
    return {
      unlocked: unlimited || done > 0,
      unlimited,
      left: unlimited ? Infinity : Math.max(0, done * ROUNDS_PER_MISSION - (Number(d.played) || 0)),
      best: Math.max(Number(d.best) || 0, Number(me && me.gameBest) || 0),
      spins: Math.max(0, spinsEarned - (Number(d.spinsUsed) || 0)),
      hasRound: !!(d.cur && Array.isArray(d.cur.tray) && typeof d.cur.grid === 'string'),
      perMission: ROUNDS_PER_MISSION,
      ops: modeOf(me) !== 'junior',
    };
  }

  // ─── Экран игры ───────────────────────────────────────────────────────
  // ctx: { me, nextMission: {n, id, title}|null, tips: [{text}], rating: bool, go(hash) }
  // Возвращает функцию очистки (вызывается при уходе с экрана).
  function render(root, ctx) {
    const mode = MODES[modeOf(ctx.me)];
    let disposers = [];
    const cleanup = () => { disposers.forEach((f) => f()); disposers = []; };
    // При входе в игру первым показывается рейтинг (мотивация), «Играть» — внизу экрана
    intro();
    return cleanup;

    function roundsLine(g) { return g.unlimited ? '∞' : String(g.left); }
    function modeTag() { return mode.ops && h('span', { class: 'g-mode' }, '● ', t('gameModeOps')); }
    function levelKey() { return mode.ops ? 'gameLevelChipSr' : 'gameLevelChipJr'; }

    // Экраны игры — почти без слов: цифры и иконки, правила — по «?», приватность — по «i»
    function head() {
      return h('div', { class: 'row g-head' },
        h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => ctx.go('#/map') }, icon('back')),
        h('span', { class: 'g-logo-sm', html: mode.ops ? LOGO_OPS : LOGO }),
        h('div', { class: 'g-head-title' }, h('h2', { class: 'step-title' }, t('gameName')), modeTag()),
        h('button', { class: 'g-q', type: 'button', 'aria-label': t('gameRulesTitle'), onclick: showRules }, '?'));
    }
    function stat(ico, val, label) {
      return h('div', { 'aria-label': `${label}: ${val}`, title: label },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), h('b', null, val));
    }
    function stats(g) {
      return h('div', { class: 'g-stats' },
        stat('🏆', fmt(g.best), t('gameBest')),
        stat('🎟️', roundsLine(g), t('gameRounds')),
        stat('🔄', String(g.spins), t('gameSpins')));
    }
    function showRules() {
      const rules = [
        ['🧩', t('gameR1')],
        ['🎟️', t('gameR2')],
        ['🔄', t('gameR3')],
        ['🎓', t('gameR4')],
        ['🏅', t(mode.ops ? 'gameRLevelSr' : 'gameRLevelJr')],
      ];
      sheet({
        emoji: '❓',
        title: t('gameRulesTitle'),
        content: h('div', { class: 'g-rules-list' }, rules.map(([ico, text]) =>
          h('div', { class: 'g-rule' }, h('span', { class: 'ico', 'aria-hidden': 'true' }, ico), h('span', null, text)))),
        actions: [{ label: 'OK' }],
        dismissible: true,
      });
    }
    function showPrivacy() {
      sheet({ emoji: 'ℹ️', title: t('gameInfo'), text: t('gamePrivacy'), actions: [{ label: 'OK' }], dismissible: true });
    }
    // Главная кнопка внизу: продолжить / играть / за новым раундом в миссию / к тесту
    function mainButton(g, resume, again = false) {
      const nm = ctx.nextMission;
      if (resume) return h('button', { class: 'btn gold', onclick: () => play(resume) }, t('gameContinue'));
      if (g.unlimited || g.left > 0) return h('button', { class: 'btn gold', onclick: start }, again ? t('gameAgain') : t('gamePlay'));
      return nm
        ? h('button', { class: 'btn', onclick: () => ctx.go(`#/mission/${nm.id}`) }, '🎟️ 0 · ', t('gameToMission', { n: nm.n }))
        : h('button', { class: 'btn', onclick: () => ctx.go('#/quiz') }, '🎟️ 0 · ', t('gameToTest'));
    }

    function intro() {
      cleanup();
      SB.warmAudio(); // звук готовим заранее, чтобы первое касание фигуры не тормозило
      const g = info(ctx.me);
      const d = load();
      const resume = g.hasRound ? d.cur : null;
      const ratingBox = h('div', { class: 'g-rating' });
      root.replaceChildren(h('div', { class: 'stack g-intro' + (mode.ops ? ' ops' : '') },
        head(),
        stats(g),
        ratingBox,
        h('div', { class: 'sticky-cta' }, mainButton(g, resume))));
      if (!ctx.rating) return;
      (async () => {
        // Рекорд, набранный без связи, сначала догоняет сервер — тогда и место будет верным
        const local = Number(load().best) || 0;
        if (local > (Number(ctx.me.gameBest) || 0)) { await sendScore(local, false); boardCache = null; }
        const b = await fetchBoard();
        if (!ratingBox.isConnected || !b || !b.rating) return;
        ratingBox.replaceChildren(ratingView(b, Math.max(local, b.best || 0)));
      })();
    }

    // Экран после проигрыша: результат и рекорд крупно, сразу рейтинг с новым местом
    // r: { score, best, isBest, prevPlace, submit }
    function result(r) {
      cleanup();
      const g = info(ctx.me);
      const placeEl = h('span', { class: 'g-res-place' });
      const ratingBox = h('div', { class: 'g-rating' });
      const tip = ctx.tips && ctx.tips.length ? pick(ctx.tips) : null;
      root.replaceChildren(h('div', { class: 'stack g-intro g-result' + (mode.ops ? ' ops' : '') },
        head(),
        h('div', { class: 'g-res' + (r.isBest ? ' best' : '') },
          r.isBest && h('div', { class: 'g-res-badge' }, '🏆 ', t('gameNewBest')),
          h('b', { class: 'g-res-score', 'aria-label': `${t('gameYourScore')}: ${fmt(r.score)}` }, fmt(r.score)),
          h('div', { class: 'g-res-sub' },
            h('span', { 'aria-label': `${t('gameBest')}: ${fmt(r.best)}` }, '🏆 ', fmt(r.best)),
            h('span', null, '🎟️ ', roundsLine(g)),
            placeEl)),
        ratingBox,
        tip && h('p', { class: 'g-tipline' }, '💡 ', tip.text),
        h('div', { class: 'sticky-cta' }, mainButton(g, null, true))));
      if (!ctx.rating) return;
      (async () => {
        // Сначала результат доходит до сервера (не дольше 2,5 с), затем — свежий рейтинг
        await Promise.race([r.submit, new Promise((res) => setTimeout(res, 2500))]);
        boardCache = null;
        const b = await fetchBoard();
        if (!ratingBox.isConnected || !b || !b.rating) return;
        const myBest = Math.max(r.best, b.best || 0);
        const place = b.school.place;
        if (place) placeEl.replaceChildren(h('span', null, '🏅 ', String(place), deltaBadge(place, r.prevPlace)));
        ratingBox.replaceChildren(ratingView(b, myBest, r.prevPlace));
      })();
    }
    // «▲ +3» — на сколько мест поднялся ученик в своей школе; «NEW» — первый раз в рейтинге
    function deltaBadge(place, prev) {
      if (!place || prev === undefined) return null;
      if (!prev) return h('span', { class: 'g-up new' }, 'NEW');
      return prev > place ? h('span', { class: 'g-up' }, `▲ +${prev - place}`) : null;
    }

    // Рейтинг: вкладки «Моя школа / колледж / вуз» и «Жамбылская область».
    // Строка ученика подсвечена и видна, даже если он далеко внизу.
    function ratingView(b, myBest, prevSchoolPlace) {
      const KIND = { school: 'gameTabSchool', college: 'gameTabCollege', university: 'gameTabUniversity', other: 'gameTabOther' };
      let tab = 'school';
      const list = h('div', { class: 'g-list', role: 'tabpanel' });
      const tabs = [['school', t(KIND[b.school.kind] || KIND.school)], ['region', t('gameTabRegion')]].map(([id, label]) =>
        h('button', { class: 'g-seg-btn', type: 'button', role: 'tab', 'aria-selected': String(id === tab), onclick: () => { tab = id; fill(); } }, label));

      function row(n, who, sub, score, cls = '', extra = null) {
        return h('div', { class: 'g-row' + cls },
          h('span', { class: 'n' }, String(n)),
          h('span', { class: 'who' }, who, extra, sub && h('small', null, sub)),
          h('b', null, fmt(score)));
      }

      function fill() {
        tabs.forEach((btn, i) => btn.setAttribute('aria-selected', String((i === 0) === (tab === 'school'))));
        const region = tab === 'region';
        const data = region ? b.region : b.school;
        const others = data.rows;
        // Место ученика: от сервера; если рекорд на устройстве свежее — считаем по списку
        const place = myBest > 0
          ? (myBest === (b.best || 0) && data.place ? data.place : others.filter((r) => r.score > myBest).length + 1)
          : null;
        const total = Math.max(data.total || 0, place || 0);
        const up = !region && prevSchoolPlace !== undefined ? deltaBadge(place, prevSchoolPlace) : null;
        const meRow = () => row(place, t('gameYou'), region ? b.school.name : null, myBest, ' you', up);
        const out = [];
        out.push(h('div', { class: 'g-list-head' },
          h('b', null, region ? t('gameRegionTop', { n: others.length + (place && place <= others.length + 1 ? 1 : 0) }) : b.school.name),
          h('span', { 'aria-label': place ? t('gameMyPlaceAria', { n: place, m: total }) : '' }, place ? `🏅 ${place} / ${total}` : '🏅 —')));
        let shownMe = false;
        others.forEach((r, i) => {
          if (place && !shownMe && i + 1 >= place) { out.push(meRow()); shownMe = true; }
          const n = i + 1 + (shownMe ? 1 : 0);
          out.push(region
            ? row(n, r.name, r.school, r.score)
            : row(n, `${r.name}, ${r.grade}`, null, r.score, r.classmate ? ' mate' : ''));
        });
        if (place && !shownMe) {
          if (place > others.length + 1) out.push(h('div', { class: 'g-gap', 'aria-hidden': 'true' }, '⋯'));
          out.push(meRow());
        }
        if (!others.length && !place) out.push(h('p', { class: 'muted small center' }, '—'));
        list.replaceChildren(...out);
      }
      fill();
      return h('div', { class: 'stack-sm' },
        h('div', { class: 'g-seg', role: 'tablist' }, tabs),
        h('div', { class: 'g-rating-meta' },
          h('span', { class: 'g-chip' }, '🏅 ', t(levelKey())),
          h('button', { class: 'g-info', type: 'button', 'aria-label': t('gameInfo'), onclick: showPrivacy }, 'i')),
        list);
    }

    function start() {
      const g = info(ctx.me);
      if (!g.unlimited && g.left <= 0) return intro();
      const d = load();
      d.played = (Number(d.played) || 0) + 1;
      const grid = new Array(N * N).fill(0);
      d.cur = { grid: grid.join(''), tray: newTray(grid, mode), score: 0, combo: 0, idle: 0, best0: g.best };
      save(d);
      play(d.cur);
    }

    function play(cur) {
      cleanup();
      const grid = cur.grid.split('').map((ch) => Math.min(mode.colors.length, Number(ch) || 0));
      let tray = cur.tray.slice(0, 3);
      while (tray.length < 3) tray.push(null);
      let score = Number(cur.score) || 0;
      let combo = Number(cur.combo) || 0;
      let idle = Number(cur.idle) || 0;
      let refresh = info(ctx.me).spins; // «Новые фигуры» — общий запас за миссии на 3 звезды
      const best0 = Number(cur.best0) || 0;
      let over = false;
      let sent = 0; // какой счёт этого раунда уже ушёл на сервер

      // ─ Разметка
      const scoreEl = h('b', null, fmt(score));
      const bestEl = h('b', null, fmt(Math.max(best0, score)));
      const comboEl = h('div', { class: 'g-combo', 'aria-live': 'polite' });
      const soundBtn = h('button', { class: 'icon-btn g-sound', type: 'button', onclick: toggleSound });
      const chaseEl = h('span', { class: 'g-chase' });
      const worldEl = h('span', { class: 'g-world' });
      const raceEl = h('div', { class: 'g-race', hidden: true }, chaseEl, worldEl);
      const board = h('canvas', { class: 'g-board', role: 'img', 'aria-label': t('gameBoardAria') });
      const fxLayer = h('div', { class: 'g-fx', 'aria-live': 'polite' });
      const boardWrap = h('div', { class: 'g-board-wrap' }, board, fxLayer);
      const slots = [0, 1, 2].map((i) => h('div', { class: 'g-slot', 'data-i': String(i) }, h('canvas')));
      const trayEl = h('div', { class: 'g-tray' }, slots);
      const refreshBtn = h('button', { class: 'btn small ghost g-refresh', type: 'button', onclick: doRefresh });
      // Подсказка «как играть» — один раз, без слов: палец тянет фигуру из лотка на поле
      const hintSeen = store.get('gameHint') === '1';
      const hand = hintSeen ? null : h('div', { class: 'g-hint', 'aria-hidden': 'true' }, h('span', { class: 'g-hint-piece' }), h('span', { class: 'g-hint-hand' }, '👆'));
      const screen = h('div', { class: 'g-screen' + (mode.ops ? ' ops' : ' jr') },
        h('div', { class: 'g-hud' },
          h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('gameExit'), onclick: exit }, icon('x')),
          h('div', { class: 'g-score', 'aria-label': t('gameScore') }, scoreEl),
          comboEl,
          h('div', { class: 'g-best', 'aria-label': t('gameBest') }, '🏆 ', bestEl),
          soundBtn),
        raceEl,
        boardWrap,
        h('div', { class: 'g-tray-wrap' }, trayEl),
        h('div', { class: 'g-actions' },
          refreshBtn,
          h('span', { class: 'g-rounds', 'aria-label': t('gameRounds') }, '🎟️ ', roundsLine(info(ctx.me)))),
        hand);
      root.replaceChildren(screen);
      updateSoundBtn();
      updateRefresh();

      // ─ Соперники: один запрос при начале раунда, дальше всё считается здесь
      // race: { ahead — соперники школы выше текущего счёта (по возрастанию), startBest,
      //         world — рекорд области, rivals — соперники школы, schoolTotal — сколько их всего }
      let race = null;
      if (ctx.rating) {
        fetchBoard().then((b) => {
          if (!b || !b.rating || !screen.isConnected) return;
          const startBest = Math.max(best0, b.best || 0);
          const top1 = b.region.rows[0];
          const rivals = b.school.rows;
          race = {
            ahead: rivals.filter((r) => r.score >= score).sort((a, c) => a.score - c.score),
            startBest,
            world: top1 ? { score: Math.max(top1.score, startBest), you: startBest >= top1.score } : startBest ? { score: startBest, you: true } : null,
            worldBeat: false,
            rivals,
            schoolOthers: Math.max(rivals.length, (b.school.total || 0) - (b.best ? 1 : 0)),
            prevPlace: b.school.place || null,
          };
          updateRace();
        });
      }
      function updateRace() {
        if (!race) return;
        const next = race.ahead[0];
        chaseEl.textContent = next
          ? t('gameChase', { name: next.name, grade: next.grade, diff: fmt(next.score - score + 1) })
          : race.rivals.length ? t('gameLeader') : '';
        const w = race.world ? Math.max(race.world.score, score) : score;
        worldEl.textContent = race.world || score > 0 ? t('gameWorld', { score: fmt(w) }) : '';
        worldEl.setAttribute('aria-label', t('gameWorldAria', { score: fmt(w) }));
        raceEl.hidden = !chaseEl.textContent && !worldEl.textContent;
      }
      function checkRace() {
        if (!race) return;
        const passed = [];
        while (race.ahead.length && race.ahead[0].score < score) passed.push(race.ahead.shift());
        // Объявляем одноклассников и тех, кого ученик обходит впервые (выше его прежнего рекорда)
        const notable = passed.filter((r) => r.classmate || r.score >= race.startBest);
        if (notable.length) {
          const top = notable[notable.length - 1];
          const more = notable.length - 1;
          fxText('g-overtake', [t('gameOvertook', { name: top.name, grade: top.grade }), more > 0 ? ` ${t('gameOvertookMore', { n: more })}` : '']);
          sfx.overtake();
        }
        if (race.world && !race.worldBeat && !race.world.you && score > race.world.score) {
          race.worldBeat = true;
          setTimeout(() => { if (screen.isConnected) fxText('g-overtake world', t('gameWorldBeat')); }, notable.length ? 1300 : 0);
          sfx.overtake();
        }
        updateRace();
      }

      // ─ Размеры: поле во всю ширину, но так, чтобы поле и фигуры помещались на экране
      let S = 300;
      let P = 10;
      let pitch = 35;
      let gap = 3;
      let dpr = 1;
      let trayPitch = 18;
      let sprites = {};
      let bg = null;
      const sprite = (k, size) => sprites[k + ':' + size] || (sprites[k + ':' + size] = makeSprite(mode, k, size));
      const cs = () => Math.round((pitch - gap) * dpr);
      const cellPos = (n) => (P + n * pitch + gap / 2) * dpr;

      function layout() {
        const st = getComputedStyle(screen);
        const w = (screen.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)) || 328;
        // место по высоте: шапка сайта, счёт, строка рейтинга, фигуры и кнопка под полем.
        // Высоту окна берём наименьшую из трёх оценок: в телефонных браузерах innerHeight
        // во время перерисовки бывает завышен (страница на миг «отъезжает» по масштабу).
        const vh = Math.min(...[window.innerHeight, document.documentElement.clientHeight,
          window.visualViewport && window.visualViewport.height].filter((v) => v > 0));
        S = Math.floor(Math.max(240, Math.min(w, 440, vh - 348)));
        dpr = Math.min(2, window.devicePixelRatio || 1);
        P = Math.round(S * 0.035);
        pitch = (S - P * 2) / N;
        gap = Math.max(2, pitch * (mode.ops ? 0.08 : 0.07));
        board.style.width = board.style.height = `${S}px`;
        boardWrap.style.width = boardWrap.style.height = `${S}px`;
        board.width = board.height = Math.round(S * dpr);
        trayEl.style.width = `${S}px`;
        raceEl.style.width = `${S}px`;
        const slotW = (S - 16) / 3;
        trayPitch = Math.min(pitch * 0.56, (slotW - 12) / 5);
        trayEl.style.height = `${Math.round(trayPitch * 5 + 14)}px`;
        sprites = {};
        bg = drawBackground();
        drawTray();
        placeHint();
        kick();
      }
      function placeHint() {
        if (!hand || !hand.isConnected) return;
        const base = screen.getBoundingClientRect();
        const from = (slots.find((x) => !x.classList.contains('empty')) || slots[0]).getBoundingClientRect();
        const to = boardWrap.getBoundingClientRect();
        hand.style.setProperty('--x0', `${from.left + from.width / 2 - base.left}px`);
        hand.style.setProperty('--y0', `${from.top + from.height / 2 - base.top}px`);
        hand.style.setProperty('--x1', `${to.left + to.width / 2 - base.left}px`);
        hand.style.setProperty('--y1', `${to.top + to.height * 0.55 - base.top}px`);
        hand.style.setProperty('--cell', `${pitch}px`);
      }

      function drawBackground() {
        const c = document.createElement('canvas');
        c.width = c.height = board.width;
        const g = c.getContext('2d');
        const W = c.width;
        const grad = g.createLinearGradient(0, 0, 0, W);
        grad.addColorStop(0, mode.ops ? '#0d2036' : '#1b3466');
        grad.addColorStop(1, mode.ops ? '#06101d' : '#0b1630');
        const R = (mode.ops ? 12 : 20) * dpr;
        roundRect(g, 0, 0, W, W, R);
        g.fillStyle = grad;
        g.fill();
        g.lineWidth = (mode.ops ? 1.5 : 3) * dpr;
        g.strokeStyle = mode.ops ? '#1f4a66' : '#3a5590';
        roundRect(g, 1.5 * dpr, 1.5 * dpr, W - 3 * dpr, W - 3 * dpr, R - dpr);
        g.stroke();
        if (mode.ops) {
          // уголки-скобки, как на оперативной карте
          const L = P * dpr * 1.7;
          const o = P * dpr * 0.35;
          g.strokeStyle = 'rgba(63, 214, 255, 0.75)';
          g.lineWidth = Math.max(1.5, 2 * dpr);
          g.beginPath();
          for (const [x, y, sx, sy] of [[o, o, 1, 1], [W - o, o, -1, 1], [o, W - o, 1, -1], [W - o, W - o, -1, -1]]) {
            g.moveTo(x, y + sy * L);
            g.lineTo(x, y);
            g.lineTo(x + sx * L, y);
          }
          g.stroke();
        } else {
          // заклёпки по углам сейфа
          g.fillStyle = '#5d79b5';
          const rv = P * dpr * 0.5;
          for (const [x, y] of [[rv, rv], [W - rv, rv], [rv, W - rv], [W - rv, W - rv]]) {
            g.beginPath();
            g.arc(x, y, Math.max(1.5, rv * 0.35), 0, Math.PI * 2);
            g.fill();
          }
        }
        // пустые ячейки
        const size = cs();
        for (let r = 0; r < N; r++) {
          for (let col = 0; col < N; col++) {
            roundRect(g, cellPos(col), cellPos(r), size, size, size * (mode.ops ? 0.12 : 0.22));
            g.fillStyle = mode.ops ? 'rgba(120, 220, 255, 0.05)' : 'rgba(255, 255, 255, 0.07)';
            g.fill();
            g.lineWidth = Math.max(1, dpr);
            g.strokeStyle = mode.ops ? 'rgba(63, 214, 255, 0.14)' : 'rgba(0, 0, 0, 0.25)';
            g.stroke();
          }
        }
        return c;
      }

      // ─ Анимации поля: появление, исчезновение рядов, искры
      const pops = new Map(); // клетка → время появления
      let clears = []; // { i, k, t0, sp }
      let parts = [];
      let ghost = null; // { cells, r0, c0, k, rows, cols }
      let raf = 0;
      const kick = () => { if (!raf) raf = requestAnimationFrame(frame); };
      function frame(now) {
        raf = 0;
        draw(now);
        if (clears.length || parts.length || pops.size) kick();
      }

      function drawCell(g, k, x, y, size, scale = 1, alpha = 1) {
        const spr = sprite(k, size);
        if (alpha !== 1) g.globalAlpha = alpha;
        if (scale === 1) g.drawImage(spr, x, y);
        else {
          const s = size * scale;
          g.drawImage(spr, x + (size - s) / 2, y + (size - s) / 2, s, s);
        }
        if (alpha !== 1) g.globalAlpha = 1;
      }

      function draw(now) {
        const g = board.getContext('2d');
        const size = cs();
        g.clearRect(0, 0, board.width, board.height);
        g.drawImage(bg, 0, 0);
        // подсветка рядов, которые закроются, если отпустить фигуру здесь
        if (ghost && (ghost.rows.length || ghost.cols.length)) {
          g.fillStyle = mode.ops ? 'rgba(63, 214, 255, 0.18)' : 'rgba(255, 214, 81, 0.2)';
          for (const r of ghost.rows) g.fillRect(P * dpr, (P + r * pitch) * dpr, N * pitch * dpr, pitch * dpr);
          for (const col of ghost.cols) g.fillRect((P + col * pitch) * dpr, P * dpr, pitch * dpr, N * pitch * dpr);
        }
        for (let i = 0; i < N * N; i++) {
          const v = grid[i];
          if (!v) continue;
          const r = (i / N) | 0;
          const col = i % N;
          let scale = 1;
          const p0 = pops.get(i);
          if (p0 !== undefined) {
            const e = (now - p0) / 170;
            if (e >= 1) pops.delete(i);
            else scale = 1 + 0.18 * Math.sin(Math.max(0, e) * Math.PI);
          }
          const inLine = ghost && (ghost.rows.includes(r) || ghost.cols.includes(col));
          drawCell(g, inLine ? ghost.k : v - 1, cellPos(col), cellPos(r), size, scale);
        }
        if (ghost) {
          for (const [r, col] of ghost.cells) drawCell(g, ghost.k, cellPos(ghost.c0 + col), cellPos(ghost.r0 + r), size, 1, 0.5);
        }
        // закрывающиеся ряды: вспышка → клетка сжимается, вылетают искры
        clears = clears.filter((c) => {
          const e = (now - c.t0) / 300;
          const x = cellPos(c.i % N);
          const y = cellPos((c.i / N) | 0);
          if (e < 0) {
            drawCell(g, c.k, x, y, size);
            return true;
          }
          if (!c.sp) {
            c.sp = true;
            if (!reducedMotion && parts.length < 160) {
              const [light, mid] = mode.colors[c.k];
              for (let j = 0; j < 3; j++) {
                const a = Math.random() * Math.PI * 2;
                const sp = (1.2 + Math.random() * 2.4) * dpr;
                parts.push({ x: x + size / 2, y: y + size / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.6 * dpr, t0: now, life: 520 + Math.random() * 260, color: j ? light : mid, s: (2.5 + Math.random() * 3) * dpr });
              }
            }
          }
          if (e >= 1) return false;
          const k2 = e * e;
          drawCell(g, c.k, x, y, size, 1 - k2, 1 - e * 0.4);
          if (e < 0.6) drawCell(g, -1, x, y, size, 1 - k2, (0.6 - e) * 1.2);
          return true;
        });
        // искры
        parts = parts.filter((p) => {
          const e = (now - p.t0) / p.life;
          if (e >= 1) return false;
          p.vy += 0.12 * dpr;
          p.x += p.vx;
          p.y += p.vy;
          g.globalAlpha = 1 - e;
          g.fillStyle = p.color;
          g.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
          return true;
        });
        g.globalAlpha = 1;
      }

      function drawTray() {
        slots.forEach((slot, i) => {
          const cv = slot.firstChild;
          const p = tray[i];
          slot.classList.toggle('empty', !p);
          if (!p) {
            slot.removeAttribute('aria-label');
            cv.width = cv.height = 0;
            return;
          }
          const cells = cellsOf(p);
          const { rows, cols } = sizeOf(cells);
          const tp = trayPitch * dpr;
          const size = Math.round(tp * 0.9);
          cv.width = Math.round(cols * tp);
          cv.height = Math.round(rows * tp);
          cv.style.width = `${cols * trayPitch}px`;
          cv.style.height = `${rows * trayPitch}px`;
          const g = cv.getContext('2d');
          g.clearRect(0, 0, cv.width, cv.height);
          for (const [r, c] of cells) g.drawImage(sprite(p.k, size), c * tp + (tp - size) / 2, r * tp + (tp - size) / 2);
          slot.classList.toggle('dim', !canPlace(grid, cells));
          slot.setAttribute('aria-label', t('gamePieceAria', { n: cells.length }));
          // «Поднятая» фигура готовится заранее — при касании ничего не рисуем
          if (!(floats[i] && floats[i].p === p && floats[i].w === cols * pitch)) floats[i] = buildFloat(p);
        });
      }

      // ─ HUD
      function updateHud() {
        scoreEl.textContent = fmt(score);
        scoreEl.classList.remove('bump');
        void scoreEl.offsetWidth; // перезапуск анимации
        scoreEl.classList.add('bump');
        bestEl.textContent = fmt(Math.max(best0, score));
        comboEl.textContent = combo >= 2 ? t('gameCombo', { n: combo }) : '';
      }
      function updateRefresh() {
        refreshBtn.replaceChildren('🔄', h('span', { class: 'g-count' }, String(refresh)));
        // Без запаса кнопка не выключается, а подсказывает, где взять «Новые фигуры»
        refreshBtn.classList.toggle('none', refresh <= 0);
        refreshBtn.setAttribute('aria-label', t('gameRefreshAria', { n: refresh }));
      }
      function updateSoundBtn() {
        soundBtn.textContent = SB.soundOn() ? '🔊' : '🔇';
        soundBtn.setAttribute('aria-label', SB.soundOn() ? t('soundOn') : t('soundOff'));
      }
      function toggleSound() {
        store.set('sound', SB.soundOn() ? 'off' : 'on');
        updateSoundBtn();
      }

      function fxText(cls, text, x, y) {
        const el = h('div', { class: cls }, text);
        if (x !== undefined) { el.style.left = `${x}px`; el.style.top = `${y}px`; }
        fxLayer.append(el);
        setTimeout(() => el.remove(), cls.startsWith('g-overtake') ? 2600 : 1200);
      }

      function persist() {
        const d = load();
        d.cur = over ? null : { grid: grid.join(''), tray, score, combo, idle, best0 };
        if (score > (Number(d.best) || 0)) d.best = score;
        save(d);
      }

      // ─ Перетаскивание фигуры пальцем или мышью.
      // Раньше «тяжесть» давали: запуск звука браузера прямо при первом касании фигуры
      // (до 0,2–0,5 с стоп-кадра на телефоне), сдвиг фигуры только в следующем кадре,
      // плавный рост фигуры из размера лотка, замер поля после вставки фигуры в страницу
      // и строгая привязка к одной клетке. Теперь: картинка фигуры готова заранее (floats),
      // размеры замеряются один раз до любых изменений страницы, фигура двигается прямо
      // в обработчике касания, тень на поле перерисовывается только при смене клетки,
      // привязка — к ближайшей подходящей клетке в радиусе ~1 клетки.
      let drag = null;
      let floats = []; // готовые «поднятые» фигуры для каждого места лотка (размер клетки поля)
      function buildFloat(p) {
        const cells = cellsOf(p);
        const { rows, cols } = sizeOf(cells);
        const w = cols * pitch;
        const hh = rows * pitch;
        const cv = h('canvas');
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(hh * dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${hh}px`;
        const g = cv.getContext('2d');
        const size = cs();
        for (const [r, c] of cells) g.drawImage(sprite(p.k, size), (c * pitch + gap / 2) * dpr, (r * pitch + gap / 2) * dpr);
        const inner = h('div', { class: 'g-float-in' }, cv);
        return { el: h('div', { class: 'g-float', 'aria-hidden': 'true' }, inner), inner, w, h: hh, cells, p };
      }
      function onDown(e, i) {
        if (drag || over || !tray[i] || (e.button !== undefined && e.button > 0)) return;
        e.preventDefault();
        if (hand) hand.classList.add('off');
        const f = floats[i] && floats[i].p === tray[i] ? floats[i] : (floats[i] = buildFloat(tray[i]));
        const rect = board.getBoundingClientRect(); // до изменений страницы — без пересчёта раскладки
        // Фигура поднимается над пальцем (палец её не закрывает); мышью — держим за середину
        const lift = e.pointerType === 'mouse' ? f.h / 2 : f.h + pitch * 0.8;
        drag = { i, p: tray[i], cells: f.cells, el: f.el, inner: f.inner, w: f.w, h: f.h, lift, x0: e.clientX, y0: e.clientY, pid: e.pointerId, rect, target: null, moved: false };
        f.el.style.transition = 'none';
        f.inner.style.transition = 'none';
        f.inner.style.transform = '';
        position(e.clientX, e.clientY);
        document.body.append(f.el);
        slots[i].classList.add('lifted');
        try { slots[i].setPointerCapture(e.pointerId); } catch { /* не страшно */ }
        sfx.pick();
      }
      function onMove(e) {
        if (!drag || e.pointerId !== drag.pid) return;
        if (!drag.moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) > 6) drag.moved = true;
        position(e.clientX, e.clientY); // сразу, без ожидания следующего кадра
      }
      // Щедрая привязка: ближайшая к фигуре позиция в радиусе ~1 клетки, куда она помещается
      function snap(left, top) {
        const fx = (left - drag.rect.left - P) / pitch;
        const fy = (top - drag.rect.top - P) / pitch;
        const rx = Math.round(fx);
        const ry = Math.round(fy);
        let best = null;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const c0 = rx + dx;
            const r0 = ry + dy;
            const dist = (c0 - fx) ** 2 + (r0 - fy) ** 2;
            if (dist > 1.1 || (best && dist >= best.dist)) continue;
            if (fits(grid, drag.cells, r0, c0)) best = { r0, c0, dist };
          }
        }
        return best;
      }
      function position(x, y) {
        const left = x - drag.w / 2;
        const top = y - drag.lift;
        drag.el.style.transform = `translate3d(${left}px, ${top}px, 0)`;
        const tgt = snap(left, top);
        const same = tgt ? drag.target && drag.target.r0 === tgt.r0 && drag.target.c0 === tgt.c0 : !drag.target;
        if (same) return;
        drag.target = tgt;
        if (tgt) {
          const test = grid.slice();
          for (const [r, c] of drag.cells) test[(tgt.r0 + r) * N + tgt.c0 + c] = 1;
          ghost = { cells: drag.cells, r0: tgt.r0, c0: tgt.c0, k: drag.p.k, ...fullLines(test) };
        } else {
          ghost = null;
        }
        kick(); // тень на поле — в ближайшем кадре и только при смене клетки
      }
      function onUp(e) {
        if (!drag || e.pointerId !== drag.pid) return;
        if (e.type === 'pointerup') position(e.clientX, e.clientY);
        const d = drag;
        drag = null;
        ghost = null;
        if (d.target && e.type === 'pointerup') {
          d.el.remove();
          slots[d.i].classList.remove('lifted');
          placePiece(d.i, d.target);
        } else {
          // фигура плавно возвращается на место
          const sr = slots[d.i].getBoundingClientRect();
          d.el.style.transition = 'transform 0.16s ease-out';
          d.inner.style.transition = 'transform 0.16s ease-out';
          d.el.style.transform = `translate3d(${sr.left + sr.width / 2 - d.w / 2}px, ${sr.top + sr.height / 2 - d.h / 2}px, 0)`;
          d.inner.style.transform = `scale(${trayPitch / pitch})`;
          setTimeout(() => {
            if (drag && drag.el === d.el) return; // ту же фигуру уже снова взяли
            d.el.remove();
            slots[d.i].classList.remove('lifted');
          }, reducedMotion ? 0 : 170);
          if (d.moved) sfx.back();
        }
        kick();
      }
      slots.forEach((slot, i) => {
        slot.addEventListener('pointerdown', (e) => onDown(e, i));
        slot.addEventListener('contextmenu', (e) => e.preventDefault());
      });
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);

      // ─ Ход
      function placePiece(i, { r0, c0 }) {
        const p = tray[i];
        const cells = cellsOf(p);
        const now = performance.now();
        for (const [r, c] of cells) {
          const idx = (r0 + r) * N + c0 + c;
          grid[idx] = p.k + 1;
          pops.set(idx, now);
        }
        tray[i] = null;
        let gained = cells.length * 10;
        const { rows, cols } = fullLines(grid);
        const lines = rows.length + cols.length;
        const { rows: pr, cols: pc } = sizeOf(cells);
        const cx = P + (c0 + pc / 2) * pitch;
        const cy = P + (r0 + pr / 2) * pitch;
        if (lines) {
          combo = Math.min(MAX_COMBO, combo + 1);
          idle = 0;
          gained += LINE_POINTS[Math.min(lines, LINE_POINTS.length - 1)] * Math.max(1, combo);
          const gone = new Set();
          rows.forEach((r) => { for (let c = 0; c < N; c++) gone.add(r * N + c); });
          cols.forEach((c) => { for (let r = 0; r < N; r++) gone.add(r * N + c); });
          const mr = r0 + (pr - 1) / 2;
          const mc = c0 + (pc - 1) / 2;
          for (const idx of gone) {
            const delay = reducedMotion ? 0 : 70 + Math.hypot(((idx / N) | 0) - mr, (idx % N) - mc) * 26;
            clears.push({ i: idx, k: grid[idx] - 1, t0: now + delay, sp: false });
            grid[idx] = 0;
            pops.delete(idx);
          }
          const clean = grid.every((v) => !v);
          if (clean) gained += CLEAN_BONUS;
          const names = t('gameLines');
          const title = clean ? t('gameClean') : names[Math.min(lines, names.length) - 1];
          fxText('g-banner', combo >= 2 ? `${title} ${t('gameCombo', { n: combo })}` : title);
          sfx.clear(lines, combo);
          buzz(lines > 1 ? [18, 40, 18] : 18);
        } else {
          idle += 1;
          if (idle >= mode.idle) combo = 0;
          sfx.place();
        }
        score += gained;
        fxText('g-pop', `+${fmt(gained)}`, cx, cy);
        if (tray.every((x) => !x)) tray = newTray(grid, mode);
        if (hand && hand.isConnected) {
          hand.remove();
          store.set('gameHint', '1');
        }
        updateHud();
        checkRace();
        drawTray();
        persist();
        checkMoves();
        kick();
      }

      function doRefresh() {
        if (over || drag) return;
        if (refresh <= 0) { toast(t('gameSpinHint')); return; }
        refresh -= 1;
        const d = load();
        d.spinsUsed = (Number(d.spinsUsed) || 0) + 1;
        save(d);
        tray = newTray(grid, mode);
        sfx.refresh();
        refreshBtn.classList.remove('pulse');
        updateRefresh();
        drawTray();
        persist();
        checkMoves();
      }

      function checkMoves() {
        if (tray.some((p) => p && canPlace(grid, cellsOf(p)))) return;
        if (refresh > 0) {
          refreshBtn.classList.add('pulse');
          toast(t('gameNoMoves'));
          return;
        }
        over = true;
        persist();
        sent = score;
        const submit = sendScore(score, true);
        setTimeout(() => finish(submit), reducedMotion ? 100 : 550);
      }

      function finish(submit) {
        if (!screen.isConnected) return;
        const isBest = score > best0 && score > 0;
        if (isBest) { sfx.best(); confetti(); } else sfx.over();
        result({
          score,
          best: Math.max(best0, score, race ? race.startBest : 0),
          isBest,
          prevPlace: race ? race.prevPlace : undefined, // undefined — рейтинг в начале раунда не загрузился
          submit,
        });
      }

      function exit() {
        if (!over) toast(t('gameSaved'));
        ctx.go('#/map');
      }

      let resizeRaf = 0;
      const onResize = () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; if (!drag) layout(); });
      };
      window.addEventListener('resize', onResize);

      disposers.push(() => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        window.removeEventListener('resize', onResize);
        if (raf) cancelAnimationFrame(raf);
        if (drag) drag.el.remove();
        drag = null;
        // Ушли посреди раунда с новым рекордом — отправляем его (раунд продолжится позже)
        if (ctx.rating && !over && score > best0 && score > sent) { sent = score; sendScore(score, false); }
      });

      layout();
      onResize(); // ещё раз на следующем кадре, когда страница точно уложилась
      // В сохранённом раунде могло не остаться ходов (например, закрыли вкладку в этот момент)
      checkMoves();
    }
  }

  SB.game = { info, render, starsFor, LOGO, LOGO_OPS, ROUNDS_PER_MISSION };
})();
