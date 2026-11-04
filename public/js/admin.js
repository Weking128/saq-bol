// Админ-панель «Сақ бол!»: обзор, участники, учебные заведения, настройки.
(function () {
  'use strict';
  const { h, mascot, toast, fmt } = SB;
  const root = document.getElementById('admin-root');

  const TYPE_LABELS = { school: 'Школа', college: 'Колледж', university: 'Вуз', other: 'Другое' };
  const STATUS_LABELS = {
    passed: 'Сертификат получен',
    failed: 'Тест не сдан',
    missions_done: 'Миссии пройдены',
    in_progress: 'Проходит миссии',
    registered: 'Только регистрация',
  };
  const state = { tab: 'overview', filters: { from: '', to: '', type: '', district: '' }, people: { q: '', district: '', institution: '', status: '', grade: '', from: '', to: '', sort: 'created', page: 1 }, institutions: null, districts: [], instDistrict: '' };

  async function api(path, opts = {}) {
    const headers = { 'X-Requested-With': 'fetch' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(path, { method: opts.method || 'GET', headers, credentials: 'same-origin', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
    } catch {
      throw new Error('Нет связи с сервером');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !opts.allow401) {
      renderLogin();
      throw new Error(data.error || 'Требуется вход');
    }
    if (!res.ok) throw Object.assign(new Error(data.error || 'Ошибка сервера'), { status: res.status });
    return data;
  }

  const qs = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== '' && v !== null && v !== undefined)).toString();
  const dt = (iso) => (iso ? new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
  const d = (iso) => (iso ? new Date(iso).toLocaleDateString('ru-RU') : '—');
  const today = () => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };
  const daysAgo = (n) => {
    const t = new Date();
    t.setDate(t.getDate() - n);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };
  const statusBadge = (s) => h('span', { class: `status st-${s}` }, STATUS_LABELS[s] || s);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

  // ─── Вход ─────────────────────────────────────────────────────────────

  function renderLogin() {
    stopRefresh();
    const pw = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', placeholder: 'Пароль администратора', 'aria-label': 'Пароль' });
    const err = h('p', { class: 'error-text', role: 'alert' });
    const btn = h('button', { class: 'btn', type: 'submit' }, 'Войти');
    const form = h('form', {
      class: 'card stack login',
      onsubmit: async (e) => {
        e.preventDefault();
        err.textContent = '';
        btn.disabled = true;
        try {
          await api('/api/admin/login', { method: 'POST', body: { password: pw.value }, allow401: true });
          boot();
        } catch (ex) {
          err.textContent = ex.message;
          btn.disabled = false;
        }
      },
    }, mascot(), h('h2', { class: 'center' }, 'Админ-панель'), h('p', { class: 'muted center small' }, 'Сақ бол! — квест по финансовой безопасности'), pw, err, btn);
    root.replaceChildren(h('div', { class: 'login-wrap' }, form));
    pw.focus();
  }

  // ─── Каркас ───────────────────────────────────────────────────────────

  const TABS = [
    ['overview', 'Обзор'],
    ['analytics', 'Аналитика'],
    ['people', 'Участники'],
    ['institutions', 'Учебные заведения'],
    ['settings', 'Настройки'],
  ];

  function shell() {
    const main = h('main', { class: 'a-main' });
    const tabs = h('nav', { class: 'a-tabs', role: 'tablist' }, TABS.map(([id, label]) =>
      h('button', { role: 'tab', 'aria-selected': String(state.tab === id), onclick: () => switchTab(id) }, label)));
    root.replaceChildren(
      h('header', { class: 'a-top' },
        h('div', { class: 'brand' }, h('img', { src: '/img/favicon.svg', alt: '', width: '30', height: '30' }), h('div', null, 'Сақ бол!', h('small', null, 'Админ-панель'))),
        h('div', { class: 'spacer' }),
        h('a', { href: '/', target: '_blank', rel: 'noopener' }, 'Открыть квест ↗'),
        h('button', {
          class: 'plain',
          onclick: async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); renderLogin(); },
        }, 'Выйти')),
      tabs, main);
    return main;
  }

  function switchTab(id) {
    state.tab = id;
    try { sessionStorage.setItem('sb-admin-tab', id); } catch { /* недоступно */ }
    render();
  }

  let refreshTimer = null;
  const stopRefresh = () => { clearInterval(refreshTimer); refreshTimer = null; };

  function render() {
    stopRefresh();
    hideTip();
    const main = shell();
    ({ overview: renderOverview, analytics: renderAnalytics, people: renderPeople, institutions: renderInstitutions, settings: renderSettings })[state.tab](main);
  }

  async function loadInstitutions(force) {
    if (!state.institutions || force) state.institutions = await api('/api/admin/institutions');
    return state.institutions;
  }

  // ─── Обзор ────────────────────────────────────────────────────────────

  // Фильтры периода, района и типа — общие для «Обзора» и «Аналитики»
  function periodFilters() {
    const f = state.filters;
    const dateFrom = h('input', { class: 'ctl', type: 'date', value: f.from, onchange: (e) => { f.from = e.target.value; render(); } });
    const dateTo = h('input', { class: 'ctl', type: 'date', value: f.to, onchange: (e) => { f.to = e.target.value; render(); } });
    const preset = (label, from, to) => h('button', {
      'aria-pressed': String(f.from === from && f.to === to),
      onclick: () => { f.from = from; f.to = to; render(); },
    }, label);
    return h('div', { class: 'filters' },
      h('div', { class: 'f' }, 'Период', h('div', { class: 'seg' }, preset('Сегодня', today(), today()), preset('7 дней', daysAgo(6), today()), preset('30 дней', daysAgo(29), today()), preset('Всё время', '', ''))),
      h('label', { class: 'f' }, 'С', dateFrom),
      h('label', { class: 'f' }, 'По', dateTo),
      h('label', { class: 'f' }, 'Город / район', districtSelect(f.district, (v) => { f.district = v; render(); })),
      h('label', { class: 'f' }, 'Тип заведения', h('select', { class: 'ctl', onchange: (e) => { f.type = e.target.value; render(); } },
        h('option', { value: '' }, 'Все'), Object.entries(TYPE_LABELS).map(([k, v]) => h('option', { value: k, selected: f.type === k }, v)))));
  }

  async function renderOverview(main) {
    const f = state.filters;
    const content = h('div', null, h('p', { class: 'muted' }, 'Загрузка…'));
    main.append(periodFilters(), content);

    let s;
    try {
      s = await api('/api/admin/stats?' + qs(f));
    } catch (e) {
      content.replaceChildren(h('p', { class: 'error-text' }, e.message));
      return;
    }
    const t = s.totals;
    // Обёртка h('div') отбрасывает пустые блоки (например, таблицу районов при выбранном районе)
    content.replaceChildren(h('div', null,
      h('section', { class: 'kpis a-section' },
        kpi('Участников', fmt(t.participants), `из ${fmt(t.institutions)} учебных заведений`),
        kpi('Прошли все миссии', fmt(t.missionsDone), `${pct(t.missionsDone, t.participants)}% от участников`),
        kpi('Проходили тест', fmt(t.tested), `${pct(t.tested, t.participants)}% от участников`),
        kpi('Получили сертификат', fmt(t.passed), t.tested ? `${pct(t.passed, t.tested)}% сдали из тех, кто проходил` : '—'),
        kpi('Средний балл теста', t.avgScore === null ? '—' : String(t.avgScore).replace('.', ','), 'лучший результат участника, из 10')),
      h('section', { class: 'grid-2 a-section' },
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', null, 'Регистрации по дням'), h('span', { class: 'hint' }, 'наведите на столбец')),
          dayChart(s.byDay)),
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', null, 'Знание тем'), h('span', { class: 'hint' }, '% правильных ответов в тесте')),
          s.topics.some((x) => x.shown)
            ? h('div', { class: 'hbars' }, s.topics.map((x) => h('div', { class: 'hbar' },
              h('span', null, x.topic),
              h('span', { class: 'track', role: 'img', 'aria-label': `${x.topic}: ${x.correctPct ?? 0}%` }, h('i', { style: { width: `${x.correctPct ?? 0}%` } })),
              h('span', { class: 'v' }, x.correctPct === null ? '—' : `${x.correctPct}%`))))
            : h('p', { class: 'muted small' }, 'Пока никто не проходил тест.'))),
      h('section', { class: 'grid-2 a-section' },
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', null, 'Самые трудные вопросы'), h('span', { class: 'hint' }, 'меньше всего правильных ответов')),
          s.questions.length
            ? h('ol', { class: 'qlist' }, s.questions.slice(0, 6).map((q) => h('li', null, h('b', null, `${q.correctPct}%`), h('span', null, q.q, h('br'), h('span', { class: 'sub muted' }, `${q.topic} · показан ${q.shown} раз`)))))
            : h('p', { class: 'muted small' }, 'Пока нет данных.')),
        h('div', { class: 'panel' },
          h('div', { class: 'panel-head' }, h('h3', null, 'По классам и курсам')),
          s.byGrade.length
            ? h('div', { class: 'chips' }, s.byGrade.map((g) => h('span', { class: 'chip' }, h('b', null, `${g.grade} ${g.kind === 'course' ? 'курс' : 'кл.'}`), ` — ${g.participants} уч., ${g.passed} серт.`)))
            : h('p', { class: 'muted small' }, 'Пока нет данных.'))),
      !f.district && h('section', { class: 'panel a-section' },
        h('div', { class: 'panel-head' }, h('h3', null, 'По городу и районам'), h('span', { class: 'hint' }, 'нажмите на строку, чтобы отфильтровать статистику')),
        districtTable(s.byDistrict)),
      h('section', { class: 'panel a-section' },
        h('div', { class: 'panel-head' }, h('h3', null, 'Учебные заведения'), h('span', { class: 'hint' }, 'нажмите на строку, чтобы увидеть участников')),
        institutionTable(s.byInstitution))));
  }

  function districtSelect(value, onChange) {
    return h('select', { class: 'ctl', onchange: (e) => onChange(e.target.value) },
      h('option', { value: '' }, 'Все'),
      state.districts.map((d) => h('option', { value: d.id, selected: value === d.id }, d.name)));
  }

  function districtTable(rows) {
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null,
        h('th', null, 'Город / район'), h('th', { class: 'num' }, 'Заведений с участниками'), h('th', { class: 'num' }, 'Участников'),
        h('th', { class: 'num' }, 'Прошли миссии'), h('th', { class: 'num' }, 'Сертификатов'), h('th', { class: 'num' }, '% сдачи'), h('th', { class: 'num' }, 'Ср. балл'))),
      h('tbody', null, rows.map((r) => h('tr', {
        class: 'click' + (r.participants ? '' : ' inactive'),
        onclick: () => { state.filters.district = r.id; render(); },
      },
      h('td', { class: 'name' }, r.name),
      h('td', { class: 'num' }, r.institutions),
      h('td', { class: 'num' }, r.participants),
      h('td', { class: 'num' }, r.missionsDone),
      h('td', { class: 'num' }, r.passed),
      h('td', { class: 'num' }, `${pct(r.passed, r.participants)}%`),
      h('td', { class: 'num' }, r.avgScore === null ? '—' : String(r.avgScore).replace('.', ',')))))));
  }

  function kpi(label, value, sub) {
    return h('div', { class: 'kpi' }, h('small', null, label), h('b', null, value), h('span', null, sub));
  }

  let tipEl = null;
  function showTip(e, html) {
    if (!tipEl) { tipEl = h('div', { class: 'tip', role: 'tooltip' }); document.body.append(tipEl); }
    tipEl.replaceChildren(...html.flat(3).filter((x) => x !== null && x !== undefined && x !== false));
    const r = (e.currentTarget || e.target).getBoundingClientRect();
    tipEl.style.display = 'block';
    const w = tipEl.offsetWidth;
    tipEl.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tipEl.style.top = `${Math.max(8, r.top - tipEl.offsetHeight - 8)}px`;
  }
  const hideTip = () => { if (tipEl) tipEl.style.display = 'none'; };

  function dayChart(rows) {
    if (!rows.length) return h('p', { class: 'muted small' }, 'Пока нет регистраций.');
    // Заполняем пропущенные дни нулями, чтобы ось времени была непрерывной
    const map = new Map(rows.map((r) => [r.day, r]));
    const days = [];
    const start = new Date(rows[0].day + 'T00:00:00Z');
    const end = new Date(rows[rows.length - 1].day + 'T00:00:00Z');
    for (let x = new Date(start); x <= end && days.length < 62; x.setUTCDate(x.getUTCDate() + 1)) {
      const key = x.toISOString().slice(0, 10);
      days.push(map.get(key) || { day: key, participants: 0, passed: 0 });
    }
    const max = Math.max(...days.map((x) => x.participants), 1);
    const nice = max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
    const label = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
    const step = Math.ceil(days.length / 7);

    const bars = h('div', { class: 'bars' },
      [0, 0.5, 1].map((p) => [
        h('div', { class: 'grid', style: { bottom: `${p * 100}%` } }),
        h('div', { class: 'ylab', style: { bottom: `${p * 100}%`, transform: 'translateY(50%)' } }, String(Math.round(nice * p))),
      ]),
      days.map((x) => {
        const tip = [h('b', null, label(x.day)), h('br'), `Участников: ${x.participants}`, h('br'), `Сертификатов: ${x.passed}`];
        return h('div', {
          class: 'col', tabindex: '0', 'aria-label': `${label(x.day)}: участников ${x.participants}, сертификатов ${x.passed}`,
          onmouseenter: (e) => showTip(e, tip), onmouseleave: hideTip, onfocus: (e) => showTip(e, tip), onblur: hideTip,
        }, h('i', { style: { height: `${(x.participants / nice) * 100}%` } }));
      }));
    const xl = h('div', { class: 'xlabs', 'aria-hidden': 'true' }, days.map((x, i) => h('span', null, i % step === 0 || i === days.length - 1 ? label(x.day) : '')));
    const table = h('details', { style: { marginTop: '10px' } }, h('summary', { class: 'small muted' }, 'Показать таблицей'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Дата'), h('th', { class: 'num' }, 'Участников'), h('th', { class: 'num' }, 'Сертификатов'))),
        h('tbody', null, days.filter((x) => x.participants).reverse().map((x) => h('tr', null, h('td', null, label(x.day)), h('td', { class: 'num' }, x.participants), h('td', { class: 'num' }, x.passed)))))));
    return h('div', null, bars, xl, table);
  }

  function institutionTable(rows) {
    if (!rows.length) return h('p', { class: 'muted small' }, 'Пока нет участников.');
    let sortKey = 'participants';
    let dir = -1;
    let q = '';
    const tbody = h('tbody');
    const cols = [
      ['name', 'Учебное заведение', false],
      ['type', 'Тип', false],
      ['participants', 'Участников', true],
      ['missionsDone', 'Прошли миссии', true],
      ['passed', 'Сертификатов', true],
      ['rate', '% сдачи', true],
      ['avgScore', 'Ср. балл', true],
      ['lastActivity', 'Активность', false],
    ];
    rows.forEach((r) => { r.rate = pct(r.passed, r.participants); });
    const thead = h('thead', null, h('tr', null, cols.map(([k, label, num]) => h('th', {
      class: 'sortable' + (num ? ' num' : '') + (k === 'type' || k === 'lastActivity' ? ' hide-sm' : ''),
      onclick: () => { dir = sortKey === k ? -dir : (num ? -1 : 1); sortKey = k; fill(); },
    }, label))));
    function fill() {
      const list = rows.filter((r) => !q || r.name.toLowerCase().includes(q))
        .sort((a, b) => {
          const va = a[sortKey] ?? -1;
          const vb = b[sortKey] ?? -1;
          return (typeof va === 'string' ? va.localeCompare(vb, 'ru', { numeric: true }) : va - vb) * dir;
        });
      tbody.replaceChildren(...list.map((r) => h('tr', {
        class: 'click',
        onclick: () => { state.people = { ...state.people, district: r.district || '', institution: r.id ? String(r.id) : 'other', q: '', status: '', page: 1 }; switchTab('people'); },
      },
      h('td', null, h('div', { class: 'name' }, r.name), h('div', { class: 'sub' }, r.districtName)),
      h('td', { class: 'hide-sm' }, TYPE_LABELS[r.type] || r.type),
      h('td', { class: 'num' }, r.participants),
      h('td', { class: 'num' }, r.missionsDone),
      h('td', { class: 'num' }, r.passed),
      h('td', { class: 'num' }, `${r.rate}%`),
      h('td', { class: 'num' }, r.avgScore === null ? '—' : String(r.avgScore).replace('.', ',')),
      h('td', { class: 'hide-sm nowrap' }, dt(r.lastActivity)))));
    }
    fill();
    return h('div', null,
      h('input', { class: 'ctl', type: 'search', placeholder: 'Поиск по названию', style: { marginBottom: '10px', width: '100%', maxWidth: '360px' }, oninput: (e) => { q = e.target.value.trim().toLowerCase(); fill(); } }),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, thead, tbody)));
  }

  // ─── Аналитика ────────────────────────────────────────────────────────

  const FUNNEL_LABELS = {
    registered: 'Зарегистрировались',
    started: 'Начали миссии',
    allMissions: 'Прошли все миссии',
    tested: 'Проходили тест',
    certified: 'Получили сертификат',
  };
  const LANG_LABELS = { kk: 'Қазақша', ru: 'Русский' };
  const LEVEL_LABELS = { junior: 'Облегчённая (1–6 кл.)', junior_short: '1–6 кл.', senior: 'Полная (7+ кл., колледжи, вузы)', senior_short: '7+ кл. и старше' };
  const time = (iso, sec) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) });
  const num1 = (v) => (v === null || v === undefined ? '—' : String(v).replace('.', ','));
  const minutes = (v) => {
    if (v === null || v === undefined) return '—';
    if (v < 1) return '< 1 мин';
    if (v < 60) return `${num1(Math.round(v * 10) / 10)} мин`;
    return `${Math.floor(v / 60)} ч ${Math.round(v % 60)} мин`;
  };
  const tipOn = (tip) => ({ tabindex: '0', onmouseenter: (e) => showTip(e, tip), onmouseleave: hideTip, onfocus: (e) => showTip(e, tip), onblur: hideTip });
  const empty = (text) => h('p', { class: 'muted small' }, text);

  async function renderAnalytics(main) {
    const content = h('div', null, h('p', { class: 'muted' }, 'Загрузка…'));
    main.append(periodFilters(), content);

    const load = async (quiet) => {
      let a;
      try {
        a = await api('/api/admin/analytics?' + qs(state.filters));
      } catch (e) {
        if (!quiet) content.replaceChildren(h('p', { class: 'error-text' }, e.message));
        return;
      }
      if (!content.isConnected) return;
      // Открытые таблицы остаются открытыми после автообновления
      const open = new Set([...content.querySelectorAll('details[open]')].map((d) => d.dataset.key));
      hideTip();
      content.replaceChildren(analyticsView(a));
      content.querySelectorAll('details[data-key]').forEach((d) => { if (open.has(d.dataset.key)) d.open = true; });
    };
    await load(false);
    // Автообновление, пока вкладка открыта и видна
    refreshTimer = setInterval(() => {
      if (state.tab === 'analytics' && document.visibilityState === 'visible') load(true);
    }, 30000);
  }

  function panel(title, hint, body) {
    return h('div', { class: 'panel' }, h('div', { class: 'panel-head' }, h('h3', null, title), hint && h('span', { class: 'hint' }, hint)), body);
  }

  function tableDetails(key, head, rows) {
    return h('details', { class: 'as-table', 'data-key': key }, h('summary', { class: 'small muted' }, 'Показать таблицей'),
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, head.map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
        h('tbody', null, rows.map((r) => h('tr', null, r.map((c, i) => h('td', { class: i ? 'num' : '' }, String(c)))))))));
  }

  // Вертикальные столбцы одного цвета с подсказками и табличным видом
  function vbars(items, o) {
    const values = items.map(o.value);
    const max = Math.max(...values, 1);
    const nice = max <= 5 ? 5 : max <= 10 ? 10 : Math.ceil(max / 10) * 10;
    const every = o.every || 1;
    const bars = h('div', { class: 'bars' + (o.small ? ' sm' : '') + (o.marker ? ' marked' : '') },
      [0, 0.5, 1].map((p) => [
        h('div', { class: 'grid', style: { bottom: `${p * 100}%` } }),
        h('div', { class: 'ylab', style: { bottom: `${p * 100}%`, transform: 'translateY(50%)' } }, String(Math.round(nice * p))),
      ]),
      o.marker && h('div', { class: 'vmark', style: { left: `calc(34px + (100% - 34px) * ${o.marker.index / items.length})` } }, h('span', null, o.marker.label)),
      items.map((x, i) => h('div', { class: 'col' + (o.cls ? ` ${o.cls(x)}` : ''), 'aria-label': o.aria(x), ...tipOn(o.tip(x)) },
        h('i', { style: { height: `${(values[i] / nice) * 100}%` } }))));
    const xl = h('div', { class: 'xlabs', 'aria-hidden': 'true' }, items.map((x, i) => h('span', null, i % every === 0 ? o.label(x) : '')));
    return h('div', null, bars, xl, o.caption && h('div', { class: 'xcap' }, o.caption), o.table);
  }

  function analyticsView(a) {
    // У 1–6 классов под тем же id своя миссия — показываем оба названия
    const junior = Object.fromEntries(((SB.JUNIOR_MISSIONS_BY_LANG || {}).ru || []).map((m) => [m.id, m.title]));
    const titles = Object.fromEntries(((SB.MISSIONS_BY_LANG || {}).ru || []).map((m) => [m.id, junior[m.id] ? `${m.title} / 1–6 кл.: ${junior[m.id]}` : m.title]));
    const L = a.live;
    return h('div', null,
      h('section', { class: 'panel a-section' },
        h('div', { class: 'panel-head' }, h('h3', null, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Сейчас'),
          h('span', { class: 'hint' }, `обновлено в ${time(a.generatedAt, true)} · автообновление каждые 30 с`)),
        h('div', { class: 'kpis live-kpis' },
          kpi('Активны сейчас', fmt(L.activeNow), 'регистрировались, проходили миссии или тест за последние 10 минут'),
          kpi('Регистраций сегодня', fmt(L.regToday), 'с начала дня'),
          kpi('Сертификатов сегодня', fmt(L.certToday), L.regToday ? `${pct(L.certToday, L.regToday)}% от регистраций за день` : 'с начала дня')),
        h('h4', { class: 'sub-h' }, 'Последние 3 часа — регистрации за каждые 10 минут'),
        vbars(L.recent, {
          small: true,
          every: 3,
          value: (x) => x.reg,
          label: (x) => time(x.at),
          aria: (x) => `${time(x.at)}: регистраций ${x.reg}, сертификатов ${x.cert}`,
          tip: (x) => [h('b', null, `${time(x.at)}–${time(new Date(x.at).getTime() + 600000)}`), h('br'), `Регистраций: ${x.reg}`, h('br'), `Сертификатов: ${x.cert}`],
          table: tableDetails('recent', ['Время', 'Регистраций', 'Сертификатов'], L.recent.filter((x) => x.reg || x.cert).reverse().map((x) => [time(x.at), x.reg, x.cert])),
        })),
      h('section', { class: 'grid-2 a-section' },
        panel('Воронка прохождения', 'от регистрации до сертификата', funnelView(a.funnel)),
        panel('Миссии', '% прошедших из тех, кому миссия доступна', missionsView(a.missions, titles))),
      h('section', { class: 'grid-2 a-section' },
        panel('Результаты теста', 'лучший результат каждого участника', scoresView(a)),
        panel('Итоговый тест', null, testsView(a))),
      h('section', { class: 'grid-2 a-section' },
        panel('Активность по часам', 'регистрации за период, местное время', hoursView(a.hours)),
        panel('Где останавливаются', 'кто ещё не прошёл все миссии', stuckView(a.stuck))),
      h('section', { class: 'panel a-section' },
        h('div', { class: 'panel-head' }, h('h3', null, 'Язык и версия квеста')),
        splitsView(a)));
  }

  function funnelView(rows) {
    const base = rows[0].n;
    if (!base) return empty('Пока нет участников.');
    return h('div', null,
      h('div', { class: 'fbars' }, rows.map((r, i) => {
        const tip = [h('b', null, FUNNEL_LABELS[r.key]), h('br'), `Всего: ${fmt(r.n)} (${pct(r.n, base)}% от зарегистрированных)`,
          i ? [h('br'), `От предыдущего шага: ${pct(r.n, rows[i - 1].n)}%`] : null,
          h('br'), `${LEVEL_LABELS.junior_short}: ${fmt(r.junior)} · ${LEVEL_LABELS.senior_short}: ${fmt(r.senior)}`];
        return h('div', { class: 'fbar', 'aria-label': `${FUNNEL_LABELS[r.key]}: ${r.n}`, ...tipOn(tip) },
          h('span', null, FUNNEL_LABELS[r.key]),
          h('span', { class: 'track' }, h('i', { style: { width: `${pct(r.n, base)}%` } })),
          h('span', { class: 'v' }, fmt(r.n), h('small', null, i ? `${pct(r.n, base)}%` : '100%')));
      })),
      tableDetails('funnel', ['Шаг', 'Участников', '% от зарег.', '% от пред. шага', LEVEL_LABELS.junior_short, LEVEL_LABELS.senior_short],
        rows.map((r, i) => [FUNNEL_LABELS[r.key], fmt(r.n), `${pct(r.n, base)}%`, i ? `${pct(r.n, rows[i - 1].n)}%` : '—', fmt(r.junior), fmt(r.senior)])));
  }

  function missionsView(rows, titles) {
    if (!rows.some((m) => m.eligible)) return empty('Пока нет участников.');
    const name = (m, i) => `${i + 1}. ${titles[m.id] || m.id}`;
    return h('div', null,
      h('div', { class: 'hbars' }, rows.map((m, i) => {
        const p = pct(m.done, m.eligible);
        const tip = [h('b', null, name(m, i)), h('br'), `Прошли: ${fmt(m.done)} из ${fmt(m.eligible)}`, h('br'),
          `Средний результат: ${m.avgPct === null ? '—' : `${m.avgPct}%`}`, m.seniorOnly ? [h('br'), 'Только в полной версии (7+ кл.)'] : null];
        return h('div', { class: 'hbar', 'aria-label': `${name(m, i)}: ${p}%`, ...tipOn(tip) },
          h('span', null, name(m, i), m.seniorOnly ? h('span', { class: 'sub muted' }, ' · 7+') : null),
          h('span', { class: 'track' }, h('i', { style: { width: `${p}%` } })),
          h('span', { class: 'v' }, `${p}%`));
      })),
      tableDetails('missions', ['Миссия', 'Доступна', 'Прошли', '% прошли', 'Ср. результат'],
        rows.map((m, i) => [name(m, i) + (m.seniorOnly ? ' (7+ кл.)' : ''), fmt(m.eligible), fmt(m.done), `${pct(m.done, m.eligible)}%`, m.avgPct === null ? '—' : `${m.avgPct}%`])));
  }

  function scoresView(a) {
    const total = a.scores.reduce((s, x) => s + x.n, 0);
    if (!total) return empty('Пока никто не проходил тест.');
    return vbars(a.scores, {
      value: (x) => x.n,
      label: (x) => String(x.score),
      cls: (x) => (x.score < a.passScore ? 'dim' : ''),
      marker: { index: a.passScore, label: `проходной балл: ${a.passScore}` },
      caption: `правильных ответов из ${a.quizSize}`,
      aria: (x) => `${x.score} из ${a.quizSize}: ${x.n} участников`,
      tip: (x) => [h('b', null, `${x.score} из ${a.quizSize}`), h('br'), `Участников: ${fmt(x.n)} (${pct(x.n, total)}%)`],
      table: tableDetails('scores', ['Баллов', 'Участников', 'Доля'], a.scores.map((x) => [`${x.score} из ${a.quizSize}`, fmt(x.n), `${pct(x.n, total)}%`])),
    });
  }

  function testsView(a) {
    const t = a.tests;
    if (!t.tested) return empty('Пока никто не проходил тест.');
    const mini = (label, value, sub) => h('div', { class: 'mini' }, h('small', null, label), h('b', null, value), h('span', null, sub));
    return h('div', { class: 'minis' },
      mini('Сдали с первой попытки', `${pct(t.firstTry, t.tested)}%`, `${fmt(t.firstTry)} из ${fmt(t.tested)} проходивших`),
      mini('Попыток на участника', num1(t.avgAttempts), `сдали со 2-й: ${fmt(t.toPass[1])}, с 3-й и позже: ${fmt(t.toPass[2])}`),
      mini('Длительность теста', minutes(t.medianTestMin), 'медиана по попыткам'),
      mini('От регистрации до сертификата', minutes(a.medianToCertMin), 'медиана: миссии + тест'));
  }

  function hoursView(rows) {
    const used = rows.filter((x) => x.reg || x.cert);
    if (!used.length) return empty('Пока нет регистраций.');
    // Показываем рабочую часть суток: не меньше 8:00–18:00 и все часы, где были регистрации
    const from = Math.min(8, used[0].hour);
    const to = Math.max(18, used[used.length - 1].hour);
    const shown = rows.slice(from, to + 1);
    return vbars(shown, {
      every: 2,
      value: (x) => x.reg,
      label: (x) => String(x.hour),
      caption: 'час дня',
      aria: (x) => `${x.hour}:00: регистраций ${x.reg}, сертификатов ${x.cert}`,
      tip: (x) => [h('b', null, `${x.hour}:00–${x.hour + 1}:00`), h('br'), `Регистраций: ${fmt(x.reg)}`, h('br'), `Сертификатов: ${fmt(x.cert)}`],
      table: tableDetails('hours', ['Час', 'Регистраций', 'Сертификатов'], used.map((x) => [`${x.hour}:00–${x.hour + 1}:00`, fmt(x.reg), fmt(x.cert)])),
    });
  }

  function stuckView(rows) {
    const total = rows.reduce((s, x) => s + x.n, 0);
    if (!total) return empty('Все участники прошли миссии.');
    return vbars(rows, {
      small: true,
      value: (x) => x.n,
      label: (x) => String(x.done),
      caption: 'пройдено миссий (0 — только зарегистрировались)',
      aria: (x) => `Пройдено миссий ${x.done}: ${x.n} участников`,
      tip: (x) => [h('b', null, x.done ? `Пройдено миссий: ${x.done}` : 'Только регистрация'), h('br'), `Участников: ${fmt(x.n)} (${pct(x.n, total)}%)`],
      table: tableDetails('stuck', ['Пройдено миссий', 'Участников', 'Доля'], rows.map((x) => [x.done, fmt(x.n), `${pct(x.n, total)}%`])),
    });
  }

  function splitsView(a) {
    const total = a.langs.reduce((s, x) => s + x.n, 0);
    if (!total) return empty('Пока нет участников.');
    const row = (label, r) => h('tr', null,
      h('td', null, label),
      h('td', { class: 'num' }, fmt(r.n)),
      h('td', null, h('span', { class: 'share', role: 'img', 'aria-label': `${pct(r.n, total)}%` }, h('i', { style: { width: `${pct(r.n, total)}%` } })), `${pct(r.n, total)}%`),
      h('td', { class: 'num' }, fmt(r.certified)),
      h('td', { class: 'num' }, `${pct(r.certified, r.n)}%`));
    return h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
      h('thead', null, h('tr', null, h('th', null, 'Группа'), h('th', { class: 'num' }, 'Участников'), h('th', null, 'Доля'), h('th', { class: 'num' }, 'Сертификатов'), h('th', { class: 'num' }, '% получивших'))),
      h('tbody', null,
        h('tr', { class: 'group-row' }, h('td', { colspan: '5' }, 'Язык сайта')),
        a.langs.map((r) => row(LANG_LABELS[r.lang] || r.lang, r)),
        h('tr', { class: 'group-row' }, h('td', { colspan: '5' }, 'Версия квеста')),
        a.levels.map((r) => row(LEVEL_LABELS[r.level] || r.level, r)))));
  }

  // ─── Участники ────────────────────────────────────────────────────────

  async function renderPeople(main) {
    const p = state.people;
    let insts = [];
    try { insts = await loadInstitutions(); } catch { /* список не критичен */ }
    const tableBox = h('div', null, h('p', { class: 'muted' }, 'Загрузка…'));
    let timer;
    const reload = (resetPage = true) => { if (resetPage) p.page = 1; loadPeople(tableBox); };
    const sel = (key, options) => h('select', { class: 'ctl', onchange: (e) => { p[key] = e.target.value; reload(); } },
      options.map(([v, label]) => h('option', { value: v, selected: String(p[key]) === String(v) }, label)));

    const exportLink = () => '/api/admin/export.csv?' + qs({ q: p.q, district: p.district, institution: p.institution, status: p.status, grade: p.grade, from: p.from, to: p.to });
    const instOptions = insts.filter((i) => !p.district || i.district === p.district);

    main.append(
      h('div', { class: 'filters' },
        h('label', { class: 'f grow' }, 'Поиск', h('input', {
          class: 'ctl', type: 'search', value: p.q, placeholder: 'ФИО или № сертификата',
          oninput: (e) => { p.q = e.target.value; clearTimeout(timer); timer = setTimeout(reload, 300); },
        })),
        h('label', { class: 'f' }, 'Город / район', districtSelect(p.district, (v) => { p.district = v; p.institution = ''; p.page = 1; render(); })),
        h('label', { class: 'f' }, 'Учебное заведение', sel('institution', [['', 'Все'], ...instOptions.map((i) => [String(i.id), i.name]), ['other', '— Другое (вписаны вручную)']])),
        h('label', { class: 'f' }, 'Статус', sel('status', [['', 'Все'], ...Object.entries(STATUS_LABELS)])),
        h('label', { class: 'f' }, 'Класс / курс', sel('grade', [['', 'Все'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), String(i + 1)])])),
        h('label', { class: 'f' }, 'С', h('input', { class: 'ctl', type: 'date', value: p.from, onchange: (e) => { p.from = e.target.value; reload(); } })),
        h('label', { class: 'f' }, 'По', h('input', { class: 'ctl', type: 'date', value: p.to, onchange: (e) => { p.to = e.target.value; reload(); } })),
        h('label', { class: 'f' }, 'Сортировка', sel('sort', [['created', 'Сначала новые'], ['name', 'По фамилии'], ['institution', 'По заведению'], ['score', 'По результату']])),
        h('button', { class: 'abtn ghost', onclick: () => { state.people = { q: '', district: '', institution: '', status: '', grade: '', from: '', to: '', sort: 'created', page: 1 }; render(); } }, 'Сбросить'),
        h('a', { class: 'abtn ok', href: '#', onclick: (e) => { e.preventDefault(); location.href = exportLink(); } }, '↓ Скачать для Excel')),
      h('div', { class: 'panel' }, tableBox));
    loadPeople(tableBox);
  }

  async function loadPeople(box) {
    const p = state.people;
    box.style.opacity = '0.6';
    let data;
    try {
      data = await api('/api/admin/participants?' + qs({ ...p, size: 50 }));
    } catch (e) {
      box.replaceChildren(h('p', { class: 'error-text' }, e.message));
      box.style.opacity = '1';
      return;
    }
    box.style.opacity = '1';
    const pages = Math.max(1, Math.ceil(data.total / data.size));
    box.replaceChildren(
      h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null,
          h('th', null, 'ФИО'), h('th', null, 'Учебное заведение'), h('th', null, 'Класс'),
          h('th', { class: 'num' }, 'Миссии'), h('th', { class: 'num' }, 'Тест'), h('th', null, 'Статус'), h('th', { class: 'hide-sm' }, 'Регистрация'))),
        h('tbody', null, data.rows.length ? data.rows.map((r) => h('tr', { class: 'click', onclick: () => openParticipant(r.id) },
          h('td', null, h('div', { class: 'name' }, `${r.lastName} ${r.firstName}`), r.middleName ? h('div', { class: 'sub' }, r.middleName) : null),
          h('td', null, r.institution, h('div', { class: 'sub' }, r.districtName)),
          h('td', null, r.gradeLabel, r.level === 'junior' ? h('div', { class: 'sub' }, '🌱 облегчённая версия') : null),
          h('td', { class: 'num' }, `${r.missionsDone}/${r.missionsTotal || 5}`),
          h('td', { class: 'num' }, r.attemptsCount ? `${r.bestScore}/10` : '—', r.attemptsCount > 1 ? h('div', { class: 'sub' }, `попыток: ${r.attemptsCount}`) : null),
          h('td', null, statusBadge(r.status)),
          h('td', { class: 'hide-sm' }, dt(r.createdAt))))
          : h('tr', { class: 'empty-row' }, h('td', { colspan: '7' }, 'Участников по этим условиям нет'))))),
      h('div', { class: 'pager' },
        h('span', null, `Найдено: ${fmt(data.total)}`),
        h('span', { class: 'row' },
          h('button', { class: 'abtn ghost sm', disabled: p.page <= 1, onclick: () => { p.page -= 1; loadPeople(box); } }, '← Назад'),
          h('span', null, `Стр. ${p.page} из ${pages}`),
          h('button', { class: 'abtn ghost sm', disabled: p.page >= pages, onclick: () => { p.page += 1; loadPeople(box); } }, 'Вперёд →'))));
  }

  async function openParticipant(id) {
    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Карточка участника' }, h('p', { class: 'muted' }, 'Загрузка…'));
    const close = () => { backdrop.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const backdrop = h('div', { class: 'modal-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, modal);
    document.body.append(backdrop);
    document.addEventListener('keydown', onKey);

    let data;
    try {
      data = await api(`/api/admin/participants/${id}`);
    } catch (e) {
      modal.replaceChildren(h('p', { class: 'error-text' }, e.message));
      return;
    }
    const p = data.participant;
    const canvas = data.certificates ? h('canvas', { style: { width: '100%', borderRadius: '10px', boxShadow: 'var(--shadow)' } }) : null;
    // Сертификат рисуется на языке, который выбрал участник; можно переключить
    let certLang = p.lang === 'kk' ? 'kk' : 'ru';
    const certData = () => data.certificates[certLang];
    const certToggle = canvas && h('div', { class: 'lang-switch', role: 'group', 'aria-label': 'Язык сертификата' }, [['kk', 'ҚАЗ'], ['ru', 'РУС']].map(([code, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(certLang === code), onclick: async (e) => {
        certLang = code;
        e.currentTarget.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget)));
        await SB.cert.draw(canvas, certData());
      } }, label)));
    modal.replaceChildren(h('div', { class: 'stack' },
      h('button', { class: 'abtn ghost sm close', onclick: close }, '✕ Закрыть'),
      h('h2', null, `${p.lastName} ${p.firstName} ${p.middleName}`.trim()),
      statusBadge(p.status),
      h('dl', { class: 'kv' },
        h('dt', null, 'Город / район'), h('dd', null, p.districtName),
        h('dt', null, 'Учебное заведение'), h('dd', null, p.institution),
        h('dt', null, 'Класс / курс'), h('dd', null, p.gradeLabel + (p.level === 'junior' ? ' · облегчённая версия квеста' : '')),
        h('dt', null, 'Регистрация'), h('dd', null, dt(p.createdAt)),
        h('dt', null, 'Последняя активность'), h('dd', null, dt(p.updatedAt)),
        h('dt', null, 'Очки (XP)'), h('dd', null, String(p.xp)),
        h('dt', null, 'Лучший результат'), h('dd', null, p.attemptsCount ? `${p.bestScore} из 10 (попыток: ${p.attemptsCount})` : 'тест не проходил(а)'),
        h('dt', null, 'Сертификат'), h('dd', null, p.certNumber ? `№ ${p.certNumber} от ${d(p.passedAt)}` : '—')),
      h('h3', null, 'Миссии'),
      h('div', { class: 'mgrid' }, (((p.level === 'junior' ? SB.JUNIOR_MISSIONS_BY_LANG : SB.MISSIONS_BY_LANG) || {}).ru || []).filter((m) => !p.missionIds || p.missionIds.includes(m.id)).map((m, i) => {
        const r = p.missions[m.id];
        return h('div', { class: 'mcell' + (r ? '' : ' off') }, h('b', null, `${i + 1}. ${m.title}`), r ? `${r.score} из ${r.max} · ${d(r.at)}` : 'не пройдена');
      })),
      h('h3', null, 'Попытки теста'),
      data.attempts.length
        ? h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
          h('thead', null, h('tr', null, h('th', null, 'Начата'), h('th', null, 'Завершена'), h('th', { class: 'num' }, 'Баллы'))),
          h('tbody', null, data.attempts.map((a) => h('tr', null, h('td', null, dt(a.startedAt)), h('td', null, a.finishedAt ? dt(a.finishedAt) : 'не завершена'), h('td', { class: 'num' }, a.score ?? '—'))))))
        : h('p', { class: 'muted small' }, 'Тест ещё не начинали.'),
      canvas && h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('h3', null, 'Сертификат'), certToggle),
      canvas,
      canvas && h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('button', { class: 'abtn', onclick: async () => SB.cert.download(await SB.cert.toPdf(canvas), SB.cert.fileName(certData(), 'pdf')) }, '↓ PDF'),
        h('button', { class: 'abtn ghost', onclick: async () => SB.cert.download(await SB.cert.toPng(canvas), SB.cert.fileName(certData(), 'png')) }, '↓ PNG')),
      h('hr', { style: { border: 0, borderTop: '1px solid var(--line)', margin: '20px 0 10px' } }),
      h('button', {
        class: 'abtn bad',
        onclick: async () => {
          if (!confirm(`Удалить участника «${p.lastName} ${p.firstName}» и все его результаты? Это действие нельзя отменить.`)) return;
          try {
            await api(`/api/admin/participants/${p.id}`, { method: 'DELETE' });
            toast('Участник удалён', 'ok');
            close();
            render();
          } catch (e) { toast(e.message, 'bad'); }
        },
      }, 'Удалить участника')));
    if (canvas) await SB.cert.draw(canvas, certData());
  }

  // ─── Учебные заведения ────────────────────────────────────────────────

  async function renderInstitutions(main) {
    const box = h('div', null, h('p', { class: 'muted' }, 'Загрузка…'));
    const typeSelect = (value) => h('select', { class: 'ctl' }, ['school', 'college', 'university'].map((k) => h('option', { value: k, selected: value === k }, TYPE_LABELS[k])));
    const districtPick = (value) => h('select', { class: 'ctl' }, state.districts.map((d) => h('option', { value: d.id, selected: value === d.id }, d.name)));
    const name = h('input', { class: 'ctl', placeholder: 'Например: Средняя школа №67', maxlength: '150', style: { minWidth: '220px' } });
    const nameKk = h('input', { class: 'ctl', placeholder: 'Мысалы: №67 орта мектеп', maxlength: '200', style: { minWidth: '220px' } });
    const type = typeSelect('school');
    const district = districtPick(state.instDistrict || 'taraz');
    // Массовое добавление
    const bulkText = h('textarea', { class: 'ctl', rows: '6', style: { width: '100%' }, placeholder: 'Средняя школа №1 | №1 орта мектеп\nСредняя школа №2\nОсновная школа имени Абая | Абай атындағы негізгі мектеп' });
    const bulkType = typeSelect('school');
    const bulkDistrict = districtPick(state.instDistrict || 'taraz');
    let q = '';
    main.append(
      h('div', { class: 'notice warn a-section' }, 'Список виден ученикам при регистрации: сначала они выбирают город или район, затем заведение. Заведения, у которых уже есть участники, нельзя удалить — их можно скрыть (снять галочку «Показывать»). Переименование и перенос в другой район обновят данные у всех участников заведения.'),
      h('form', {
        class: 'filters a-section',
        onsubmit: async (e) => {
          e.preventDefault();
          try {
            await api('/api/admin/institutions', { method: 'POST', body: { name: name.value, nameKk: nameKk.value, type: type.value, district: district.value } });
            name.value = '';
            nameKk.value = '';
            toast('Добавлено', 'ok');
            await loadInstitutions(true);
            fill();
          } catch (ex) { toast(ex.message, 'bad'); }
        },
      },
      h('label', { class: 'f grow' }, 'Новое заведение (на русском)', name),
      h('label', { class: 'f grow' }, 'На казахском', nameKk),
      h('label', { class: 'f' }, 'Город / район', district),
      h('label', { class: 'f' }, 'Тип', type),
      h('button', { class: 'abtn', type: 'submit' }, '+ Добавить')),
      h('details', { class: 'panel a-section' },
        h('summary', { style: { cursor: 'pointer', fontWeight: '800' } }, 'Добавить списком (например, официальный список школ района)'),
        h('div', { class: 'stack-sm', style: { marginTop: '12px' } },
          h('p', { class: 'small muted' }, 'По одному заведению на строку. Название на казахском — через вертикальную черту « | » (необязательно). Заведения, которые уже есть в этом районе, пропускаются.'),
          bulkText,
          h('div', { class: 'filters', style: { marginBottom: 0 } },
            h('label', { class: 'f' }, 'Город / район', bulkDistrict),
            h('label', { class: 'f' }, 'Тип', bulkType),
            h('button', {
              class: 'abtn', type: 'button',
              onclick: async () => {
                try {
                  const r = await api('/api/admin/institutions/bulk', { method: 'POST', body: { lines: bulkText.value, district: bulkDistrict.value, type: bulkType.value } });
                  toast(`Добавлено: ${r.added}${r.skipped ? `, пропущено: ${r.skipped}` : ''}`, 'ok');
                  bulkText.value = '';
                  await loadInstitutions(true);
                  fill();
                } catch (ex) { toast(ex.message, 'bad'); }
              },
            }, '+ Добавить все')))),
      h('div', { class: 'filters' },
        h('label', { class: 'f grow' }, 'Поиск', h('input', { class: 'ctl', type: 'search', placeholder: 'Название', oninput: (e) => { q = e.target.value.trim().toLowerCase(); fill(); } })),
        h('label', { class: 'f' }, 'Город / район', districtSelect(state.instDistrict, (v) => { state.instDistrict = v; fill(); }))),
      h('div', { class: 'panel' }, box));

    try { await loadInstitutions(true); } catch (e) { box.replaceChildren(h('p', { class: 'error-text' }, e.message)); return; }

    function fill() {
      const list = state.institutions.filter((i) => (!q || (i.name + ' ' + (i.nameKk || '')).toLowerCase().includes(q))
        && (!state.instDistrict || i.district === state.instDistrict));
      const shown = list.slice(0, 300);
      box.replaceChildren(
        h('p', { class: 'small muted', style: { marginBottom: '8px' } }, `Найдено: ${list.length}${list.length > shown.length ? ` (показаны первые ${shown.length} — уточните поиск или выберите район)` : ''}`),
        h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, h('th', null, 'Название'), h('th', null, 'Город / район и тип'), h('th', { class: 'num' }, 'Участников'), h('th', { class: 'num' }, 'Сертиф.'), h('th', null, 'Показывать'), h('th', null, ''))),
        h('tbody', null, shown.map((i) => {
          const n = h('input', { class: 'ctl', value: i.name, maxlength: '150', 'aria-label': 'Название на русском' });
          const nk = h('input', { class: 'ctl', value: i.nameKk, maxlength: '200', placeholder: 'на казахском', 'aria-label': 'Название на казахском', style: { marginTop: '6px' } });
          const t = typeSelect(i.type);
          const ds = districtPick(i.district);
          const a = h('input', { type: 'checkbox', checked: !!i.active, style: { width: '20px', height: '20px', accentColor: 'var(--sky)' } });
          const save = async () => {
            try {
              await api(`/api/admin/institutions/${i.id}`, { method: 'PUT', body: { name: n.value, nameKk: nk.value, type: t.value, district: ds.value, active: a.checked } });
              Object.assign(i, { name: n.value.trim(), nameKk: nk.value.trim(), type: t.value, district: ds.value, active: a.checked ? 1 : 0 });
              row.classList.toggle('inactive', !a.checked);
              toast('Сохранено', 'ok');
            } catch (ex) { toast(ex.message, 'bad'); }
          };
          a.addEventListener('change', save);
          ds.style.marginBottom = '6px';
          const row = h('tr', { class: i.active ? '' : 'inactive' },
            h('td', { style: { width: '50%', minWidth: '280px' } }, n, nk), h('td', null, h('div', null, ds), t),
            h('td', { class: 'num' }, i.participants), h('td', { class: 'num' }, i.passed || 0),
            h('td', null, a),
            h('td', null, h('div', { class: 'row' },
              h('button', { class: 'abtn sm', onclick: save }, 'Сохранить'),
              !i.participants && h('button', {
                class: 'abtn sm ghost',
                onclick: async () => {
                  if (!confirm(`Удалить «${i.name}» из списка?`)) return;
                  try {
                    await api(`/api/admin/institutions/${i.id}`, { method: 'DELETE' });
                    await loadInstitutions(true);
                    fill();
                  } catch (ex) { toast(ex.message, 'bad'); }
                },
              }, 'Удалить'))));
          return row;
        })))));
    }
    fill();
  }

  // ─── Настройки ────────────────────────────────────────────────────────

  async function renderSettings(main) {
    let s;
    try { s = await api('/api/admin/settings'); } catch (e) { main.append(h('p', { class: 'error-text' }, e.message)); return; }
    const field = (key, label, hint, type = 'text') => h('label', null, label, hint && h('small', null, hint),
      type === 'textarea'
        ? h('textarea', { class: 'ctl', name: key }, s[key])
        : h('input', { class: 'ctl', name: key, type, value: s[key], ...(type === 'number' ? { min: '1', max: '10' } : {}) }));

    const form = h('form', {
      class: 'form-grid',
      onsubmit: async (e) => {
        e.preventDefault();
        const body = Object.fromEntries(new FormData(form).entries());
        try {
          await api('/api/admin/settings', { method: 'PUT', body });
          toast('Настройки сохранены', 'ok');
        } catch (ex) { toast(ex.message, 'bad'); }
      },
    },
    field('event_title', 'Название мероприятия', 'Отображается в заголовке сайта и в сертификате'),
    field('event_title_kk', 'Название мероприятия — на казахском', 'Для казахской версии сайта и сертификата'),
    field('org_name', 'Организатор', 'Указывается вверху сертификата и в подвале сайта'),
    field('org_name_kk', 'Организатор — на казахском'),
    field('city', 'Город', 'Указывается в сертификате под датой'),
    field('city_kk', 'Город — на казахском'),
    field('signer_position', 'Должность подписанта', 'Подпись в правом нижнем углу сертификата'),
    field('signer_position_kk', 'Должность подписанта — на казахском'),
    field('signer_name', 'ФИО подписанта', 'Например: А. Б. Иванов. Можно оставить пустым'),
    field('pass_score', 'Проходной балл (из 10)', 'Сколько правильных ответов нужно для сертификата', 'number'),
    field('cert_prefix', 'Префикс номера сертификата', 'Латинские буквы и цифры, например SB'),
    field('contacts', 'Контакты в подвале сайта', 'Каждый контакт — с новой строки', 'textarea'),
    field('contacts_kk', 'Контакты в подвале — на казахском', 'Если поле пустое, показывается русский вариант', 'textarea'),
    h('label', null, 'Рейтинг в мини-игре «Сейф-пазл»',
      h('small', null, 'Ученики видят соперников из своей школы (имя, первая буква фамилии, класс) и общий рекорд (инициалы и школа). Если выключить — остаётся только личный рекорд'),
      h('select', { class: 'ctl', name: 'game_rating' },
        h('option', { value: 'on', selected: s.game_rating !== 'off' }, 'Показывать'),
        h('option', { value: 'off', selected: s.game_rating === 'off' }, 'Не показывать'))),
    h('div', null, h('button', { class: 'abtn', type: 'submit' }, 'Сохранить настройки')));

    main.append(
      h('section', { class: 'panel a-section' }, h('h2', null, 'Мероприятие и сертификат'), form),
      h('section', { class: 'panel a-section' }, h('h2', null, 'Пароль администратора'),
        h('p', { class: 'small' }, 'Пароль задаётся переменной ADMIN_PASSWORD в настройках проекта Vercel (Settings → Environment Variables). ' +
          'Чтобы сменить пароль, измените переменную и сделайте Redeploy — все открытые сессии админки завершатся автоматически.')),
      h('section', { class: 'panel a-section' }, h('h2', null, 'Проверка сертификатов'),
        h('p', { class: 'small' }, 'Любой может проверить подлинность сертификата по номеру на странице ', h('a', { href: '/verify', target: '_blank' }, `${location.host}/verify`), '.')));
  }

  // ─── Запуск ───────────────────────────────────────────────────────────

  async function boot() {
    try {
      await api('/api/admin/me', { allow401: true });
    } catch (e) {
      if (e.status === 401) return renderLogin();
      root.replaceChildren(h('div', { class: 'login-wrap' }, h('p', { class: 'error-text' }, e.message)));
      return;
    }
    try { state.districts = (await api('/api/config')).districts || []; } catch { /* фильтр по районам будет пустым */ }
    try { state.tab = sessionStorage.getItem('sb-admin-tab') || 'overview'; } catch { /* недоступно */ }
    if (!TABS.some(([id]) => id === state.tab)) state.tab = 'overview';
    render();
  }

  boot();
})();
