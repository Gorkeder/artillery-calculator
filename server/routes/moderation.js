'use strict';

const { HttpError, readJson } = require('../http-util');
const { can } = require('../permissions');
const repo = require('../repo');

const MAX_REASON = 200;
const BLOCK_REJECT_REASON = 'Автор заблокирован';
const MAX_REPORT_TEXT = 500;
const MAX_OPEN_REPORTS = 20;

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function need(c, action) {
  if (!c.user) throw new HttpError(401, 'login required');
  if (!can(c.user, action)) throw new HttpError(403, 'forbidden');
}

function idParam(c) {
  const n = Number(c.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'not found');
  return n;
}

// A required, trimmed text of 1..MAX_REASON characters.
function requiredReason(body) {
  const s = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!s || s.length > MAX_REASON) throw new HttpError(400, 'reason must be 1..200 characters');
  return s;
}

function optionalReason(body) {
  if (body.reason === undefined || body.reason === null) return null;
  if (typeof body.reason !== 'string' || body.reason.length > MAX_REASON) {
    throw new HttpError(400, 'reason must be up to 200 characters');
  }
  return body.reason.trim() || null;
}

function targetUser(c) {
  const user = c.db.prepare('SELECT id, role FROM users WHERE id = ?').get(idParam(c));
  if (!user) throw new HttpError(404, 'user not found');
  return user;
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/moderation',
    handler: async (c) => {
      need(c, 'moderation:read');
      return { body: repo.moderationOverview(c.db) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/features/:id/approve',
    handler: async (c) => {
      need(c, 'moderation:write');
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      if (row.status !== 'pending') throw new HttpError(409, 'already published');
      repo.updateRow(c.db, 'features', id, {
        status: 'approved',
        reject_reason: null,
        reviewed_at: sqlTime(c.now()),
        reviewed_by: c.user.id,
      });
      return { body: repo.getFeature(c.db, id, c.user) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/features/:id/reject',
    handler: async (c) => {
      need(c, 'moderation:write');
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      const reason = requiredReason(await readJson(c.req));
      if (row.status !== 'pending') throw new HttpError(409, 'a published object cannot be rejected');
      repo.updateRow(c.db, 'features', id, {
        reject_reason: reason,
        reviewed_at: sqlTime(c.now()),
        reviewed_by: c.user.id,
      });
      return { body: repo.getFeature(c.db, id, c.user) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/users/:id/block-proposals',
    handler: async (c) => {
      need(c, 'moderation:write');
      const user = targetUser(c);
      if (user.role === 'admin') throw new HttpError(400, 'cannot block an admin');
      const reason = optionalReason(await readJson(c.req));
      const now = sqlTime(c.now());
      // The block and the rejection of the open proposals land together or not at all.
      c.db.exec('BEGIN');
      try {
        c.db
          .prepare('UPDATE users SET proposals_blocked_at = ?, proposals_block_reason = ? WHERE id = ?')
          .run(now, reason, user.id);
        const r = c.db
          .prepare(
            `UPDATE features SET reject_reason = ?, reviewed_at = ?, reviewed_by = ?
             WHERE author_id = ? AND status = 'pending' AND reject_reason IS NULL`,
          )
          .run(BLOCK_REJECT_REASON, now, c.user.id, user.id);
        c.db.exec('COMMIT');
        return { body: { ok: true, rejected: Number(r.changes) } };
      } catch (err) {
        c.db.exec('ROLLBACK');
        throw err;
      }
    },
  },
  {
    method: 'POST',
    pattern: '/api/users/:id/unblock-proposals',
    handler: async (c) => {
      need(c, 'moderation:write');
      const user = targetUser(c);
      c.db
        .prepare('UPDATE users SET proposals_blocked_at = NULL, proposals_block_reason = NULL WHERE id = ?')
        .run(user.id);
      return { body: { ok: true } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/features/:id/report',
    handler: async (c) => {
      if (!c.user) throw new HttpError(401, 'login required');
      if (!can(c.user, 'report:create')) throw new HttpError(403, 'proposals_blocked');
      if (!c.limiters.proposalsWrite.allow('u:' + c.user.id, c.now())) {
        throw new HttpError(429, 'too many requests, try again later');
      }
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      // Only what the public sees can be reported; anything else looks like a missing object.
      const map = row ? repo.getMapById(c.db, row.map_id) : null;
      if (!row || row.status !== 'approved' || !map || (!map.published && c.user.role !== 'admin')) {
        throw new HttpError(404, 'feature not found');
      }
      const body = await readJson(c.req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_REPORT_TEXT) throw new HttpError(400, 'text must be 1..500 characters');
      const open = c.db
        .prepare('SELECT 1 FROM reports WHERE feature_id = ? AND user_id = ? AND resolved_at IS NULL')
        .get(id, c.user.id);
      if (open) throw new HttpError(409, 'report_exists');
      const n = c.db
        .prepare('SELECT COUNT(*) AS n FROM reports WHERE user_id = ? AND resolved_at IS NULL')
        .get(c.user.id).n;
      if (n >= MAX_OPEN_REPORTS) throw new HttpError(409, 'reports_limit');
      c.db
        .prepare('INSERT INTO reports (feature_id, user_id, text, created_at) VALUES (?, ?, ?, ?)')
        .run(id, c.user.id, text, sqlTime(c.now()));
      return { status: 201, body: { ok: true } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reports/:id/resolve',
    handler: async (c) => {
      need(c, 'moderation:write');
      const id = idParam(c);
      const row = c.db.prepare('SELECT id, resolved_at FROM reports WHERE id = ?').get(id);
      if (!row) throw new HttpError(404, 'report not found');
      if (row.resolved_at) throw new HttpError(409, 'already resolved');
      c.db
        .prepare('UPDATE reports SET resolved_at = ?, resolved_by = ? WHERE id = ?')
        .run(sqlTime(c.now()), c.user.id, id);
      return { body: { ok: true } };
    },
  },
];
