'use strict';

const crypto = require('node:crypto');
const { sha256 } = require('./auth');

const HOUR = 60 * 60 * 1000;
const TTL_MS = { verify_email: 24 * HOUR, reset_password: HOUR };
const TOKEN_RE = /^[0-9a-f]{64}$/;

function issueToken(db, userId, kind, nowMs) {
  if (!(kind in TTL_MS)) throw new Error('unknown token kind: ' + kind);
  revokeTokens(db, userId, kind, nowMs);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    kind,
    nowMs + TTL_MS[kind],
  );
  return token;
}

function revokeTokens(db, userId, kind, nowMs) {
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL').run(
    nowMs,
    userId,
    kind,
  );
}

function peekToken(db, token, kind, nowMs) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const row = db
    .prepare('SELECT user_id FROM auth_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .get(sha256(token), kind, nowMs);
  return row ? row.user_id : null;
}

// Atomic: of two concurrent requests with the same token exactly one gets changes === 1.
function consumeToken(db, token, kind, nowMs) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const hash = sha256(token);
  const r = db
    .prepare('UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .run(nowMs, hash, kind, nowMs);
  if (r.changes !== 1) return null;
  return db.prepare('SELECT user_id FROM auth_tokens WHERE token_hash = ?').get(hash).user_id;
}

// Drops stale tokens, then unverified accounts older than a day that have no live verification token.
function cleanup(db, nowMs) {
  const dayAgo = nowMs - 24 * HOUR;
  db.prepare(
    'DELETE FROM auth_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)',
  ).run(dayAgo, dayAgo);
  db.prepare(
    `DELETE FROM users
     WHERE email_verified_at IS NULL
       AND created_at < datetime(? / 1000, 'unixepoch')
       AND NOT EXISTS (
         SELECT 1 FROM auth_tokens t
         WHERE t.user_id = users.id AND t.kind = 'verify_email' AND t.used_at IS NULL AND t.expires_at > ?
       )`,
  ).run(dayAgo, nowMs);
  // Rejected proposals nobody deleted: 30 days after the decision. Ones with photos stay: their files
  // live outside the database and this function has no uploads directory to remove them from.
  db.prepare(
    `DELETE FROM features
     WHERE status = 'pending' AND reject_reason IS NOT NULL
       AND reviewed_at IS NOT NULL AND reviewed_at < datetime(? / 1000, 'unixepoch')
       AND NOT EXISTS (SELECT 1 FROM feature_images fi WHERE fi.feature_id = features.id)`,
  ).run(nowMs - 30 * 24 * HOUR);
}

module.exports = { issueToken, peekToken, consumeToken, revokeTokens, cleanup };
