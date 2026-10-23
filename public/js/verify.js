// Публичная проверка подлинности сертификата по номеру (казахский / русский).
(function () {
  'use strict';
  const { h, api, t } = SB;
  const app = document.getElementById('app');
  const topRight = document.getElementById('top-right');
  let current = new URLSearchParams(location.search).get('n') || '';

  function render() {
    document.title = `Сақ бол! — ${t('verifyTitle')}`;
    topRight.replaceChildren(SB.langSwitch(render));
    const input = h('input', {
      class: 'input', value: current, autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
      required: true, maxlength: '40', placeholder: 'SB-2026-…', 'aria-label': t('certNumber'),
    });
    const result = h('div', { 'aria-live': 'polite' });
    const form = h('form', {
      class: 'card stack-sm',
      onsubmit: (e) => {
        e.preventDefault();
        current = input.value.trim();
        if (!current) return;
        history.replaceState(null, '', '/verify?n=' + encodeURIComponent(current));
        check(current, result);
      },
    },
    h('label', { class: 'field' }, h('span', null, t('certNumber')), input),
    h('button', { class: 'btn', type: 'submit' }, t('verifyBtn')));

    app.replaceChildren(h('div', { class: 'stack' },
      h('h1', { class: 'step-title' }, t('verifyTitle')),
      h('p', { class: 'muted' }, t('verifyIntro'), ' ', h('b', null, 'SB-2026-00012-4821'), '.'),
      form, result));
    if (current) check(current, result);
  }

  async function check(n, result) {
    result.replaceChildren(h('p', { class: 'muted' }, t('checking')));
    try {
      const r = await api('/api/verify?n=' + encodeURIComponent(n));
      if (!r.found) {
        result.replaceChildren(h('div', { class: 'rule red' }, t('verifyNotFound')));
        return;
      }
      result.replaceChildren(h('div', { class: 'card stack-sm' },
        h('div', { class: 'rule green' }, t('verifyValid')),
        h('p', null, h('b', null, t('vParticipant')), r.name),
        h('p', null, h('b', null, t('vInstitution')), r.institution),
        h('p', null, h('b', null, t('vGrade')), r.gradeLabel),
        h('p', null, h('b', null, t('vResult')), t('vScore', { s: r.score, n: r.total })),
        h('p', null, h('b', null, t('vDate')), new Date(r.passedAt).toLocaleDateString('ru-RU')),
        h('p', { class: 'muted small' }, `№ ${r.number} · ${r.eventTitle}`)));
    } catch (e) {
      result.replaceChildren(h('div', { class: 'rule red' }, e.message));
    }
  }

  render();
})();
