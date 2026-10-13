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
    hiddenSquads: {}, onlyMine: false, updatedAt: 0, online: true, admin: false, adminClans: [],
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

  // Own set: the category icons in map-icons.js feed the category editor and must not grow tactical ones.
  var TACTIC_ICONS = {
    gather: { label: 'Сбор', svg: '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>' },
    attack: { label: 'Атака', svg: '<path d="M4 20 20 4M14 4h6v6"/>' },
    defend: { label: 'Оборона', svg: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>' },
    enemy: { label: 'Враг', svg: '<circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/>' },
    artillery: { label: 'Артиллерия', svg: '<circle cx="8" cy="17" r="3"/><path d="M10 15 20 5M16 4l4 4"/>' },
    sniper: { label: 'Снайпер', svg: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>' },
    danger: { label: 'Опасность', svg: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6"/>' },
    question: { label: 'Вопрос', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><circle cx="12" cy="17" r=".6"/>' },
  };

  function iconNode(id) {
    var def = TACTIC_ICONS[id] || TACTIC_ICONS.question;
    var wrap = document.createElement('span');
    wrap.className = 'ico';
    // def.svg is static markup from the table above, never user input
    wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + def.svg + '</svg>';
    return wrap;
  }

  function permanentLabel(layer, text, direction) {
    if (!text) return;
    // bindTooltip takes a string as HTML: pass a text node holder instead
    layer.bindTooltip(h('span', null, text), { permanent: true, direction: direction, className: 'tac-label', offset: [0, direction === 'bottom' ? 4 : 0] });
  }

  // CRS.Simple is linear, so the screen angle of the last segment does not depend on the zoom.
  function arrowHead(points, size, color, width) {
    var a = Geo.toLatLng({ x: points[points.length - 2][0], y: points[points.length - 2][1] }, size);
    var b = Geo.toLatLng({ x: points[points.length - 1][0], y: points[points.length - 1][1] }, size);
    var deg = Math.atan2(-(b[0] - a[0]), b[1] - a[1]) * 180 / Math.PI;
    var px = 14 + 3 * width;
    var el = h('div', { class: 'tac-head', style: 'width:' + px + 'px;height:' + px + 'px;transform:rotate(' + deg + 'deg)' });
    // static markup, color validated on the server as a squad color (#rrggbb) or the shared constant
    el.innerHTML = '<svg viewBox="0 0 20 20"><path d="M1 2 19 10 1 18 5 10z" fill="' + color + '"/></svg>';
    return L.marker(b, {
      icon: L.divIcon({ html: el, className: 'tac-head-wrap', iconSize: [px, px], iconAnchor: [px / 2, px / 2] }),
      interactive: interactive, keyboard: false,
    });
  }

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
    var color = colorOf(item);
    var weight = weightOf(item.width);
    var layer = null;
    if (item.kind === 'pencil') {
      layer = L.polyline(Geo.pointsToLatLngs(item.geometry, size), {
        color: color, weight: weight, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
        interactive: interactive, bubblingMouseEvents: false,
      });
    } else if (item.kind === 'arrow') {
      var line = L.polyline(Geo.pointsToLatLngs(item.geometry, size), {
        color: color, weight: weight, opacity: 0.95, lineCap: 'round', lineJoin: 'round',
        dashArray: '8 6', interactive: interactive, bubblingMouseEvents: false,
      });
      layer = L.featureGroup([line, arrowHead(item.geometry, size, color, item.width)]);
    } else if (item.kind === 'zone') {
      layer = L.polygon(Geo.pointsToLatLngs(item.geometry, size), {
        color: color, fillColor: color, fillOpacity: 0.2, weight: Math.max(2, weight - 1),
        interactive: interactive, bubblingMouseEvents: false,
      });
      permanentLabel(layer, item.label, 'center');
    } else if (item.kind === 'marker') {
      var mk = h('div', { class: 'mk tac-mk' }, iconNode(item.icon));
      mk.style.setProperty('--c', color);
      layer = L.marker(Geo.toLatLng({ x: item.geometry[0], y: item.geometry[1] }, size), {
        icon: L.divIcon({ html: mk, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] }),
        interactive: interactive, keyboard: false,
      });
      permanentLabel(layer, item.label, 'bottom');
    } else if (item.kind === 'text') {
      var txt = h('div', { class: 'tac-text' }, item.label || '');
      txt.style.color = color;
      layer = L.marker(Geo.toLatLng({ x: item.geometry[0], y: item.geometry[1] }, size), {
        icon: L.divIcon({ html: txt, className: 'tac-text-wrap', iconSize: null }),
        interactive: interactive, keyboard: false,
      });
    }
    // An unknown kind from a newer server is skipped, not fatal.
    if (layer) layer.itemId = item.id;
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
    refreshClanForUnknownSquad();
  }

  // A drawing of a squad created or recoloured after the page opened: re-read the clan once, then redraw.
  var reloadingClan = false;
  function refreshClanForUnknownSquad() {
    if (reloadingClan || !S.clan) return;
    var unknown = S.items.some(function (it) { return it.squad_id !== null && !squadById(it.squad_id); });
    if (!unknown) return;
    reloadingClan = true;
    reloadClan().then(function () {
      reloadingClan = false;
      if (!S.on) return;
      render();
      updatePanel();
    });
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
      if (r.status === 200) {
        // An answer that was in flight during our own write is older than what we show: keep the current items.
        if (r.data.plan.version < S.plan.version) updateState();
        else applyPlanBody(r.data, r.etag);
      } else updateState();
    }, function (err) {
      if (err.status === 404 || err.status === 403) {
        // The plan was deleted, or the member lost access: re-read what the clan still offers.
        return reloadClan().then(function () {
          if (!S.on) return null;
          if (!S.online) { updateState(); return null; }
          if (!S.clan || !hasPerm('tactics_view')) return lostAccess('Доступ к тактике закрыт или план удалён');
          V.notice('План удалён.');
          return loadPlans().catch(function () { /* the next poll retries */ });
        });
      }
      S.online = false;
      updateState();
    });
  }

  function reloadClan() {
    if (S.admin) {
      // The admin has no clan of their own here: re-read the clan that is open.
      if (!S.clan) return Promise.resolve();
      return api.get('/api/admin/clans/' + S.clan.clan.id).then(function (d) {
        S.clan = adminBody(d, S.clan.me.id);
        S.online = true;
      }, function (err) {
        if (err.status === 404) { S.clan = null; S.online = true; } else S.online = false;
      });
    }
    return api.get('/api/my/clan').then(function (body) {
      S.clan = body.clan ? body : null;
      S.online = true;
    }, function (err) {
      // Only an explicit refusal means the access is gone; a network or server error keeps the clan as it was.
      if (err.status === 401 || err.status === 403 || err.status === 404) { S.clan = null; S.online = true; } else S.online = false;
    });
  }

  function loadPlans(wantedPlan) {
    var map = V.state().map;
    if (!map || !map.published || !S.clan) {
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

  var openSeq = 0;

  function openPlan(publicId) {
    var seq = ++openSeq;
    return api.get('/api/plans/' + encodeURIComponent(publicId)).then(function (body) {
      if (seq !== openSeq || !S.on) return;
      applyPlanBody(body, '"v' + body.plan.version + '"');
      updateUrl();
    }, function (err) {
      if (seq !== openSeq || !S.on) return null;
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
    els.clanSel = h('select', { 'aria-label': 'Клан', hidden: true, onchange: function () { pickClan(Number(els.clanSel.value)); } });
    els.panel = h('aside', { id: 'tac-panel', class: 'tac-panel', hidden: true },
      h('div', { class: 'tac-head' }, h('strong', null, 'Тактика'), h('span', { class: 'grow' }), els.state),
      els.clanSel, els.title, els.empty,
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
    var manage = !S.admin && hasPerm('plans_manage');
    els.create.hidden = !manage;
    els.rename.hidden = !manage || !S.plan;
    els.activate.hidden = !manage || !S.plan || S.plan.active;
    els.del.hidden = !(manage || S.admin) || !S.plan;
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

  // ---------- site admin: any clan, read and erase only ----------

  function adminBody(detail, adminId) {
    return {
      clan: detail.clan,
      me: { id: adminId, isOwner: false, perms: ['tactics_view'], drawSquads: [] },
      roles: [], squads: detail.squads, members: [],
    };
  }

  function pickClan(clanId, wantedPlan) {
    return api.get('/api/admin/clans/' + clanId).then(function (detail) {
      if (!S.on) return null;
      S.clan = adminBody(detail, V.state().me.user.id);
      els.clanSel.value = String(clanId);
      return loadPlans(wantedPlan);
    }, function () { V.notice('Не удалось открыть клан.'); });
  }

  // The clan list comes from the admin API; a ?plan= link names its clan through the plan itself.
  function startAdmin(opts) {
    return api.get('/api/admin/clans').then(function (clans) {
      if (!S.on) return null;
      S.adminClans = clans;
      els.clanSel.textContent = '';
      clans.forEach(function (c) {
        els.clanSel.appendChild(h('option', { value: String(c.id) }, '[' + c.tag + '] ' + c.name));
      });
      els.clanSel.hidden = clans.length === 0;
      if (!clans.length) { S.clan = null; updatePanel(); return null; }
      var wanted = opts && opts.plan;
      var first = wanted
        ? api.get('/api/plans/' + encodeURIComponent(wanted)).then(function (b) { return b.plan.clan_id; }, function () { return clans[0].id; })
        : Promise.resolve(clans[0].id);
      return first.then(function (clanId) {
        if (!clans.some(function (c) { return c.id === clanId; })) clanId = clans[0].id;
        return pickClan(clanId, wanted);
      });
    });
  }

  // ---------- start / stop ----------

  function start(viewer, clanBody, opts) {
    V = viewer;
    S.admin = !!(opts && opts.admin);
    S.clan = S.admin ? null : clanBody;
    S.on = true;
    S.plans = [];
    S.plan = null;
    S.items = [];
    S.etag = null;
    S.online = true;
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
    els.clanSel.hidden = true;
    updatePanel();
    var ready = S.admin ? startAdmin(opts) : loadPlans(opts && opts.plan);
    return ready.then(updateUrl);
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
    available: function () { var m = V && V.state().map; return !!(m && m.published && S.clan); },
    state: function () { return S; },
    active: function () { return S.on; },
    plan: function () { return S.plan; },
    clan: function () { return S.clan; },
    planPublicId: function () { return S.plan ? S.plan.id : null; },
    canDraw: function () { return !S.admin && hasPerm('tactics_draw'); },
    isAdmin: function () { return S.admin; },
    canManage: function () { return hasPerm('plans_manage'); },
    squads: function () { return S.clan ? S.clan.squads : []; },
    drawSquads: function () { return S.clan ? S.clan.me.drawSquads : []; },
    colorOf: colorOf,
    TACTIC_ICONS: TACTIC_ICONS,
    iconNode: iconNode,
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
