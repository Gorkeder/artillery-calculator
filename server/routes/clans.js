'use strict';

const { HttpError, readJson } = require('../http-util');
const { can } = require('../permissions');
const { memberContext, outranks } = require('../clan-permissions');
const { validateClan, clanKey } = require('../clan-validate');
const { unlinkAll } = require('../files');
const clanRepo = require('../clan-repo');
const { need, limitWrites, checked, intParam, memberOf, requirePerm, memberOrAdmin, memberTarget } = require('../clan-http');

function uniqueOrThrow(db, fields, exceptId) {
  if (fields.tag !== undefined && clanRepo.keyTaken(db, 'tag_key', clanKey(fields.tag), exceptId)) {
    throw new HttpError(409, 'tag_taken');
  }
  if (fields.name !== undefined && clanRepo.keyTaken(db, 'name_key', clanKey(fields.name), exceptId)) {
    throw new HttpError(409, 'name_taken');
  }
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/clans',
    handler: async (c) => ({ body: clanRepo.listClans(c.db, String(c.query.get('q') || '').slice(0, 40)) }),
  },
  {
    method: 'GET',
    pattern: '/api/my/clan',
    handler: async (c) => {
      need(c);
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/clans/:tag',
    handler: async (c) => {
      const clan = clanRepo.getClanByTag(c.db, c.params.tag);
      if (!clan) throw new HttpError(404, 'clan not found');
      return { body: clanRepo.publicProfile(c.db, clan) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      const fields = checked(validateClan(await readJson(c.req), { create: true }));
      // Every check below runs after the last await, so parallel requests cannot both pass them.
      const row = c.db.prepare('SELECT email_verified_at, clans_blocked FROM users WHERE id = ?').get(c.user.id);
      const state = { emailVerified: Boolean(row.email_verified_at), clansBlocked: Boolean(row.clans_blocked) };
      if (!can(c.user, 'clan:create', state)) {
        throw new HttpError(403, state.clansBlocked ? 'clans_blocked' : 'email_not_verified');
      }
      if (memberContext(c.db, c.user.id)) throw new HttpError(409, 'already_in_clan');
      uniqueOrThrow(c.db, fields, 0);
      clanRepo.createClan(c.db, { ...fields, ownerId: c.user.id });
      return { status: 201, body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/clans/:id',
    handler: async (c) => {
      memberOrAdmin(c, 'clan_settings');
      limitWrites(c);
      const fields = checked(validateClan(await readJson(c.req)));
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      const { clan } = memberOrAdmin(c, 'clan_settings'); // re-read after the await
      uniqueOrThrow(c.db, fields, clan.id);
      const set = { ...fields };
      if (fields.tag !== undefined) set.tag_key = clanKey(fields.tag);
      if (fields.name !== undefined) set.name_key = clanKey(fields.name);
      const keys = Object.keys(set);
      c.db.prepare(`UPDATE clans SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => set[k]), clan.id);
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/clans/:id',
    handler: async (c) => {
      const { clan } = memberOrAdmin(c, 'owner');
      limitWrites(c);
      c.db.prepare('DELETE FROM clans WHERE id = ?').run(clan.id);
      unlinkAll(c.uploadsDir, [clan.emblem_path]);
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans/:id/leave',
    handler: async (c) => {
      const ctx = memberOf(c);
      limitWrites(c);
      if (ctx.isOwner) throw new HttpError(409, 'owner_must_transfer');
      clanRepo.removeMember(c.db, c.user.id);
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans/:id/transfer',
    handler: async (c) => {
      memberOf(c);
      limitWrites(c);
      const body = await readJson(c.req);
      const ctx = memberOf(c);
      if (!ctx.isOwner) throw new HttpError(403, 'forbidden');
      if (!Number.isInteger(body.userId) || body.userId < 1) throw new HttpError(400, 'userId must be a positive integer');
      const target = memberContext(c.db, body.userId);
      if (!target || target.clanId !== ctx.clanId) throw new HttpError(404, 'member not found');
      if (target.userId === ctx.userId) throw new HttpError(400, 'already the owner');
      c.db.prepare('UPDATE clans SET owner_id = ? WHERE id = ?').run(target.userId, ctx.clanId);
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/clans/:id/members/:uid',
    handler: async (c) => {
      const ctx = memberOf(c);
      limitWrites(c);
      requirePerm(ctx, 'kick');
      const target = memberTarget(c, ctx, 'uid');
      if (target.userId === ctx.userId) throw new HttpError(400, 'use_leave');
      if (!outranks(ctx, target)) throw new HttpError(403, 'forbidden');
      clanRepo.removeMember(c.db, target.userId);
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/users/:id/block-clans',
    handler: async (c) => {
      need(c);
      if (c.user.role !== 'admin') throw new HttpError(403, 'forbidden');
      const body = await readJson(c.req);
      if (typeof body.blocked !== 'boolean') throw new HttpError(400, 'blocked must be boolean');
      const user = c.db.prepare('SELECT id, role FROM users WHERE id = ?').get(intParam(c, 'id'));
      if (!user) throw new HttpError(404, 'user not found');
      if (user.role === 'admin') throw new HttpError(400, 'cannot block an admin');
      c.db.prepare('UPDATE users SET clans_blocked = ? WHERE id = ?').run(body.blocked ? 1 : 0, user.id);
      return { body: { ok: true } };
    },
  },
];

module.exports.uniqueOrThrow = uniqueOrThrow;
