'use strict';

const { HttpError, readJson } = require('../http-util');
const { can } = require('../permissions');
const { memberContext } = require('../clan-permissions');
const { validateClan, clanKey } = require('../clan-validate');
const clanRepo = require('../clan-repo');
const { need, limitWrites, checked } = require('../clan-http');

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
];

module.exports.uniqueOrThrow = uniqueOrThrow;
