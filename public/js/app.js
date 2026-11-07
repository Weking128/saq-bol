// Сақ бол! — экраны игры: приветствие, регистрация, карта миссий, миссии,
// итоговый тест, результат и сертификат. Навигация через #/адрес.
// Все тексты интерфейса — через SB.t() (словарь в i18n.js).
(function () {
  'use strict';
  // Не загрузился один из файлов сайта (обрыв связи, «умный» браузер) — вместо белого экрана
  // просим обновить страницу, а серверу сообщаем, чего не хватило (журнал [client] … load)
  const S = window.SB || {};
  const missing = [
    typeof S.t !== 'function' && 'i18n',
    typeof S.celebrate !== 'function' && 'fx',
    typeof S.runMission !== 'function' && 'engine',
    !(S.MISSIONS_BY_LANG && S.MISSIONS_BY_LANG.ru && S.JUNIOR_MISSIONS_BY_LANG && S.JUNIOR_MISSIONS_BY_LANG.ru) && 'missions',
    !(S.MISSIONS_BY_LANG && S.MISSIONS_BY_LANG.kk && S.JUNIOR_MISSIONS_BY_LANG && S.JUNIOR_MISSIONS_BY_LANG.kk) && 'missions.kk',
    !S.game && 'game',
    !S.cert && 'certificate',
    typeof S.h !== 'function' && 'ui',
  ].filter(Boolean);
  if (missing.length) {
    const box = document.getElementById('app');
    if (box) {
      box.textContent = '';
      const card = document.createElement('div');
      card.className = 'card stack center';
      const p = document.createElement('p');
      p.textContent = 'Сайт толық жүктелмеді — бетті жаңартыңыз. / Сайт загрузился не полностью — обновите страницу.';
      const btn = document.createElement('button');
      btn.className = 'btn gold';
      btn.type = 'button';
      btn.textContent = '🔄 Жаңарту / Обновить';
      btn.addEventListener('click', () => location.reload());
      card.append(p, btn);
      box.append(card);
    }
    try {
      fetch('/api/client-error', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'load', msg: `не загрузилось: ${missing.join(', ')}`, src: 'app.js', page: (/^#\/[a-z]*/.exec(location.hash) || ['#/'])[0] }),
      }).catch(() => {});
    } catch { /* без связи — не страшно */ }
    return;
  }
  const { h, api, store, sheet, toast, confetti, mascot, icon, sleep, fmt, t } = SB;

  const app = document.getElementById('app');
  const topRight = document.getElementById('top-right');
  // cleanup — что убрать при уходе с экрана (например, обработчики мини-игры)
  // view — номер текущего экрана (растёт при каждом переходе)
  const state = { config: null, me: null, institutions: null, quiz: null, page: '', cleanup: null, view: 0 };
  // Ответ сервера, пришедший после ухода ученика на другой экран, не рисует поверх него:
  // const alive = viewGuard(); … await …; if (!alive()) return;
  const viewGuard = () => { const v = state.view; return () => v === state.view; };

  const RANK_XP = [0, 100, 200, 300, 450];
  const TYPE_TABS = [
    { id: 'school', key: 'tabSchools', ico: '🏫' },
    { id: 'college', key: 'tabColleges', ico: '🎓' },
    { id: 'university', key: 'tabUniversities', ico: '🏛️' },
  ];
  // Литеры классов: в казахских классах обычно А, Ә, Б, В, Г, Ғ…
  const LETTERS_BY_LANG = { ru: ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'], kk: ['А', 'Ә', 'Б', 'В', 'Г', 'Ғ', 'Д', 'Е'] };

  const missionDone = (id) => !!(state.me && state.me.missions[id]);
  const isJunior = () => !!(state.me && state.me.level === 'junior');
  // Миссии участника: для 1–6 классов — своё, облегчённое содержание (SB.JUNIOR_MISSIONS),
  // набор id приходит с сервера (MISSION_SETS в lib/app.js)
  function missionsFor() {
    const ids = (state.me && state.me.missionIds) || SB.MISSIONS.map((m) => m.id);
    return (isJunior() ? SB.JUNIOR_MISSIONS : SB.MISSIONS).filter((m) => ids.includes(m.id));
  }
  const memoFor = () => (isJunior() ? SB.JUNIOR_MEMO : SB.MEMO);
  const allMissionsDone = () => missionsFor().every((m) => missionDone(m.id));
  // Первая непройденная миссия — куда звать за новыми раундами мини-игры
  function nextMissionInfo() {
    const missions = missionsFor();
    const i = missions.findIndex((m) => !missionDone(m.id));
    return i < 0 ? null : { n: i + 1, id: missions[i].id, title: missions[i].title };
  }
  // Мини-игра включена в админке (Настройки → «Мини-игра»)
  const gameOn = () => SB.game.settings().enabled;
  const gameBtnLabel = () => {
    const g = SB.game.info(state.me);
    return t('gameBtn', { n: g.unlimited ? '∞' : g.left });
  };

  function rankOf(me) {
    if (me.passed) return t('rankFinal');
    let r = 0;
    RANK_XP.forEach((xp, i) => { if (me.xp >= xp) r = i; });
    return t(`rank${r}`);
  }

  // Звёзды за миссию (3 звезды дают «Новые фигуры» в мини-игре) — одна функция на весь сайт
  const starsFor = (score, max) => SB.game.starsFor(score, max);

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
    try {
      state.config = await api(`/api/config?lang=${SB.lang}`);
      SB.game.configure(state.config.game);
      if (state.me) state.me = (await api('/api/me')).participant;
    } catch { /* покажем с прежними данными */ }
    // Список заведений сбрасываем только сейчас: пока грузились тексты, ученик мог нажать
    // на район, и экран регистрации падал на пустом списке
    state.institutions = null;
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
    // Во время миссии, теста и мини-игры язык не переключаем, чтобы не потерять прогресс
    const busy = state.page === 'mission' || state.page === 'game' || (state.page === 'quiz' && state.quiz);
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

  // Подвал: организатор и проверка сертификата
  function renderFooter() {
    const c = state.config;
    document.getElementById('footer').replaceChildren(
      h('div', { class: 'org' }, c.orgName),
      h('div', null, h('a', { href: '/verify', style: { color: 'inherit' } }, t('verifyLink'))));
  }

  // ─── Приветствие ──────────────────────────────────────────────────────

  function renderWelcome() {
    const c = state.config;
    const me = state.me;
    const missions = me ? missionsFor() : SB.MISSIONS;
    // Главный экран — почти без слов: короткий слоган, цифры, миссии значками; подробности — по «?»
    const about = () => sheet({ emoji: '🛡️', title: t('aboutTitle'), text: t('about'), actions: [{ label: 'OK' }], dismissible: true });
    app.replaceChildren(h('div', { class: 'stack' },
      h('section', { class: 'hero' },
        h('button', { class: 'hero-q', type: 'button', 'aria-label': t('aboutTitle'), onclick: about }, '?'),
        mascot(),
        h('h1', null, 'Сақ бол!'),
        h('p', { class: 'tagline' }, t('tagline')),
        h('div', { class: 'features' },
          h('div', null, h('b', null, `🗺️ ${missions.length}`), t('featMissions')),
          h('div', null, h('b', null, `📝 ${c.quizSize}`), t('featQuestions')),
          h('div', null, h('b', null, '🎓'), t('featCert'))),
        h('p', { class: 'org' }, c.orgName)),
      me
        ? h('div', { class: 'card stack-sm' },
          h('div', { class: 'row' },
            h('div', { class: 'avatar sm', 'aria-hidden': 'true' }, (me.firstName[0] || '') + (me.lastName[0] || '')),
            h('div', null, h('b', null, me.fullName), h('div', { class: 'muted small' }, me.gradeLabel))),
          h('button', { class: 'btn gold', onclick: () => go('#/map') }, t('continueAs')),
          h('button', { class: 'btn ghost small', onclick: logout }, t('otherParticipant')))
        : h('button', { class: 'btn gold', onclick: () => go('#/register') }, t('startQuest')),
      h('div', { class: 'topics compact' }, missions.map((m) =>
        h('div', { class: 'topic' }, h('span', { class: 'emo' }, m.emoji), h('b', null, m.title))),
        h('div', { class: 'topic' }, h('span', { class: 'emo' }, '🎓'), h('b', null, t('finalTest'))))));
  }

  // ─── Регистрация ──────────────────────────────────────────────────────

  async function renderRegister() {
    if (!state.institutions) {
      const alive = viewGuard();
      app.replaceChildren(h('div', { class: 'empty' }, t('loadingInstitutions')));
      try {
        // Сначала заведения с номером (по возрастанию номера), затем остальные по алфавиту
        const num = (name) => { const m = name.match(/№\s*(\d+)/); return m ? Number(m[1]) : Infinity; };
        state.institutions = (await api(`/api/institutions?lang=${SB.lang}`))
          .sort((a, b) => num(a.name) - num(b.name) || a.name.localeCompare(b.name, SB.lang));
      } catch (e) {
        return alive() && showError(e, renderRegister);
      }
      if (!alive()) return;
    }
    const form = { district: null, inst: null, other: '', otherKind: 'class', lastName: '', firstName: '', middleName: '', grade: null, letter: '', consent: false };
    const districts = state.config.districts || [];
    const districtName = (id) => (districts.find((d) => d.id === id) || {}).name || '';
    const typeIco = (type) => (TYPE_TABS.find((tb) => tb.id === type) || TYPE_TABS[0]).ico;
    let tab = 'school';
    let query = '';
    let globalQuery = '';
    stepDistrict();

    // Шаг 1а: город или район (и поиск по всей области)
    function stepDistrict() {
      const results = h('div', { class: 'inst-list', role: 'list', hidden: true });
      const dlist = h('div', { class: 'district-list' }, districts.map((d) => {
        const n = state.institutions.filter((i) => i.district === d.id).length;
        return h('button', {
          class: 'district',
          onclick: () => {
            if (form.district !== d.id) { form.inst = null; query = ''; }
            form.district = d.id;
            const types = new Set(state.institutions.filter((i) => i.district === d.id).map((i) => i.type));
            tab = types.has('school') ? 'school' : [...types][0] || 'school';
            stepInstitution();
          },
        },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, d.id === 'taraz' ? '🏙️' : '📍'),
        h('span', { class: 'meta' }, h('b', null, d.name), h('small', null, d.center)),
        h('span', { class: 'count' }, t('instCount', { n })));
      }));
      const search = h('input', {
        class: 'input', type: 'search', placeholder: t('searchAll'), 'aria-label': t('searchLabel'),
        value: globalQuery, autocomplete: 'off', enterkeyhint: 'search',
        oninput: (e) => { globalQuery = e.target.value; fill(); },
      });

      function fill() {
        const q = globalQuery.trim().toLowerCase();
        const searching = q.length >= 2;
        dlist.hidden = searching;
        results.hidden = !searching;
        if (!searching) return;
        const items = state.institutions.filter((i) => (i.name + ' ' + (i.alt || '')).toLowerCase().includes(q)).slice(0, 80);
        results.replaceChildren(
          ...items.map((i) => h('button', {
            class: 'inst', role: 'listitem',
            onclick: () => { form.district = i.district; form.inst = i; stepPerson(); },
          }, h('span', { class: 'ico' }, typeIco(i.type)), h('span', null, i.name, h('span', { class: 'sub' }, districtName(i.district))))),
          ...(items.length ? [] : [h('div', { class: 'empty' }, t('nothingFoundRegion'))]));
      }

      app.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'steps-dots' }, h('i', { class: 'on' }), h('i')),
        h('h2', { class: 'step-title' }, t('whereStudy')),
        search, results, dlist));
      fill();
    }

    // Шаг 1б: учебное заведение в выбранном городе / районе
    function stepInstitution() {
      if (!state.institutions) return renderRegister(); // список ещё грузится (смена языка)
      const inDistrict = state.institutions.filter((i) => i.district === form.district);
      const presentTypes = TYPE_TABS.filter((tb) => inDistrict.some((i) => i.type === tb.id));
      const list = h('div', { class: 'inst-list', role: 'list' });
      const search = h('input', {
        class: 'input', type: 'search', placeholder: t('searchPlaceholder'), 'aria-label': t('searchLabel'),
        value: query, autocomplete: 'off', enterkeyhint: 'search',
        oninput: (e) => { query = e.target.value; fill(); },
      });
      const tabs = presentTypes.length > 1 ? h('div', { class: 'tabs', role: 'tablist' }, presentTypes.map((tb) =>
        h('button', {
          class: 'tab', role: 'tab', 'aria-selected': String(tb.id === tab),
          onclick: (e) => { tab = tb.id; tabs.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', 'false')); e.currentTarget.setAttribute('aria-selected', 'true'); fill(); },
        }, `${tb.ico} ${t(tb.key)}`))) : null;
      const otherBox = h('div', { class: 'card stack-sm', hidden: form.inst !== 'other' },
        h('label', { class: 'field' }, h('span', null, t('otherInstName')),
          h('input', { class: 'input', value: form.other, maxlength: '150', placeholder: t('otherInstPlaceholder'), oninput: (e) => { form.other = e.target.value; validate(); } })),
        h('div', { class: 'field' },
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
        // Поиск — по названию на обоих языках, внутри выбранного района
        const items = inDistrict.filter((i) => (q ? (i.name + ' ' + (i.alt || '')).toLowerCase().includes(q) : !tabs || i.type === tab));
        list.replaceChildren(
          ...items.map((i) => h('button', {
            class: 'inst', role: 'listitem', 'aria-pressed': String(!!form.inst && form.inst.id === i.id),
            onclick: () => { form.inst = i; otherBox.hidden = true; fill(); validate(); next.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); },
          }, h('span', { class: 'ico' }, typeIco(i.type)), i.name)),
          ...(items.length ? [] : [h('div', { class: 'empty' }, t('nothingFound'))]),
          h('button', {
            class: 'inst other', 'aria-pressed': String(form.inst === 'other'),
            onclick: () => { form.inst = 'other'; otherBox.hidden = false; fill(); validate(); otherBox.querySelector('input').focus(); },
          }, h('span', { class: 'ico' }, '✏️'), t('notInList')));
      }

      app.replaceChildren(h('div', { class: 'stack' },
        h('div', { class: 'steps-dots' }, h('i', { class: 'on' }), h('i')),
        h('div', { class: 'row' },
          h('button', { class: 'icon-btn', 'aria-label': t('otherDistrict'), title: t('otherDistrict'), onclick: stepDistrict }, icon('back')),
          h('h2', { class: 'step-title' }, districtName(form.district))),
        search, tabs, list, otherBox,
        h('div', { class: 'sticky-cta' }, next)));
      fill();
      validate();
    }

    function stepPerson() {
      const kind = form.inst === 'other' ? form.otherKind : form.inst.type === 'school' ? 'class' : 'course';
      // 12 классов — в НИШ и некоторых других школах
      const maxGrade = kind === 'class' ? 12 : form.inst !== 'other' && form.inst.type === 'college' ? 4 : 6;
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
              district: form.district,
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
          h('h2', { class: 'step-title' }, t('whatName'))),
        h('p', { class: 'muted small' }, `${form.inst === 'other' ? form.other : form.inst.name} · ${districtName(form.district)}`),
        h('div', { class: 'card stack' },
          input('lastName', { ac: 'family-name' }),
          input('firstName', { ac: 'given-name' }),
          input('middleName', { optional: true, ac: 'additional-name' })),
        h('div', { class: 'card stack' },
          h('div', { class: 'field' }, h('span', null, kind === 'class' ? t('grade') : t('course')), gradeGrid),
          h('div', { class: 'field' }, h('span', null, kind === 'class' ? t('letter') : t('group'), h('em', null, t('ifAny'))),
            letterGrid && h('div', { style: { marginBottom: '8px' } }, letterGrid), letterInput)),
        h('div', { class: 'consent' },
          h('label', { class: 'check' },
            h('input', { type: 'checkbox', checked: form.consent, onchange: (e) => { form.consent = e.target.checked; } }),
            h('span', null, t('consent'))),
          h('details', { class: 'consent-more' },
            h('summary', null, t('consentMore')),
            h('p', null, t('consentFull', { org: state.config.orgName })))),
        h('p', { class: 'muted small' }, t('nameOnCert')),
        err,
        h('div', { class: 'sticky-cta' }, submit)));
    }
  }

  // ─── Карта миссий ─────────────────────────────────────────────────────

  function renderMap() {
    const me = state.me;
    const missions = missionsFor();
    const total = missions.length;
    const initials = (me.firstName[0] || '') + (me.lastName[0] || '');
    const finalAvailable = allMissionsDone();

    app.replaceChildren(h('div', { class: 'stack' },
      h('section', { class: 'card player-card' },
        h('div', { class: 'who' }, h('div', { class: 'avatar', 'aria-hidden': 'true' }, initials),
          h('div', null, h('h2', null, t('hello', { name: me.firstName })), h('div', { class: 'rank' }, rankOf(me)))),
        h('div', null,
          h('div', { class: 'xp-line' }, h('span', null, `⭐ ${me.xp} XP`), h('span', null, t('missionsCount', { d: me.missionsDone, n: total }))),
          h('div', { class: 'progress gold', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total * 100), 'aria-valuenow': String(me.xp) },
            h('i', { style: { width: `${Math.min(100, (me.xp / (total * 100)) * 100)}%` } }))),
        h('div', { class: 'badges', 'aria-label': t('badges') }, missions.map((m) =>
          h('div', { class: 'badge' + (missionDone(m.id) ? ' on' : ''), title: m.badge.name, 'aria-label': missionDone(m.id) ? t('badgeEarned', { name: m.badge.name }) : m.badge.name }, m.badge.emoji)))),
      gameCard(),
      isJunior() && h('div', null, h('span', { class: 'route-note' }, t('juniorRoute'))),
      finalAvailable && !me.passed && h('div', { class: 'rule' }, t('allMissionsDone')),
      missionMap(missions),
      h('button', { class: 'btn ghost', onclick: () => go('#/memo') }, t('memoBtn'))));

    const map = app.querySelector('.jmap');
    // Бегущий пунктир оперативной карты — таймером, 5 шагов в секунду (см. .ops .trail-dash в app.css)
    const trail = map.classList.contains('ops') && !SB.reducedMotion && map.querySelector('.jtrail');
    if (trail) {
      let offset = 0;
      const timer = setInterval(() => {
        if (!trail.isConnected) { clearInterval(timer); return; }
        if (document.hidden) return;
        offset = (offset - 3) % 18;
        trail.style.setProperty('--dash', `${offset}px`);
      }, 200);
      state.cleanup = () => clearInterval(timer);
    }

    // Анимация после пройденной миссии: агент идёт к следующей точке, она «открывается»
    const cur = map.querySelector('.jnode.current');
    const mascotEl = map.querySelector('.jmascot');
    const just = state.justCompleted;
    state.justCompleted = null;
    if (just && cur && mascotEl && !SB.reducedMotion) {
      const from = map.querySelector(`.jnode[data-id="${just}"]`);
      if (from && from !== cur) {
        const target = { left: mascotEl.style.left, top: mascotEl.style.top };
        mascotEl.style.transition = 'none';
        mascotEl.style.left = from.style.left;
        mascotEl.style.top = `${parseFloat(from.style.top) - 42}px`;
        cur.classList.add('waiting');
        from.scrollIntoView({ block: 'center' });
        setTimeout(() => {
          mascotEl.style.transition = '';
          mascotEl.style.left = target.left;
          mascotEl.style.top = target.top;
          cur.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }, 250);
        setTimeout(() => { cur.classList.remove('waiting'); cur.classList.add('unlock'); SB.sparkle(cur); }, 1150);
        return;
      }
    }
    if (cur && Number(cur.dataset.index) > 1) cur.scrollIntoView({ block: 'center' });
  }

  // 1–6 классы — карта-джунгли с маскотом; 7 класс и старше — строгая «оперативная карта»
  function missionMap(missions) {
    const me = state.me;
    const ops = !isJunior();
    const ROW = 172;
    const TOP = 210;
    const XS = [30, 70, 32, 68, 30, 70];
    const nodes = missions.map((m, i) => {
      const done = missionDone(m.id);
      const available = !done && (i === 0 || missionDone(missions[i - 1].id));
      return { kind: 'mission', m, i, x: XS[i % XS.length], state: done ? 'done' : available ? 'available' : 'locked' };
    });
    nodes.push({ kind: 'final', i: missions.length, x: 50, state: me.passed ? 'done' : allMissionsDone() ? 'available' : 'locked' });
    nodes.forEach((n, i) => { n.y = TOP + i * ROW; });
    const height = TOP + (nodes.length - 1) * ROW + 150;
    const start = { x: 50, y: 52 };

    // Тропа: отрезки до каждой точки (открытые — светлые, закрытые — бледные).
    // На оперативной карте — ломаная линия, как маршрут на схеме: сначала вбок на уровне
    // точки (подпись под точкой не пересекается), затем вниз к следующей.
    let prev = start;
    const paths = nodes.map((n) => {
      const d = ops
        ? `M ${prev.x} ${prev.y} H ${n.x} V ${n.y}`
        : `M ${prev.x} ${prev.y} C ${prev.x} ${prev.y + ROW * 0.55}, ${n.x} ${n.y - ROW * 0.55}, ${n.x} ${n.y}`;
      prev = n;
      const cls = n.state === 'locked' ? ' locked' : '';
      return `<path class="trail-base${cls}" d="${d}"/><path class="trail-dash${cls}" d="${d}"/>`;
    }).join('');

    const current = nodes.find((n) => n.state === 'available') || nodes[nodes.length - 1];

    // Украшения джунглей — с противоположной от точки стороны тропы
    const DECOR = ['🌴', '🦜', '🌳', '🐒', '🌺', '🍌', '🦋', '🌿', '🐸', '🪨', '🍄', '🐍'];
    const decor = [];
    if (!ops) {
      nodes.forEach((n, i) => {
        const side = n.x < 50 ? 1 : -1;
        decor.push({ x: 50 + side * 33, y: n.y - 30, e: DECOR[(i * 2) % DECOR.length], cls: 'sway big' });
        decor.push({ x: 50 + side * 24, y: n.y + 52, e: DECOR[(i * 2 + 1) % DECOR.length], cls: '' });
      });
      decor.push({ x: 12, y: 40, e: '🌴', cls: 'sway big' }, { x: 88, y: 46, e: '☀️', cls: '' }, { x: 86, y: height - 50, e: '🌴', cls: 'sway big' }, { x: 14, y: height - 46, e: '🌺', cls: '' });
    }
    const finalTitle = ops ? (me.passed ? t('opsCert') : t('opsFinal')) : (me.passed ? t('certTreasure') : t('treasure'));

    const tapNode = (n) => {
      if (n.kind === 'final') {
        if (n.state === 'done') return go('#/certificate');
        if (n.state === 'locked') return toast(t('testLocked'));
        return go('#/quiz');
      }
      if (n.state === 'locked') return toast(t('lockedMission', { n: n.i, title: missions[n.i - 1].title }));
      openMissionCard(n.m, n.i, n.state === 'done');
    };

    const done = missions.filter((m) => missionDone(m.id)).length;
    return h('section', { class: 'jmap' + (ops ? ' ops' : ''), style: { height: `${height}px` } },
      // SVG создаётся через разметку, чтобы получить правильное пространство имён
      h('div', { style: { display: 'contents' }, html: `<svg class="jtrail" viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">${paths}</svg>` }),
      decor.map((d) => h('span', { class: `jdeco ${d.cls}`, 'aria-hidden': 'true', style: { left: `${d.x}%`, top: `${d.y}px` } }, d.e)),
      ops && h('div', { class: 'ops-hud', 'aria-hidden': 'true' }, h('span', null, t('opsMap')), h('span', null, `${done} / ${missions.length}`)),
      ops
        ? h('div', { class: 'jstart ops-hq', style: { top: `${start.y}px` } }, h('span', { class: 'hq', 'aria-hidden': 'true' }), h('small', null, t('opsHq')))
        : h('div', { class: 'jstart', style: { top: `${start.y}px` } }, '⛺', h('small', null, t('campStart'))),
      nodes.map((n) => {
        const r = n.kind === 'mission' ? me.missions[n.m.id] : null;
        const label = n.kind === 'final'
          ? [h('span', { class: 'num' }, ops ? t('opsFinalSub') : t('treasureSub')), h('b', null, finalTitle)]
          : [h('span', { class: 'num' }, t('stage', { n: n.i + 1 })), h('b', null, n.m.title), r && h('span', { class: 'stars' }, starsText(starsFor(r.score, r.max)))];
        const emoji = n.kind === 'final' ? (me.passed ? '🏆' : ops ? '🛡️' : '💎') : n.m.emoji;
        return [
          h('button', {
            class: `jnode ${n.state}${n.kind === 'final' ? ' final' : ''}${n === current ? ' current' : ''}`,
            style: { left: `${n.x}%`, top: `${n.y}px` },
            'data-id': n.kind === 'final' ? 'final' : n.m.id,
            'data-index': String(n.i),
            'aria-label': n.kind === 'final' ? finalTitle : `${t('stage', { n: n.i + 1 })}: ${n.m.title}`,
            onclick: () => tapNode(n),
          },
          h('span', { class: 'emo', 'aria-hidden': 'true' }, emoji),
          n.state === 'locked' && h('span', { class: 'lock', 'aria-hidden': 'true' }, '🔒'),
          n.state === 'done' && n.kind === 'mission' && h('span', { class: 'check', 'aria-hidden': 'true' }, '✓')),
          h('div', { class: 'jlabel', style: { left: `${n.x}%`, top: `${n.y + (n.kind === 'final' ? 62 : 50)}px` } }, label),
        ];
      }),
      // Указатель текущей точки: маскот в джунглях, метка «Вы здесь» на оперативной карте
      h('div', { class: 'jmascot' + (ops ? ' ops-pin' : ''), 'aria-hidden': 'true', style: { left: `${current.x}%`, top: `${current.y - (current.kind === 'final' ? 52 : 42)}px` } },
        ops ? h('span', { class: 'pin-label' }, t('opsHere')) : mascot()));
  }

  // Карточка мини-игры на карте: закрыта до первой миссии, дальше — рекорд и раунды
  function gameCard() {
    if (!gameOn()) return null;
    const g = SB.game.info(state.me);
    // 7+ классы — строгая карточка в стиле оперативной карты
    const logo = h('span', { class: 'gc-logo', html: g.ops ? SB.game.LOGO_OPS : SB.game.LOGO });
    const ops = g.ops ? ' ops' : '';
    if (!g.unlocked) {
      return h('button', { class: 'game-card locked' + ops, type: 'button', onclick: () => toast(t('gameLockedToast')) },
        logo,
        h('span', { class: 'gc-meta' }, h('b', null, t('gameName')), h('small', null, `🔒 ${t('gameLocked')}`)));
    }
    return h('button', { class: 'game-card' + ops, type: 'button', onclick: () => go('#/game') },
      logo,
      h('span', { class: 'gc-meta' },
        h('b', null, t('gameName'), g.ops ? h('span', { class: 'gc-mode' }, t('gameModeOps')) : null),
        h('small', null, g.best ? `🏆 ${t('gameBest')}: ${fmt(g.best)}` : t('gameTag'))),
      h('span', { class: 'gc-side' },
        h('span', { class: 'gc-play' }, g.hasRound ? t('gameResume') : t('gamePlayShort')),
        h('span', { class: 'gc-rounds' }, `🎟️ ${g.unlimited ? '∞' : g.left} · 🔄 ${g.spins}`)));
  }

  function renderGame() {
    if (!gameOn()) return go('#/map');
    if (!SB.game.info(state.me).unlocked) {
      toast(t('gameLockedToast'));
      return go('#/map');
    }
    state.cleanup = SB.game.render(app, {
      me: state.me,
      rating: !!(state.config && state.config.gameRating),
      nextMission: nextMissionInfo(),
      tips: memoFor(),
      go,
    });
  }

  async function openMissionCard(m, i, done) {
    const r = state.me.missions[m.id];
    const ok = await sheet({
      emoji: m.emoji,
      title: `${t('stage', { n: i + 1 })}: ${m.title}`,
      content: h('div', null,
        h('p', null, m.desc),
        r && h('p', { style: { marginTop: '8px', fontWeight: '800' } }, h('span', { style: { color: '#f5b800' } }, starsText(starsFor(r.score, r.max))), ` · ${Math.round((r.score / r.max) * 100)} XP`)),
      actions: [{ label: done ? t('replayBtn') : t('startBtn'), class: done ? '' : 'gold', value: true }, { label: t('close'), class: 'ghost', value: false }],
      dismissible: true,
    });
    if (ok) go(`#/mission/${m.id}`);
  }

  // ─── Миссия ───────────────────────────────────────────────────────────

  async function renderMission(id) {
    const missions = missionsFor();
    const idx = missions.findIndex((m) => m.id === id);
    const mission = missions[idx];
    if (!mission) return go('#/map');
    if (idx > 0 && !missionDone(missions[idx - 1].id)) return go('#/map');
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
    const doneBefore = state.me.missionsDone;
    const prevBest = state.me.missions[id]; // лучший результат этой миссии до прохождения
    const here = location.hash;
    // Результат сохраняется параллельно с праздником: экран не ждёт ответа сервера
    // (раньше после последнего ответа экран «замирал», пока шёл запрос). Повторы — на случай
    // кратковременной потери связи.
    const save = async () => {
      let err = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt) await sleep(1500);
        try {
          state.me = (await api('/api/progress', { method: 'POST', body: { missionId: id, score, max } })).participant;
          return null;
        } catch (e) { err = e; }
      }
      return err;
    };
    let saved = false;
    const saving = save().then((e) => { saved = true; return e; });

    const stars = starsFor(score, max);
    const xp = Math.round((score / max) * 100);
    const next = missions[idx + 1];

    // Праздник! Новая миссия — раунд мини-игры, впервые 3 звезды — «Новые фигуры»
    const gotRound = gameOn() && firstTime && !state.me.passed;
    const had3 = !!prevBest && starsFor(prevBest.score, prevBest.max) === 3;
    const gotSpin = gameOn() && stars === 3 && !had3;
    const bonusLines = [gotRound && t(doneBefore ? 'gameBonus' : 'gameBonusFirst', { n: SB.game.settings().rounds }), gotSpin && t('gameSpinBonus')].filter(Boolean);
    await SB.celebrate({
      emoji: mission.badge.emoji,
      title: t('missionComplete'),
      subtitle: mission.title,
      stars,
      xp,
      badge: firstTime ? t('newBadge', { name: mission.badge.name }) : null,
      bonus: bonusLines.length ? bonusLines.flatMap((l, i) => (i ? [h('br'), l] : [l])) : null,
      button: t('hooray'),
    });
    if (location.hash !== here) return; // ушли с экрана во время праздника
    // Обычно ответ уже пришёл; при медленной связи — понятная надпись вместо «зависания»
    if (!saved) app.replaceChildren(h('div', { class: 'empty' }, t('savingResult')));
    let err = await saving;
    while (err) {
      await new Promise((resolve) => showError(err, resolve));
      if (location.hash !== here) return;
      app.replaceChildren(h('div', { class: 'empty' }, t('savingResult')));
      err = await save();
    }
    if (location.hash !== here) return;
    updateTopbar(); // обновить очки; переключатель языка остаётся скрытым до перехода на другой экран
    state.justCompleted = id;

    app.replaceChildren(h('div', { class: 'stack finish' },
      h('div', { class: 'big-emo' }, mission.badge.emoji),
      h('h2', { class: 'step-title' }, t('missionDone', { title: mission.title })),
      h('div', { class: 'stars-big', 'aria-label': t('starsAria', { n: stars }) },
        [0, 1, 2].map((i) => h('span', { class: i < stars ? '' : 'off' }, '⭐'))),
      h('p', null, h('span', { class: 'pill gold' }, `+${xp} XP`), ' ', h('span', { class: 'pill' }, t('correctCount', { s: score, m: max }))),
      h('div', { class: 'card stack-sm', style: { textAlign: 'left' } },
        h('b', null, t('rememberMain')),
        h('ul', { class: 'lesson', style: { margin: 0, paddingLeft: '20px' } }, mission.recap.map((r) => h('li', null, r)))),
      // Не 3 звезды и «Новые фигуры» за эту миссию ещё не получены — зовём пройти ещё раз
      gameOn() && stars < 3 && !had3 && h('div', { class: 'rule blue row spin-hint' },
        h('b', { style: { flex: '1' } }, t('gameSpinFinish')),
        h('button', { class: 'btn small ghost', style: { width: 'auto' }, onclick: () => go(`#/mission/${id}`) }, t('replayBtn'))),
      next
        ? h('button', { class: 'btn gold', onclick: () => go('#/map') }, t('toMapNext'))
        : h('button', { class: 'btn gold', onclick: () => go('#/memo') }, t('toFinalTest')),
      next && h('button', { class: 'btn ghost', onclick: () => go(`#/mission/${next.id}`) }, t('nextMission', { n: idx + 2, title: next.title })),
      gameOn() && h('button', { class: 'btn ghost', onclick: () => go('#/game') }, gameBtnLabel())));
  }

  // ─── Памятка ──────────────────────────────────────────────────────────

  function renderMemo() {
    const canTest = allMissionsDone() && !state.me.passed;
    app.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => go('#/map') }, icon('back')),
        h('h2', { class: 'step-title' }, t('memoTitle'))),
      isJunior() && SB.listenBtn(() => [t('memoTitle'), memoFor().map((m) => m.text)]),
      h('div', { class: 'stack-sm memo-list' }, memoFor().map((m) =>
        h('div', { class: 'card row', style: { alignItems: 'flex-start', padding: '14px' } },
          h('span', { style: { fontSize: '26px', lineHeight: '1' }, 'aria-hidden': 'true' }, m.emoji),
          h('span', null, m.text)))),
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
    const start = h('button', { class: 'btn gold', onclick: begin }, t('startBtn'));
    const rules = isJunior()
      ? [t('quizRule1Jr', { n: c.quizSize }), t('quizRule2Jr', { p: c.passScore }), t('quizRule3Jr')]
      : [t('quizRule1', { n: c.quizSize }), t('quizRule2', { p: c.passScore }), t('quizRule3'), t('quizRule4')];
    const showRules = () => sheet({ emoji: '📝', title: t('rulesTitle'), content: h('div', { class: 'stack-sm' }, rules.map((r) => h('p', null, r))), actions: [{ label: 'OK' }], dismissible: true });
    const alive = viewGuard();
    async function begin() {
      start.disabled = true;
      start.textContent = t('preparingQuestions');
      try {
        const quiz = await api('/api/quiz/start', { method: 'POST' });
        if (!alive()) return;
        state.quiz = { ...quiz, answers: [], index: 0 };
        updateTopbar();
        renderQuestion();
      } catch (e) {
        toast(e.message, 'bad');
        start.disabled = false;
        start.textContent = t('startBtn');
      }
    }
    app.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('button', { class: 'icon-btn', 'aria-label': t('back'), onclick: () => go('#/map') }, icon('back')),
        h('h2', { class: 'step-title', style: { flex: '1' } }, t('finalTest')),
        h('button', { class: 'q-btn', type: 'button', 'aria-label': t('rulesTitle'), onclick: showRules }, '?')),
      h('div', { class: 'quiz-chips' },
        h('span', { 'aria-label': rules[0] }, t('quizChipQ', { n: c.quizSize })),
        h('span', { 'aria-label': rules[1] }, t('quizChipPass', { p: c.passScore })),
        h('span', null, '⏱️ ∞'),
        h('span', null, '🔁')),
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
    // Пока ответы отправляются, варианты не нажимаются: иначе кнопка «Готово» снова
    // включалась, тест уходил второй раз и ученик видел ошибку «попытка уже завершена»
    let sending = false;
    const opts = q.options.map((o, k) => h('button', {
      class: 'option', 'aria-pressed': String(qz.answers[qz.index] === k),
      onclick: () => {
        if (sending) return;
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
      if (sending) return;
      sending = true;
      nextBtn.disabled = true;
      nextBtn.textContent = t('checking');
      const alive = viewGuard();
      try {
        const res = await api('/api/quiz/submit', { method: 'POST', body: { attemptId: qz.attemptId, answers: qz.answers } });
        state.me = res.participant;
        if (!alive()) return; // результат сохранён, ученик уже на другом экране
        state.quiz = null;
        updateTopbar();
        renderResult(res);
      } catch (e) {
        sending = false;
        if (!alive()) return;
        // Ответы уже приняты: первая отправка дошла, а ответ сервера потерялся по дороге.
        // Берём итог с сервера: сдал — к сертификату, нет — к экрану теста (там лучший результат)
        if (e.status === 409) {
          try { state.me = (await api('/api/me')).participant; } catch { /* покажем с прежними данными */ }
          if (!alive()) return;
          state.quiz = null;
          updateTopbar();
          toast(t('answersSaved'), 'ok');
          go(state.me && state.me.passed ? '#/certificate' : '#/quiz');
          return;
        }
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
      isJunior() && SB.listenBtn(() => [q.q, q.options.map((o, k) => `${keys[k]}. ${o}`)]),
      h('div', { class: 'options' }, opts),
      h('div', { class: 'btn-row' },
        qz.index > 0 && h('button', { class: 'btn ghost', style: { flex: '0 0 30%' }, 'aria-label': t('back'), onclick: () => { if (sending) return; qz.index -= 1; renderQuestion(); } }, '←'),
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

  async function renderResult(res) {
    const alive = viewGuard();
    if (res.passed) {
      await SB.celebrate({ emoji: '🏆', title: t('testPassedWow'), subtitle: t('rankFinal'), stars: 3, bonus: gameOn() && SB.game.settings().unlimited ? t('gameBonusFull') : null, button: t('hooray') });
      if (!alive()) return;
    }
    const review = Array.isArray(res.review) ? res.review : [];
    const reviewBox = h('div', { hidden: true }, reviewList(review));
    const toggle = review.length && h('button', {
      class: 'btn ghost',
      onclick: () => { reviewBox.hidden = !reviewBox.hidden; toggle.textContent = reviewBox.hidden ? t('showReview') : t('hideReview'); },
    }, t('showReview'));

    app.replaceChildren(h('div', { class: 'stack center' },
      scoreRing(res.score, res.total, res.passed),
      h('h2', { class: 'step-title' }, res.passed ? t('passedTitle') : t('failedTitle')),
      !res.passed && h('p', { class: 'muted' }, t('failedText', { p: res.passScore, d: res.passScore - res.score })),
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
    const alive = viewGuard();
    app.replaceChildren(h('div', { class: 'empty' }, t('preparingCert')));
    let data;
    try {
      data = await api('/api/certificate');
    } catch (e) {
      return alive() && showError(e, renderCertificate);
    }
    if (!alive()) return;
    const canvas = h('canvas', { 'aria-label': `${t('yourCert')}: ${data.fullName}`, role: 'img' });
    await SB.cert.draw(canvas, data);
    if (!alive()) return;

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
      gameOn() && h('button', { class: 'btn ghost', onclick: () => go('#/game') }, gameBtnLabel()),
      h('button', { class: 'btn ghost', onclick: () => go('#/memo') }, t('memoBtn')),
      h('button', { class: 'link-btn', onclick: logout }, t('finishAndExit'))));
  }

  // ─── Маршрутизация ────────────────────────────────────────────────────

  function route() {
    const [, page, arg] = (location.hash.replace(/^#/, '') || '/').split('/');
    state.view += 1;
    if (state.cleanup) { state.cleanup(); state.cleanup = null; }
    SB.stopSpeech();
    state.page = page || '';
    if (page !== 'quiz') state.quiz = null;
    // 1–6 классы: крупнее шрифт и кнопки (стили body.junior в app.css)
    document.body.classList.toggle('junior', isJunior());
    updateTopbar();
    window.scrollTo(0, 0);
    if (!state.me) return page === 'register' ? renderRegister() : renderWelcome();
    switch (page) {
      case 'map': return renderMap();
      case 'mission': return renderMission(arg);
      case 'memo': return renderMemo();
      case 'quiz': return renderQuizIntro();
      case 'game': return renderGame();
      case 'certificate': return renderCertificate();
      case 'register': return go('#/map');
      default: return renderWelcome();
    }
  }

  async function boot() {
    try {
      state.config = await api(`/api/config?lang=${SB.lang}`);
      SB.game.configure(state.config.game);
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
