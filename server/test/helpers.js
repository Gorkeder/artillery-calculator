'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../db');
const { createApp } = require('../app');
const { createSession, createUser } = require('../auth');

async function startTestServer(opts = {}) {
  const db = openDb(':memory:');
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-up-'));
  let clock = opts.now || Date.now();
  const app = createApp({
    db,
    uploadsDir,
    cookieSecure: false,
    now: () => clock,
    loginLimiter: opts.loginLimiter,
  });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, url, { body, raw, cookie, headers = {} } = {}) {
    const h = { 'x-requested-with': 'test', ...headers };
    if (cookie) h.cookie = cookie;
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      h['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers: h, body: payload });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, headers: res.headers };
  }

  const adminId = createUser(db, { login: 'admin', password: 'correct horse', role: 'admin' });
  const adminCookie = 'sid=' + createSession(db, adminId, clock);

  return {
    db,
    api,
    base,
    uploadsDir,
    adminId,
    adminCookie,
    setNow(ms) { clock = ms; },
    async cleanup() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startTestServer };
