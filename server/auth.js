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

function createUser(db, { login, password, role }) {
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) throw new Error('login must match [A-Za-z0-9_.-]{3,32}');
  if (typeof password !== 'string' || password.length < 8) throw new Error('password must be at least 8 characters');
  if (role !== 'admin' && role !== 'user') throw new Error('role must be admin or user');
  const r = db
    .prepare('INSERT INTO users (login, password_hash, role) VALUES (?, ?, ?)')
    .run(login, hashPassword(password), role);
  return Number(r.lastInsertRowid);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(db, userId, nowMs, ttlMs = SESSION_TTL_MS) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    nowMs + ttlMs,
  );
  return token;
}

function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(String(token)));
}

function getSessionUser(db, token, nowMs) {
  if (!token || typeof token !== 'string') return null;
  const row = db
    .prepare(
      'SELECT s.expires_at, u.id, u.login, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    )
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at <= nowMs) {
    destroySession(db, token);
    return null;
  }
  return { id: row.id, login: row.login, role: row.role };
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
  createSession,
  getSessionUser,
  destroySession,
  parseCookies,
  sessionCookie,
  clearCookie,
  createRateLimiter,
};
