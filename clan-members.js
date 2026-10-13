(function () {
  'use strict';

  var C = window.Clan;
  var h = C.h;
  var api = C.api;

  function checkboxList(items, checkedIds, enabled) {
    var boxes = [];
    var el = h('div', { class: 'checks' }, items.map(function (it) {
      var cb = h('input', { type: 'checkbox', checked: checkedIds.indexOf(it.id) >= 0, disabled: !enabled(it) });
      boxes.push({ id: it.id, cb: cb });
      return h('label', null, cb, C.chip(it.name, it.color));
    }));
    return {
      el: el,
      value: function () { return boxes.filter(function (b) { return b.cb.checked; }).map(function (b) { return b.id; }); },
    };
  }
  C.checkboxList = checkboxList;

  C.tabs.members = function (el) {
    var d = C.data;
    var err = h('p', { class: 'err', role: 'alert' });
    var list = h('ul', { class: 'list' });

    function openEditor(row, m, editRoles, editSquads) {
      var old = row.querySelector('.editor');
      if (old) { old.remove(); return; }
      var box = h('div', { class: 'editor' });
      var roles = null;
      var squads = null;
      if (editRoles) {
        var assignable = d.roles.filter(function (r) { return !r.everyone; });
        roles = checkboxList(assignable, m.roles, function (r) { return C.roleBelow(r) && C.permsHeld(r.perms); });
        box.appendChild(h('div', { class: 'muted' }, 'Роли'));
        box.appendChild(assignable.length ? roles.el : h('p', { class: 'muted' }, 'Ролей пока нет.'));
      }
      if (editSquads) {
        squads = checkboxList(d.squads, m.squads, function () { return true; });
        box.appendChild(h('div', { class: 'muted' }, 'Отряды'));
        box.appendChild(d.squads.length ? squads.el : h('p', { class: 'muted' }, 'Отрядов пока нет.'));
      }
      var e = h('p', { class: 'err', role: 'alert' });
      var save = h('button', { type: 'button', class: 'primary small' }, 'Сохранить');
      save.addEventListener('click', function () {
        var payload = {};
        if (roles) payload.roles = roles.value();
        if (squads) payload.squads = squads.value();
        C.act(save, e, function () { return api.put(C.base() + '/members/' + m.id, payload).then(C.set); });
      });
      box.appendChild(e);
      box.appendChild(h('div', { class: 'row' }, save,
        h('button', { type: 'button', class: 'small', onclick: function () { box.remove(); } }, 'Отмена')));
      row.appendChild(box);
    }

    d.members.forEach(function (m) {
      var self = m.id === d.me.id;
      var editRoles = C.can('roles_manage') && (self || C.outranks(m));
      var editSquads = C.can('squads_manage') && (self || C.outranks(m));
      var canKick = C.can('kick') && !self && C.outranks(m);
      var row = h('li', null,
        h('span', { class: 'grow' }, m.owner ? '★ ' : '', h('strong', null, m.login), self ? h('span', { class: 'muted' }, ' (вы)') : null),
        m.roles.map(function (id) { var r = C.roleById(id); return r ? C.chip(r.name, r.color) : null; }),
        m.squads.map(function (id) { var s = C.squadById(id); return s ? C.chip(s.name, s.color) : null; }));
      if (editRoles || editSquads) {
        row.appendChild(h('button', { type: 'button', class: 'small', onclick: function () { openEditor(row, m, editRoles, editSquads); } }, 'Изменить'));
      }
      if (canKick) {
        var kick = h('button', { type: 'button', class: 'small danger' }, 'Исключить');
        kick.addEventListener('click', function () {
          if (!window.confirm('Исключить ' + m.login + ' из клана?')) return;
          C.act(kick, err, function () { return api.del(C.base() + '/members/' + m.id).then(C.set); });
        });
        row.appendChild(kick);
      }
      list.appendChild(row);
    });
    el.appendChild(h('p', { class: 'muted' }, 'Участников: ' + d.members.length + ' из ' + d.limits.members + '. ★ — лидер.'));
    el.appendChild(err);
    el.appendChild(list);
  };
})();
