// Праздничные эффекты: экран «Миссия пройдена!» с салютом, лучами, звёздами,
// счётчиком очков и короткой мелодией (звук можно выключить — кнопка 🔊).
(function () {
  'use strict';
  const { h, store, reducedMotion, confetti, t } = SB;

  // ─── Звук (синтезируется в браузере, без файлов) ──────────────────────
  let audio = null;
  const soundOn = () => store.get('sound') !== 'off';

  function tone(freq, at, dur, type = 'triangle', vol = 0.07) {
    if (!soundOn()) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = audio.currentTime + at;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    } catch { /* звук недоступен — не страшно */ }
  }

  const fanfare = () => {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.11, 0.25));
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(f, 0.5, 0.7, 'sine', 0.045));
  };
  const ding = (i) => tone(880 * Math.pow(1.26, i), 0, 0.3, 'sine', 0.08);

  // ─── Салют на canvas ──────────────────────────────────────────────────
  function fireworks(canvas, duration = 3600) {
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
    };
    resize();
    const W = () => canvas.width;
    const H = () => canvas.height;
    const parts = [];
    const colors = ['#ffd451', '#ff6b6b', '#4dd4ff', '#7CFF9B', '#c08bff', '#ffffff', '#ff9f43'];
    const burst = () => {
      const x = W() * (0.15 + Math.random() * 0.7);
      const y = H() * (0.12 + Math.random() * 0.38);
      const color = colors[Math.floor(Math.random() * colors.length)];
      const n = 70;
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const s = (2.5 + Math.random() * 4.5) * dpr;
        parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, decay: 0.012 + Math.random() * 0.012, color, r: (1.6 + Math.random() * 1.8) * dpr });
      }
    };
    const start = performance.now();
    const schedule = [0, 300, 650, 1000, 1400, 1800, 2300];
    let fired = 0;
    let raf = 0;
    const frame = (now) => {
      const el = now - start;
      while (fired < schedule.length && el >= schedule[fired]) { burst(); fired += 1; }
      ctx.clearRect(0, 0, W(), H());
      ctx.globalCompositeOperation = 'lighter';
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vx *= 0.985;
        p.vy = p.vy * 0.985 + 0.06 * dpr;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (el < duration || parts.length) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }

  // ─── Экран празднования ───────────────────────────────────────────────
  // celebrate({ emoji, title, subtitle, stars (0–3), xp, badge, button }) → Promise
  SB.celebrate = function celebrate({ emoji, title, subtitle, stars = 0, xp = null, badge = null, button }) {
    return new Promise((resolve) => {
      const canvas = h('canvas', { 'aria-hidden': 'true' });
      const starEls = [0, 1, 2].map(() => h('span', null, '⭐'));
      const xpNum = h('b', null, '0');
      const sound = h('button', {
        class: 'cele-sound', type: 'button', 'aria-label': soundOn() ? t('soundOn') : t('soundOff'),
        onclick: () => {
          store.set('sound', soundOn() ? 'off' : 'on');
          sound.textContent = soundOn() ? '🔊' : '🔇';
          sound.setAttribute('aria-label', soundOn() ? t('soundOn') : t('soundOff'));
        },
      }, soundOn() ? '🔊' : '🔇');
      // Буквы заголовка подпрыгивают по очереди
      const titleEl = h('h2', { class: 'cele-title' }, [...title].map((ch, i) =>
        h('span', { style: { animationDelay: `${0.25 + i * 0.04}s` } }, ch === ' ' ? ' ' : ch)));
      const btn = h('button', { class: 'btn gold cele-btn', type: 'button' }, button);
      const overlay = h('div', { class: 'celebrate', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('div', { class: 'rays', 'aria-hidden': 'true' }),
        canvas,
        sound,
        h('div', { class: 'cele-card' },
          h('div', { class: 'cele-badge', 'aria-hidden': 'true' }, emoji),
          titleEl,
          subtitle && h('p', { class: 'cele-sub' }, subtitle),
          stars > 0 && h('div', { class: 'cele-stars', 'aria-label': t('starsAria', { n: stars }) }, starEls),
          xp !== null && h('div', { class: 'cele-xp' }, '+', xpNum, ' XP'),
          badge && h('div', { class: 'cele-badge-name' }, badge),
          btn));
      document.body.append(overlay);
      document.body.classList.add('no-scroll');

      const timers = [];
      let stopFx = () => {};
      if (!reducedMotion) {
        stopFx = fireworks(canvas);
        confetti();
      }
      fanfare();
      starEls.forEach((el, i) => {
        if (i >= stars) return;
        timers.push(setTimeout(() => { el.classList.add('on'); ding(i); }, reducedMotion ? 0 : 700 + i * 380));
      });
      if (xp !== null) {
        const begin = reducedMotion ? 0 : 1300;
        timers.push(setTimeout(() => {
          const t0 = performance.now();
          const step = (now) => {
            const k = Math.min(1, (now - t0) / 800);
            xpNum.textContent = String(Math.round(xp * (1 - Math.pow(1 - k, 3))));
            if (k < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        }, begin));
      }
      setTimeout(() => btn.focus({ preventScroll: true }), 400);

      btn.addEventListener('click', () => {
        timers.forEach(clearTimeout);
        stopFx();
        overlay.classList.add('leaving');
        setTimeout(() => {
          overlay.remove();
          document.body.classList.remove('no-scroll');
          resolve();
        }, reducedMotion ? 0 : 250);
      });
    });
  };

  // Искры вокруг элемента (открытие новой точки на карте)
  SB.sparkle = function sparkle(el) {
    if (reducedMotion || !el) return;
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI * 2 * i) / 10;
      const s = h('span', { class: 'spark', 'aria-hidden': 'true' }, i % 2 ? '✨' : '⭐');
      s.style.setProperty('--sx', `${Math.cos(a) * 70}px`);
      s.style.setProperty('--sy', `${Math.sin(a) * 70}px`);
      el.append(s);
      setTimeout(() => s.remove(), 1200);
    }
    tone(1318.5, 0, 0.35, 'sine', 0.06);
  };
})();
