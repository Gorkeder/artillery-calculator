(function () {
  'use strict';

  var links = document.querySelectorAll('[data-account-link]');
  if (!links.length || !window.fetch) return;
  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (me) {
      if (!me || !me.user) return;
      var u = me.user;
      Array.prototype.forEach.call(links, function (a) {
        a.textContent = (u.clan ? '[' + u.clan.tag + '] ' : '') + u.login + (u.clanInvitations ? ' (' + u.clanInvitations + ')' : '');
        a.title = u.clanInvitations ? 'Аккаунт · приглашений в клан: ' + u.clanInvitations : 'Аккаунт';
      });
    })
    .catch(function () { /* stay with "Войти" */ });
})();
