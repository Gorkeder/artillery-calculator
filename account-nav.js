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
      var u = me.user;
      // "[TAG] login" for clan members, "(N)" for pending clan invitations.
      var name = (u.clan ? '[' + u.clan.tag + '] ' : '') + u.login + (u.clanInvitations ? ' (' + u.clanInvitations + ')' : '');
      var title = 'Аккаунт: ' + name + (u.clanInvitations ? ' · приглашений в клан: ' + u.clanInvitations : '');
      Array.prototype.forEach.call(links, function (a) {
        var label = a.querySelector('[data-account-label]');
        if (label) label.textContent = name;
        else if (!a.querySelector('svg')) a.textContent = name;
        else a.classList.add('is-signed-in');
        a.title = title;
        a.setAttribute('aria-label', title);
      });
    })
    .catch(function () { /* stay with "Войти" */ });
})();
