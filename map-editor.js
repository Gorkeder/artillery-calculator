(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;

  var V = null;
  var map = null;
  var ed = { tool: 'select', catId: null, selectedId: null, drawing: false };
  var els = {};
  var isAdmin = false;
  var SHAPE_LABEL = { point: 'Точка', polygon: 'Полигон', line: 'Линия' };
  var ERROR_TEXT = {
    proposals_limit: 'Слишком много предложений на модерации (не больше 10), дождитесь решений',
    drafts_limit: 'Слишком много черновиков (не больше 20), отправьте или удалите лишние',
    proposals_blocked: 'Отправка предложений для вас закрыта',
  };
  var DRAW_SHAPE = { polygon: 'Polygon', line: 'Line' };

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
        if (err.status === 401) status('Сессия истекла — обновите страницу и войдите снова', 'error');
        else if (ERROR_TEXT[err.message]) status(ERROR_TEXT[err.message], 'error');
        else status('Ошибка: ' + err.message, 'error', function () { save(fn); });
        return null;
      });
  }

  // ---------- toolbar ----------

  function openDialog(name) {
    if (window.MapEditorDialogs) window.MapEditorDialogs[name]();
    else status('Диалоги не загружены — обновите страницу', 'error');
  }

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
    if (isAdmin) {
      bar.appendChild(h('span', { class: 'ed-sep' }));
      bar.appendChild(h('button', { type: 'button', onclick: function () { openDialog('categories'); } }, 'Категории'));
      bar.appendChild(h('button', { type: 'button', onclick: function () { openDialog('maps'); } }, 'Карты'));
      els.moderationBtn = h('button', { type: 'button', onclick: function () { openDialog('moderation'); } }, 'Модерация');
      bar.appendChild(els.moderationBtn);
    }
    bar.appendChild(els.status);
    document.getElementById('ed-slot').appendChild(bar);
    els.toolbar = bar;
    updateToolbar();
  }

  function updateToolbar() {
    V.setDrawTool(ed.tool !== 'select');
    Object.keys(els.toolBtns).forEach(function (k) {
      els.toolBtns[k].classList.toggle('on', ed.tool === k);
    });
  }

  // ---------- active category ----------

  function setActiveCat(id) {
    ed.catId = id;
    markActiveCategory();
    // A drawing tool must always draw the shape of the active category.
    var c = V.catById(id);
    if (ed.tool !== 'select' && c && c.shape !== ed.tool) setTool(c.shape);
  }

  function markActiveCategory() {
    var items = document.querySelectorAll('#cats li');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', Number(items[i].getAttribute('data-id')) === ed.catId);
    }
  }

  // ---------- tools ----------

  function drawOptions(cat) {
    return {
      finishOn: 'dblclick',
      allowSelfIntersection: true,
      snappable: false,
      templineStyle: { color: cat.color },
      hintlineStyle: { color: cat.color, dashArray: [5, 5] },
      pathOptions: { color: cat.color, fillColor: cat.color, fillOpacity: 0.25 },
    };
  }

  function setTool(tool) {
    map.pm.disableDraw();
    ed.drawing = false;
    ed.tool = tool;
    if (tool !== 'select') deselect();
    map.getContainer().classList.toggle('crosshair', tool === 'point');
    if (tool !== 'select') {
      var cat = V.catById(ed.catId);
      if (!cat || cat.shape !== tool) {
        cat = V.state().categories.find(function (c) { return c.shape === tool; });
        if (!cat) {
          status('Нет категории с типом «' + SHAPE_LABEL[tool] + '». Создайте её в «Категории».', 'error');
          ed.tool = 'select';
          map.getContainer().classList.remove('crosshair');
          updateToolbar();
          return;
        }
        setActiveCat(cat.id);
      }
      if (DRAW_SHAPE[tool]) map.pm.enableDraw(DRAW_SHAPE[tool], drawOptions(cat));
    }
    updateToolbar();
  }

  function finishDraw() {
    var shape = DRAW_SHAPE[ed.tool];
    try {
      if (shape && map.pm.Draw[shape] && map.pm.Draw[shape]._finishShape) map.pm.Draw[shape]._finishShape();
    } catch (e) { /* Enter is a convenience; double click always works */ }
  }

  function createFeature(geometry) {
    var cat = V.catById(ed.catId);
    if (!cat) return;
    var mapId = V.state().map.id;
    save(function () {
      return api.post('/api/features', { map_id: mapId, category_id: cat.id, geometry: geometry, title: '' });
    }).then(function (f) {
      if (!f) return;
      V.setFeature(f, true);
      select(f.id);
    });
  }

  function onMapClick(e) {
    if (V.mode() !== 'shared') return;
    if (!V.size()) return;
    if (ed.tool === 'point') createFeature(Geo.fromLatLng(e.latlng, V.size()));
    else if (ed.tool === 'select') deselect();
  }

  function onCreate(e) {
    if (V.mode() !== 'shared') return;
    var ll = e.layer.getLatLngs();
    var ring = Array.isArray(ll[0]) ? ll[0] : ll;
    var points = Geo.latLngsToPoints(ring, V.size());
    e.layer.remove();
    setTool('select');
    createFeature({ points: points });
  }

  // ---------- selection and geometry editing ----------

  function onFeatureClick(id, e) {
    if (V.mode() !== 'shared') return V.defaultClick(id, e);
    // A user may only select their own unpublished objects; everything else opens its card.
    var f = V.featureById(id);
    if (!isAdmin && !(f && f.mine && f.status === 'pending')) return V.defaultClick(id, e);
    if (ed.drawing || ed.tool === 'point') return false;
    if (ed.tool === 'select') { select(id); return true; }
    return false;
  }

  function highlight(id, on) {
    var layer = V.layers()[id];
    if (!layer) return;
    if (layer instanceof L.Marker) {
      var el = layer.getElement();
      if (el) {
        var mk = el.querySelector('.mk');
        if (mk) mk.classList.toggle('sel', on);
      }
    } else {
      layer.setStyle({ weight: on ? 4 : (layer instanceof L.Polygon ? 2 : 3) });
    }
  }

  function enableEdit(layer) {
    if (layer.pm) layer.pm.enable({ allowSelfIntersection: true });
  }

  function select(id) {
    deselect(true);
    var layer = V.layers()[id];
    var f = V.featureById(id);
    if (!layer || !f) return;
    ed.selectedId = id;
    if (!isLocked(f)) enableEdit(layer);
    highlight(id, true);
    showProps(f);
    map.invalidateSize({ pan: false });
  }

  function deselect(keepPanel) {
    if (ed.selectedId !== null) {
      var layer = V.layers()[ed.selectedId];
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
    save(function () { return api.patch('/api/features/' + id, { geometry: geometry }); }).then(function (f) {
      if (f) V.setFeature(f, false); // geometry only: keep the live layer so vertex editing is not interrupted
    });
  }

  function attachLayer(layer, feature) {
    var isMarker = layer instanceof L.Marker;
    layer.on(isMarker ? 'pm:dragend' : 'pm:edit', function () { saveGeometry(feature.id, layer); });
  }

  // ---------- properties panel ----------

  function buildProps() {
    els.title = h('input', { type: 'text', maxLength: 120, placeholder: 'Название' });
    els.desc = h('textarea', { rows: 6, maxLength: 4000, placeholder: 'Описание' });
    els.cat = h('select');
    els.color = h('input', { type: 'color' });
    els.colorReset = h('button', { type: 'button' }, 'Как у категории');
    els.opacity = h('input', { type: 'range', min: 0, max: 1, step: 0.05 });
    els.opacityRow = h('div', null, h('label', null, 'Прозрачность заливки'), els.opacity);
    els.photos = h('div', { class: 'ed-photos' });
    els.colorLabel = h('label', null, 'Цвет');
    els.colorRow = h('div', { class: 'row' }, els.color, els.colorReset);
    els.photosLabel = h('label', null, 'Фото');
    els.note = h('p', { class: 'hint' });
    // A user's object is a draft until the author sends it to moderation; a sent one can be withdrawn.
    els.submit = h('button', { type: 'button', class: 'primary', onclick: function () { sendLifecycle('submit'); } },
      'Отправить на модерацию');
    els.withdraw = h('button', { type: 'button', onclick: function () { sendLifecycle('withdraw'); } }, 'Отозвать');
    els.lifecycle = h('div', { class: 'row' }, els.submit, els.withdraw);
    els.lifecycle.hidden = isAdmin;
    els.panel = h('aside', { class: 'ed-props', hidden: true },
      h('h2', null, 'Объект'),
      els.note,
      els.lifecycle,
      h('label', null, 'Название'), els.title,
      h('label', null, 'Категория'), els.cat,
      h('label', null, 'Описание'), els.desc,
      els.colorLabel, els.colorRow,
      els.opacityRow,
      els.photosLabel, els.photos,
      h('p', null, h('button', { type: 'button', class: 'danger', onclick: deleteSelected }, 'Удалить объект')));
    if (!isAdmin) {
      // Appearance and photos are the admin's call; a proposal is a position, a category and a text.
      [els.colorLabel, els.colorRow, els.opacityRow, els.photosLabel, els.photos].forEach(function (el) { el.hidden = true; });
    }
    document.getElementById('props-slot').appendChild(els.panel);

    els.title.addEventListener('change', function () { patch({ title: els.title.value }); });
    els.desc.addEventListener('change', function () { patch({ description: els.desc.value }); });
    els.cat.addEventListener('change', function () { patch({ category_id: Number(els.cat.value) }); });
    els.color.addEventListener('change', function () { patch({ color: els.color.value }); });
    els.colorReset.addEventListener('click', function () { patch({ color: null }); });
    els.opacity.addEventListener('change', function () { patch({ opacity: Number(els.opacity.value) }); });
  }

  // A rejected proposal of a non-admin cannot be edited any more (the server answers 404).
  function isLocked(f) {
    return !isAdmin && f.status === 'pending' && (!!f.reject_reason || !!f.submitted);
  }

  function showProps(f) {
    var cat = V.catById(f.category_id);
    // Never overwrite the field the admin is typing in: a save finishing for another
    // field re-renders the panel, and that must not wipe in-progress text.
    function put(el, value) { if (document.activeElement !== el) el.value = value; }
    els.panel.hidden = false;
    put(els.title, f.title || '');
    put(els.desc, f.description || '');
    if (document.activeElement !== els.cat) {
      els.cat.textContent = '';
      V.state().categories.forEach(function (c) {
        if (c.shape === cat.shape) els.cat.appendChild(h('option', { value: c.id, selected: c.id === f.category_id }, c.name));
      });
    }
    put(els.color, f.color || cat.color);
    put(els.opacity, f.opacity === null ? 0.25 : f.opacity);
    if (isAdmin) {
      els.opacityRow.hidden = cat.shape !== 'polygon';
      els.colorReset.hidden = f.color === null;
      if (window.MapEditor.renderPhotos) window.MapEditor.renderPhotos(f);
    }
    // A user's own proposal: show where it stands; a rejected one can only be deleted.
    var locked = isLocked(f);
    els.title.disabled = locked;
    els.desc.disabled = locked;
    els.cat.disabled = locked;
    els.note.hidden = isAdmin || f.status !== 'pending';
    els.note.textContent = f.reject_reason ? 'Отклонено: ' + f.reject_reason
      : (f.submitted ? 'На модерации' : 'Черновик: ещё не отправлен на модерацию');
    var openProposal = f.status === 'pending' && !f.reject_reason;
    els.submit.hidden = !(openProposal && !f.submitted);
    els.withdraw.hidden = !(openProposal && f.submitted);
  }

  // 'submit' sends a draft to moderation, 'withdraw' turns a waiting proposal back into a draft.
  function sendLifecycle(action) {
    var id = ed.selectedId;
    if (id === null) return;
    save(function () { return api.post('/api/features/' + id + '/' + action, {}); }).then(function (f) {
      if (!f) return;
      V.setFeature(f, true);
      if (ed.selectedId === id) select(id);
    });
  }

  function patch(fields) {
    var id = ed.selectedId;
    if (id === null) return;
    save(function () { return api.patch('/api/features/' + id, fields); }).then(function (f) {
      if (!f) return;
      V.setFeature(f, true);
      if (ed.selectedId === id) select(id); // re-enable editing on the re-created layer, refresh the panel
    });
  }

  function deleteSelected() {
    var id = ed.selectedId;
    if (id === null) return;
    var f = V.featureById(id);
    if (!window.confirm('Удалить объект «' + (f.title || 'без названия') + '»?')) return;
    deselect();
    save(function () { return api.del('/api/features/' + id); }).then(function (r) {
      if (r) V.dropFeature(id);
    });
  }

  // ---------- photos ----------

  function resizeImage(file, maxSide) {
    return createImageBitmap(file).catch(function () {
      throw new Error('не удалось прочитать изображение');
    }).then(function (bmp) {
      var k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * k));
      var hgt = Math.max(1, Math.round(bmp.height * k));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hgt;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, hgt);
      ctx.drawImage(bmp, 0, 0, w, hgt);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('не удалось сжать изображение'));
        }, 'image/jpeg', 0.85);
      });
    });
  }

  function addPhotos(featureId, files) {
    files.reduce(function (chain, file) {
      return chain.then(function () {
        return save(function () {
          return resizeImage(file, 1600).then(function (blob) {
            return api.upload('PUT', '/api/features/' + featureId + '/images', blob);
          });
        }).then(function (img) {
          if (!img) return;
          var f = V.featureById(featureId);
          if (!f) return;
          f.images = f.images.concat([img]);
          V.setFeature(f, false);
          if (ed.selectedId === featureId) renderPhotos(f);
        });
      });
    }, Promise.resolve());
  }

  function removePhoto(featureId, imageId) {
    save(function () { return api.del('/api/feature-images/' + imageId); }).then(function (r) {
      if (!r) return;
      var f = V.featureById(featureId);
      if (!f) return;
      f.images = f.images.filter(function (i) { return i.id !== imageId; });
      V.setFeature(f, false);
      if (ed.selectedId === featureId) renderPhotos(f);
    });
  }

  function renderPhotos(f) {
    els.photos.textContent = '';
    f.images.forEach(function (img) {
      els.photos.appendChild(h('div', { class: 'ph' },
        h('img', { src: img.url, alt: '' }),
        h('button', { type: 'button', title: 'Удалить фото', onclick: function () { removePhoto(f.id, img.id); } }, '×')));
    });
    if (f.images.length < 10) {
      var input = h('input', {
        type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true,
        onchange: function () { addPhotos(f.id, Array.prototype.slice.call(input.files)); input.value = ''; },
      });
      els.photos.appendChild(input);
      els.photos.appendChild(h('button', { type: 'button', onclick: function () { input.click(); } }, '+ Фото'));
    }
  }

  // ---------- keyboard ----------

  function onKey(e) {
    if (V.mode() !== 'shared') return;
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

  function start(viewer) {
    V = viewer;
    map = V.leaflet();
    isAdmin = !!V.state().me.can.feature;
    document.body.classList.add('editing');
    buildToolbar();
    buildProps();

    V.hooks.onLayer = attachLayer;
    V.hooks.afterCategories = markActiveCategory;
    V.hooks.afterLoad = function () {
      deselect();
      var cats = V.state().categories;
      ed.catId = cats.length ? cats[0].id : null;
      markActiveCategory();
    };
    V.setClickHandler(onFeatureClick);

    document.getElementById('cats').addEventListener('click', function (e) {
      if (e.target.tagName === 'INPUT') return;
      var li = e.target.closest('li');
      if (li) setActiveCat(Number(li.getAttribute('data-id')));
    });
    map.on('click', onMapClick);
    map.on('pm:create', onCreate);
    map.on('pm:drawstart', function () { ed.drawing = true; });
    map.on('pm:drawend', function () { ed.drawing = false; });
    document.addEventListener('keydown', onKey);
    refreshModeration();

    // Layers created before Geoman was loaded have no `pm`; rebuild them.
    V.renderAll();
    V.renderCategories();
    var cats = V.state().categories;
    if (cats.length && ed.catId === null) setActiveCat(cats[0].id);
    status('Режим редактора', '');
  }

  // The admin switches between shared objects and personal marks: the inactive editor hides.
  function setActive(on) {
    els.toolbar.hidden = !on;
    if (!on) {
      setTool('select');
      deselect();
    }
  }

  function setModerationCount(n) {
    if (els.moderationBtn) els.moderationBtn.textContent = 'Модерация' + (n ? ' (' + n + ')' : '');
  }

  function refreshModeration() {
    if (!isAdmin) return;
    api.get('/api/moderation').then(function (d) {
      setModerationCount(d.proposals.length + d.flagged.length + d.reports.length);
    }, function () { /* the badge is a convenience */ });
  }

  window.MapEditor = {
    start: start,
    setActive: setActive,
    setModerationCount: setModerationCount,
    status: status,
    renderPhotos: renderPhotos,
    save: save,
    selectedFeature: function () { return ed.selectedId === null ? null : V.featureById(ed.selectedId); },
    reselect: function () { if (ed.selectedId !== null) select(ed.selectedId); },
  };
})();
