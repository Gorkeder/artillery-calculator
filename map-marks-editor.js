(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;
  var ICONS = window.MAP_ICONS || {};

  var V = null;
  var M = null;
  var map = null;
  var ed = { tool: 'select', selectedId: null, drawing: false };
  var els = {};
  var DRAW_SHAPE = { polygon: 'Polygon', line: 'Line' };
  var DEFAULT_COLOR = '#d4c24f';

  function active() { return V.mode() === 'marks'; }

  // ---------- status / saving ----------

  function status(text, kind, retry) {
    els.status.textContent = text;
    els.status.className = 'ed-status' + (kind ? ' ' + kind : '');
    if (retry) {
      els.status.appendChild(document.createTextNode(' '));
      els.status.appendChild(h('button', { type: 'button', onclick: retry }, 'Повторить'));
    }
  }

  // Runs an API call with visible status; resolves its value, or null after showing an error.
  function save(fn) {
    status('Сохранение…', 'busy');
    return fn().then(
      function (value) { status('Сохранено', 'ok'); return value; },
      function (err) {
        if (err.status === 401) status('Сессия истекла: обновите страницу и войдите снова', 'error');
        else if (err.message === 'marks_limit') status('Достигнут лимит: 300 меток', 'error');
        else if (err.status === 429) status('Слишком часто, подождите минуту', 'error');
        else status('Ошибка: ' + err.message, 'error', function () { save(fn); });
        return null;
      });
  }

  // ---------- toolbar ----------

  function buildToolbar() {
    els.status = h('span', { class: 'ed-status' });
    els.toolBtns = {};
    var bar = h('div', { class: 'ed-toolbar' });
    [['select', 'Выбор'], ['point', 'Точка'], ['polygon', 'Полигон'], ['line', 'Линия']].forEach(function (t) {
      var b = h('button', { type: 'button', onclick: function () { setTool(t[0]); } }, t[1]);
      els.toolBtns[t[0]] = b;
      bar.appendChild(b);
    });
    bar.appendChild(h('button', { type: 'button', class: 'danger', onclick: deleteSelected }, 'Удалить'));
    bar.appendChild(els.status);
    els.toolbar = bar;
    document.getElementById('ed-slot').appendChild(bar);
    updateToolbar();
  }

  function updateToolbar() {
    V.setDrawTool(ed.tool !== 'select');
    Object.keys(els.toolBtns).forEach(function (k) {
      els.toolBtns[k].classList.toggle('on', ed.tool === k);
    });
  }

  // An admin edits either the shared map or their own marks; everybody else only has marks.
  function buildModeSwitch(sharedLabel) {
    els.modeShared = h('button', { type: 'button', onclick: function () { setMode('shared'); } }, sharedLabel);
    els.modeMarks = h('button', { type: 'button', onclick: function () { setMode('marks'); } }, 'Мои метки');
    var sw = h('div', { class: 'ed-mode' }, els.modeShared, els.modeMarks);
    var slot = document.getElementById('ed-slot');
    slot.insertBefore(sw, slot.firstChild);
  }

  function setMode(mode) {
    V.setMode(mode);
    var marksMode = mode === 'marks';
    els.toolbar.hidden = !marksMode;
    if (els.modeShared) {
      els.modeShared.classList.toggle('on', !marksMode);
      els.modeMarks.classList.toggle('on', marksMode);
    }
    if (window.MapEditor) window.MapEditor.setActive(!marksMode);
    if (!marksMode) {
      setTool('select');
      deselect();
    }
  }

  // ---------- tools ----------

  function drawOptions() {
    return {
      finishOn: 'dblclick',
      allowSelfIntersection: true,
      snappable: false,
      templineStyle: { color: DEFAULT_COLOR },
      hintlineStyle: { color: DEFAULT_COLOR, dashArray: [5, 5] },
      pathOptions: { color: DEFAULT_COLOR, fillColor: DEFAULT_COLOR, fillOpacity: 0.25 },
    };
  }

  function setTool(tool) {
    map.pm.disableDraw();
    ed.drawing = false;
    ed.tool = tool;
    if (tool !== 'select') deselect();
    map.getContainer().classList.toggle('crosshair', tool === 'point');
    if (DRAW_SHAPE[tool]) map.pm.enableDraw(DRAW_SHAPE[tool], drawOptions());
    updateToolbar();
  }

  function finishDraw() {
    var shape = DRAW_SHAPE[ed.tool];
    try {
      if (shape && map.pm.Draw[shape] && map.pm.Draw[shape]._finishShape) map.pm.Draw[shape]._finishShape();
    } catch (e) { /* Enter is a convenience; double click always works */ }
  }

  function createMark(shape, geometry) {
    if (!M.available()) {
      status('Личные метки доступны только на опубликованных картах', 'error');
      return;
    }
    var slug = V.state().map.slug;
    var body = { map: slug, shape: shape, geometry: geometry, title: '' };
    if (shape === 'point') body.icon = 'pin';
    save(function () { return api.post('/api/my/marks', body); }).then(function (m) {
      if (!m) return;
      M.show();
      M.setMark(m);
      select(m.id);
    });
  }

  function onMapClick(e) {
    if (!active() || !V.size()) return;
    if (ed.tool === 'point') createMark('point', Geo.fromLatLng(e.latlng, V.size()));
    else if (ed.tool === 'select') deselect();
  }

  function onCreate(e) {
    if (!active()) return;
    var shape = ed.tool;
    var ll = e.layer.getLatLngs();
    var ring = Array.isArray(ll[0]) ? ll[0] : ll;
    var points = Geo.latLngsToPoints(ring, V.size());
    e.layer.remove();
    setTool('select');
    if (shape === 'polygon' || shape === 'line') createMark(shape, { points: points });
  }

  // ---------- selection and geometry editing ----------

  function onMarkClick(id, e) {
    // Another mode's object: open its card, unless a drawing tool wants this click.
    if (!active()) return V.drawTool() ? false : M.open(id, e && e.latlng);
    if (ed.drawing || ed.tool === 'point') return false;
    if (ed.tool === 'select') { select(id); return true; }
    return false;
  }

  function highlight(id, on) {
    var layer = M.layers()[id];
    if (!layer) return;
    if (layer instanceof L.Marker) {
      var el = layer.getElement();
      var mk = el && el.querySelector('.mk');
      if (mk) mk.classList.toggle('sel', on);
    } else {
      layer.setStyle({ weight: on ? 4 : (layer instanceof L.Polygon ? 2 : 3) });
    }
  }

  function select(id) {
    deselect(true);
    var layer = M.layers()[id];
    var m = M.byId(id);
    if (!layer || !m) return;
    ed.selectedId = id;
    if (layer.pm) layer.pm.enable({ allowSelfIntersection: true });
    highlight(id, true);
    showProps(m);
    map.invalidateSize({ pan: false });
  }

  function deselect(keepPanel) {
    if (ed.selectedId !== null) {
      var layer = M.layers()[ed.selectedId];
      if (layer && layer.pm) layer.pm.disable();
      highlight(ed.selectedId, false);
    }
    ed.selectedId = null;
    if (!keepPanel) {
      els.panel.hidden = true;
      map.invalidateSize({ pan: false });
    }
  }

  function flat(latlngs) {
    return Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  }

  function saveGeometry(id, layer) {
    var size = V.size();
    var geometry = layer instanceof L.Marker
      ? Geo.fromLatLng(layer.getLatLng(), size)
      : { points: Geo.latLngsToPoints(flat(layer.getLatLngs()), size) };
    save(function () { return api.patch('/api/my/marks/' + id, { geometry: geometry }); }).then(function (m) {
      if (!m) return;
      // Replace the data but keep the live layer so vertex editing is not interrupted.
      var list = M.list();
      var i = list.findIndex(function (x) { return x.id === id; });
      if (i >= 0) list[i] = m;
    });
  }

  function attachLayer(layer, mark) {
    var isMarker = layer instanceof L.Marker;
    layer.on(isMarker ? 'pm:dragend' : 'pm:edit', function () { saveGeometry(mark.id, layer); });
  }

  // ---------- properties panel ----------

  function buildProps() {
    els.title = h('input', { type: 'text', maxLength: 80, placeholder: 'Название' });
    els.desc = h('textarea', { rows: 5, maxLength: 1000, placeholder: 'Описание' });
    els.color = h('input', { type: 'color' });
    els.icon = h('select');
    window.mapIconOptions().forEach(function (g) { els.icon.appendChild(g); });
    els.iconRow = h('div', null, h('label', null, 'Иконка'), els.icon);
    els.panel = h('aside', { class: 'ed-props', hidden: true },
      h('h2', null, 'Моя метка'),
      h('label', null, 'Название'), els.title,
      h('label', null, 'Описание'), els.desc,
      h('label', null, 'Цвет'), els.color,
      els.iconRow,
      h('p', null, h('button', { type: 'button', class: 'danger', onclick: deleteSelected }, 'Удалить метку')));
    document.getElementById('props-slot').appendChild(els.panel);

    els.title.addEventListener('change', function () { patch({ title: els.title.value }); });
    els.desc.addEventListener('change', function () { patch({ description: els.desc.value }); });
    els.color.addEventListener('change', function () { patch({ color: els.color.value }); });
    els.icon.addEventListener('change', function () { patch({ icon: els.icon.value }); });
  }

  function showProps(m) {
    // Never overwrite the field being typed in: a save for another field re-renders the panel.
    function put(el, value) { if (document.activeElement !== el) el.value = value; }
    els.panel.hidden = false;
    put(els.title, m.title || '');
    put(els.desc, m.description || '');
    put(els.color, m.color);
    put(els.icon, ICONS[m.icon] ? m.icon : 'question');
    els.iconRow.hidden = m.shape !== 'point';
  }

  function patch(fields) {
    var id = ed.selectedId;
    if (id === null) return;
    save(function () { return api.patch('/api/my/marks/' + id, fields); }).then(function (m) {
      if (!m) return;
      M.setMark(m);
      if (ed.selectedId === id) select(id); // re-enable editing on the re-created layer, refresh the panel
    });
  }

  function deleteSelected() {
    var id = ed.selectedId;
    if (id === null || !active()) return;
    var m = M.byId(id);
    if (!window.confirm('Удалить метку «' + ((m && m.title) || 'без названия') + '»?')) return;
    deselect();
    save(function () { return api.del('/api/my/marks/' + id); }).then(function (r) {
      if (r) M.dropMark(id);
    });
  }

  // ---------- keyboard ----------

  function onKey(e) {
    if (!active()) return;
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      if (ed.drawing || ed.tool !== 'select') setTool('select'); else deselect();
    } else if (e.key === 'Delete' && !typing) {
      deleteSelected();
    } else if (e.key === 'Enter' && ed.drawing && !typing) {
      finishDraw();
    }
  }

  // ---------- start ----------

  function start(viewer, marksView) {
    V = viewer;
    M = marksView;
    map = V.leaflet();
    document.body.classList.add('editing');
    buildToolbar();
    buildProps();

    M.hooks.onLayer = attachLayer;
    M.setClickHandler(onMarkClick);
    V.onMapLoaded(function () { deselect(); });
    map.on('click', onMapClick);
    map.on('pm:create', onCreate);
    map.on('pm:drawstart', function () { if (active()) ed.drawing = true; });
    map.on('pm:drawend', function () { if (active()) ed.drawing = false; });
    document.addEventListener('keydown', onKey);

    var can = V.state().me.can;
    if (can.feature) {
      buildModeSwitch('Общие');
      setMode('shared');
    } else if (can.propose && window.MapEditor) {
      // A user chooses between proposing to the shared map and their private marks; private is the default.
      buildModeSwitch('Предложить');
      setMode('marks');
    } else {
      setMode('marks');
    }
    // Layers drawn before this editor attached its handlers need them now.
    Object.keys(M.layers()).forEach(function (id) {
      var layer = M.layers()[id];
      var m = M.byId(Number(id));
      if (layer && m) attachLayer(layer, m);
    });
    status('Мои метки: видны только вам', '');
  }

  // Tactics mode: stop drawing and vertex editing without tearing the editor down.
  function pause() { setTool('select'); deselect(); }

  window.MapMarksEditor = { start: start, pause: pause };
})();
