(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;
  var ICONS = window.MAP_ICONS;

  var state = {
    me: { user: null, can: {} },
    maps: [],
    map: null,
    size: null,
    categories: [],
    features: [],
    hidden: {},
    groups: {},
    layers: {},
    openId: null,
  };
  var hooks = { onLayer: null, afterCategories: null, afterLoad: null };
  var leaflet = null;
  var overlay = null;
  var clickHandler = defaultClick;
  var narrow = window.matchMedia('(max-width: 720px)');

  function $(id) { return document.getElementById(id); }
  function catById(id) { return state.categories.find(function (c) { return c.id === id; }); }
  function featureById(id) { return state.features.find(function (f) { return f.id === id; }); }

  function svgIcon(id) {
    var def = Object.prototype.hasOwnProperty.call(ICONS, id) ? ICONS[id] : ICONS.question;
    var wrap = document.createElement('span');
    wrap.className = 'ico';
    // def.svg is static markup from map-icons.js, never user input
    wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + def.svg + '</svg>';
    return wrap;
  }

  function notice(text) {
    var el = $('notice');
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    el.hidden = false;
  }

  // ---------- layers ----------

  function markerIcon(feature, cat) {
    var el = h('div', { class: 'mk' }, svgIcon(cat.icon));
    el.style.setProperty('--c', feature.color || cat.color);
    return L.divIcon({ html: el, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] });
  }

  function makeLayer(feature) {
    var cat = catById(feature.category_id);
    if (!cat || !state.size) return null;
    var size = state.size;
    var style = Geo.featureStyle(feature, cat);
    var layer;
    if (cat.shape === 'point') {
      layer = L.marker(Geo.toLatLng(feature.geometry, size), {
        icon: markerIcon(feature, cat), title: feature.title || cat.name, keyboard: false,
      });
    } else if (cat.shape === 'polygon') {
      layer = L.polygon(Geo.pointsToLatLngs(feature.geometry.points, size), style);
    } else {
      layer = L.polyline(Geo.pointsToLatLngs(feature.geometry.points, size), { color: style.color, weight: 3 });
    }
    layer.featureId = feature.id;
    layer.on('click', function (e) {
      var consumed = clickHandler(feature.id, e);
      if (consumed !== false) L.DomEvent.stopPropagation(e);
    });
    return layer;
  }

  function defaultClick(id, e) {
    openFeature(id, e && e.latlng);
    return true;
  }

  function addFeatureLayer(feature) {
    var layer = makeLayer(feature);
    if (!layer) return;
    if (hooks.onLayer) hooks.onLayer(layer, feature);
    state.layers[feature.id] = layer;
    if (state.groups[feature.category_id]) state.groups[feature.category_id].addLayer(layer);
  }

  function removeLayer(id) {
    var layer = state.layers[id];
    if (!layer) return;
    Object.keys(state.groups).forEach(function (k) { state.groups[k].removeLayer(layer); });
    layer.remove();
    delete state.layers[id];
  }

  function clearLayers() {
    Object.keys(state.groups).forEach(function (k) { state.groups[k].remove(); });
    state.groups = {};
    state.layers = {};
  }

  function syncVisibility() {
    state.categories.forEach(function (c) {
      var g = state.groups[c.id];
      if (!g) return;
      if (state.hidden[c.id]) g.remove(); else g.addTo(leaflet);
    });
  }

  function renderAll() {
    clearLayers();
    if (!state.size) return;
    state.categories.forEach(function (c) { state.groups[c.id] = L.layerGroup(); });
    state.features.forEach(addFeatureLayer);
    syncVisibility();
  }

  // ---------- category list / search ----------

  function renderCategories() {
    var ul = $('cats');
    ul.textContent = '';
    state.categories.forEach(function (c) {
      var count = state.features.filter(function (f) { return f.category_id === c.id; }).length;
      var cb = h('input', {
        type: 'checkbox', checked: !state.hidden[c.id],
        onchange: function () { state.hidden[c.id] = !cb.checked; syncVisibility(); },
      });
      ul.appendChild(h('li', { 'data-id': c.id },
        cb,
        h('span', { style: 'color:' + c.color }, svgIcon(c.icon)),
        h('span', { class: 'cat-name' }, c.name),
        h('span', { class: 'cat-n' }, String(count))));
    });
    if (hooks.afterCategories) hooks.afterCategories();
  }

  function setupSearch() {
    var input = $('search');
    var out = $('search-results');
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      out.textContent = '';
      if (!q) return;
      state.features
        .filter(function (f) { return (f.title || '').toLowerCase().indexOf(q) >= 0; })
        .slice(0, 8)
        .forEach(function (f) {
          out.appendChild(h('li', null, h('button', {
            type: 'button', onclick: function () { focusFeature(f.id); },
          }, f.title)));
        });
    });
    $('show-all').addEventListener('click', function () { state.hidden = {}; syncVisibility(); renderCategories(); });
    $('hide-all').addEventListener('click', function () {
      state.categories.forEach(function (c) { state.hidden[c.id] = true; });
      syncVisibility();
      renderCategories();
    });
  }

  // ---------- card ----------

  function cardNode(feature) {
    var cat = catById(feature.category_id);
    return h('div', { class: 'card' },
      h('h3', null, feature.title || (cat ? cat.name : '')),
      h('div', { class: 'card-cat' }, cat ? cat.name : ''),
      feature.description ? h('p', { class: 'card-text' }, feature.description) : null,
      feature.images.length ? h('div', { class: 'card-photos' }, feature.images.map(function (img) {
        return h('a', { href: img.url, target: '_blank', rel: 'noopener' },
          h('img', { src: img.url, loading: 'lazy', alt: '' }));
      })) : null);
  }

  function updateUrl() {
    var q = new URLSearchParams();
    if (state.map) q.set('m', state.map.slug);
    if (state.openId !== null && state.openId !== undefined) q.set('f', String(state.openId));
    var s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }

  function closeCard(silent) {
    state.openId = null;
    if (leaflet) leaflet.closePopup();
    $('sheet').hidden = true;
    if (!silent) updateUrl();
  }

  function openFeature(id, latlng) {
    var f = featureById(id);
    var layer = state.layers[id];
    if (!f || !layer) return;
    closeCard(true);
    state.openId = id;
    var node = cardNode(f);
    if (narrow.matches) {
      var sheet = $('sheet');
      sheet.textContent = '';
      sheet.appendChild(h('button', { class: 'card-x', type: 'button', 'aria-label': 'Закрыть', onclick: function () { closeCard(); } }, '×'));
      sheet.appendChild(node);
      sheet.hidden = false;
    } else {
      var isPoint = !!layer.getLatLng;
      var at = isPoint ? layer.getLatLng() : (latlng || layer.getBounds().getCenter());
      L.popup({ className: 'card-popup', minWidth: 260, maxWidth: 320, offset: isPoint ? [0, -14] : [0, 0], autoPanPadding: [40, 40] })
        .setLatLng(at).setContent(node).openOn(leaflet);
    }
    updateUrl();
  }

  function focusFeature(id) {
    var f = featureById(id);
    var layer = state.layers[id];
    if (!f || !layer) return;
    if (state.hidden[f.category_id]) {
      state.hidden[f.category_id] = false;
      syncVisibility();
      renderCategories();
    }
    if (layer.getLatLng) leaflet.flyTo(layer.getLatLng(), Math.max(leaflet.getZoom(), 1), { duration: 0.6 });
    else leaflet.flyToBounds(layer.getBounds(), { maxZoom: 2, duration: 0.6 });
    openFeature(id);
  }

  // ---------- data mutation helpers (used by the editor) ----------

  function setFeature(f, rerender) {
    var i = state.features.findIndex(function (x) { return x.id === f.id; });
    var isNew = i < 0;
    if (isNew) state.features.push(f); else state.features[i] = f;
    if (rerender === false && !isNew && state.layers[f.id]) return;
    removeLayer(f.id);
    addFeatureLayer(f);
    renderCategories();
    if (state.openId === f.id) openFeature(f.id);
  }

  function dropFeature(id) {
    removeLayer(id);
    state.features = state.features.filter(function (f) { return f.id !== id; });
    if (state.openId === id) closeCard();
    renderCategories();
  }

  function setCategory(c) {
    var i = state.categories.findIndex(function (x) { return x.id === c.id; });
    if (i < 0) state.categories.push(c); else state.categories[i] = c;
    renderAll();
    renderCategories();
  }

  // ---------- maps ----------

  function fillMapSelect() {
    var sel = $('map-select');
    sel.textContent = '';
    state.maps.forEach(function (m) {
      sel.appendChild(h('option', { value: m.slug, selected: !!state.map && state.map.slug === m.slug },
        m.title + (m.published ? '' : ' (черновик)')));
    });
    sel.hidden = state.maps.length === 0;
  }

  function reloadMaps() {
    return api.get('/api/maps').then(function (maps) {
      state.maps = maps;
      fillMapSelect();
    });
  }

  function loadMap(slug, opts) {
    opts = opts || {};
    return api.get('/api/maps/' + encodeURIComponent(slug)).then(function (data) {
      state.map = data.map;
      state.categories = data.categories;
      state.features = data.features;
      state.hidden = {};
      data.categories.forEach(function (c) { if (!c.visible_default) state.hidden[c.id] = true; });
      closeCard(true);
      if (overlay) { overlay.remove(); overlay = null; }
      clearLayers();
      notice(null);
      if (data.map.image_url && data.map.width && data.map.height) {
        state.size = { width: data.map.width, height: data.map.height };
        var bounds = [[0, 0], [state.size.height, state.size.width]];
        overlay = L.imageOverlay(data.map.image_url, bounds).addTo(leaflet);
        leaflet.setMaxBounds(L.latLngBounds(bounds).pad(0.5));
        if (!opts.keepView) leaflet.fitBounds(bounds);
        renderAll();
      } else {
        state.size = null;
        notice('У этой карты ещё нет изображения.');
      }
      renderCategories();
      fillMapSelect();
      updateUrl();
      if (hooks.afterLoad) hooks.afterLoad();
    });
  }

  // ---------- auth UI / editor loading ----------

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function optionalScript(src) {
    return loadScript(src).catch(function () { /* added in a later task; tolerated */ });
  }

  function startEditor() {
    return loadScript('/vendor/geoman/leaflet-geoman.min.js')
      .then(function () { return loadScript('/map-editor.js'); })
      .then(function () { return optionalScript('/map-editor-dialogs.js'); })
      .then(function () { window.MapEditor.start(window.MapViewer); });
  }

  function setupAuth() {
    var btn = $('auth-btn');
    var dlg = $('login-dlg');
    var user = state.me.user;
    btn.hidden = false;
    btn.textContent = user ? 'Выйти (' + user.login + ')' : '🔒';
    btn.title = user ? 'Выйти' : 'Вход для редакторов';
    btn.addEventListener('click', function () {
      if (user) api.post('/api/logout', {}).then(function () { location.reload(); });
      else dlg.showModal();
    });
    $('login-cancel').addEventListener('click', function () { dlg.close(); });
    $('login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var err = $('login-err');
      err.hidden = true;
      api.post('/api/login', { login: form.login.value, password: form.password.value })
        .then(function () { location.reload(); })
        .catch(function (ex) {
          err.textContent = ex.status === 429 ? 'Слишком много попыток, подождите.' : 'Неверный логин или пароль.';
          err.hidden = false;
        });
    });
  }

  // ---------- init ----------

  function init() {
    leaflet = L.map('map', {
      crs: L.CRS.Simple, minZoom: -5, maxZoom: 3, zoomSnap: 0.25, zoomDelta: 0.5,
      attributionControl: false, zoomControl: true,
    });
    leaflet.on('popupclose', function () {
      if (state.openId !== null) { state.openId = null; updateUrl(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCard(); });
    $('map-select').addEventListener('change', function (e) { loadMap(e.target.value); });
    $('layers-btn').addEventListener('click', function () { $('side').classList.toggle('open'); });
    setupSearch();

    return api.get('/api/me')
      .then(function (me) { state.me = me; })
      .catch(function () { /* stay anonymous */ })
      .then(function () { setupAuth(); return reloadMaps(); })
      .then(function () {
        var q = new URLSearchParams(location.search);
        var wanted = q.get('m');
        var slug = state.maps.some(function (m) { return m.slug === wanted; }) ? wanted : (state.maps[0] && state.maps[0].slug);
        if (!slug) {
          notice(state.me.can.map ? 'Карт пока нет. Нажмите «Карты» и добавьте первую.' : 'Карт пока нет.');
          return null;
        }
        return loadMap(slug).then(function () {
          var f = Number(q.get('f'));
          if (f && featureById(f)) focusFeature(f);
        });
      })
      .catch(function () { notice('Не удалось загрузить карту. Обновите страницу.'); })
      .then(function () {
        if (state.me.can.feature && window.matchMedia('(min-width: 900px)').matches) {
          return startEditor().catch(function () { notice('Не удалось загрузить редактор.'); });
        }
        return null;
      });
  }

  window.MapViewer = {
    hooks: hooks,
    state: function () { return state; },
    leaflet: function () { return leaflet; },
    layers: function () { return state.layers; },
    size: function () { return state.size; },
    featureById: featureById,
    catById: catById,
    renderAll: renderAll,
    renderCategories: renderCategories,
    setFeature: setFeature,
    dropFeature: dropFeature,
    setCategory: setCategory,
    loadMap: loadMap,
    reloadMaps: reloadMaps,
    openFeature: openFeature,
    closeCard: closeCard,
    focusFeature: focusFeature,
    notice: notice,
    setClickHandler: function (fn) { clickHandler = fn || defaultClick; },
  };

  init();
})();
