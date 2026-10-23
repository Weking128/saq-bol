// Движок миссий: каждый шаг миссии — это урок или мини-игра.
// Типы шагов: lesson, sort, choice, spot, chat, pyramid.
// Каждый движок возвращает Promise<{score, max}>.
(function () {
  'use strict';
  const { h, sleep, shuffle, pick, sheet, toast, mascot, icon, fmt, reducedMotion, t } = SB;

  function header(step) {
    return [
      step.kicker && h('div', { class: 'step-kicker' }, step.kicker),
      step.title && h('h2', { class: 'step-title' }, step.title),
      step.say && h('div', { class: 'mascot-say' }, mascot(), h('div', { class: 'bubble' }, step.say)),
      step.prompt && h('p', { class: 'lesson' }, step.prompt),
    ];
  }

  const engines = {
    // ── Урок ────────────────────────────────────────────────────────────
    lesson(step, root) {
      return new Promise((resolve) => {
        root.replaceChildren(h('div', { class: 'stack' },
          header(step),
          step.html && h('div', { class: 'lesson stack', html: step.html }),
          h('button', { class: 'btn', onclick: () => resolve({ score: 0, max: 0 }) }, step.button || t('further'))));
      });
    },

    // ── Сортировка карточек по двум корзинам ────────────────────────────
    sort(step, root) {
      return new Promise((resolve) => {
        const items = shuffle(step.items);
        let i = 0;
        let score = 0;
        let busy = false;
        const counter = h('div', { class: 'sort-counter' });
        const itemBox = h('div', { 'aria-live': 'polite' });
        const bins = h('div', { class: 'bins' }, step.bins.map((b) =>
          h('button', { class: `bin tone-${b.tone || 'sky'}`, onclick: () => choose(b.id) },
            h('span', { class: 'emo', 'aria-hidden': 'true' }, b.emoji), b.label)));
        root.replaceChildren(h('div', { class: 'stack' }, header(step), h('div', { class: 'sort-stage' }, counter, itemBox, bins)));

        function show() {
          const it = items[i];
          counter.replaceChildren(h('span', null, t('cardOf', { i: i + 1, n: items.length })), h('span', null, `✓ ${score}`));
          itemBox.replaceChildren(h('div', { class: 'sort-item' + (it.mono ? ' mono' : '') },
            it.emoji && h('div', { class: 'emo', 'aria-hidden': 'true' }, it.emoji),
            h('div', null, it.text)));
        }

        async function choose(binId) {
          if (busy) return;
          busy = true;
          const it = items[i];
          const ok = it.bin === binId;
          if (ok) score += 1;
          const right = step.bins.find((b) => b.id === it.bin);
          await sheet({
            tone: ok ? 'ok' : 'bad',
            emoji: ok ? '✅' : '❌',
            title: ok ? pick(t('praise')) : t('rightIs', { label: right.label }),
            text: it.why,
            actions: [{ label: i + 1 < items.length ? t('nextCard') : t('done') }],
          });
          i += 1;
          busy = false;
          if (i < items.length) show();
          else resolve({ score, max: items.length });
        }
        show();
      });
    },

    // ── Вопрос с вариантами ответа ──────────────────────────────────────
    choice(step, root) {
      return new Promise((resolve) => {
        const opts = step.shuffle === false ? step.options : shuffle(step.options);
        const keys = t('optionKeys');
        const buttons = opts.map((o, k) =>
          h('button', { class: 'option', onclick: () => choose(k) }, h('span', { class: 'key' }, keys[k]), h('span', null, o.text)));
        root.replaceChildren(h('div', { class: 'stack' },
          header({ ...step, title: step.title || t('situation') }),
          h('div', { class: 'q-text' }, step.q),
          h('div', { class: 'options' }, buttons)));

        async function choose(k) {
          buttons.forEach((b) => { b.disabled = true; });
          const o = opts[k];
          const ok = !!o.correct;
          buttons[k].classList.add(ok ? 'right' : 'wrong');
          if (!ok) buttons[opts.findIndex((x) => x.correct)].classList.add('right');
          await sleep(reducedMotion ? 0 : 450);
          await sheet({
            tone: ok ? 'ok' : 'bad',
            emoji: ok ? '🎉' : '🤔',
            title: ok ? pick(t('praise')) : t('notQuite'),
            text: o.feedback,
            actions: [{ label: t('further') }],
          });
          resolve({ score: ok ? 1 : 0, max: 1 });
        }
      });
    },

    // ── «Найди подвох»: тапни по подозрительным местам ──────────────────
    spot(step, root) {
      return new Promise((resolve) => {
        const flagIds = Object.keys(step.flags);
        const found = [];
        let misses = 0;
        let finished = false;
        const hud = h('div', { class: 'spot-hud', 'aria-live': 'polite' });
        const mock = h('div', { html: step.mock });
        const giveUp = h('button', { class: 'link-btn', onclick: () => finish() }, t('giveUp'));
        root.replaceChildren(h('div', { class: 'stack' }, header(step), hud, mock, h('div', { class: 'center' }, giveUp)));

        function updateHud() {
          hud.replaceChildren(
            h('span', { class: 'found' }, t('foundOf', { f: found.length, n: flagIds.length })),
            h('span', { class: 'miss' }, misses ? t('misses', { m: misses }) : ''));
        }

        mock.querySelectorAll('[data-spot]').forEach((el) => {
          el.classList.add('spot');
          el.setAttribute('role', 'button');
          el.tabIndex = 0;
          el.addEventListener('click', (e) => { e.preventDefault(); tap(el); });
          el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(el); }
          });
        });

        function tap(el) {
          if (finished) return;
          const id = el.dataset.spot;
          if (step.flags[id]) {
            if (found.includes(id)) return;
            found.push(id);
            el.classList.add('hit');
            el.append(h('span', { class: 'flag-n' }, String(found.length)));
            toast(`🚩 ${step.flags[id].label}`, 'ok');
            updateHud();
            if (found.length === flagIds.length) setTimeout(finish, 700);
          } else {
            misses += 1;
            el.classList.remove('nope');
            void el.offsetWidth; // перезапуск анимации
            el.classList.add('nope');
            toast(el.dataset.note || t('noTrickHere'));
            updateHud();
          }
        }

        async function finish() {
          if (finished) return;
          finished = true;
          giveUp.remove();
          const missed = flagIds.filter((id) => !found.includes(id));
          let n = found.length;
          for (const id of missed) {
            const el = mock.querySelector(`[data-spot="${id}"]`);
            if (el) { el.classList.add('revealed'); el.append(h('span', { class: 'flag-n' }, String(++n))); }
          }
          const all = found.length === flagIds.length;
          const list = h('ol', { class: 'flag-list' }, [...found, ...missed].map((id, k) =>
            h('li', null,
              h('span', { class: 'n' + (found.includes(id) ? '' : ' missed') }, String(k + 1)),
              h('div', null, h('b', null, step.flags[id].label), ' — ', step.flags[id].why))));
          await sheet({
            tone: all ? 'ok' : '',
            emoji: all ? '🕵️' : '🔎',
            title: all ? t('allFound') : t('foundSummary', { f: found.length, n: flagIds.length }),
            content: list,
            actions: [{ label: t('further') }],
          });
          resolve({ score: Math.max(0, found.length - Math.floor(misses / 2)), max: flagIds.length });
        }
        updateHud();
      });
    },

    // ── Переписка или звонок с ветвлением ───────────────────────────────
    chat(step, root) {
      return new Promise((resolve) => {
        const style = step.style || 'msg';
        const status = h('small', null, step.contact.status || '');
        const body = h('div', { class: 'chat-body', 'aria-live': 'polite' });
        const choices = h('div', { class: 'chat-choices' });
        const chat = h('div', { class: `chat chat-${style}` },
          h('div', { class: 'chat-head' }, h('div', { class: 'av', 'aria-hidden': 'true' }, step.contact.avatar), h('div', null, h('b', null, step.contact.name), status)),
          body, choices);
        root.replaceChildren(h('div', { class: 'stack' }, header(step), chat));

        let score = 0;
        let timer = null;
        if (style === 'call') {
          const t0 = Date.now();
          const tick = () => {
            const s = Math.floor((Date.now() - t0) / 1000);
            status.textContent = `${step.contact.status} · ${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
          };
          tick();
          timer = setInterval(tick, 1000);
        }

        const keepVisible = () => choices.scrollIntoView({ block: 'end', behavior: reducedMotion ? 'auto' : 'smooth' });

        async function add(m) {
          if (m.from === 'them' || m.from === 'post') {
            const typing = h('div', { class: 'typing', 'aria-label': t('typing') }, h('i'), h('i'), h('i'));
            body.append(typing);
            keepVisible();
            await sleep(reducedMotion ? 120 : Math.min(1500, 420 + m.text.length * 13));
            typing.remove();
          } else {
            await sleep(reducedMotion ? 0 : 180);
          }
          const el = m.from === 'post'
            ? h('div', { class: 'post' }, h('div', { class: 'ch' }, m.channel), m.text)
            : h('div', { class: `msg ${m.from}${m.link ? ' link' : ''}` }, m.text);
          body.append(el);
          keepVisible();
        }

        async function go(id) {
          const node = step.nodes[id];
          choices.replaceChildren();
          for (const m of node.msgs || []) await add(m);
          if (node.end) {
            clearInterval(timer);
            if (style === 'call') status.textContent = t('callEnded');
            await sleep(reducedMotion ? 0 : 500);
            const tone = node.end === 'good' ? 'ok' : node.end === 'bad' ? 'bad' : '';
            await sheet({
              tone,
              emoji: node.emoji || (node.end === 'good' ? '🛡️' : node.end === 'bad' ? '💸' : '🙂'),
              title: node.title,
              text: node.text,
              actions: [{ label: t('further') }],
            });
            resolve({ score, max: step.max });
            return;
          }
          choices.append(h('div', { class: 'lead' }, node.lead || t('whatReply')));
          for (const c of node.shuffle === false ? node.choices : shuffle(node.choices)) {
            choices.append(h('button', {
              class: 'reply',
              onclick: async () => {
                choices.replaceChildren();
                score += c.points || 0;
                await add({ from: 'me', text: c.say || c.text });
                go(c.to);
              },
            }, c.text));
          }
          keepVisible();
        }
        go('start');
      });
    },

    // ── Симуляция финансовой пирамиды ───────────────────────────────────
    pyramid(step, root) {
      return new Promise((resolve) => {
        const MAX = 16;
        const MILESTONES = { 1: 'pyrM1', 2: 'pyrM2', 4: 'pyrM4', 7: 'pyrM7', 10: 'pyrM10', 13: 'pyrM13', 15: 'pyrM15' };
        let level = 0;
        let total = 0;
        const lvlEl = h('b', null, '0');
        const totEl = h('b', null, '0');
        const pyr = h('div', { class: 'pyramid', 'aria-hidden': 'true' });
        const msg = h('div', { class: 'pyr-msg rule blue', 'aria-live': 'polite' }, t('pyrStart'));
        const btn = h('button', { class: 'btn gold', onclick: add }, t('pyrButton'));
        root.replaceChildren(h('div', { class: 'stack' },
          header(step),
          h('div', { class: 'pyr-stats' },
            h('div', null, h('small', null, t('pyrLevels')), lvlEl),
            h('div', null, h('small', null, t('pyrTotal')), totEl)),
          pyr, msg, btn));

        function add() {
          if (level >= MAX) return;
          level += 1;
          total += 3 ** (level - 1);
          lvlEl.textContent = String(level);
          totEl.textContent = fmt(total);
          pyr.querySelectorAll('.base').forEach((r) => r.classList.remove('base'));
          pyr.append(h('div', { class: 'pyr-row base', style: { width: `${8 + (level - 1) * 6}%` } }));
          if (MILESTONES[level]) msg.textContent = t(MILESTONES[level]);
          if (level === MAX) collapse();
        }

        async function collapse() {
          btn.disabled = true;
          msg.className = 'pyr-msg rule red';
          msg.innerHTML = t('pyrCollapse');
          await sleep(reducedMotion ? 300 : 2200);
          [...pyr.children].reverse().forEach((r, k) => {
            r.style.transitionDelay = `${k * 60}ms`;
            r.style.transform = `translateY(${180 + Math.random() * 140}px) rotate(${Math.random() * 50 - 25}deg)`;
          });
          pyr.classList.add('collapse');
          await sleep(reducedMotion ? 100 : 1900);
          await sheet({
            tone: 'bad',
            emoji: '💥',
            title: t('pyrFallen'),
            html: t('pyrFallenText'),
            actions: [{ label: t('understood') }],
          });
          resolve({ score: 1, max: 1 });
        }
      });
    },
  };

  // Запуск миссии: шаги по очереди, прогресс-бар сверху.
  async function runMission(mission, root, onExit) {
    let score = 0;
    let max = 0;
    const fill = h('i', { style: { width: '0%' } });
    const stage = h('div');
    root.replaceChildren(
      h('div', { class: 'mission-head' },
        h('button', { class: 'icon-btn', 'aria-label': t('exitMission'), onclick: onExit }, icon('x')),
        h('div', { class: 'progress', role: 'progressbar', 'aria-label': t('missionProgress') }, fill),
        h('span', { class: 'pill', 'aria-hidden': 'true' }, mission.emoji)),
      stage);
    for (let i = 0; i < mission.steps.length; i++) {
      fill.style.width = `${(i / mission.steps.length) * 100}%`;
      const step = mission.steps[i];
      const r = await engines[step.type](step, stage);
      if (!stage.isConnected) return null; // игрок вышел из миссии
      score += r.score;
      max += r.max;
      window.scrollTo(0, 0);
    }
    fill.style.width = '100%';
    return { score, max };
  }

  SB.runMission = runMission;
})();
