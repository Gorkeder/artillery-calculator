'use strict';

const { HttpError } = require('./http-util');
const { memberContext, has } = require('./clan-permissions');
const clanRepo = require('./clan-repo');

function need(c) {
  if (!c.user) throw new HttpError(401, 'login required');
}

function limitWrites(c) {
  if (!c.limiters.clansWrite.allow('u:' + c.user.id, c.now())) {
    throw new HttpError(429, 'too many requests, try again later');
  }
}

function checked(result) {
  if (!result.ok) throw new HttpError(400, result.error);
  return result.value;
}

function intParam(c, key) {
  const n = Number(c.params[key]);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'not found');
  return n;
}

// The actor's context in the clan named by the URL. Not a member of that clan → 404,
// so clan ids cannot be probed.
function memberOf(c) {
  need(c);
  const id = intParam(c, 'id');
  const ctx = memberContext(c.db, c.user.id);
  if (!ctx || ctx.clanId !== id) throw new HttpError(404, 'clan not found');
  return ctx;
}

function requirePerm(ctx, name) {
  if (!has(ctx, name)) throw new HttpError(403, 'forbidden');
}

// Settings and deletion: a member with `perm` ('owner' = the owner only) or the site admin for any clan.
function memberOrAdmin(c, perm) {
  need(c);
  const id = intParam(c, 'id');
  const clan = clanRepo.getClan(c.db, id);
  if (!clan) throw new HttpError(404, 'clan not found');
  const ctx = memberContext(c.db, c.user.id);
  const inClan = Boolean(ctx) && ctx.clanId === id;
  if (c.user.role === 'admin') return { clan, ctx: inClan ? ctx : null, admin: true };
  if (!inClan) throw new HttpError(404, 'clan not found');
  if (perm === 'owner' ? !ctx.isOwner : !has(ctx, perm)) throw new HttpError(403, 'forbidden');
  return { clan, ctx, admin: false };
}

// Another member of the actor's clan, by URL param; anyone else is a 404.
function memberTarget(c, ctx, key) {
  const target = memberContext(c.db, intParam(c, key));
  if (!target || target.clanId !== ctx.clanId) throw new HttpError(404, 'member not found');
  return target;
}

module.exports = { need, limitWrites, checked, intParam, memberOf, requirePerm, memberOrAdmin, memberTarget };
