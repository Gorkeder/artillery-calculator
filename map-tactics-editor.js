(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;

  var EPSILON = 0.0005;
  var MAX_POINTS = 2000;     // the server rejects longer strokes
  var MIN_STEP_PX = 2;       // mouse moves closer than this are not recorded
  var V = null;
  var T = null;
  var map = null;
  var running = false;
  var changeHooked = false;
  var ed = { tool: 'pencil', squad: null, width: 2, drawing: false, points: [], temp: null, spaceDown: false, pan: null, lastPx: null, verts: [], rubber: null };
  var VERTEX_TOOLS = { arrow: { min: 2, max: 50 }, zone: { min: 3, max: 200 } };
  var pending = []; // strokes that could not be sent: { body, layer, pid }
  var erasing = {}; // item ids with a DELETE in flight
  var els = {};
  var dblZoomWas = false;
  var lastPlan = null;

  function hasPlan() { return !!T.planPublicId(); }
  function usable() {
    return running && V.mode() === 'tactics' && T.active() && hasPlan() && (ed.eraserOnly || allowedSquads().length > 0);
  }

  // ---------- panel ----------

  function allowedSquads() {
    var all = T.squads();
    var ds = T.drawSquads();
    var list = ds === 'all' ? all : all.filter(function (s) { return ds.indexOf(s.id) >= 0; });
    var out = list.map(function (s) { return { id: s.id, name: s.name, color: s.color }; });
    if (ds === 'all') out.push({ id: null, name: 'Общие', color: '#e9e6d8' });
    return out;
  }

  function buildPanel() {
    var slot = document.getElementById('tac-tools-slot');
    if (!slot) return false;
    els.tool = {};
    var tools = h('div', { class: 'tac-tools' });
    var toolList = ed.eraserOnly ? [['eraser', 'Стереть рисунок']] : [['pencil', 'Карандаш (P)'], ['arrow', 'Стрелка (A)'],
      ['zone', 'Зона (Z)'], ['marker', 'Метка (M)'], ['text', 'Текст (T)'], ['eraser', 'Ластик (E)']];
    toolList.forEach(function (t) {
      els.tool[t[0]] = h('button', { type: 'button', onclick: function () { setTool(t[0]); } }, t[1]);
      tools.appendChild(els.tool[t[0]]);
    });
    els.squad = h('select', { 'aria-label': 'Рисую за отряд', onchange: function () {
      ed.squad = els.squad.value === '' ? null : Number(els.squad.value);
      els.squad.blur();
    } });
    els.widths = h('div', { class: 'tac-widths' });
    [1, 2, 3].forEach(function (w) {
      els.widths.appendChild(h('button', { type: 'button', onclick: function () { ed.width = w; updateTools(); } }, String(w)));
    });
    els.label = h('input', { type: 'text', maxLength: 120, placeholder: 'Подпись', 'aria-label': 'Подпись' });
    els.labelLbl = h('label', null, 'Подпись');
    els.icon = h('select', { 'aria-label': 'Иконка' });
    Object.keys(T.TACTIC_ICONS).forEach(function (id) {
      els.icon.appendChild(h('option', { value: id }, T.TACTIC_ICONS[id].label));
    });
    els.iconLbl = h('label', null, 'Иконка');
    els.hint = h('p', { class: 'hint' }, 'Карту двигайте правой кнопкой или пробелом.');
    els.gate = h('p', { class: 'hint tac-gate' });
    els.status = h('p', { class: 'hint tac-status' });
    els.retry = h('div', { class: 'tac-retry' });
    els.drawing = h('div', { hidden: ed.eraserOnly },
      h('label', null, 'Рисую за'), els.squad, h('label', null, 'Толщина'), els.widths,
      els.labelLbl, els.label, els.iconLbl, els.icon, els.hint);
    els.box = h('div', { class: 'tac-editor' },
      h('div', { class: 'tac-controls' }, tools, els.drawing),
      els.gate, els.status, els.retry);
    slot.appendChild(els.box);
    return true;
  }

  function fillSquads() {
    if (!els.squad) return;
    els.squad.textContent = '';
    var list = allowedSquads();
    list.forEach(function (s) {
      els.squad.appendChild(h('option', { value: s.id === null ? '' : String(s.id) }, s.name));
    });
    if (list.length === 0) {
      els.squad.appendChild(h('option', { value: '' }, 'нет доступных отрядов'));
      ed.squad = null;
      return;
    }
    if (!list.some(function (s) { return s.id === ed.squad; })) ed.squad = list[0].id;
    els.squad.value = ed.squad === null ? '' : String(ed.squad);
  }

  function updateTools() {
    if (!els.box) return;
    Object.keys(els.tool).forEach(function (k) { els.tool[k].classList.toggle('on', ed.tool === k); });
    Array.prototype.forEach.call(els.widths.children, function (b, i) { b.classList.toggle('on', ed.width === i + 1); });
    var withLabel = ed.tool === 'zone' || ed.tool === 'marker' || ed.tool === 'text';
    els.labelLbl.hidden = els.label.hidden = !withLabel;
    els.iconLbl.hidden = els.icon.hidden = ed.tool !== 'marker';
    var gate = '';
    if (!hasPlan()) gate = 'Создайте или выберите план.';
    else if (!ed.eraserOnly && allowedSquads().length === 0) gate = 'Вам не назначен отряд для рисования.';
    els.box.classList.toggle('disabled', gate !== '');
    els.gate.textContent = gate;
  }

  function say(text) { if (els.status) els.status.textContent = text || ''; }

  // ---------- tools ----------

  // The pencil owns the left button only while there is somewhere to draw; otherwise the map stays draggable.
  function syncMap() {
    if (!map || !running) return;
    var can = usable();
    var pencil = ed.tool === 'pencil' && can;
    var vertex = ed.tool in VERTEX_TOOLS && can;
    var point = (ed.tool === 'marker' || ed.tool === 'text') && can;
    var drag = !pencil || ed.spaceDown;
    if (drag) map.dragging.enable(); else map.dragging.disable();
    // double click finishes an arrow or zone, so it must not zoom meanwhile
    if (pencil || vertex) map.doubleClickZoom.disable(); else if (dblZoomWas) map.doubleClickZoom.enable();
    map.getContainer().classList.toggle('tac-pencil', (pencil || vertex || point) && !ed.spaceDown);
  }

  function setTool(tool) {
    cancelStroke();
    ed.tool = tool;
    T.setInteractive(tool === 'eraser');
    syncMap();
    updateTools();
  }

  function color() {
    var sq = allowedSquads().find(function (s) { return s.id === ed.squad; });
    return sq ? sq.color : '#e9e6d8';
  }

  function weight() { return 2 + 2 * (ed.width - 1); }

  function cancelStroke() {
    ed.drawing = false;
    ed.points = [];
    ed.lastPx = null;
    ed.verts = [];
    if (ed.temp) { ed.temp.remove(); ed.temp = null; }
    if (ed.rubber) { ed.rubber.remove(); ed.rubber = null; }
  }

  function onDown(e) {
    if (!running || V.mode() !== 'tactics') return;
    var ev = e.originalEvent || {};
    if (ev.button === 2) { ed.pan = { x: ev.clientX, y: ev.clientY }; return; }
    if (ev.button !== 0 || ev.shiftKey || ed.tool !== 'pencil' || ed.spaceDown || !usable()) return;
    ed.drawing = true;
    ed.points = [e.latlng];
    ed.lastPx = e.containerPoint || null;
    ed.temp = L.polyline([e.latlng], {
      color: color(), weight: weight(), opacity: 0.9, lineCap: 'round', lineJoin: 'round', interactive: false,
    }).addTo(map);
  }

  function onMove(e) {
    var ev = e.originalEvent || {};
    // The button was released outside the window and the mouseup never arrived.
    if (ev.buttons === 0) {
      if (ed.pan) ed.pan = null;
      if (ed.drawing) { finishStroke(); return; }
    }
    if (ed.pan) {
      map.panBy([ed.pan.x - ev.clientX, ed.pan.y - ev.clientY], { animate: false });
      ed.pan = { x: ev.clientX, y: ev.clientY };
      return;
    }
    if (ed.verts.length && ed.tool in VERTEX_TOOLS) {
      var last = ed.verts[ed.verts.length - 1];
      if (!ed.rubber) {
        ed.rubber = L.polyline([last, e.latlng], {
          color: color(), weight: 2, dashArray: '4 6', opacity: 0.7, interactive: false,
        }).addTo(map);
      } else {
        ed.rubber.setLatLngs([last, e.latlng]);
      }
      return;
    }
    if (!ed.drawing || !ed.temp) return;
    var px = e.containerPoint;
    if (px && ed.lastPx) {
      var dx = px.x - ed.lastPx.x;
      var dy = px.y - ed.lastPx.y;
      if (dx * dx + dy * dy < MIN_STEP_PX * MIN_STEP_PX) return;
    }
    ed.lastPx = px || null;
    ed.points.push(e.latlng);
    ed.temp.addLatLng(e.latlng);
  }

  function round5(n) { return Math.round(n * 1e5) / 1e5; }

  // Clamp, round, drop repeats, simplify; if the stroke is still over the server limit, loosen and finally thin out.
  function buildGeometry(latlngs) {
    var size = V.size();
    if (!size) return [];
    var raw = [];
    latlngs.forEach(function (ll) {
      var p = Geo.fromLatLng(ll, size);
      var pt = [round5(p.x), round5(p.y)];
      var last = raw[raw.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) raw.push(pt);
    });
    var eps = EPSILON;
    var pts = Geo.simplify(raw, eps);
    for (var i = 0; i < 6 && pts.length > MAX_POINTS; i++) {
      eps *= 2;
      pts = Geo.simplify(raw, eps);
    }
    if (pts.length > MAX_POINTS) {
      var step = pts.length / (MAX_POINTS - 1);
      var thin = [];
      for (var k = 0; k < MAX_POINTS - 1; k++) thin.push(pts[Math.floor(k * step)]);
      thin.push(pts[pts.length - 1]);
      pts = thin;
    }
    return pts;
  }

  function finishStroke() {
    if (!ed.drawing) return;
    var temp = ed.temp;
    var latlngs = ed.points;
    ed.drawing = false;
    ed.points = [];
    ed.lastPx = null;
    ed.temp = null;
    var pid = T.planPublicId();
    var pts = buildGeometry(latlngs);
    if (pts.length < 2 || !pid || !temp) { if (temp) temp.remove(); return; }
    send({ kind: 'pencil', geometry: pts, width: ed.width, squad: ed.squad }, temp, pid);
  }

  function onUp(e) {
    var ev = (e && e.originalEvent) || e || {};
    if (ev.button === 2 || ed.pan) ed.pan = null;
    if (ev.button === undefined || ev.button === 0) finishStroke();
  }

  // ---------- arrow, zone, marker, text ----------

  function addVertex(latlng) {
    var rule = VERTEX_TOOLS[ed.tool];
    ed.verts.push(latlng);
    if (!ed.temp) {
      var style = { color: color(), weight: weight(), opacity: 0.9, interactive: false };
      ed.temp = (ed.tool === 'zone' ? L.polygon : L.polyline)([latlng], style).addTo(map);
    } else {
      ed.temp.setLatLngs(ed.verts);
    }
    if (ed.verts.length >= rule.max) finishVertices();
  }

  function finishVertices() {
    var rule = VERTEX_TOOLS[ed.tool];
    if (!rule || !ed.verts.length) return;
    if (ed.verts.length < rule.min) {
      say(ed.tool === 'zone' ? 'Зоне нужно минимум 3 точки.' : 'Стрелке нужно минимум 2 точки.');
      return;
    }
    var size = V.size();
    var pid = T.planPublicId();
    var temp = ed.temp;
    var verts = ed.verts;
    ed.verts = [];
    ed.temp = null;
    if (ed.rubber) { ed.rubber.remove(); ed.rubber = null; }
    if (!size || !pid || !temp) { if (temp) temp.remove(); return; }
    var pts = verts.map(function (ll) {
      var p = Geo.fromLatLng(ll, size);
      return [round5(p.x), round5(p.y)];
    });
    var body = { kind: ed.tool, geometry: pts, width: ed.width, squad: ed.squad };
    var label = els.label.value.trim();
    if (ed.tool === 'zone' && label) body.label = label;
    send(body, temp, pid);
  }

  function placePoint(latlng) {
    var size = V.size();
    var pid = T.planPublicId();
    if (!size || !pid) return;
    var label = els.label.value.trim();
    var p = Geo.fromLatLng(latlng, size);
    var body = { kind: ed.tool, geometry: [round5(p.x), round5(p.y)], width: ed.width, squad: ed.squad };
    if (ed.tool === 'text') {
      if (!label) { say('Введите текст в поле «Подпись».'); els.label.focus(); return; }
      body.label = label;
    } else {
      body.icon = els.icon.value;
      if (label) body.label = label;
    }
    // A quick marker stands in until the server answers and the real layer arrives.
    var temp = L.circleMarker(latlng, {
      radius: 7, color: color(), fillColor: color(), fillOpacity: 0.5, interactive: false,
    }).addTo(map);
    send(body, temp, pid);
  }

  function onClick(e) {
    if (!usable()) return;
    if (ed.tool in VERTEX_TOOLS) addVertex(e.latlng);
    else if (ed.tool === 'marker' || ed.tool === 'text') placePoint(e.latlng);
  }

  function onDblClick() {
    if (!usable() || !(ed.tool in VERTEX_TOOLS) || !ed.verts.length) return;
    // the two clicks of a double click each added a vertex in the same place: keep one
    if (ed.verts.length >= 2) {
      ed.verts.pop();
      if (ed.temp) ed.temp.setLatLngs(ed.verts);
    }
    finishVertices();
  }

  // The stroke is already on the map (temp layer); the server answer replaces it with the real one.
  function send(body, temp, pid) {
    temp.setStyle({ opacity: 0.5 });
    api.post('/api/plans/' + encodeURIComponent(pid) + '/items', body).then(function (r) {
      temp.remove();
      removePending(temp);
      if (running && T.active() && T.planPublicId() === pid) T.setItem(r.item, r.version);
      say('Сохранено');
    }, function (err) {
      if (!running) { temp.remove(); return; }
      var st = err && err.status;
      var msg = err && err.message;
      if (st === 403) {
        temp.remove();
        say('Нет права рисовать для этого отряда.');
      } else if (st === 404) {
        temp.remove();
        say('План или отряд недоступны.');
        T.refresh();
      } else if (st === 409 && msg === 'items_limit') {
        temp.remove();
        say('В плане уже 500 рисунков.');
      } else if (st === 400) {
        temp.remove();
        say('Штрих не принят сервером.');
      } else if (st === 429) {
        keepForRetry(body, temp, pid, 'Слишком часто, подождите минуту и нажмите «Повторить».');
      } else if (st === 401) {
        keepForRetry(body, temp, pid, 'Сессия истекла: войдите заново.');
      } else {
        keepForRetry(body, temp, pid, 'Нет связи.');
      }
    });
  }

  function keepForRetry(body, temp, pid, text) {
    say(text);
    pending.push({ body: body, layer: temp, pid: pid });
    renderRetry();
  }

  function removePending(layer) {
    pending = pending.filter(function (p) { return p.layer !== layer; });
    renderRetry();
  }

  function renderRetry() {
    if (!els.retry) return;
    els.retry.textContent = '';
    if (!pending.length) return;
    els.retry.appendChild(h('button', { type: 'button', onclick: function () {
      var list = pending.slice();
      pending = [];
      renderRetry();
      list.forEach(function (p) { send(p.body, p.layer, p.pid); });
    } }, 'Повторить (' + pending.length + ')'));
    els.retry.appendChild(h('button', { type: 'button', class: 'danger', onclick: function () {
      pending.forEach(function (p) { p.layer.remove(); });
      pending = [];
      renderRetry();
    } }, 'Отбросить'));
  }

  // Unsent strokes belong to the plan they were drawn in: show them only while that plan is open.
  function syncPending() {
    var cur = T.planPublicId();
    pending.forEach(function (p) {
      var on = map.hasLayer(p.layer);
      if (p.pid === cur && !on) p.layer.addTo(map);
      else if (p.pid !== cur && on) p.layer.remove();
    });
  }

  // ---------- eraser ----------

  function onLayerClick(e) {
    if (!usable() || ed.tool !== 'eraser') return;
    var target = e.target;
    if (!target || target.itemId === undefined) return;
    var id = target.itemId;
    if (erasing[id]) return;
    erasing[id] = true;
    api.del('/api/items/' + id).then(function (r) {
      delete erasing[id];
      if (running && T.active()) T.dropItem(id, r.version);
      say('Стёрто');
    }, function (err) {
      delete erasing[id];
      if (!running) return;
      var st = err && err.status;
      if (st === 403) say('Нет права стирать рисунки этого отряда.');
      else if (st === 404) { say('Рисунок уже удалён.'); T.refresh(); }
      else if (st === 429) say('Слишком часто, подождите минуту.');
      else say('Не удалось стереть: ' + ((err && err.message) || 'ошибка'));
    });
  }

  // ---------- keyboard ----------

  function onKeyDown(e) {
    if (!running || V.mode() !== 'tactics' || ed.eraserOnly) return;
    var tag = ((e.target && e.target.tagName) || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space') {
      if (!ed.spaceDown) { ed.spaceDown = true; if (ed.drawing) cancelStroke(); syncMap(); }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (ed.drawing || ed.verts.length) cancelStroke(); else if (ed.tool !== 'pencil') setTool('pencil');
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
      setTool('pencil');
    } else if (e.key === 'Enter' && ed.verts.length) {
      finishVertices();
    } else if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') {
      setTool('eraser');
    } else if (e.key === 'a' || e.key === 'A' || e.key === 'ф' || e.key === 'Ф') {
      setTool('arrow');
    } else if (e.key === 'z' || e.key === 'Z' || e.key === 'я' || e.key === 'Я') {
      setTool('zone');
    } else if (e.key === 'm' || e.key === 'M' || e.key === 'ь' || e.key === 'Ь') {
      setTool('marker');
    } else if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') {
      setTool('text');
    } else if (/^[1-9]$/.test(e.key)) {
      var s = allowedSquads()[Number(e.key) - 1];
      if (s) { ed.squad = s.id; els.squad.value = s.id === null ? '' : String(s.id); }
    }
  }

  function onKeyUp(e) {
    if (!running || e.code !== 'Space') return;
    if (ed.spaceDown) { ed.spaceDown = false; syncMap(); }
    e.preventDefault();
  }

  function onWindowUp(e) { onUp(e); }
  function onBlur() { ed.spaceDown = false; ed.pan = null; cancelStroke(); syncMap(); }
  function onContext(ev) { if (running && V.mode() === 'tactics') ev.preventDefault(); }

  // ---------- data changes ----------

  // Every redraw of the plan layer creates new polylines: re-attach the eraser click and refresh the panel.
  function onTacticsChange() {
    if (!running) return;
    var layers = T.layers();
    Object.keys(layers).forEach(function (id) {
      layers[id].off('click', onLayerClick);
      layers[id].on('click', onLayerClick);
    });
    var cur = T.planPublicId();
    if (cur !== lastPlan) { lastPlan = cur; cancelStroke(); }
    syncPending();
    fillSquads();
    updateTools();
    syncMap();
  }

  // ---------- start / stop ----------

  function start(viewer, tactics, opts) {
    if (running) stop();
    V = viewer;
    T = tactics;
    ed.eraserOnly = !!(opts && opts.eraserOnly);
    map = V.leaflet();
    if (!map || !buildPanel()) return;
    running = true;
    dblZoomWas = map.doubleClickZoom.enabled();
    ed.spaceDown = false;
    ed.pan = null;
    lastPlan = T.planPublicId();
    map.on('mousedown', onDown);
    map.on('mousemove', onMove);
    map.on('mouseup', onUp);
    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.getContainer().addEventListener('contextmenu', onContext);
    window.addEventListener('mouseup', onWindowUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    if (!changeHooked) { changeHooked = true; T.onChange(onTacticsChange); }
    fillSquads();
    setTool(ed.eraserOnly ? 'eraser' : 'pencil');
    onTacticsChange();
  }

  function stop() {
    if (!map) return;
    var was = running;
    running = false;
    cancelStroke();
    ed.spaceDown = false;
    ed.pan = null;
    map.off('mousedown', onDown);
    map.off('mousemove', onMove);
    map.off('mouseup', onUp);
    map.off('click', onClick);
    map.off('dblclick', onDblClick);
    map.getContainer().removeEventListener('contextmenu', onContext);
    window.removeEventListener('mouseup', onWindowUp);
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    map.dragging.enable();
    if (dblZoomWas) map.doubleClickZoom.enable();
    map.getContainer().classList.remove('tac-pencil');
    pending.forEach(function (p) { p.layer.remove(); });
    pending = [];
    if (els.box && els.box.parentNode) els.box.parentNode.removeChild(els.box);
    els = {};
    if (was && T && T.active()) T.setInteractive(false);
  }

  window.MapTacticsEditor = { start: start, stop: stop };
})();
