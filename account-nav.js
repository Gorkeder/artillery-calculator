(function () {
  'use strict';

  var links = document.querySelectorAll('[data-account-link]');
  if (!links.length || !window.fetch) return;
  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (me) {
      if (!me || !me.user) return;
      Array.prototype.forEach.call(links, function (a) {
        a.textContent = me.user.login;
        a.title = 'Аккаунт';
      });
    })
    .catch(function () { /* stay with "Войти" */ });
})();
