(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;

  var POLL_MS = 15000;
  var SHARED_COLOR = '#e9e6d8';
  var V = null;
  var S = {
    on: false, clan: null, plans: [], plan: null, items: [], etag: null,
    hiddenSquads: {}, onlyMine: false, updatedAt: 0, online: true,
  };
  var layers = {};
  var group = null;
  var timer = null;
  var clock = null;
  var interactive = false;
  var listeners = [];
  var els = {};

  function squadById(id) {
    return S.clan && S.clan.squads.find(function (s) { return s.id === id; }) || null;
  }
  function mySquadIds() {
    var me = S.clan && S.clan.members.find(function (m) { return m.id === S.clan.me.id; });
    return me ? me.squads : [];
  }
  function colorOf(item) {
    var sq = item.squad_id === null ? null : squadById(item.squad_id);
    return sq ? sq.color : SHARED_COLOR;
  }
  function hasPerm(name) { return !!S.clan && (S.clan.me.isOwner || S.clan.me.perms.indexOf(name) >= 0); }
  function emit() { listeners.forEach(function (fn) { fn(); }); }

  // ---------- drawing layer ----------

  function visible(item) {
    var key = item.squad_id === null ? 'shared' : String(item.squad_id);
    if (S.hiddenSquads[key]) return false;
    if (S.onlyMine && item.squad_id !== null && mySquadIds().indexOf(item.squad_id) < 0) return false;
    return true;
  }

  function weightOf(width) { return 2 + 2 * (width - 1); }

  function makeLayer(item) {
    var size = V.size();
    if (!size) return null;
    // Stage 3 adds the other kinds here; an unknown kind from a newer server is skipped, not fatal.
    if (item.kind !== 'pencil') return null;
    var layer = L.polyline(Geo.pointsToLatLngs(item.geometry, size), {
      color: colorOf(item), weight: weightOf(item.width), opacity: 0.9, lineCap: 'round', lineJoin: 'round',
      interactive: interactive, bubblingMouseEvents: false,
    });
    layer.itemId = item.id;
    return layer;
  }

  function render() {
    if (group) group.remove();
    group = null;
    layers = {};
    if (!S.on || !V.size()) return;
    group = L.layerGroup();
    S.items.forEach(function (it) {
      if (!visible(it)) return;
      var layer = makeLayer(it);
      if (!layer) return;
      layers[it.id] = layer;
      group.addLayer(layer);
    });
    group.addTo(V.leaflet());
    emit();
  }

  function setInteractive(on) {
    interactive = !!on;
    render();
  }

  // ---------- network ----------

  function planUrl() { return '/api/plans/' + encodeURIComponent(S.plan.id); }

  function applyPlanBody(body, etag) {
    S.plan = body.plan;
    S.items = body.items;
    S.etag = etag || '"v' + body.plan.version + '"';
    S.updatedAt = Date.now();
    S.online = true;
    render();
    updatePanel();
  }

  function lostAccess(message) {
    stop(true);
    V.notice(message);
    document.body.dispatchEvent(new CustomEvent('tactics:closed'));
  }

  function poll() {
    if (!S.on || !S.plan || document.hidden) return Promise.resolve();
    var id = S.plan.id;
    return api.getConditional(planUrl(), S.etag).then(function (r) {
      if (!S.on || !S.plan || S.plan.id !== id) return;
      S.online = true;
      S.updatedAt = Date.now();
      if (r.status === 200) applyPlanBody(r.data, r.etag);
      else updatePanel();
    }, function (err) {
      if (err.status === 404 || err.status === 403) {
        // The plan was deleted, or the member lost access: re-read what the clan still offers.
        return reloadClan().then(function () {
          if (!S.clan || !hasPerm('tactics_view')) return lostAccess('Доступ к тактике закрыт.');
          V.notice('План удалён.');
          return loadPlans();
        });
      }
      S.online = false;
      updatePanel();
    });
  }

  function reloadClan() {
    return api.get('/api/my/clan').then(function (body) { S.clan = body.clan ? body : null; }, function () { S.clan = null; });
  }

  function loadPlans(wantedPlan) {
    var map = V.state().map;
    if (!map || !map.published) {
      S.plans = [];
      S.plan = null;
      S.items = [];
      render();
      updatePanel();
      return Promise.resolve();
    }
    return api.get('/api/clans/' + S.clan.clan.id + '/plans?map=' + encodeURIComponent(map.slug)).then(function (plans) {
      S.plans = plans;
      var pick = (wantedPlan && plans.find(function (p) { return p.id === wantedPlan; })) ||
        plans.find(function (p) { return p.active; }) || plans[0] || null;
      if (!pick) {
        S.plan = null;
        S.items = [];
        S.etag = null;
        render();
        updatePanel();
        return null;
      }
      return openPlan(pick.id);
    });
  }

  function openPlan(publicId) {
    return api.get('/api/plans/' + encodeURIComponent(publicId)).then(function (body) {
      applyPlanBody(body, '"v' + body.plan.version + '"');
      updateUrl();
    }, function (err) {
      if (err.status === 404 || err.status === 403) return loadPlans();
      V.notice('Не удалось загрузить план.');
      return null;
    });
  }

  function updateUrl() {
    var q = new URLSearchParams(location.search);
    if (S.on) {
      q.set('tactics', '1');
      if (S.plan) q.set('plan', S.plan.id); else q.delete('plan');
    } else {
      q.delete('tactics');
      q.delete('plan');
    }
    var s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }

  // ---------- panel ----------

  function buildPanel() {
    els.title = h('select', { 'aria-label': 'План', onchange: function () { openPlan(els.title.value); } });
    els.state = h('span', { class: 'tac-state' });
    els.squads = h('ul', { class: 'tac-squads' });
    els.empty = h('p', { class: 'hint', hidden: true }, 'Для этой карты у клана нет планов.');
    els.create = h('button', { type: 'button', class: 'primary', hidden: true, onclick: createPlan }, 'Создать план');
    els.rename = h('button', { type: 'button', hidden: true, onclick: renamePlan }, 'Переименовать');
    els.activate = h('button', { type: 'button', hidden: true, onclick: activatePlan }, 'Сделать активным');
    els.del = h('button', { type: 'button', class: 'danger', hidden: true, onclick: deletePlan }, 'Удалить');
    els.panel = h('aside', { id: 'tac-panel', class: 'tac-panel', hidden: true },
      h('div', { class: 'tac-head' }, h('strong', null, 'Тактика'), h('span', { class: 'grow' }), els.state),
      els.title, els.empty,
      h('div', { class: 'tac-plan-btns' }, els.create, els.rename, els.activate, els.del),
      els.squads,
      h('div', { id: 'tac-tools-slot' }));
    document.querySelector('.mapwrap').appendChild(els.panel);
  }

  function updateState() {
    if (!els.state) return;
    if (!S.online) { els.state.textContent = 'нет связи'; els.state.className = 'tac-state bad'; return; }
    var sec = Math.max(0, Math.round((Date.now() - S.updatedAt) / 1000));
    els.state.textContent = S.plan ? 'обновлено ' + sec + ' с назад' : '';
    els.state.className = 'tac-state';
  }

  function updatePanel() {
    if (!els.panel) return;
    els.panel.hidden = !S.on;
    els.title.textContent = '';
    S.plans.forEach(function (p) {
      els.title.appendChild(h('option', { value: p.id, selected: !!S.plan && S.plan.id === p.id },
        (p.active ? '★ ' : '') + p.title));
    });
    els.title.hidden = S.plans.length === 0;
    els.empty.hidden = S.plans.length !== 0;
    var manage = hasPerm('plans_manage');
    els.create.hidden = !manage;
    els.rename.hidden = !manage || !S.plan;
    els.activate.hidden = !manage || !S.plan || S.plan.active;
    els.del.hidden = !manage || !S.plan;
    renderSquadFilter();
    updateState();
  }

  function renderSquadFilter() {
    els.squads.textContent = '';
    if (!S.clan) return;
    function row(key, name, color) {
      var cb = h('input', {
        type: 'checkbox', checked: !S.hiddenSquads[key],
        onchange: function () { S.hiddenSquads[key] = !cb.checked; render(); },
      });
      els.squads.appendChild(h('li', null, h('label', { class: 'tac-row' },
        cb, h('span', { class: 'tac-dot', style: 'background:' + color }), h('span', { class: 'cat-name' }, name))));
    }
    S.clan.squads.forEach(function (sq) { row(String(sq.id), sq.name, sq.color); });
    row('shared', 'Общие', SHARED_COLOR);
    var mine = h('input', {
      type: 'checkbox', checked: S.onlyMine,
      onchange: function () { S.onlyMine = mine.checked; render(); },
    });
    els.squads.appendChild(h('li', null, h('label', { class: 'tac-row' }, mine, h('span', { class: 'cat-name' }, 'Только мои отряды'))));
  }

  function createPlan() {
    var title = window.prompt('Название плана');
    if (!title) return;
    var map = V.state().map;
    api.post('/api/clans/' + S.clan.clan.id + '/plans', { mapId: map.id, title: title }).then(function (body) {
      return loadPlans(body.plan.id);
    }, planError);
  }

  function renamePlan() {
    var title = window.prompt('Новое название', S.plan.title);
    if (!title) return;
    api.patch(planUrl(), { title: title }).then(function () { return loadPlans(S.plan.id); }, planError);
  }

  function activatePlan() {
    api.post(planUrl() + '/activate').then(function () { return loadPlans(S.plan.id); }, planError);
  }

  function deletePlan() {
    if (!window.confirm('Удалить план «' + S.plan.title + '» вместе со всеми рисунками?')) return;
    api.del(planUrl()).then(function () { return loadPlans(); }, planError);
  }

  function planError(err) {
    var text = {
      plans_limit: 'Достигнут лимит: 25 планов.',
      title_invalid: 'Название: от 1 до 60 символов.',
    }[err.message];
    V.notice(text || (err.status === 429 ? 'Слишком часто, подождите минуту.' : 'Ошибка: ' + err.message));
  }

  // ---------- start / stop ----------

  function start(viewer, clanBody, opts) {
    V = viewer;
    S.clan = clanBody;
    S.on = true;
    S.hiddenSquads = {};
    S.onlyMine = false;
    document.body.classList.add('tactics');
    if (!els.panel) {
      buildPanel();
      document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
      V.onMapLoaded(function () { if (S.on) loadPlans(); });
    }
    clearInterval(timer);
    clearInterval(clock);
    timer = setInterval(poll, POLL_MS);
    clock = setInterval(updateState, 1000);
    updatePanel();
    return loadPlans(opts && opts.plan).then(updateUrl);
  }

  function stop(silent) {
    S.on = false;
    clearInterval(timer);
    clearInterval(clock);
    document.body.classList.remove('tactics');
    if (group) group.remove();
    group = null;
    layers = {};
    if (els.panel) els.panel.hidden = true;
    if (!silent) updateUrl();
  }

  // ---------- edits made by the editor ----------

  // The server answered with the new version; our own write must not look like a foreign change on the next poll.
  function applyVersion(version) {
    if (S.plan) { S.plan.version = version; S.etag = '"v' + version + '"'; }
  }

  function setItem(item, version) {
    var i = S.items.findIndex(function (x) { return x.id === item.id; });
    if (i < 0) S.items.push(item); else S.items[i] = item;
    applyVersion(version);
    render();
  }

  function dropItem(id, version) {
    S.items = S.items.filter(function (x) { return x.id !== id; });
    applyVersion(version);
    render();
  }

  window.MapTactics = {
    start: start,
    stop: stop,
    active: function () { return S.on; },
    plan: function () { return S.plan; },
    clan: function () { return S.clan; },
    planPublicId: function () { return S.plan ? S.plan.id : null; },
    canDraw: function () { return hasPerm('tactics_draw'); },
    canManage: function () { return hasPerm('plans_manage'); },
    squads: function () { return S.clan ? S.clan.squads : []; },
    drawSquads: function () { return S.clan ? S.clan.me.drawSquads : []; },
    colorOf: colorOf,
    layers: function () { return layers; },
    itemById: function (id) { return S.items.find(function (x) { return x.id === id; }) || null; },
    setInteractive: setInteractive,
    setItem: setItem,
    dropItem: dropItem,
    applyVersion: applyVersion,
    refresh: poll,
    reloadPlans: function () { return loadPlans(S.plan && S.plan.id); },
    onChange: function (fn) { listeners.push(fn); },
  };
})();
