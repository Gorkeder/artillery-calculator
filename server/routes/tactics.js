'use strict';

const { HttpError, readJson } = require('../http-util');
const { memberContext } = require('../clan-permissions');
const { validatePlan } = require('../tactic-validate');
const { checked, need, intParam, memberOf, requirePerm } = require('../clan-http');
const clanRepo = require('../clan-repo');
const repo = require('../repo');
const tactics = require('../tactic-repo');

function limitWrites(c) {
  if (!c.limiters.tacticsWrite.allow('u:' + c.user.id, c.now())) {
    throw new HttpError(429, 'too many requests, try again later');
  }
}

// Reading: a member with tactics_view, or the site admin for any clan. Anyone else — 404, so ids and
// clans cannot be probed. Returns what the caller needs to decide further.
function readAccess(c, clanId) {
  need(c);
  const ctx = memberContext(c.db, c.user.id);
  const inClan = Boolean(ctx) && ctx.clanId === clanId;
  if (c.user.role === 'admin') return { ctx: inClan ? ctx : null, admin: true };
  if (!inClan) throw new HttpError(404, 'not found');
  requirePerm(ctx, 'tactics_view');
  return { ctx, admin: false };
}

// The plan named by the URL with read access to it.
function planFor(c) {
  need(c);
  const plan = tactics.getPlanByPublicId(c.db, c.params.pid);
  if (!plan) throw new HttpError(404, 'plan not found');
  const access = readAccess(c, plan.clan_id);
  return { plan, ...access };
}

// Writing a plan: a member with the flag; the site admin never writes (403 by design: they may read).
function planForManage(c) {
  const r = planFor(c);
  if (r.admin && !r.ctx) throw new HttpError(403, 'forbidden');
  requirePerm(r.ctx, 'plans_manage');
  return r;
}

const bodyOf = (c, plan) => tactics.planBody(c.db, plan);

// If-None-Match may carry a list, weak validators (W/ added by a gzip proxy) or *.
function etagMatches(header, etag) {
  if (typeof header !== 'string') return false;
  return header.split(',').some((p) => {
    const v = p.trim().replace(/^W\//, '');
    return v === '*' || v === etag;
  });
}

function publishedMap(c, mapId) {
  const row = Number.isInteger(mapId) ? c.db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId) : null;
  if (!row || !row.published) throw new HttpError(404, 'map not found');
  return row;
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/clans/:id/plans',
    handler: async (c) => {
      const clanId = intParam(c, 'id');
      if (!clanRepo.getClan(c.db, clanId)) {
        need(c);
        throw new HttpError(404, 'clan not found');
      }
      readAccess(c, clanId);
      let mapId = null;
      const slug = c.query.get('map');
      if (slug) {
        const map = repo.getMapBySlug(c.db, slug);
        if (!map || !map.published) throw new HttpError(404, 'map not found');
        mapId = map.id;
      }
      return { body: tactics.listPlans(c.db, clanId, mapId) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans/:id/plans',
    handler: async (c) => {
      requirePerm(memberOf(c), 'plans_manage');
      limitWrites(c);
      const input = await readJson(c.req);
      const fields = checked(validatePlan(input, { create: true }));
      const ctx = memberOf(c); // re-read after the await
      requirePerm(ctx, 'plans_manage');
      const map = publishedMap(c, input.mapId);
      // Count and insert have no await between them, so parallel requests cannot overshoot.
      if (tactics.countPlans(c.db, ctx.clanId) >= tactics.LIMITS.plans) throw new HttpError(409, 'plans_limit');
      const hasActive = c.db.prepare('SELECT 1 FROM tactic_plans WHERE clan_id = ? AND map_id = ? AND is_active = 1')
        .get(ctx.clanId, map.id);
      const plan = tactics.insertPlan(c.db, {
        clanId: ctx.clanId, mapId: map.id, title: fields.title, userId: c.user.id, active: !hasActive,
      });
      return { status: 201, body: bodyOf(c, plan) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/plans/:pid',
    handler: async (c) => {
      const { plan } = planFor(c);
      const etag = `"v${plan.version}"`;
      c.headers.ETag = etag;
      if (etagMatches(c.req.headers['if-none-match'], etag)) return { status: 304, body: null };
      return { body: bodyOf(c, plan) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/plans/:pid',
    handler: async (c) => {
      planForManage(c);
      limitWrites(c);
      const fields = checked(validatePlan(await readJson(c.req)));
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      const { plan } = planForManage(c); // re-read after the await
      tactics.rename(c.db, plan, fields.title, c.user.id);
      return { body: bodyOf(c, tactics.getPlanByPublicId(c.db, plan.public_id)) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/plans/:pid/activate',
    handler: async (c) => {
      const { plan } = planForManage(c);
      limitWrites(c);
      tactics.activate(c.db, plan, c.user.id);
      return { body: bodyOf(c, tactics.getPlanByPublicId(c.db, plan.public_id)) };
    },
  },
];

module.exports.helpers = { readAccess, planFor, planForManage, limitWrites, bodyOf };
