'use strict';

const crypto = require('node:crypto');
const { HttpError, readJson } = require('../http-util');
const { sha256 } = require('../auth');
const { memberContext } = require('../clan-permissions');
const { validateInviteOptions } = require('../clan-validate');
const clanRepo = require('../clan-repo');
const { need, limitWrites, checked, intParam, memberOf, requirePerm } = require('../clan-http');

const DAY = 24 * 60 * 60 * 1000;
const TTL_MS = { '1d': DAY, '7d': 7 * DAY };
const TOKEN_RE = /^[0-9a-f]{64}$/;
// A link works while it is not revoked, not expired and has uses left.
const ACTIVE = '(revoked = 0 AND (expires_at IS NULL OR expires_at > ?) AND (max_uses IS NULL OR uses < max_uses))';

function inviteByToken(c) {
  const token = c.params.token;
  const row = TOKEN_RE.test(token)
    ? c.db.prepare(`SELECT * FROM clan_invites WHERE token_hash = ? AND ${ACTIVE}`).get(sha256(token), c.now())
    : null;
  if (!row) throw new HttpError(404, 'invite_invalid');
  return row;
}

// Shared by both ways to join; runs after the last await, right before the insert.
function joinChecks(db, clanId, userId) {
  if (memberContext(db, userId)) throw new HttpError(409, 'already_in_clan');
  if (clanRepo.countMembers(db, clanId) >= clanRepo.LIMITS.members) throw new HttpError(409, 'clan_full');
}

function listInvites(c, clanId) {
  return c.db
    .prepare(
      `SELECT i.id, u.login AS created_by, i.created_at, i.expires_at, i.max_uses, i.uses
       FROM clan_invites i LEFT JOIN users u ON u.id = i.created_by
       WHERE i.clan_id = ? AND ${ACTIVE} ORDER BY i.id DESC`,
    )
    .all(clanId, c.now());
}

function listInvitations(db, clanId) {
  return db
    .prepare(
      `SELECT i.id, u.login, b.login AS invited_by, i.created_at FROM clan_invitations i
       JOIN users u ON u.id = i.user_id LEFT JOIN users b ON b.id = i.invited_by
       WHERE i.clan_id = ? ORDER BY i.id DESC`,
    )
    .all(clanId);
}

function inviter(c) {
  const ctx = memberOf(c);
  requirePerm(ctx, 'invite');
  return ctx;
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/clans/join/:token',
    handler: async (c) => {
      const inv = inviteByToken(c);
      const clan = clanRepo.getClan(c.db, inv.clan_id);
      const out = clanRepo.clanOut(clan);
      return { body: { tag: out.tag, name: out.name, emblem_url: out.emblem_url, members: clanRepo.countMembers(c.db, clan.id) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans/join/:token',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      const inv = inviteByToken(c);
      clanRepo.tx(c.db, () => {
        joinChecks(c.db, inv.clan_id, c.user.id);
        c.db.prepare('UPDATE clan_invites SET uses = uses + 1 WHERE id = ?').run(inv.id);
        clanRepo.addMember(c.db, inv.clan_id, c.user.id);
      });
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans/:id/invites',
    handler: async (c) => {
      inviter(c);
      limitWrites(c);
      const opts = checked(validateInviteOptions(await readJson(c.req)));
      const ctx = inviter(c);
      if (listInvites(c, ctx.clanId).length >= clanRepo.LIMITS.activeInvites) throw new HttpError(409, 'invites_limit');
      const token = crypto.randomBytes(32).toString('hex');
      const now = c.now();
      const expiresAt = opts.ttl ? now + TTL_MS[opts.ttl] : null;
      const id = Number(c.db.prepare(
        'INSERT INTO clan_invites (token_hash, clan_id, created_by, created_at, expires_at, max_uses) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(sha256(token), ctx.clanId, c.user.id, now, expiresAt, opts.maxUses).lastInsertRowid);
      return { status: 201, body: { id, url: c.publicUrl + '/clan/join/' + token, expires_at: expiresAt, max_uses: opts.maxUses } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/clans/:id/invites',
    handler: async (c) => ({ body: { invites: listInvites(c, inviter(c).clanId) } }),
  },
  {
    method: 'DELETE',
    pattern: '/api/clans/:id/invites/:iid',
    handler: async (c) => {
      const ctx = inviter(c);
      limitWrites(c);
      const r = c.db.prepare('UPDATE clan_invites SET revoked = 1 WHERE id = ? AND clan_id = ?').run(intParam(c, 'iid'), ctx.clanId);
      if (!r.changes) throw new HttpError(404, 'invite not found');
      return { body: { invites: listInvites(c, ctx.clanId) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans/:id/invitations',
    handler: async (c) => {
      inviter(c);
      limitWrites(c);
      const body = await readJson(c.req);
      const ctx = inviter(c);
      if (typeof body.login !== 'string' || !body.login.trim()) throw new HttpError(400, 'login required');
      const user = c.db.prepare('SELECT id FROM users WHERE lower(login) = lower(?)').get(body.login.trim());
      if (!user) throw new HttpError(404, 'user_not_found');
      if (memberContext(c.db, user.id)) throw new HttpError(409, 'already_in_clan');
      if (c.db.prepare('SELECT 1 FROM clan_invitations WHERE clan_id = ? AND user_id = ?').get(ctx.clanId, user.id)) {
        throw new HttpError(409, 'already_invited');
      }
      const pending = c.db.prepare('SELECT COUNT(*) AS n FROM clan_invitations WHERE clan_id = ?').get(ctx.clanId).n;
      if (pending >= clanRepo.LIMITS.pendingInvitations) throw new HttpError(409, 'invitations_limit');
      c.db.prepare('INSERT INTO clan_invitations (clan_id, user_id, invited_by) VALUES (?, ?, ?)').run(ctx.clanId, user.id, c.user.id);
      return { status: 201, body: { invitations: listInvitations(c.db, ctx.clanId) } };
    },
  },
  {
    method: 'GET',
    pattern: '/api/clans/:id/invitations',
    handler: async (c) => ({ body: { invitations: listInvitations(c.db, inviter(c).clanId) } }),
  },
  {
    method: 'DELETE',
    pattern: '/api/clans/:id/invitations/:iid',
    handler: async (c) => {
      const ctx = inviter(c);
      limitWrites(c);
      const r = c.db.prepare('DELETE FROM clan_invitations WHERE id = ? AND clan_id = ?').run(intParam(c, 'iid'), ctx.clanId);
      if (!r.changes) throw new HttpError(404, 'invitation not found');
      return { body: { invitations: listInvitations(c.db, ctx.clanId) } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/invitations/:id/accept',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      const inv = c.db.prepare('SELECT * FROM clan_invitations WHERE id = ? AND user_id = ?').get(intParam(c, 'id'), c.user.id);
      if (!inv) throw new HttpError(404, 'invitation not found');
      clanRepo.tx(c.db, () => {
        joinChecks(c.db, inv.clan_id, c.user.id);
        clanRepo.addMember(c.db, inv.clan_id, c.user.id);
      });
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/invitations/:id/decline',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      const r = c.db.prepare('DELETE FROM clan_invitations WHERE id = ? AND user_id = ?').run(intParam(c, 'id'), c.user.id);
      if (!r.changes) throw new HttpError(404, 'invitation not found');
      return { body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
];
