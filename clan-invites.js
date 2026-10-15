(function () {
  'use strict';

  var C = window.Clan;
  var h = C.h;
  var api = C.api;

  function fmtMs(ms) { return new Date(ms).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }); }

  C.tabs.invites = function (el) {
    var base = C.base();
    var err = h('p', { class: 'err', role: 'alert' });
    var created = h('div');
    var links = h('ul', { class: 'list' });
    var pending = h('ul', { class: 'list' });

    function renderLinks(data) {
      links.textContent = '';
      if (!data.invites.length) links.appendChild(h('li', { class: 'muted' }, 'Активных ссылок нет.'));
      data.invites.forEach(function (inv) {
        var revoke = h('button', { type: 'button', class: 'small danger' }, 'Отозвать');
        revoke.addEventListener('click', function () {
          C.act(revoke, err, function () { return api.del(base + '/invites/' + inv.id).then(renderLinks); });
        });
        links.appendChild(h('li', null, h('span', { class: 'grow' },
          'Создал ' + (inv.created_by || '—') + ' · ' + (inv.expires_at ? 'до ' + fmtMs(inv.expires_at) : 'бессрочно')
          + ' · использована ' + inv.uses + (inv.max_uses ? ' из ' + inv.max_uses : '')), revoke));
      });
    }

    function renderPending(data) {
      pending.textContent = '';
      if (!data.invitations.length) pending.appendChild(h('li', { class: 'muted' }, 'Ожидающих приглашений нет.'));
      data.invitations.forEach(function (inv) {
        var revoke = h('button', { type: 'button', class: 'small danger' }, 'Отозвать');
        revoke.addEventListener('click', function () {
          C.act(revoke, err, function () { return api.del(base + '/invitations/' + inv.id).then(renderPending); });
        });
        pending.appendChild(h('li', null, h('span', { class: 'grow' }, h('strong', null, inv.login),
          h('span', { class: 'muted' }, ' · пригласил ' + (inv.invited_by || '—'))), revoke));
      });
    }

    var ttl = h('select', { 'aria-label': 'Срок действия' },
      h('option', { value: '1d' }, '1 день'), h('option', { value: '7d', selected: true }, '7 дней'), h('option', { value: '' }, 'Бессрочно'));
    var uses = h('select', { 'aria-label': 'Сколько раз' }, h('option', { value: '' }, 'Без ограничений'),
      [1, 5, 10, 25, 50].map(function (n) { return h('option', { value: String(n) }, n + ' раз'); }));
    var create = h('button', { type: 'button', class: 'primary' }, 'Создать ссылку');
    create.addEventListener('click', function () {
      C.act(create, err, function () {
        return api.post(base + '/invites', { ttl: ttl.value || null, maxUses: uses.value ? Number(uses.value) : null }).then(function (inv) {
          var input = h('input', { type: 'text', readOnly: true, value: inv.url, 'aria-label': 'Ссылка-приглашение' });
          var copy = h('button', { type: 'button' }, 'Копировать');
          copy.addEventListener('click', function () {
            input.select();
            var done = function () { copy.textContent = 'Скопировано'; };
            if (navigator.clipboard) navigator.clipboard.writeText(inv.url).then(done, function () { document.execCommand('copy'); done(); });
            else { document.execCommand('copy'); done(); }
          });
          created.textContent = '';
          created.appendChild(h('p', { class: 'muted' }, 'Ссылка показывается один раз — скопируйте её сейчас.'));
          created.appendChild(h('div', { class: 'copy' }, input, copy));
          return api.get(base + '/invites').then(renderLinks);
        });
      });
    });

    var login = C.field('Логин игрока', { type: 'text', maxLength: 32, required: true, autocomplete: 'off' });
    var form = h('form', null, login.el, h('button', { type: 'submit', class: 'primary' }, 'Пригласить'));
    C.bind(form, err, function () {
      return api.post(base + '/invitations', { login: login.input.value }).then(function (data) {
        login.input.value = '';
        renderPending(data);
      });
    });

    el.appendChild(err);
    el.appendChild(h('h2', null, 'Ссылка-приглашение'));
    el.appendChild(h('div', { class: 'row' }, h('label', null, 'Срок', ttl), h('label', null, 'Использований', uses)));
    el.appendChild(h('div', { class: 'row' }, create));
    el.appendChild(created);
    el.appendChild(links);
    el.appendChild(h('h2', null, 'Пригласить по логину'));
    el.appendChild(h('p', { class: 'muted' }, 'Игрок увидит приглашение на странице «Клан» и примет его сам.'));
    el.appendChild(form);
    el.appendChild(pending);
    api.get(base + '/invites').then(renderLinks).catch(function (ex) { err.textContent = C.errorText(ex); });
    api.get(base + '/invitations').then(renderPending).catch(function (ex) { err.textContent = C.errorText(ex); });
  };

  C.tabs.settings = function (el) {
    var d = C.data;
    var base = C.base();
    var err = h('p', { class: 'err', role: 'alert' });
    el.appendChild(err);

    if (C.can('clan_settings')) {
      var tag = C.field('Тег', { type: 'text', maxLength: 5, value: d.clan.tag, required: true });
      var name = C.field('Название', { type: 'text', maxLength: 100, value: d.clan.name, required: true });
      var desc = h('textarea', { maxLength: 500, rows: 4, value: d.clan.description });
      var form = h('form', null, tag.el, name.el, h('label', null, 'Описание', desc), h('button', { type: 'submit', class: 'primary' }, 'Сохранить'));
      C.bind(form, err, function () {
        return api.patch(base, { tag: tag.input.value, name: name.input.value, description: desc.value }).then(C.set);
      });
      var file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Файл эмблемы' });
      file.addEventListener('change', function () {
        var f = file.files[0];
        if (!f) return;
        if (f.size > 200 * 1024) { err.textContent = 'Файл больше 200 КБ.'; file.value = ''; return; }
        err.textContent = '';
        api.upload('PUT', base + '/emblem', f).then(C.set).catch(function (ex) { err.textContent = C.errorText(ex); file.value = ''; });
      });
      el.appendChild(h('h2', null, 'Клан'));
      el.appendChild(form);
      el.appendChild(h('h2', null, 'Эмблема'));
      el.appendChild(h('p', { class: 'muted' }, 'PNG, JPEG или WebP, до 200 КБ и 1024×1024.'));
      el.appendChild(file);
      if (d.clan.emblem_url) {
        var drop = h('button', { type: 'button', class: 'small' }, 'Убрать эмблему');
        drop.addEventListener('click', function () { C.act(drop, err, function () { return api.del(base + '/emblem').then(C.set); }); });
        el.appendChild(h('div', { class: 'row' }, drop));
      }
    }

    if (d.me.isOwner) {
      var others = d.members.filter(function (m) { return m.id !== d.me.id; });
      var who = h('select', { 'aria-label': 'Новый лидер' }, others.map(function (m) { return h('option', { value: String(m.id) }, m.login); }));
      var transfer = h('button', { type: 'button', disabled: !others.length }, 'Передать лидерство');
      transfer.addEventListener('click', function () {
        var target = others.filter(function (m) { return String(m.id) === who.value; })[0];
        if (!target || !window.confirm('Передать лидерство игроку ' + target.login + '? Вернуть его сможет только новый лидер. У вас останутся только те роли, что вы уже носите (без ролей — только права @everyone).')) return;
        C.act(transfer, err, function () { return api.post(base + '/transfer', { userId: target.id }).then(C.set); });
      });
      var confirmTag = C.field('Введите тег клана, чтобы подтвердить удаление', { type: 'text', autocomplete: 'off' });
      var del = h('button', { type: 'button', class: 'danger', disabled: true }, 'Удалить клан');
      confirmTag.input.addEventListener('input', function () { del.disabled = confirmTag.input.value.trim() !== d.clan.tag; });
      del.addEventListener('click', function () { C.act(del, err, function () { return api.del(base).then(C.set); }); });
      el.appendChild(h('h2', null, 'Лидерство'));
      el.appendChild(others.length ? who : h('p', { class: 'muted' }, 'В клане пока никого, кроме вас.'));
      el.appendChild(h('div', { class: 'row' }, transfer));
      el.appendChild(h('h2', null, 'Удаление клана'));
      el.appendChild(h('p', { class: 'muted' }, 'Удаляются роли, отряды и приглашения. Отменить нельзя.'));
      el.appendChild(confirmTag.el);
      el.appendChild(h('div', { class: 'row' }, del));
    }
  };
})();
