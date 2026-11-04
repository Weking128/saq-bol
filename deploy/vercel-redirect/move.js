// Адрес нового сайта на сервере в Казахстане.
// Если оставить пустым, переадресация не работает — страница просто сообщает о переезде.
var NEW_SITE = 'https://saq-bol.kz';

(function () {
  'use strict';
  var base = NEW_SITE.replace(/\/+$/, '');
  if (!/^https:\/\/[^/]+$/.test(base)) return;

  var path = location.pathname;
  var target = base + path + location.search;

  // Ученик уже начал квест на старом адресе — передаём его вход и язык на новый сайт.
  // Часть адреса после «#» не уходит ни на один сервер, её прочитает только сама игра.
  var isGame = path === '/' || path === '/index' || path === '/index.html';
  try {
    var token = localStorage.getItem('sb:token');
    var lang = localStorage.getItem('sb:lang');
    if (isGame && token && /^[a-f0-9]{48}$/.test(token)) {
      target += '#move=' + token + (lang === 'kk' || lang === 'ru' ? '.' + lang : '');
    }
  } catch (e) { /* localStorage недоступен — просто переходим */ }

  var link = document.getElementById('go');
  if (link) {
    link.href = base + path + location.search;
    link.textContent = base.replace(/^https:\/\//, '');
  }
  location.replace(target);
})();
