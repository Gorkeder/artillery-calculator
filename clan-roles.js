(function () {
  'use strict';

  var C = window.Clan;
  var h = C.h;
  var api = C.api;

  var PERM_LABELS = [
    ['tactics_view', 'Видеть тактику'],
    ['tactics_draw', 'Рисовать на тактике'],
    ['plans_manage', 'Управлять планами'],
    ['squads_manage', 'Управлять отрядами'],
    ['invite', 'Приглашать'],
    ['kick', 'Исключать'],
    ['roles_manage', 'Управлять ролями'],
    ['clan_settings', 'Настройки клана'],
  ];
  C.PERM_LABELS = PERM_LABELS;

  function swap(ids, i, j) {
    var copy = ids.slice();
    var t = copy[i];
    copy[i] = copy[j];
    copy[j] = t;
    return copy;
  }

  function moveButtons(ids, i, url, err) {
    function go(j) {
      api.put(url, { ids: swap(ids, i, j) }).then(C.set).catch(function (ex) { err.textContent = C.errorText(ex); });
    }
    return [
      h('button', { type: 'button', class: 'small', 'aria-label': 'Выше', disabled: i <= 0, onclick: function () { go(i - 1); } }, '↑'),
      h('button', { type: 'button', class: 'small', 'aria-label': 'Ниже', disabled: i >= ids.length - 1, onclick: function () { go(i + 1); } }, '↓'),
    ];
  }

  function roleEditor(r, onDone) {
    var d = C.data;
    var me = d.me;
    var name = C.field('Название', { type: 'text', maxLength: 30, value: r ? r.name : '', disabled: Boolean(r && r.everyone) });
    var color = h('input', { type: 'color', value: r ? r.color : '#9a9a86', 'aria-label': 'Цвет' });
    var perms = PERM_LABELS.map(function (p) {
      var cb = h('input', { type: 'checkbox', checked: Boolean(r && r.perms.indexOf(p[0]) >= 0), disabled: !(me.isOwner || C.can(p[0])) });
      return { name: p[0], cb: cb, el: h('label', null, cb, p[1]) };
    });
    var canScope = me.isOwner || C.can('tactics_draw');
    var allAllowed = me.isOwner || me.drawSquads === 'all';
    var scopeName = 'scope-' + (r ? r.id : 'new');
    var all = h('input', { type: 'radio', name: scopeName, checked: Boolean(r && r.draw_all_squads), disabled: !canScope || !allAllowed });
    var some = h('input', { type: 'radio', name: scopeName, checked: !(r && r.draw_all_squads), disabled: !canScope });
    var squads = C.checkboxList(d.squads, r ? r.squads : [], function (s) {
      return canScope && (allAllowed || me.drawSquads.indexOf(s.id) >= 0);
    });
    var err = h('p', { class: 'err', role: 'alert' });
    var save = h('button', { type: 'button', class: 'primary small' }, r ? 'Сохранить' : 'Создать');
    save.addEventListener('click', function () {
      var payload = {
        color: color.value,
        perms: perms.filter(function (p) { return p.cb.checked; }).map(function (p) { return p.name; }),
      };
      if (!r || !r.everyone) payload.name = name.input.value;
      // The draw scope is sent only by those who may change it; the server skips the check when it is unchanged.
      if (canScope) {
        payload.draw_all_squads = all.checked;
        if (!all.checked) payload.squads = squads.value();
      }
      C.act(save, err, function () {
        return (r ? api.patch(C.base() + '/roles/' + r.id, payload) : api.post(C.base() + '/roles', payload)).then(C.set);
      });
    });
    return h('div', { class: 'editor' },
      r && r.everyone ? h('p', { class: 'muted' }, 'Права @everyone есть у каждого участника клана.') : name.el,
      h('label', null, 'Цвет ', color),
      h('div', { class: 'muted' }, 'Права'),
      h('div', { class: 'checks' }, perms.map(function (p) { return p.el; })),
      h('div', { class: 'muted' }, 'Рисует для (вместе с правом «Рисовать на тактике»)'),
      h('div', { class: 'checks' }, h('label', null, all, 'все отряды'), h('label', null, some, 'выбранные отряды:')),
      d.squads.length ? squads.el : h('p', { class: 'muted' }, 'Отрядов пока нет.'),
      err,
      h('div', { class: 'row' }, save, h('button', { type: 'button', class: 'small', onclick: onDone }, 'Отмена')));
  }

  C.tabs.roles = function (el) {
    var d = C.data;
    var err = h('p', { class: 'err', role: 'alert' });
    var manageable = d.roles.filter(function (r) { return !r.everyone && C.roleBelow(r); });
    var ids = manageable.map(function (r) { return r.id; });
    var list = h('ul', { class: 'list' });

    function toggle(row, r) {
      var old = row.querySelector('.editor');
      if (old) { old.remove(); return; }
      var ed = roleEditor(r, function () { ed.remove(); });
      row.appendChild(ed);
    }

    d.roles.forEach(function (r) {
      var row = h('li', null, C.chip(r.name, r.color),
        h('span', { class: 'grow muted' }, r.everyone ? 'есть у всех участников' : ''));
      if (C.roleBelow(r)) {
        if (!r.everyone) moveButtons(ids, ids.indexOf(r.id), C.base() + '/roles/order', err).forEach(function (b) { row.appendChild(b); });
        row.appendChild(h('button', { type: 'button', class: 'small', onclick: function () { toggle(row, r); } }, 'Изменить'));
        if (!r.everyone) {
          var del = h('button', { type: 'button', class: 'small danger' }, 'Удалить');
          del.addEventListener('click', function () {
            if (!window.confirm('Удалить роль «' + r.name + '»?')) return;
            C.act(del, err, function () { return api.del(C.base() + '/roles/' + r.id).then(C.set); });
          });
          row.appendChild(del);
        }
      }
      list.appendChild(row);
    });

    var holder = h('div');
    var add = h('button', { type: 'button', class: 'primary', disabled: d.roles.length - 1 >= d.limits.roles || (!d.me.isOwner && d.me.top < 1) }, 'Создать роль');
    add.addEventListener('click', function () {
      if (holder.firstChild) { holder.textContent = ''; return; }
      holder.appendChild(roleEditor(null, function () { holder.textContent = ''; }));
    });
    el.appendChild(h('p', { class: 'muted' }, 'Чем выше роль, тем она старше. Менять можно только роли ниже своей и только права, которые есть у вас.'));
    el.appendChild(err);
    el.appendChild(list);
    el.appendChild(h('div', { class: 'row' }, add));
    el.appendChild(holder);
  };

  C.tabs.squads = function (el) {
    var d = C.data;
    var manage = C.can('squads_manage');
    var err = h('p', { class: 'err', role: 'alert' });
    var ids = d.squads.map(function (s) { return s.id; });
    var list = h('ul', { class: 'list' });

    function editor(s, onDone) {
      var name = C.field('Название', { type: 'text', maxLength: 30, value: s ? s.name : '' });
      var color = h('input', { type: 'color', value: s ? s.color : '#4f8ad4', 'aria-label': 'Цвет' });
      var e = h('p', { class: 'err', role: 'alert' });
      var save = h('button', { type: 'button', class: 'primary small' }, s ? 'Сохранить' : 'Создать');
      save.addEventListener('click', function () {
        var payload = { name: name.input.value, color: color.value };
        C.act(save, e, function () {
          return (s ? api.patch(C.base() + '/squads/' + s.id, payload) : api.post(C.base() + '/squads', payload)).then(C.set);
        });
      });
      return h('div', { class: 'editor' }, name.el, h('label', null, 'Цвет ', color), e,
        h('div', { class: 'row' }, save, h('button', { type: 'button', class: 'small', onclick: onDone }, 'Отмена')));
    }

    d.squads.forEach(function (s, i) {
      var people = d.members.filter(function (m) { return m.squads.indexOf(s.id) >= 0; }).map(function (m) { return m.login; });
      var row = h('li', null, C.chip(s.name, s.color),
        h('span', { class: 'grow muted' }, people.length ? people.join(', ') : 'никого'));
      if (manage) {
        moveButtons(ids, i, C.base() + '/squads/order', err).forEach(function (b) { row.appendChild(b); });
        row.appendChild(h('button', { type: 'button', class: 'small', onclick: function () {
          var old = row.querySelector('.editor');
          if (old) { old.remove(); return; }
          var ed = editor(s, function () { ed.remove(); });
          row.appendChild(ed);
        } }, 'Изменить'));
        var del = h('button', { type: 'button', class: 'small danger' }, 'Удалить');
        del.addEventListener('click', function () {
          if (!window.confirm('Удалить отряд «' + s.name + '»?')) return;
          C.act(del, err, function () { return api.del(C.base() + '/squads/' + s.id).then(C.set); });
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    });
    if (!d.squads.length) list.appendChild(h('li', { class: 'muted' }, 'Отрядов пока нет.'));
    el.appendChild(h('p', { class: 'muted' }, 'Участник может быть в нескольких отрядах. Распределять людей — во вкладке «Участники».'));
    el.appendChild(err);
    el.appendChild(list);
    if (manage) {
      var holder = h('div');
      var add = h('button', { type: 'button', class: 'primary', disabled: d.squads.length >= d.limits.squads }, 'Создать отряд');
      add.addEventListener('click', function () {
        if (holder.firstChild) { holder.textContent = ''; return; }
        holder.appendChild(editor(null, function () { holder.textContent = ''; }));
      });
      el.appendChild(h('div', { class: 'row' }, add));
      el.appendChild(holder);
    }
  };
})();
