(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var SHAPES = [['point', 'Точка'], ['polygon', 'Полигон'], ['line', 'Линия']];

  function V() { return window.MapViewer; }
  function E() { return window.MapEditor; }

  function openDialog(title, body) {
    var dlg = h('dialog', { class: 'dlg' },
      h('h2', null, title), body,
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: function () { dlg.close(); } }, 'Закрыть')));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    return dlg;
  }

  // ---------- categories ----------

  function categories() {
    var viewer = V();
    var st = viewer.state();
    if (!st.map) { E().status('Сначала создайте карту', 'error'); return; }
    var list = h('div', { class: 'dlg-list' });

    function featureCount(id) {
      return st.features.filter(function (f) { return f.category_id === id; }).length;
    }

    function patch(c, fields) {
      return E().save(function () { return api.patch('/api/categories/' + c.id, fields); }).then(function (res) {
        if (res) viewer.setCategory(res);
        render();
      });
    }

    function row(c) {
      var n = featureCount(c.id);
      var icon = h('select', { onchange: function () { patch(c, { icon: icon.value }); } },
        window.mapIconOptions(c.icon));
      var shape = h('select', {
        disabled: n > 0,
        title: n > 0 ? 'Тип нельзя менять, пока в категории есть объекты' : '',
        onchange: function () { patch(c, { shape: shape.value }); },
      }, SHAPES.map(function (s) { return h('option', { value: s[0], selected: s[0] === c.shape }, s[1]); }));
      var name = h('input', { type: 'text', value: c.name, maxLength: 60, onchange: function () { patch(c, { name: name.value }); } });
      var color = h('input', { type: 'color', value: c.color, onchange: function () { patch(c, { color: color.value }); } });
      var vis = h('input', {
        type: 'checkbox', checked: c.visible_default, title: 'Показывать по умолчанию',
        onchange: function () { patch(c, { visible_default: vis.checked }); },
      });
      var del = h('button', {
        type: 'button', class: 'danger',
        onclick: function () {
          if (!window.confirm('Удалить категорию «' + c.name + '»' + (n ? ' вместе с объектами (' + n + ')' : '') + '?')) return;
          E().save(function () { return api.del('/api/categories/' + c.id); }).then(function (res) {
            if (!res) return;
            viewer.loadMap(st.map.slug, { keepView: true }).then(render);
          });
        },
      }, 'Удалить');
      return h('div', { class: 'dlg-row' }, color, name, icon, shape, vis, del);
    }

    function render() {
      list.textContent = '';
      st.categories.forEach(function (c) { list.appendChild(row(c)); });
      if (!st.categories.length) list.appendChild(h('p', null, 'Категорий пока нет.'));
    }

    var newName = h('input', { type: 'text', placeholder: 'Новая категория', maxLength: 60 });
    var newShape = h('select', null, SHAPES.map(function (s) { return h('option', { value: s[0] }, s[1]); }));
    var addForm = h('div', { class: 'dlg-row' }, newName, newShape, h('button', {
      type: 'button', class: 'primary',
      onclick: function () {
        if (!newName.value.trim()) return;
        var body = { map_id: st.map.id, name: newName.value.trim(), shape: newShape.value };
        E().save(function () { return api.post('/api/categories', body); }).then(function (c) {
          if (!c) return;
          newName.value = '';
          viewer.setCategory(c);
          render();
        });
      },
    }, 'Добавить'));

    openDialog('Категории — ' + st.map.title, h('div', null, list, addForm));
    render();
  }

  // ---------- maps ----------

  function maps() {
    var viewer = V();
    var st = viewer.state();
    var list = h('div', { class: 'dlg-list' });
    var dlg;

    function refresh() {
      return viewer.reloadMaps().then(render);
    }

    function patch(m, fields) {
      return E().save(function () { return api.patch('/api/maps/' + m.id, fields); }).then(function (res) {
        if (res) refresh();
      });
    }

    function row(m) {
      var title = h('input', { type: 'text', value: m.title, maxLength: 80, onchange: function () { patch(m, { title: title.value }); } });
      var pub = h('input', {
        type: 'checkbox', checked: m.published, title: 'Опубликована',
        onchange: function () { patch(m, { published: pub.checked }); },
      });
      var file = h('input', {
        type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true,
        onchange: function () {
          var f = file.files[0];
          file.value = '';
          if (!f) return;
          E().save(function () { return api.upload('PUT', '/api/maps/' + m.id + '/image', f); }).then(function (res) {
            if (!res) return;
            refresh();
            if (st.map && st.map.id === m.id) viewer.loadMap(m.slug);
          });
        },
      });
      var open = h('button', { type: 'button', onclick: function () { viewer.loadMap(m.slug); dlg.close(); } }, 'Открыть');
      var up = h('button', { type: 'button', onclick: function () { file.click(); } },
        m.image_url ? 'Заменить картинку' : 'Загрузить картинку');
      var del = h('button', {
        type: 'button', class: 'danger',
        onclick: function () {
          if (!window.confirm('Удалить карту «' + m.title + '» со всеми категориями и объектами? Это необратимо.')) return;
          E().save(function () { return api.del('/api/maps/' + m.id); }).then(function (res) {
            if (!res) return;
            viewer.reloadMaps().then(function () {
              var next = viewer.state().maps[0];
              if (st.map && st.map.id === m.id && next) return viewer.loadMap(next.slug);
              return null;
            }).then(render);
          });
        },
      }, 'Удалить');
      return h('div', { class: 'dlg-row' }, pub, title, h('code', null, m.slug), open, up, file, del);
    }

    function render() {
      list.textContent = '';
      st.maps.forEach(function (m) { list.appendChild(row(m)); });
      if (!st.maps.length) list.appendChild(h('p', null, 'Карт пока нет.'));
    }

    var slug = h('input', { type: 'text', placeholder: 'slug (a-z, 0-9, -)', maxLength: 40 });
    var title = h('input', { type: 'text', placeholder: 'Название', maxLength: 80 });
    var addForm = h('div', { class: 'dlg-row' }, slug, title, h('button', {
      type: 'button', class: 'primary',
      onclick: function () {
        var body = { slug: slug.value.trim(), title: title.value.trim(), published: false };
        E().save(function () { return api.post('/api/maps', body); }).then(function (m) {
          if (!m) return;
          slug.value = '';
          title.value = '';
          refresh();
        });
      },
    }, 'Добавить карту'));

    dlg = openDialog('Карты', h('div', null, list, addForm,
      h('p', { class: 'hint' }, 'Новая карта — черновик: отметьте «опубликована», когда будет готова. Замена картинки не сдвигает объекты.')));
    render();
  }

  // ---------- moderation ----------

  function moderation() {
    var viewer = V();
    var data = { proposals: [], flagged: [], rejected: [], reports: [], blocked: [] };
    var tab = 'proposals';
    var TITLES = {
      proposals: 'Предложения', flagged: 'Пустые и спам', rejected: 'Отклонённые', reports: 'Жалобы', blocked: 'Заблокированные',
    };
    var FLAGS = { empty: 'Пустой', duplicate: 'Дубль', frequency: 'Частая отправка' };
    var tabs = h('div', { class: 'row' });
    var list = h('div', { class: 'dlg-list' });
    var dlg;

    function reload() {
      return api.get('/api/moderation').then(function (d) {
        data = d;
        E().setModerationCount(d.proposals.length + d.flagged.length + d.reports.length);
        render();
      }, function (err) {
        list.textContent = 'Ошибка: ' + err.message;
      });
    }

    // Runs a moderation call with the editor's status line, then refreshes the queue (and the map).
    function act(fn, reloadMap) {
      return E().save(fn).then(function (res) {
        if (!res) return;
        var st = viewer.state();
        if (reloadMap && st.map) viewer.loadMap(st.map.slug, { keepView: true });
        reload();
      });
    }

    function showOnMap(slug, featureId) {
      dlg.close();
      var st = viewer.state();
      var go = st.map && st.map.slug === slug ? Promise.resolve() : viewer.loadMap(slug);
      go.then(function () { viewer.focusFeature(featureId); });
    }

    function blockAuthor(userId, login) {
      var why = window.prompt('Заблокировать «' + login + '» для предложений и жалоб. Причина (необязательно):', '');
      if (why === null) return;
      act(function () { return api.post('/api/users/' + userId + '/block-proposals', { reason: why.trim() }); }, true);
    }

    function proposalRow(p) {
      var reason = h('input', { type: 'text', maxLength: 200, placeholder: 'Причина отклонения' });
      return h('div', { class: 'dlg-row mod-row' },
        h('div', { class: 'mod-info' },
          h('strong', null, p.title || 'Без названия'),
          h('div', { class: 'hint' }, p.category_name + ' · ' + p.map_title + ' · ' + (p.author_login || 'аккаунт удалён')),
          p.flag ? h('span', { class: 'chip' }, FLAGS[p.flag] || p.flag) : null,
          p.description ? h('div', { class: 'mod-text' }, p.description) : null),
        reason,
        h('button', { type: 'button', onclick: function () { showOnMap(p.map_slug, p.id); } }, 'Показать'),
        h('button', { type: 'button', class: 'primary', onclick: function () {
          act(function () { return api.post('/api/features/' + p.id + '/approve', {}); }, true);
        } }, 'Одобрить'),
        h('button', { type: 'button', class: 'danger', onclick: function () {
          if (!reason.value.trim()) { reason.focus(); return; }
          act(function () { return api.post('/api/features/' + p.id + '/reject', { reason: reason.value.trim() }); }, true);
        } }, 'Отклонить'),
        p.author_id ? h('button', { type: 'button', class: 'danger', onclick: function () { blockAuthor(p.author_id, p.author_login); } },
          'Заблокировать автора') : null);
    }

    // A rejected proposal can still be published: the admin may change their mind (e.g. after unblocking).
    function rejectedRow(p) {
      return h('div', { class: 'dlg-row mod-row' },
        h('div', { class: 'mod-info' },
          h('strong', null, p.title || 'Без названия'),
          h('div', { class: 'hint' }, p.category_name + ' · ' + p.map_title + ' · ' + (p.author_login || 'аккаунт удалён')),
          h('div', { class: 'mod-text' }, 'Отклонено: ' + (p.reject_reason || ''))),
        h('button', { type: 'button', onclick: function () { showOnMap(p.map_slug, p.id); } }, 'Показать'),
        h('button', { type: 'button', class: 'primary', onclick: function () {
          act(function () { return api.post('/api/features/' + p.id + '/approve', {}); }, true);
        } }, 'Одобрить'));
    }

    function reportRow(r) {
      return h('div', { class: 'dlg-row mod-row' },
        h('div', { class: 'mod-info' },
          h('strong', null, r.feature_title || 'Без названия'),
          h('div', { class: 'hint' }, 'от ' + r.reporter_login + ' · ' + r.created_at),
          h('div', { class: 'mod-text' }, r.text)),
        h('button', { type: 'button', onclick: function () { showOnMap(r.map_slug, r.feature_id); } }, 'Показать'),
        h('button', { type: 'button', class: 'primary', onclick: function () {
          act(function () { return api.post('/api/reports/' + r.id + '/resolve', {}); }, false);
        } }, 'Решено'));
    }

    function blockedRow(b) {
      return h('div', { class: 'dlg-row mod-row' },
        h('div', { class: 'mod-info' },
          h('strong', null, b.login),
          h('div', { class: 'hint' }, b.reason ? 'Причина: ' + b.reason : 'Без причины')),
        h('button', { type: 'button', onclick: function () {
          act(function () { return api.post('/api/users/' + b.id + '/unblock-proposals', {}); }, false);
        } }, 'Разблокировать'));
    }

    function render() {
      tabs.textContent = '';
      Object.keys(TITLES).forEach(function (k) {
        tabs.appendChild(h('button', { type: 'button', class: tab === k ? 'on' : '', onclick: function () { tab = k; render(); } },
          TITLES[k] + ' (' + data[k].length + ')'));
      });
      list.textContent = '';
      var rowFor = {
        proposals: proposalRow, flagged: proposalRow, rejected: rejectedRow, reports: reportRow, blocked: blockedRow,
      }[tab];
      if (tab === 'flagged' && data.flagged.length) {
        list.appendChild(h('div', { class: 'dlg-row' },
          h('span', { class: 'hint' }, 'Автоматически отмечены как пустые, дубли или частая отправка.'),
          h('button', { type: 'button', class: 'danger', onclick: function () {
            var why = window.prompt('Причина отклонения для всех (' + data.flagged.length + '):',
              'Пустое или повторяющееся предложение');
            if (why === null || !why.trim()) return;
            act(function () { return api.post('/api/moderation/reject-flagged', { reason: why.trim() }); }, true);
          } }, 'Отклонить все (' + data.flagged.length + ')')));
      }
      data[tab].forEach(function (item) { list.appendChild(rowFor(item)); });
      if (!data[tab].length) list.appendChild(h('p', null, 'Пока пусто.'));
    }

    dlg = openDialog('Модерация', h('div', null, tabs, list));
    reload();
  }

  window.MapEditorDialogs = { categories: categories, maps: maps, moderation: moderation };
})();
