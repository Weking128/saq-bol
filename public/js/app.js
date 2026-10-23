// Сақ бол! — экраны игры: приветствие, регистрация, карта миссий, миссии,
// итоговый тест, результат и сертификат. Навигация через #/адрес.
// Все тексты интерфейса — через SB.t() (словарь в i18n.js).
(function () {
  'use strict';
  const { h, api, store, sheet, toast, confetti, mascot, icon, sleep, t } = SB;

  const app = document.getElementById('app');
  const topRight = document.getElementById('top-right');
  const state = { config: null, me: null, institutions: null, quiz: null, page: '' };

  const RANK_XP = [0, 100, 200, 300, 450];
  const TYPE_TABS = [
    { id: 'school', key: 'tabSchools', ico: '🏫' },
    { id: 'college', key: 'tabColleges', ico: '🎓' },
    { id: 'university', key: 'tabUniversities', ico: '🏛️' },
  ];
  // Литеры классов: в казахских классах обычно А, Ә, Б, В, Г, Ғ…
  const LETTERS_BY_LANG = { ru: ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'], kk: ['А', 'Ә', 'Б', 'В', 'Г', 'Ғ', 'Д', 'Е'] };

  const missionDone = (id) => !!(state.me && state.me.missions[id]);
  const allMissionsDone = () => SB.MISSIONS.every((m) => missionDone(m.id));

  function rankOf(me) {
    if (me.passed) return t('rankFinal');
    let r = 0;
    RANK_XP.forEach((xp, i) => { if (me.xp >= xp) r = i; });
    return t(`rank${r}`);
  }

  function starsFor(score, max) {
    const pct = max ? score / max : 1;
    return pct >= 0.9 ? 3 : pct >= 0.6 ? 2 : 1;
  }

  const starsText = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

  function go(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  function showError(err, retry) {
    app.replaceChildren(h('div', { class: 'card stack center' },
      h('div', { style: { fontSize: '48px' } }, '📡'),
      h('h2', null, t('somethingWrong')),
      h('p', { class: 'muted' }, err.message),
      retry && h('button', { class: 'btn', onclick: retry }, t('retry'))));
  }

  // ─── Язык ─────────────────────────────────────────────────────────────

  async function changeLang() {
    // Настройки мероприятия, названия заведений и подписи класса зависят от языка
    state.institutions = null;
    try {
      state.config = await api('/api/config');
      if (state.me) state.me = (await api('/api/me')).participant;
    } catch { /* покажем с прежними данными */ }
    applyStaticTexts();
    renderFooter();
    route();
  }

  function applyStaticTexts() {
    document.title = (state.config && state.config.eventTitle) || t('title');
    document.getElementById('brand').setAttribute('aria-label', t('brandHome'));
  }

  // ─── Верхняя панель и подвал ──────────────────────────────────────────

  function updateTopbar() {
    topRight.replaceChildren();
    // Во время миссии и теста язык не переключаем, чтобы не потерять прогресс
    const busy = state.page === 'mission' || (state.page === 'quiz' && state.quiz);
    if (!busy) topRight.append(SB.langSwitch(changeLang));
    if (!state.me) return;
    topRight.append(
      h('span', { class: 'xp-chip', title: t('xp') }, '⭐ ', String(state.me.xp)),
      h('button', { class: 'icon-btn', 'aria-label': t('logout'), title: t('logoutShort'), onclick: logout }, icon('logout')));
  }

  async function logout() {
    const ok = await sheet({
      emoji: '👋',
      title: t('logoutTitle'),
      text: t('logoutText'),
      actions: [{ label: t('logoutShort'), class: 'bad', value: true }, { label: t('stay'), class: 'ghost', value: false }],
      dismissible: true,
    });
    if (!ok) return;
    store.del('token');
    state.me = null;
    go('#/');
  }

  function renderFooter() {
    const c = state.config;
    const lines = String(c.contacts || '').split('\n').map((s) => s.trim()).filter(Boolean);
    document.getElementById('footer').replaceChildren(
      h('div', { class: 'hot' }, h('strong', null, t('sos')), lines.map((l) => h('span', null, l))),
      h('div', null, c.orgName),
      h('div', null, h('a', { href: '/verify', style: { color: 'inherit' } }, t('verifyLink'))));
  }

  // ─── Приветствие ──────────────────────────────────────────────────────

  function renderWelcome() {
    const c = state.config;
    const me = state.me;
    app.replaceChildren(h('div', { class: 'stack' },
      h('section', { class: 'hero' },
        mascot(),
        h('h1', null, 'Сақ бол!'),
        h('p', { class: 'tagline' }, t('tagline')),
        h('div', { class: 'features' },
          h('div', null, h('b', null, '5'), t('featMissions')),
          h('div', null, h('b', null, String(c.quizSize)), t('featQuestions')),
          h('div', null, h('b', null, '🎓'), t('featCert'))),
        h('p', { class: 'org' }, c.orgName)),
      me
        ? h('div', { class: 'card stack-sm' },
          h('p', { class: 'muted small' }, t('deviceHasParticipant')),
          h('p', null, h('b', null, me.fullName), h('br'), h('span', { class: 'muted small' }, `${me.gradeLabel} · ${me.institution}`)),
          h('button', { class: 'btn', onclick: () => go('#/map') }, t('continueAs', { name: me.firstName })),
          h('button', { class: 'btn ghost', onclick: logout }, t('otherParticipant')))
        : h('button', { class: 'btn gold', onclick: () => go('#/register') }, t('startQuest')),
      h('h2', { style: { fontSize: '20px', marginTop: '22px' } }, t('whatAwaits')),
      h('div', { class: 'topics' }, SB.MISSIONS.map((m, i) =>
        h('div', { class: 'topic' }, h('span', { class: 'emo' }, m.emoji), h('b', null, `${i + 1}. ${m.title}`), m.desc)),
        h('div', { class: 'topic' }, h('span', { class: 'emo' }, '🎓'), h('b', null, t('finalTest')), t('finalTestDesc', { n: c.quizSize })))));
  }

  // ─── Регистрация ──────────────────────────────────────────────────────

  async function renderRegister() {
    if (!state.institutions) {
      app.replaceChildren(h('div', { class: 'empty' }, t('loadingInstitutions')));
      try {
        // Сначала заведения с номером (по возрастанию номера), затем остальные по алфавиту
        const num = (name) => { const m = name.match(/№\s*(\d+)/); return m ? Number(m[1]) : Infinity; };
        state.institutions = (await api('/api/institutions'))
          .sort((a, b) => num(a.name) - num(b.name) || a.name.localeCompare(b.name, SB.lang));
      } catch (e) {
        return showError(e, renderRegister);
      }
    }
    const form = { inst: null, other: '', otherKind: 'class', lastName: '', firstName: '', middleName: '', grade: null, letter: '', consent: false };
    let tab = 'school';
    let query = '';
    stepInstitution();

    function stepInstitution() {
      const list = h('div', { class: 'inst-list', role: 'list' });
      const search = h('input', {
        class: 'input', type: 'search', placeholder: t('searchPlaceholder'), 'aria-label': t('searchLabel'),
        value: query, autocomplete: 'off', enterkeyhint: 'search',
        oninput: (e) => { query = e.target.value; fill(); },
      });
      const tabs = h('div', { class: 'tabs', role: 'tablist' }, TYPE_TABS.map((tb) =>
        h('button', {
          class: 'tab', role: 'tab', 'aria-selected': String(tb.id === tab),
          onclick: (e) => { tab = tb.id; tabs.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', 'false')); e.currentTarget.setAttribute('aria-selected', 'true'); fill(); },
        }, `${tb.ico} ${t(tb.key)}`)));
      const otherBox = h('div', { class: 'card stack-sm', hidden: form.inst !== 'other' },
        h('label', { class: 'field' }, h('span', null, t('otherInstName')),
          h('input', { class: 'input', value: form.other, maxlength: '150', placeholder: t('otherInstPlaceholder'), oninput: (e) => { form.other = e.target.value; validate(); } })),
        h('div', { class: 'field' }, h('span', null, t('youStudyIn')),
          h('div', { class: 'btn-row' },
            ['class', 'course'].map((k) => h('button', {
              class: 'choice-btn', style: { flex: '1', fontSize: '15px' }, 'aria-pressed': String(form.otherKind === k),
              onclick: (e) => { form.otherKind = k; e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
            }, k === 'class' ? t('kindSchool') : t('kindCourse'))))));
      const next = h('button', { class: 'btn', disabled: true, onclick: stepPerson }, t('next'));

      function validate() {
        next.disabled = !(form.inst && (form.inst !== 'other' || form.other.trim().length >= 3));
      }

      function fill() {
        const q = query.trim().toLowerCase();
        // Поиск — по названию на обоих языках
        const items = state.institutions.filter((i) => (q ? (i.name + ' ' + (i.alt || '')).toLowerCase().includes(q) : i.type === tab));
        list.replaceChildren(
          ...items.map((i) => h('button', {
            class: 'inst', role: 'listitem', 'aria-pressed': String(!!form.inst && form.inst.id === i.id),
            onclick: () => { form.inst = i; otherBox.hidden = true; fill(); validate(); next.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
          }, h('span', { class: 'ico' }, (TYPE_TABS.find((tb) => tb.id === i.type) || TYPE_TABS[0]).ico), i.name)),
          items.length ? null : h('div', { class: 'empty' }, t('nothingFound')),
          h('button', {
            class: 'inst other', 'aria-pressed': String(form.inst === 'other'),
            onclick: () => { form.inst = 'other'; otherBox.hidden = false; fill(); validate(); otherBox.querySelector('input').focus(); },
          }, h('span', { class: 'ico' }, '✏️'), t('notInList')));
      }

      app.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'steps-dots' }, h('i', { class: 'on' }), h('i')),
        h('div', null, h('div', { class: 'step-kicker' }, t('step', { i: 1, n: 2 })), h('h2', { class: 'step-title' }, t('whereStudy'))),
        search, tabs, list, otherBox,
        h('div', { class: 'sticky-cta' }, next)));
      fill();
      validate();
    }

    function stepPerson() {
      const kind = form.inst === 'other' ? form.otherKind : form.inst.type === 'school' ? 'class' : 'course';
      const maxGrade = kind === 'class' ? 11 : form.inst !== 'other' && form.inst.type === 'college' ? 4 : 6;
      if (form.grade > maxGrade) form.grade = null;
      const LETTERS = LETTERS_BY_LANG[SB.lang] || LETTERS_BY_LANG.ru;
      const err = h('p', { class: 'error-text', role: 'alert' });
      const submit = h('button', { class: 'btn gold', onclick: send }, t('startQuest'));

      const input = (key, opts = {}) => h('label', { class: 'field' },
        h('span', null, t(key), opts.optional && h('em', null, t('ifAny'))),
        h('input', {
          class: 'input', value: form[key], maxlength: '50', autocomplete: opts.ac, autocapitalize: 'words', spellcheck: 'false',
          oninput: (e) => { form[key] = e.target.value; e.target.classList.remove('invalid'); },
          'data-key': key,
        }));

      const gradeGrid = h('div', { class: 'choice-grid', role: 'group', 'aria-label': kind === 'class' ? t('grade') : t('course') },
        Array.from({ length: maxGrade }, (_, i) => i + 1).map((n) => h('button', {
          class: 'choice-btn', 'aria-pressed': String(form.grade === n),
          onclick: (e) => { form.grade = n; gradeGrid.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget))); },
        }, String(n))));

      const letterInput = h('input', {
        class: 'input', value: LETTERS.includes(form.letter) ? '' : form.letter, maxlength: '12',
        placeholder: kind === 'class' ? t('otherLetter') : t('groupPlaceholder'),
        oninput: (e) => { form.letter = e.target.value.trim(); if (letterGrid) letterGrid.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false')); },
      });
      const letterGrid = kind === 'class' ? h('div', { class: 'choice-grid', role: 'group', 'aria-label': t('letter') },
        LETTERS.map((l) => h('button', {
          class: 'choice-btn', 'aria-pressed': String(form.letter === l),
          onclick: (e) => {
            const on = form.letter !== l;
            form.letter = on ? l : '';
            letterInput.value = '';
            letterGrid.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(on && b === e.currentTarget)));
          },
        }, l))) : null;

      async function send() {
        err.textContent = '';
        const missing = ['lastName', 'firstName'].find((k) => !form[k].trim());
        if (missing) {
          const el = app.querySelector(`[data-key="${missing}"]`);
          el.classList.add('invalid');
          el.focus();
          err.textContent = missing === 'lastName' ? t('enterLastName') : t('enterFirstName');
          return;
        }
        if (!form.grade) { err.textContent = kind === 'class' ? t('chooseGrade') : t('chooseCourse'); return; }
        if (!form.consent) { err.textContent = t('needConsent'); return; }
        submit.disabled = true;
        submit.textContent = t('registering');
        try {
          const res = await api('/api/register', {
            method: 'POST',
            body: {
              institutionId: form.inst === 'other' ? 'other' : form.inst.id,
              institutionOther: form.other,
              gradeKind: kind,
              lastName: form.lastName, firstName: form.firstName, middleName: form.middleName,
              grade: form.grade, gradeLetter: form.letter, consent: true,
            },
          });
          store.set('token', res.token);
          state.me = res.participant;
          toast(t('welcomeAgent', { name: state.me.firstName }), 'ok');
          go('#/map');
        } catch (e) {
          err.textContent = e.message;
          submit.disabled = false;
          submit.textContent = t('startQuest');
        }
      }

      app.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'steps-dots' }, h('i', { class: 'on' }), h('i', { class: 'on' })),
        h('div', { class: 'row' },
          h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: stepInstitution }, icon('back')),
          h('div', null, h('div', { class: 'step-kicker' }, t('step', { i: 2, n: 2 })), h('h2', { class: 'step-title' }, t('whatName')))),
        h('p', { class: 'muted small' }, form.inst === 'other' ? form.other : form.inst.name),
        h('div', { class: 'card stack' },
          input('lastName', { ac: 'family-name' }),
          input('firstName', { ac: 'given-name' }),
          input('middleName', { optional: true, ac: 'additional-name' })),
        h('div', { class: 'card stack' },
          h('div', { class: 'field' }, h('span', null, kind === 'class' ? t('grade') : t('course')), gradeGrid),
          h('div', { class: 'field' }, h('span', null, kind === 'class' ? t('letter') : t('group'), h('em', null, t('ifAny'))),
            letterGrid && h('div', { style: { marginBottom: '8px' } }, letterGrid), letterInput)),
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: form.consent, onchange: (e) => { form.consent = e.target.checked; } }),
          h('span', null, t('consent'))),
        h('p', { class: 'muted small' }, t('nameOnCert')),
        err,
        h('div', { class: 'sticky-cta' }, submit)));
    }
  }

  // ─── Карта миссий ─────────────────────────────────────────────────────

  function renderMap() {
    const me = state.me;
    const total = SB.MISSIONS.length;
    const initials = (me.firstName[0] || '') + (me.lastName[0] || '');

    const missionCards = SB.MISSIONS.map((m, i) => {
      const done = missionDone(m.id);
      const available = !done && (i === 0 || missionDone(SB.MISSIONS[i - 1].id));
      const r = me.missions[m.id];
      const cls = done ? 'done' : available ? 'available' : 'locked';
      return h('button', {
        class: `mission ${cls}`,
        onclick: () => {
          if (cls === 'locked') return toast(t('lockedMission', { n: i, title: SB.MISSIONS[i - 1].title }));
          go(`#/mission/${m.id}`);
        },
      },
      h('span', { class: 'num', 'aria-hidden': 'true' }, cls === 'locked' ? '🔒' : m.emoji),
      h('span', { class: 'meta' },
        h('h3', null, `${i + 1}. ${m.title}`),
        h('p', null, m.desc),
        h('div', { class: 'state' },
          done ? h('span', null, h('span', { class: 'stars' }, starsText(starsFor(r.score, r.max))), ` · ${Math.round((r.score / r.max) * 100)} XP · ${t('playAgain')}`)
            : available ? t('startMission') : t('closed'))));
    });

    const finalAvailable = allMissionsDone();
    const c = state.config;
    const finalCard = h('button', {
      class: `mission final ${me.passed ? 'done' : finalAvailable ? 'available' : 'locked'}`,
      onclick: () => {
        if (me.passed) return go('#/certificate');
        if (!finalAvailable) return toast(t('testLocked'));
        go('#/quiz');
      },
    },
    h('span', { class: 'num', 'aria-hidden': 'true' }, finalAvailable || me.passed ? '🎓' : '🔒'),
    h('span', { class: 'meta' },
      h('h3', null, me.passed ? t('certReceived') : t('finalTest')),
      h('p', null, me.passed ? t('bestResult', { b: me.bestScore, n: c.quizSize }) : t('testInfo', { n: c.quizSize, p: c.passScore })),
      h('div', { class: 'state' }, me.passed ? t('openCert') : finalAvailable ? (me.attemptsCount ? t('retakeShort') : t('startTest')) : t('missionsPassed', { d: me.missionsDone, n: total }))));

    app.replaceChildren(h('div', { class: 'stack' },
      h('section', { class: 'card player-card' },
        h('div', { class: 'who' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials),
          h('div', null, h('h2', null, t('hello', { name: me.firstName })), h('div', { class: 'rank' }, rankOf(me)))),
        h('div', null,
          h('div', { class: 'xp-line' }, h('span', null, `⭐ ${me.xp} XP`), h('span', null, t('missionsCount', { d: me.missionsDone, n: total }))),
          h('div', { class: 'progress gold', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total * 100), 'aria-valuenow': String(me.xp) },
            h('i', { style: { width: `${Math.min(100, (me.xp / (total * 100)) * 100)}%` } }))),
        h('div', { class: 'badges', 'aria-label': t('badges') }, SB.MISSIONS.map((m) =>
          h('div', { class: 'badge' + (missionDone(m.id) ? ' on' : ''), title: m.badge.name, 'aria-label': missionDone(m.id) ? t('badgeEarned', { name: m.badge.name }) : m.badge.name }, m.badge.emoji)))),
      finalAvailable && !me.passed && h('div', { class: 'rule' }, t('allMissionsDone')),
      h('div', { class: 'path' }, missionCards, finalCard),
      h('button', { class: 'btn ghost', onclick: () => go('#/memo') }, t('memoBtn'))));
  }

  // ─── Миссия ───────────────────────────────────────────────────────────

  async function renderMission(id) {
    const idx = SB.MISSIONS.findIndex((m) => m.id === id);
    const mission = SB.MISSIONS[idx];
    if (!mission) return go('#/map');
    if (idx > 0 && !missionDone(SB.MISSIONS[idx - 1].id)) return go('#/map');
    const firstTime = !missionDone(id);

    const exit = async () => {
      const ok = await sheet({
        emoji: '🚪', title: t('exitMissionTitle'), text: t('exitMissionText'),
        actions: [{ label: t('exitToMap'), class: 'ghost', value: true }, { label: t('continueMission'), value: false }], dismissible: true,
      });
      if (ok) go('#/map');
    };

    const result = await SB.runMission(mission, app, exit);
    if (!result) return;

    const max = Math.max(1, result.max);
    const score = Math.min(result.score, max);
    try {
      state.me = (await api('/api/progress', { method: 'POST', body: { missionId: id, score, max } })).participant;
    } catch (e) {
      // Не теряем прохождение из-за кратковременной потери связи
      for (let attempt = 0; attempt < 3 && !state.me.missions[id]; attempt++) {
        await sleep(1500);
        try { state.me = (await api('/api/progress', { method: 'POST', body: { missionId: id, score, max } })).participant; } catch { /* повтор */ }
      }
      if (!state.me.missions[id]) return showError(e, () => renderMission(id));
    }
    updateTopbar(); // обновить очки; переключатель языка остаётся скрытым до перехода на другой экран

    const stars = starsFor(score, max);
    const next = SB.MISSIONS[idx + 1];
    if (stars === 3) confetti();
    app.replaceChildren(h('div', { class: 'stack finish' },
      h('div', { class: 'big-emo' }, stars === 3 ? '🏆' : stars === 2 ? '🎉' : '👍'),
      h('h2', { class: 'step-title' }, t('missionDone', { title: mission.title })),
      h('div', { class: 'stars-big', 'aria-label': t('starsAria', { n: stars }) },
        [0, 1, 2].map((i) => h('span', { class: i < stars ? '' : 'off' }, '⭐'))),
      h('p', null, h('span', { class: 'pill gold' }, `+${Math.round((score / max) * 100)} XP`), ' ', h('span', { class: 'pill' }, t('correctCount', { s: score, m: max }))),
      firstTime && h('div', null, h('div', { class: 'badge-won' }, h('span', { class: 'emo' }, mission.badge.emoji), t('newBadge', { name: mission.badge.name }))),
      h('div', { class: 'card stack-sm', style: { textAlign: 'left' } },
        h('b', null, t('rememberMain')),
        h('ul', { class: 'lesson', style: { margin: 0, paddingLeft: '20px' } }, mission.recap.map((r) => h('li', null, r)))),
      next
        ? h('button', { class: 'btn', onclick: () => go(`#/mission/${next.id}`) }, t('nextMission', { n: idx + 2, title: next.title }))
        : h('button', { class: 'btn gold', onclick: () => go('#/memo') }, t('toFinalTest')),
      h('button', { class: 'btn ghost', onclick: () => go('#/map') }, t('toMap'))));
  }

  // ─── Памятка ──────────────────────────────────────────────────────────

  function renderMemo() {
    const canTest = allMissionsDone() && !state.me.passed;
    app.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => go('#/map') }, icon('back')),
        h('h2', { class: 'step-title' }, t('memoTitle'))),
      h('div', { class: 'mascot-say' }, mascot(), h('div', { class: 'bubble' }, t('memoSay'))),
      h('div', { class: 'stack-sm' }, SB.MEMO.map((m, i) =>
        h('div', { class: 'card row', style: { alignItems: 'flex-start', padding: '14px' } },
          h('span', { style: { fontSize: '26px', lineHeight: '1' }, 'aria-hidden': 'true' }, m.emoji),
          h('span', null, h('b', null, `${i + 1}. `), m.text)))),
      canTest
        ? h('button', { class: 'btn gold', onclick: () => go('#/quiz') }, t('readyForTest'))
        : h('button', { class: 'btn ghost', onclick: () => go('#/map') }, t('toMap'))));
  }

  // ─── Итоговый тест ────────────────────────────────────────────────────

  function renderQuizIntro() {
    if (!allMissionsDone()) return go('#/map');
    state.quiz = null;
    updateTopbar();
    const c = state.config;
    const start = h('button', { class: 'btn gold', onclick: begin }, t('startTest').replace('▶ ', ''));
    async function begin() {
      start.disabled = true;
      start.textContent = t('preparingQuestions');
      try {
        state.quiz = { ...(await api('/api/quiz/start', { method: 'POST' })), answers: [], index: 0 };
        updateTopbar();
        renderQuestion();
      } catch (e) {
        toast(e.message, 'bad');
        start.disabled = false;
        start.textContent = t('startTest').replace('▶ ', '');
      }
    }
    app.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => go('#/map') }, icon('back')),
        h('h2', { class: 'step-title' }, t('finalTest'))),
      h('div', { class: 'mascot-say' }, mascot(), h('div', { class: 'bubble' }, t('quizSay'))),
      h('div', { class: 'card stack-sm' },
        h('p', null, t('quizRule1', { n: c.quizSize })),
        h('p', null, t('quizRule2', { p: c.passScore })),
        h('p', null, t('quizRule3')),
        h('p', null, t('quizRule4'))),
      state.me.attemptsCount ? h('p', { class: 'muted small center' }, t('attemptsInfo', { a: state.me.attemptsCount, b: state.me.bestScore ?? 0, n: c.quizSize })) : null,
      start,
      h('button', { class: 'btn ghost', onclick: () => go('#/memo') }, t('repeatMemo'))));
  }

  function renderQuestion() {
    const qz = state.quiz;
    const q = qz.questions[qz.index];
    const last = qz.index === qz.questions.length - 1;
    const keys = t('optionKeys');
    const nextBtn = h('button', { class: 'btn' + (last ? ' gold' : ''), disabled: qz.answers[qz.index] === undefined, onclick: next }, last ? t('finishTest') : t('next'));
    const opts = q.options.map((o, k) => h('button', {
      class: 'option', 'aria-pressed': String(qz.answers[qz.index] === k),
      onclick: () => {
        qz.answers[qz.index] = k;
        opts.forEach((b, j) => b.setAttribute('aria-pressed', String(j === k)));
        nextBtn.disabled = false;
      },
    }, h('span', { class: 'key' }, keys[k]), h('span', null, o)));

    async function next() {
      if (!last) {
        qz.index += 1;
        renderQuestion();
        window.scrollTo(0, 0);
        return;
      }
      nextBtn.disabled = true;
      nextBtn.textContent = t('checking');
      try {
        const res = await api('/api/quiz/submit', { method: 'POST', body: { attemptId: qz.attemptId, answers: qz.answers } });
        state.me = res.participant;
        state.quiz = null;
        updateTopbar();
        renderResult(res);
      } catch (e) {
        toast(e.message, 'bad');
        nextBtn.disabled = false;
        nextBtn.textContent = t('finishTest');
      }
    }

    app.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('button', {
          class: 'icon-btn', 'aria-label': t('stopTest'),
          onclick: async () => {
            const ok = await sheet({ emoji: '⏸️', title: t('stopTestTitle'), text: t('stopTestText'), actions: [{ label: t('stop'), class: 'ghost', value: true }, { label: t('continueTest'), value: false }], dismissible: true });
            if (ok) { state.quiz = null; go('#/map'); }
          },
        }, icon('x')),
        h('div', { class: 'quiz-dots', style: { flex: '1' } }, qz.questions.map((_, i) =>
          h('i', { class: i === qz.index ? 'cur' : qz.answers[i] !== undefined ? 'done' : '' })))),
      h('div', { class: 'row', style: { justifyContent: 'space-between' } },
        h('span', { class: 'pill' }, q.topic),
        h('span', { class: 'muted small' }, t('questionOf', { i: qz.index + 1, n: qz.questions.length }))),
      h('div', { class: 'q-text' }, q.q),
      h('div', { class: 'options' }, opts),
      h('div', { class: 'btn-row' },
        qz.index > 0 && h('button', { class: 'btn ghost', style: { flex: '0 0 30%' }, 'aria-label': t('back'), onclick: () => { qz.index -= 1; renderQuestion(); } }, '←'),
        nextBtn)));
  }

  function scoreRing(score, total, passed) {
    const r = 64;
    const c = 2 * Math.PI * r;
    return h('div', { class: 'score-ring', role: 'img', 'aria-label': `${score} ${t('outOf', { n: total })}` },
      h('span', {
        style: { display: 'contents' },
        html: `<svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="${r}" fill="none" stroke="#e2e7f1" stroke-width="14"/>
          <circle cx="80" cy="80" r="${r}" fill="none" stroke="${passed ? '#129a57' : '#dc3d46'}" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / total)}"/></svg>`,
      }),
      h('div', { class: 'val' }, h('div', null, h('b', null, String(score)), h('small', null, t('outOf', { n: total })))));
  }

  function reviewList(review) {
    return h('div', { class: 'review' }, review.map((r, i) =>
      h('div', { class: 'review-item' + (r.ok ? '' : ' bad') },
        h('div', { class: 'q' }, `${i + 1}. ${r.q}`),
        !r.ok && h('div', { class: 'a your' }, t('yourAnswer', { a: r.chosen === null ? '—' : r.options[r.chosen] })),
        h('div', { class: 'a right' }, `✓ ${r.options[r.correct]}`),
        h('div', { class: 'ex' }, r.explain))));
  }

  function renderResult(res) {
    const reviewBox = h('div', { hidden: true }, reviewList(res.review));
    const toggle = h('button', {
      class: 'btn ghost',
      onclick: () => { reviewBox.hidden = !reviewBox.hidden; toggle.textContent = reviewBox.hidden ? t('showReview') : t('hideReview'); },
    }, t('showReview'));

    if (res.passed) confetti();
    app.replaceChildren(h('div', { class: 'stack center' },
      scoreRing(res.score, res.total, res.passed),
      h('h2', { class: 'step-title' }, res.passed ? t('passedTitle') : t('failedTitle')),
      h('p', { class: 'muted' }, res.passed
        ? t('passedText', { s: res.score, t: res.total })
        : t('failedText', { p: res.passScore, d: res.passScore - res.score })),
      res.passed
        ? h('button', { class: 'btn gold', onclick: () => go('#/certificate') }, t('getCert'))
        : h('button', { class: 'btn', onclick: () => go('#/quiz') }, t('retakeTest')),
      toggle,
      h('div', { style: { textAlign: 'left' } }, reviewBox),
      !res.passed && h('button', { class: 'btn ghost', onclick: () => go('#/memo') }, t('repeatMemo')),
      h('button', { class: 'link-btn', onclick: () => go('#/map') }, t('toMap'))));
  }

  // ─── Сертификат ───────────────────────────────────────────────────────

  async function renderCertificate() {
    if (!state.me.passed) return go('#/map');
    app.replaceChildren(h('div', { class: 'empty' }, t('preparingCert')));
    let data;
    try {
      data = await api('/api/certificate');
    } catch (e) {
      return showError(e, renderCertificate);
    }
    const canvas = h('canvas', { 'aria-label': `${t('yourCert')}: ${data.fullName}`, role: 'img' });
    await SB.cert.draw(canvas, data);

    const busy = async (btn, fn) => {
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = t('wait');
      try { await fn(); } catch (e) { if (e && e.name !== 'AbortError') toast(t('saveFailed'), 'bad'); }
      btn.disabled = false;
      btn.textContent = label;
    };
    const pdfBtn = h('button', { class: 'btn gold', onclick: () => busy(pdfBtn, async () => SB.cert.download(await SB.cert.toPdf(canvas), SB.cert.fileName(data, 'pdf'))) }, t('downloadPdf'));
    const pngBtn = h('button', { class: 'btn ghost', onclick: () => busy(pngBtn, async () => SB.cert.download(await SB.cert.toPng(canvas), SB.cert.fileName(data, 'png'))) }, t('savePng'));
    const shareBtn = SB.cert.canShareFiles()
      ? h('button', {
        class: 'btn', onclick: () => busy(shareBtn, async () => {
          const ok = await SB.cert.share(await SB.cert.toPdf(canvas), SB.cert.fileName(data, 'pdf'), t('shareTitle'));
          if (!ok) toast(t('shareFailed'));
        }),
      }, t('share'))
      : null;

    app.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => go('#/map') }, icon('back')),
        h('h2', { class: 'step-title' }, t('yourCert'))),
      h('div', { class: 'cert-preview' }, canvas),
      h('p', { class: 'muted small center' }, t('certNote', { num: data.number })),
      pdfBtn, shareBtn, pngBtn,
      h('div', { class: 'rule blue' }, t('tellFriends')),
      h('button', { class: 'btn ghost', onclick: () => go('#/memo') }, t('memoBtn')),
      h('button', { class: 'link-btn', onclick: logout }, t('finishAndExit'))));
  }

  // ─── Маршрутизация ────────────────────────────────────────────────────

  function route() {
    const [, page, arg] = (location.hash.replace(/^#/, '') || '/').split('/');
    state.page = page || '';
    if (page !== 'quiz') state.quiz = null;
    updateTopbar();
    window.scrollTo(0, 0);
    if (!state.me) return page === 'register' ? renderRegister() : renderWelcome();
    switch (page) {
      case 'map': return renderMap();
      case 'mission': return renderMission(arg);
      case 'memo': return renderMemo();
      case 'quiz': return renderQuizIntro();
      case 'certificate': return renderCertificate();
      case 'register': return go('#/map');
      default: return renderWelcome();
    }
  }

  async function boot() {
    try {
      state.config = await api('/api/config');
    } catch (e) {
      return showError(e, boot);
    }
    applyStaticTexts();
    renderFooter();
    if (store.get('token')) {
      try {
        state.me = (await api('/api/me')).participant;
      } catch (e) {
        if (e.status === 401) store.del('token');
      }
    }
    window.addEventListener('hashchange', route);
    document.getElementById('brand').addEventListener('click', () => go(state.me ? '#/map' : '#/'));
    route();
  }

  boot();
})();
