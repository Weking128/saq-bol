// Общие помощники интерфейса: создание элементов, запросы к API,
// нижние шторки, всплывающие подсказки, конфетти и талисман.
(function () {
  'use strict';

  // h('div', {class: 'card', onclick: fn}, 'текст', child) — безопасное создание DOM.
  // Свойство html используется только для собственного статического контента игры.
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // localStorage может быть недоступен (приватный режим) — не падаем.
  const memory = {};
  const store = {
    get(k) { try { return localStorage.getItem('sb:' + k); } catch { return memory[k] ?? null; } },
    set(k, v) { try { localStorage.setItem('sb:' + k, v); } catch { memory[k] = v; } },
    del(k) { try { localStorage.removeItem('sb:' + k); } catch { delete memory[k]; } },
  };

  async function api(path, opts = {}) {
    const t = (k) => (window.SB.t ? window.SB.t(k) : k);
    const headers = { 'X-Lang': window.SB.lang || 'ru' };
    const token = store.get('token');
    if (token) headers['X-Participant-Token'] = token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw Object.assign(new Error(t('noConnection')), { status: 0 });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || t('serverError')), { status: res.status });
    return data;
  }

  // Нижняя шторка. Возвращает Promise со значением нажатой кнопки.
  function sheet({ tone = '', emoji, title, text, html, content, actions = [{ label: 'Дальше' }], dismissible = false }) {
    return new Promise((resolve) => {
      const prevFocus = document.activeElement;
      const close = (value) => {
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
        resolve(value);
      };
      const onKey = (e) => { if (e.key === 'Escape' && dismissible) close(null); };
      const buttons = actions.map((a) =>
        h('button', { class: 'btn ' + (a.class || ''), onclick: () => close(a.value ?? true) }, a.label));
      const box = h('div', { class: `sheet ${tone}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sheet-title' },
        h('div', { class: 'head' }, emoji && h('div', { class: 'emo', 'aria-hidden': 'true' }, emoji), h('h3', { id: 'sheet-title' }, title)),
        (text || html || content) && h('div', { class: 'body' }, text, html && h('div', { html }), content),
        actions.length > 1 ? h('div', { class: 'stack-sm' }, buttons) : buttons);
      const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => { if (dismissible && e.target === backdrop) close(null); } }, box);
      document.body.append(backdrop);
      document.addEventListener('keydown', onKey);
      setTimeout(() => buttons[0] && buttons[0].focus({ preventScroll: true }), 50);
    });
  }

  let toastEl = null;
  let toastTimer = null;
  function toast(text, tone = '', ms = 2600) {
    if (toastEl) toastEl.remove();
    clearTimeout(toastTimer);
    toastEl = h('div', { class: `toast ${tone}`, role: 'status' }, text);
    document.body.append(toastEl);
    toastTimer = setTimeout(() => { if (toastEl) toastEl.remove(); toastEl = null; }, ms);
  }

  function confetti() {
    if (reducedMotion) return;
    const colors = ['#00a3c4', '#f5b800', '#ff6b6b', '#129a57', '#6c5ce7', '#ffffff'];
    const box = h('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 90; i++) {
      const piece = h('i', {
        style: {
          left: Math.random() * 100 + 'vw',
          background: pick(colors),
          animationDuration: 2.2 + Math.random() * 2 + 's',
          animationDelay: Math.random() * 0.6 + 's',
        },
      });
      // CSS-переменные через Object.assign не ставятся — только setProperty
      piece.style.setProperty('--dx', (Math.random() * 200 - 100) + 'px');
      piece.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
      box.append(piece);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 5000);
  }

  // Талисман — «Агент Сақ», щит с глазами.
  const MASCOT_SVG = `
<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="sbShield" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#22c3e0"/><stop offset="1" stop-color="#0a5f8a"/>
    </linearGradient>
  </defs>
  <path d="M60 10 L101 23 V57 C101 85 84 103 60 113 C36 103 19 85 19 57 V23 Z" fill="url(#sbShield)" stroke="#f5b800" stroke-width="6" stroke-linejoin="round"/>
  <path d="M60 18 L93 28.5 V57 C93 80 79 95 60 104" fill="none" stroke="#ffffff" stroke-opacity=".18" stroke-width="5" stroke-linecap="round"/>
  <ellipse cx="45" cy="55" rx="11" ry="12" fill="#fff"/>
  <ellipse cx="75" cy="55" rx="11" ry="12" fill="#fff"/>
  <circle cx="47" cy="57" r="6" fill="#0d1b3d"/>
  <circle cx="77" cy="57" r="6" fill="#0d1b3d"/>
  <circle cx="49" cy="54.5" r="2" fill="#fff"/>
  <circle cx="79" cy="54.5" r="2" fill="#fff"/>
  <path d="M34 40 Q45 34 54 39" stroke="#0d1b3d" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M66 39 Q75 34 86 40" stroke="#0d1b3d" stroke-width="4" fill="none" stroke-linecap="round"/>
  <circle cx="36" cy="71" r="5" fill="#ff8fa3" opacity=".55"/>
  <circle cx="84" cy="71" r="5" fill="#ff8fa3" opacity=".55"/>
  <path d="M49 76 Q60 86 71 76" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round"/>
  <path d="M60 2 l3.2 6.6 7.2 1 -5.2 5 1.3 7.2 -6.5 -3.4 -6.5 3.4 1.3 -7.2 -5.2 -5 7.2 -1 z" fill="#f5b800"/>
</svg>`;

  function mascot(cls = 'mascot') {
    return h('div', { class: cls, html: MASCOT_SVG });
  }

  const ICONS = {
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h11"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
  };
  const icon = (name) => h('span', { html: ICONS[name], style: { display: 'contents' } });

  const fmt = (n) => Number(n).toLocaleString('ru-RU');

  window.SB = { h, sleep, shuffle, pick, store, api, sheet, toast, confetti, mascot, icon, fmt, reducedMotion, MASCOT_SVG };
})();
