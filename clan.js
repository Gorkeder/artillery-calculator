(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var app = document.getElementById('app');

  var MESSAGES = {
    tag_invalid: 'Тег: 2–5 букв или цифр.',
    name_invalid: 'Название: 3–40 символов для клана, 1–30 для роли или отряда.',
    description_invalid: 'Описание: до 500 символов.',
    tag_taken: 'Такой тег уже занят.',
    name_taken: 'Такое название уже занято.',
    already_in_clan: 'Игрок уже состоит в клане.',
    email_not_verified: 'Сначала подтвердите почту в аккаунте.',
    clans_blocked: 'Создание кланов для вас закрыто администрацией.',
    clan_full: 'В клане уже 50 участников.',
    invite_invalid: 'Приглашение недействительно или истекло.',
    user_not_found: 'Игрок с таким логином не найден.',
    already_invited: 'Этот игрок уже приглашён.',
    owner_must_transfer: 'Лидер не может выйти: сначала передайте лидерство или удалите клан.',
    roles_limit: 'Не больше 10 ролей.',
    squads_limit: 'Не больше 10 отрядов.',
    invites_limit: 'Слишком много активных ссылок, отзовите старые.',
    invitations_limit: 'Слишком много ожидающих приглашений.',
    perm_not_held: 'Нельзя выдать или снять право, которого нет у вас.',
    squad_not_held: 'Нельзя выдать рисование для отряда, который недоступен вам.',
    role_above: 'Эта роль не ниже вашей.',
    order_mismatch: 'Список изменился, обновите страницу.',
    forbidden: 'Недостаточно прав.',
    'payload too large': 'Файл больше 200 КБ.',
    emblem_invalid: 'Нужна картинка PNG, JPEG или WebP не больше 1024×1024.',
    'cannot block an admin': 'Администратора заблокировать нельзя.',
  };

  function errorText(ex) {
    if (ex && ex.status === 429) return 'Слишком много действий, попробуйте чуть позже.';
    return (ex && MESSAGES[ex.message]) || 'Что-то пошло не так. Попробуйте ещё раз.';
  }

  function show() {
    app.textContent = '';
    for (var i = 0; i < arguments.length; i++) {
      var node = arguments[i];
      if (Array.isArray(node)) node.forEach(function (n) { if (n) app.appendChild(n); });
      else if (node) app.appendChild(node);
    }
  }

  function field(label, attrs) {
    var input = h('input', attrs);
    return { el: h('label', null, label, input), input: input };
  }

  function bind(formEl, errEl, work) {
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      act(formEl.querySelector('button[type=submit]'), errEl, work);
    });
  }

  // Runs `work` with the button disabled and prints a failure into errEl.
  function act(btn, errEl, work) {
    btn.disabled = true;
    errEl.textContent = '';
    Promise.resolve()
      .then(work)
      .catch(function (ex) {
        if (ex && ex.status === 404 && (ex.message === 'clan not found' || ex.message === 'member not found')) {
          // The clan was deleted or the user was removed while the page was open.
          errEl.textContent = 'Состав клана изменился, обновляем страницу.';
          return Clan.reload();
        }
        errEl.textContent = errorText(ex);
      })
      .then(function () { btn.disabled = false; });
  }

  function emblem(clan, small) {
    var cls = 'emblem' + (small ? ' sm' : '');
    return clan.emblem_url ? h('img', { class: cls, src: clan.emblem_url, alt: '' }) : h('div', { class: cls }, clan.tag);
  }

  function chip(name, color) {
    return h('span', { class: 'chip' }, h('i', { style: 'background:' + color }), name);
  }

  function loginLink() {
    return h('a', { href: '/account?next=' + encodeURIComponent(location.pathname) }, 'Войдите');
  }

  // Name that scrolls right-to-left when it does not fit its box.
  function marquee(text) {
    var inner = h('span', { class: 'mq-in' }, text);
    var box = h('span', { class: 'mq' }, inner);
    requestAnimationFrame(function check() {
      if (!box.isConnected) { if (!box.__tries || box.__tries++ < 20) { box.__tries = box.__tries || 1; requestAnimationFrame(check); } return; }
      var w = box.clientWidth;
      if (w && inner.scrollWidth > w) {
        var over = inner.scrollWidth - w;
        box.style.setProperty('--mq-d', -over + 'px');
        box.style.setProperty('--mq-t', Math.max(6, Math.round(over / 30) + 4) + 's');
        box.classList.add('run');
      }
    });
    return box;
  }

  function title(clan) {
    return h('h1', { class: 'mq-row' }, h('span', { class: 'tag' }, '[' + clan.tag + '] '), marquee(clan.name));
  }

  var Clan = window.Clan = {
    api: api, h: h, field: field, bind: bind, act: act, chip: chip, errorText: errorText,
    tabs: {}, data: null, tab: 'overview',
  };

  Clan.base = function () { return '/api/clans/' + Clan.data.clan.id; };
  Clan.can = function (perm) { return Clan.data.me.perms.indexOf(perm) >= 0; };
  Clan.permsHeld = function (names) {
    return Clan.data.me.isOwner || names.every(function (n) { return Clan.can(n); });
  };
  // Same rules as server/clan-permissions.js; the server re-checks everything.
  Clan.outranks = function (member) {
    var me = Clan.data.me;
    if (member.owner) return false;
    return me.isOwner || member.top < me.top;
  };
  Clan.roleBelow = function (role) { return Clan.data.me.isOwner || role.position < Clan.data.me.top; };
  Clan.roleById = function (id) { return Clan.data.roles.filter(function (r) { return r.id === id; })[0] || null; };
  Clan.squadById = function (id) { return Clan.data.squads.filter(function (s) { return s.id === id; })[0] || null; };
  Clan.set = function (body) {
    Clan.data = body;
    if (body.clan) renderClan();
    else showNoClan(body);
  };

  // ---------- catalog, profile, join ----------

  function showCatalog() {
    var input = h('input', { type: 'text', placeholder: 'Поиск по тегу или названию', 'aria-label': 'Поиск клана', maxLength: 40 });
    var list = h('ul', { class: 'list' });
    var timer = null;
    function load() {
      api.get('/api/clans?q=' + encodeURIComponent(input.value.trim())).then(function (rows) {
        list.textContent = '';
        if (!rows.length) list.appendChild(h('li', { class: 'muted' }, 'Ничего не найдено.'));
        rows.forEach(function (r) {
          list.appendChild(h('li', null, emblem(r, true),
            h('a', { class: 'grow', href: '/clans/' + encodeURIComponent(r.tag) }, h('span', { class: 'tag' }, '[' + r.tag + '] '), marquee(r.name)),
            h('span', { class: 'muted' }, r.members + ' уч.')));
        });
      }).catch(function () {
        list.textContent = '';
        list.appendChild(h('li', { class: 'err' }, 'Не удалось загрузить список.'));
      });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 300); });
    show(h('h1', null, 'Кланы'), input, list, h('p', null, h('a', { href: '/clan' }, 'Мой клан')));
    load();
  }

  // Site-admin tools. Everything goes through the clan API; the server checks the role again.
  function adminBlock(d) {
    var err = h('p', { class: 'err', role: 'alert' });
    var tag = h('input', { type: 'text', value: d.clan.tag, maxLength: 5, 'aria-label': 'Тег' });
    var name = h('input', { type: 'text', value: d.clan.name, maxLength: 100, 'aria-label': 'Название' });
    var save = h('button', { type: 'button', class: 'primary' }, 'Сохранить');
    var resetDesc = h('button', { type: 'button' }, 'Сбросить описание');
    var resetEmblem = h('button', { type: 'button' }, 'Сбросить эмблему');
    var del = h('button', { type: 'button', class: 'danger' }, 'Удалить клан');
    var base = '/api/clans/' + d.clan.id;

    save.addEventListener('click', function () {
      act(save, err, function () {
        return api.patch(base, { tag: tag.value, name: name.value }).then(function () {
          location.href = '/clans/' + encodeURIComponent(tag.value.trim());
        });
      });
    });
    resetDesc.addEventListener('click', function () {
      act(resetDesc, err, function () { return api.patch(base, { description: '' }).then(function () { location.reload(); }); });
    });
    resetEmblem.addEventListener('click', function () {
      act(resetEmblem, err, function () { return api.del(base + '/emblem').then(function () { location.reload(); }); });
    });
    del.addEventListener('click', function () {
      if (!window.confirm('Удалить клан «' + d.clan.name + '» вместе с планами и рисунками? Это необратимо.')) return;
      act(del, err, function () { return api.del(base).then(function () { location.href = '/clans'; }); });
    });

    var members = h('ul', { class: 'list' }, d.members.map(function (m) {
      var cb = h('input', { type: 'checkbox', checked: m.clans_blocked });
      cb.addEventListener('change', function () {
        cb.disabled = true;
        err.textContent = '';
        api.post('/api/users/' + m.id + '/block-clans', { blocked: cb.checked }).then(function () {
          cb.disabled = false;
        }, function (ex) {
          cb.checked = !cb.checked;
          cb.disabled = false;
          err.textContent = errorText(ex);
        });
      });
      return h('li', null, h('span', { class: 'grow' }, m.owner ? '★ ' : '', m.login),
        h('label', { class: 'muted' }, cb, ' закрыть создание кланов'));
    }));

    return h('section', { class: 'admin-block' },
      h('h2', null, 'Администрирование'),
      h('div', { class: 'row' }, tag, name, save),
      h('div', { class: 'row' }, resetDesc, resetEmblem, del),
      err,
      h('h3', null, 'Участники'),
      members);
  }

  function showProfile(tag) {
    api.get('/api/clans/' + encodeURIComponent(tag)).then(function (c) {
      document.title = '[' + c.tag + '] ' + c.name + ' — ANOMA WIKI';
      show(
        h('div', { class: 'clan-head' }, emblem(c), h('div', null, title(c),
          h('div', { class: 'muted' }, 'Лидер: ' + (c.owner || '—') + ' · участников: ' + c.members.length))),
        c.description ? h('p', { class: 'desc' }, c.description) : null,
        h('h2', null, 'Участники'),
        h('ul', { class: 'list' }, c.members.map(function (m) {
          return h('li', null, h('span', { class: 'grow' }, m.owner ? '★ ' : '', m.login),
            m.roles.map(function (r) { return chip(r.name, r.color); }));
        })),
        h('p', null, h('a', { href: '/clans' }, '← Все кланы')));
      // The profile is public and is already drawn; the admin tools are added only for a site admin.
      api.get('/api/me').then(function (me) {
        if (!me.user || me.user.role !== 'admin') return null;
        return api.get('/api/admin/clans').then(function (list) {
          var row = list.filter(function (x) { return x.tag.toLowerCase() === c.tag.toLowerCase(); })[0];
          return row ? api.get('/api/admin/clans/' + row.id) : null;
        });
      }).then(function (detail) {
        if (detail) app.appendChild(adminBlock(detail));
      }).catch(function () { /* the public profile stays as it is */ });
    }).catch(function (ex) {
      show(h('h1', null, 'Клан'), h('p', { class: 'err' }, ex && ex.status === 404 ? 'Клан не найден.' : errorText(ex)),
        h('p', null, h('a', { href: '/clans' }, '← Все кланы')));
    });
  }

  function showJoin(token) {
    Promise.all([api.get('/api/clans/join/' + token), api.get('/api/me')]).then(function (res) {
      var c = res[0];
      var me = res[1];
      var err = h('p', { class: 'err', role: 'alert' });
      var action;
      if (!me.user) {
        action = h('p', null, loginLink(), ', чтобы вступить.');
      } else if (me.user.clan) {
        action = h('p', { class: 'muted' }, 'Вы уже в клане [' + me.user.clan.tag + ']. Чтобы вступить, сначала выйдите из него.');
      } else {
        action = h('button', { type: 'button', class: 'primary' }, 'Вступить');
        action.addEventListener('click', function () {
          act(action, err, function () {
            return api.post('/api/clans/join/' + token, {}).then(function () { location.href = '/clan'; });
          });
        });
      }
      show(h('h1', null, 'Приглашение в клан'),
        h('div', { class: 'clan-head' }, emblem(c), h('div', null, h('strong', null, '[' + c.tag + '] ' + c.name),
          h('div', { class: 'muted' }, 'Участников: ' + c.members))),
        h('div', { class: 'row' }, action), err);
    }).catch(function (ex) {
      show(h('h1', null, 'Приглашение в клан'), h('p', { class: 'err' }, errorText(ex)));
    });
  }

  // ---------- my clan ----------

  function reload() {
    return api.get('/api/my/clan').then(Clan.set).catch(function (ex) {
      if (ex && ex.status === 401) {
        show(h('h1', null, 'Клан'), h('p', null, loginLink(), ', чтобы создать клан или принять приглашение.'),
          h('p', null, h('a', { href: '/clans' }, 'Каталог кланов')));
      } else {
        show(h('h1', null, 'Клан'), h('p', { class: 'err' }, errorText(ex)));
      }
    });
  }
  Clan.reload = reload;

  function showNoClan(body) {
    var invites = h('ul', { class: 'list' }, body.invitations.map(function (inv) {
      var err = h('span', { class: 'err' });
      var yes = h('button', { type: 'button', class: 'primary small' }, 'Принять');
      var no = h('button', { type: 'button', class: 'small' }, 'Отклонить');
      yes.addEventListener('click', function () {
        act(yes, err, function () { return api.post('/api/invitations/' + inv.id + '/accept', {}).then(Clan.set); });
      });
      no.addEventListener('click', function () {
        act(no, err, function () { return api.post('/api/invitations/' + inv.id + '/decline', {}).then(Clan.set); });
      });
      return h('li', null, emblem(inv, true),
        h('span', { class: 'grow' }, h('span', { class: 'tag' }, '[' + inv.tag + '] '), inv.name,
          h('div', { class: 'muted' }, 'пригласил ' + (inv.invited_by || '—'))),
        yes, no, err);
    }));
    var tag = field('Тег (2–5 букв или цифр)', { type: 'text', maxLength: 5, required: true });
    var name = field('Название', { type: 'text', maxLength: 100, required: true });
    var desc = h('textarea', { maxLength: 500, rows: 3 });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null, tag.el, name.el, h('label', null, 'Описание (необязательно)', desc), err,
      h('button', { type: 'submit', class: 'primary' }, 'Создать клан'));
    bind(form, err, function () {
      return api.post('/api/clans', { tag: tag.input.value, name: name.input.value, description: desc.value }).then(Clan.set);
    });
    show(h('h1', null, 'Клан'),
      h('p', { class: 'muted' }, 'Вы пока не в клане. Вступить можно по ссылке-приглашению или по приглашению от участника клана.'),
      body.invitations.length ? h('h2', null, 'Приглашения') : null,
      body.invitations.length ? invites : null,
      h('h2', null, 'Создать свой клан'), form,
      h('p', null, h('a', { href: '/clans' }, 'Каталог кланов')));
  }

  var TABS = [
    { id: 'overview', title: 'Обзор', visible: function () { return true; } },
    { id: 'members', title: 'Участники', visible: function () { return true; } },
    { id: 'roles', title: 'Роли', visible: function () { return Clan.can('roles_manage'); } },
    { id: 'squads', title: 'Отряды', visible: function () { return true; } },
    { id: 'invites', title: 'Приглашения', visible: function () { return Clan.can('invite'); } },
    { id: 'settings', title: 'Настройки', visible: function () { return Clan.can('clan_settings') || Clan.data.me.isOwner; } },
  ];

  function renderClan() {
    var d = Clan.data;
    var tabs = TABS.filter(function (t) { return t.visible() && (t.id === 'overview' || Clan.tabs[t.id]); });
    if (!tabs.some(function (t) { return t.id === Clan.tab; })) Clan.tab = 'overview';
    var bar = h('div', { class: 'tabs wrap', role: 'tablist' }, tabs.map(function (t) {
      return h('button', {
        type: 'button', role: 'tab', class: t.id === Clan.tab ? 'on' : '', 'aria-selected': String(t.id === Clan.tab),
        onclick: function () { Clan.tab = t.id; renderClan(); },
      }, t.title);
    }));
    var body = h('div');
    if (Clan.tab === 'overview') overview(body);
    else Clan.tabs[Clan.tab](body);
    document.title = '[' + d.clan.tag + '] ' + d.clan.name + ' — ANOMA WIKI';
    show(h('div', { class: 'clan-head' }, emblem(d.clan), h('div', null, title(d.clan),
      h('a', { href: '/clans/' + encodeURIComponent(d.clan.tag) }, 'Публичная страница'))), bar, body);
  }

  function overview(el) {
    var d = Clan.data;
    var me = d.members.filter(function (m) { return m.id === d.me.id; })[0];
    var err = h('p', { class: 'err', role: 'alert' });
    el.appendChild(h('p', { class: 'desc' }, d.clan.description || h('span', { class: 'muted' }, 'Описания пока нет.')));
    el.appendChild(h('p', null, 'Участников: ' + d.members.length + ' из ' + d.limits.members));
    el.appendChild(h('p', null, d.me.isOwner ? '★ Вы лидер клана. ' : 'Ваши роли: ',
      me.roles.length ? me.roles.map(function (id) { var r = Clan.roleById(id); return r ? chip(r.name, r.color) : null; })
        : (d.me.isOwner ? null : h('span', { class: 'muted' }, 'нет'))));
    el.appendChild(h('p', null, 'Ваши отряды: ',
      me.squads.length ? me.squads.map(function (id) { var s = Clan.squadById(id); return s ? chip(s.name, s.color) : null; })
        : h('span', { class: 'muted' }, 'нет')));
    if (!d.me.isOwner) {
      var leave = h('button', { type: 'button', class: 'danger' }, 'Выйти из клана');
      leave.addEventListener('click', function () {
        if (!window.confirm('Выйти из клана [' + d.clan.tag + ']?')) return;
        act(leave, err, function () { return api.post(Clan.base() + '/leave', {}).then(Clan.set); });
      });
      el.appendChild(h('div', { class: 'row' }, leave));
    }
    el.appendChild(err);
  }

  function route() {
    var p = location.pathname.replace(/\/+$/, '');
    var m;
    if (p === '/clans') return showCatalog();
    if ((m = /^\/clans\/([^/]+)$/.exec(p))) return showProfile(decodeURIComponent(m[1]));
    if ((m = /^\/clan\/join\/([0-9a-f]{64})$/.exec(p))) return showJoin(m[1]);
    return reload();
  }

  // Tab scripts load after this file; DOMContentLoaded fires once all of them have run.
  document.addEventListener('DOMContentLoaded', route);
})();
