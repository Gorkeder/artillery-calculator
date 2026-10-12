(function () {
  'use strict';

  // [data-account-link] — ссылка «Войти». Если внутри есть [data-account-label],
  // меняется только он; у ссылок-иконок (svg) меняются только title/aria-label.
  var links = document.querySelectorAll('[data-account-link]');
  if (!links.length || !window.fetch) return;
  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (me) {
      if (!me || !me.user) return;
      Array.prototype.forEach.call(links, function (a) {
        var label = a.querySelector('[data-account-label]');
        if (label) label.textContent = me.user.login;
        else if (!a.querySelector('svg')) a.textContent = me.user.login;
        else a.classList.add('is-signed-in');
        a.title = 'Аккаунт: ' + me.user.login;
        a.setAttribute('aria-label', 'Аккаунт: ' + me.user.login);
      });
    })
    .catch(function () { /* stay with "Войти" */ });
})();
