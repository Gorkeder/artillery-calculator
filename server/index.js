'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { createStaticHandler } = require('./static');
const { createMailer, createUnconfiguredMailer } = require('./mailer');
const { cleanup } = require('./tokens');

const cfg = loadConfig();
fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
fs.mkdirSync(cfg.uploadsDir, { recursive: true });

const db = openDb(cfg.dbFile);
// A broken mail config must not take the whole API (and /map) down: run with mail disabled instead.
let mailer;
try {
  mailer = createMailer(cfg);
} catch (err) {
  console.error('anoma-api: mail disabled —', err.message);
  mailer = createUnconfiguredMailer();
}
if (cfg.mailMode && cfg.mailMode !== 'smtp' && cfg.mailMode !== 'log') {
  console.warn(`anoma-api: unknown MAIL_MODE "${cfg.mailMode}" (expected smtp or log), mail is disabled`);
} else if (!mailer.configured && !cfg.mailMode) {
  console.warn('anoma-api: MAIL_MODE is not set, registration and password reset are disabled (503)');
}
const app = createApp({
  db, uploadsDir: cfg.uploadsDir, cookieSecure: cfg.cookieSecure, mailer, publicUrl: cfg.publicUrl,
});
cleanup(db, Date.now());
setInterval(() => cleanup(db, Date.now()), 60 * 60 * 1000).unref();
const serveStatic = cfg.devStatic
  ? createStaticHandler({ root: cfg.devStatic, uploadsDir: cfg.uploadsDir })
  : null;

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) return app(req, res);
  if (serveStatic) return serveStatic(req, res);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  return res.end('not found');
});

server.listen(cfg.port, '127.0.0.1', () => {
  console.log(`anoma-api listening on http://127.0.0.1:${cfg.port} (db: ${cfg.dbFile})`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
