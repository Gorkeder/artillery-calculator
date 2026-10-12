// Бургер-меню общей шапки: открытие/закрытие, Esc, клик по затемнению, текущий раздел.
(function () {
  'use strict';

  var menu = document.getElementById('site-menu');
  var toggle = document.getElementById('site-menu-toggle');
  var overlay = document.getElementById('site-menu-overlay');
  if (!menu || !toggle || !overlay) return;
  var closeBtn = document.getElementById('site-menu-close');

  function isOpen() { return menu.classList.contains('is-open'); }

  function open() {
    menu.classList.add('is-open');
    overlay.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('sm-locked');
    var first = menu.querySelector('.sm-item:not([hidden])');
    if (first) first.focus();
  }

  function close(restoreFocus) {
    if (!isOpen()) return;
    menu.classList.remove('is-open');
    overlay.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('sm-locked');
    if (restoreFocus) toggle.focus();
  }

  toggle.addEventListener('click', function () {
    if (isOpen()) close(true); else open();
  });
  overlay.addEventListener('click', function () { close(false); });
  if (closeBtn) closeBtn.addEventListener('click', function () { close(true); });

  // Любой пункт меню закрывает его (в т.ч. якоря на этой же странице).
  menu.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.sm-item')) close(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) close(true);
  });

  // Подсветка текущей страницы.
  var path = location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/') || '/';
  Array.prototype.forEach.call(menu.querySelectorAll('a.sm-item[href^="/"]'), function (a) {
    var href = a.getAttribute('href');
    if (href.indexOf('#') !== -1) return;
    if (href === path) a.setAttribute('aria-current', 'page');
  });

  window.SiteMenu = { open: open, close: close };
})();
