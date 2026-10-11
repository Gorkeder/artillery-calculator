'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../db');
const { createApp } = require('../app');
const { createSession, createUser } = require('../auth');
const { createMemoryMailer } = require('../mailer');

async function startTestServer(opts = {}) {
  const db = openDb(':memory:');
  const uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-up-'));
  let clock = opts.now || Date.now();
  const mailer = opts.mailer || createMemoryMailer();
  const app = createApp({
    db,
    uploadsDir,
    cookieSecure: false,
    now: () => clock,
    loginLimiter: opts.loginLimiter,
    limiters: opts.limiters,
    mailer: opts.noMailer ? undefined : mailer,
    publicUrl: 'https://test.local',
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
    mailer,
    // Newest token of the given kind ('verify' | 'reset') found in the memory mailbox.
    lastToken(kind) {
      const re = new RegExp('#' + kind + '=([0-9a-f]{64})');
      for (let i = (mailer.sent || []).length - 1; i >= 0; i--) {
        const m = re.exec(mailer.sent[i].text);
        if (m) return m[1];
      }
      return null;
    },
    setNow(ms) { clock = ms; },
    async cleanup() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startTestServer };
