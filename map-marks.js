(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;

  var V = null;
  var marks = [];
  var layers = {};
  var group = null;
  var visible = true;
  var clickHandler = null;
  var hooks = { onLayer: null };
  var els = {};

  function byId(id) {
    return marks.find(function (m) { return m.id === id; }) || null;
  }

  // ---------- layers ----------

  function markerIcon(m) {
    var el = h('div', { class: 'mk' }, V.svgIcon(m.icon));
    el.style.setProperty('--c', m.color);
    return L.divIcon({ html: el, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] });
  }

  function makeLayer(m) {
    var size = V.size();
    if (!size) return null;
    var layer;
    if (m.shape === 'point') {
      layer = L.marker(Geo.toLatLng(m.geometry, size), { icon: markerIcon(m), title: m.title || 'Моя метка', keyboard: false });
    } else if (m.shape === 'polygon') {
      layer = L.polygon(Geo.pointsToLatLngs(m.geometry.points, size),
        { color: m.color, fillColor: m.color, fillOpacity: 0.25, weight: 2 });
    } else {
      layer = L.polyline(Geo.pointsToLatLngs(m.geometry.points, size), { color: m.color, weight: 3 });
    }
    layer.markId = m.id;
    layer.on('click', function (e) {
      var consumed = clickHandler ? clickHandler(m.id, e) : open(m.id, e.latlng);
      if (consumed !== false) L.DomEvent.stopPropagation(e);
    });
    return layer;
  }

  function addLayer(m) {
    var layer = makeLayer(m);
    if (!layer) return;
    if (hooks.onLayer) hooks.onLayer(layer, m);
    layers[m.id] = layer;
    if (group) group.addLayer(layer);
  }

  function removeLayer(id) {
    var layer = layers[id];
    if (!layer) return;
    if (group) group.removeLayer(layer);
    layer.remove();
    delete layers[id];
  }

  function syncVisibility() {
    if (!group) return;
    if (visible) group.addTo(V.leaflet()); else group.remove();
    els.checkbox.checked = visible;
  }

  function updateCount() {
    els.count.textContent = String(marks.length);
  }

  function render() {
    if (group) group.remove();
    group = null;
    layers = {};
    if (!V.size()) { updateCount(); return; }
    group = L.layerGroup();
    marks.forEach(addLayer);
    syncVisibility();
    updateCount();
  }

  // ---------- card ----------

  function cardNode(m) {
    return h('div', { class: 'card' },
      h('h3', null, m.title || 'Моя метка'),
      h('div', { class: 'card-cat' }, 'Личная метка'),
      m.description ? h('p', { class: 'card-text' }, m.description) : null);
  }

  function open(id, latlng) {
    var m = byId(id);
    var layer = layers[id];
    if (!m || !layer) return true;
    V.closeCard(true);
    V.state().openMark = id;
    var isPoint = !!layer.getLatLng;
    var at = isPoint ? layer.getLatLng() : (latlng || layer.getBounds().getCenter());
    V.showCard(cardNode(m), at, isPoint ? -14 : 0);
    V.updateUrl();
    return true;
  }

  function focus(id) {
    var layer = layers[id];
    if (!layer) return;
    show();
    var leaflet = V.leaflet();
    if (layer.getLatLng) leaflet.flyTo(layer.getLatLng(), Math.max(leaflet.getZoom(), 1), { duration: 0.6 });
    else leaflet.flyToBounds(layer.getBounds(), { maxZoom: 2, duration: 0.6 });
    open(id);
  }

  // ---------- data ----------

  function show() {
    visible = true;
    syncVisibility();
  }

  function setMark(m) {
    var i = marks.findIndex(function (x) { return x.id === m.id; });
    if (i < 0) marks.push(m); else marks[i] = m;
    removeLayer(m.id);
    addLayer(m);
    updateCount();
    if (V.state().openMark === m.id) open(m.id);
  }

  function dropMark(id) {
    removeLayer(id);
    marks = marks.filter(function (m) { return m.id !== id; });
    updateCount();
    if (V.state().openMark === id) V.closeCard();
  }

  function load() {
    var map = V.state().map;
    marks = [];
    render();
    // The server only keeps marks on published maps (an admin may open a draft).
    if (!map || !map.published) return Promise.resolve();
    var slug = map.slug;
    return api.get('/api/my/marks?map=' + encodeURIComponent(slug)).then(function (list) {
      var current = V.state().map;
      if (!current || current.slug !== slug) return; // the user already switched to another map
      marks = list;
      render();
      var wanted = V.state().wantedMark;
      if (wanted !== null) {
        V.state().wantedMark = null; // a shared link is honoured once
        if (byId(wanted)) focus(wanted);
      }
    }).catch(function () {
      V.notice('Не удалось загрузить личные метки.');
    });
  }

  // ---------- start ----------

  function start(viewer) {
    V = viewer;
    els.checkbox = h('input', {
      type: 'checkbox', checked: true,
      onchange: function () { visible = els.checkbox.checked; syncVisibility(); },
    });
    els.count = h('span', { class: 'cat-n' }, '0');
    var slot = document.getElementById('marks-slot');
    slot.textContent = '';
    slot.appendChild(h('div', { class: 'cats-head' }, h('span', null, 'Личное')));
    slot.appendChild(h('label', { class: 'marks-row' },
      els.checkbox,
      h('span', { class: 'cat-name' }, 'Мои метки'),
      els.count));
    V.onMapLoaded(function () { load(); });
    return load();
  }

  window.MapMarks = {
    start: start,
    list: function () { return marks; },
    byId: byId,
    layers: function () { return layers; },
    hooks: hooks,
    setClickHandler: function (fn) { clickHandler = fn || null; },
    setMark: setMark,
    dropMark: dropMark,
    available: function () { var m = V.state().map; return !!(m && m.published); },
    open: open,
    focus: focus,
    show: show,
  };
})();
