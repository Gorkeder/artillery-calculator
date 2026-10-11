'use strict';

const crypto = require('node:crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LOGIN_RE = /^[A-Za-z0-9_.-]{3,32}$/;

function scrypt(password, salt, keylen) {
  return crypto.scryptSync(password, salt, keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scrypt(password, salt, SCRYPT.keylen).toString('hex')}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (!salt.length || !expected.length) return false;
  const actual = scrypt(password, salt, expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createUser(db, { login, password, role, email = null, emailVerified = true }) {
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) throw new Error('login must match [A-Za-z0-9_.-]{3,32}');
  if (typeof password !== 'string' || password.length < 8) throw new Error('password must be at least 8 characters');
  if (role !== 'admin' && role !== 'user') throw new Error('role must be admin or user');
  const r = db
    .prepare(
      `INSERT INTO users (login, password_hash, role, email, email_verified_at, password_changed_at)
       VALUES (?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END, datetime('now'))`,
    )
    .run(login, hashPassword(password), role, email === null ? null : String(email).toLowerCase(), emailVerified ? 1 : 0);
  return Number(r.lastInsertRowid);
}

function setPassword(db, login, password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('password must be at least 8 characters');
  const row = db.prepare('SELECT id FROM users WHERE lower(login) = lower(?)').get(String(login));
  if (!row) throw new Error('user not found: ' + login);
  const hash = hashPassword(password);
  // An admin who sets a password proves control of the account: verify the address, close every
  // session and void outstanding one-time links (e.g. a pending reset) — all or nothing.
  db.exec('BEGIN');
  try {
    db.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = datetime('now'),
         email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?`,
    ).run(hash, row.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(row.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(db, userId, nowMs, ttlMs = SESSION_TTL_MS, meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    sha256(token),
    userId,
    nowMs + ttlMs,
    nowMs,
    nowMs,
    meta.ip ? String(meta.ip).slice(0, 64) : null,
    meta.userAgent ? String(meta.userAgent).slice(0, 200) : null,
  );
  return token;
}

const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

// Cheap "last seen": at most one write per session per 10 minutes.
function touchSession(db, token, nowMs) {
  if (!token || typeof token !== 'string') return;
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at < ?').run(
    nowMs,
    sha256(token),
    nowMs - TOUCH_INTERVAL_MS,
  );
}

// Public, non-secret handle of a session: the first 16 hex chars of its stored hash.
function sessionId(token) {
  return sha256(String(token)).slice(0, 16);
}

function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(String(token)));
}

function getSessionUser(db, token, nowMs) {
  if (!token || typeof token !== 'string') return null;
  const row = db
    .prepare(
      `SELECT s.expires_at, u.id, u.login, u.role, u.proposals_blocked_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at <= nowMs) {
    destroySession(db, token);
    return null;
  }
  return { id: row.id, login: row.login, role: row.role, proposalsBlocked: Boolean(row.proposals_blocked_at) };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (!key || key in out) continue;
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // ignore cookies with broken escapes
    }
  }
  return out;
}

function sessionCookie(token, { secure }) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}

function clearCookie({ secure }) {
  return `sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}

function createRateLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    allow(key, nowMs) {
      if (hits.size > 10000) hits.clear();
      const recent = (hits.get(key) || []).filter((t) => nowMs - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(nowMs);
      hits.set(key, recent);
      return true;
    },
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createUser,
  setPassword,
  createSession,
  touchSession,
  sessionId,
  sha256,
  LOGIN_RE,
  getSessionUser,
  destroySession,
  parseCookies,
  sessionCookie,
  clearCookie,
  createRateLimiter,
};
