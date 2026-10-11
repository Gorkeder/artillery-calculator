'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { createStaticHandler } = require('./static');

const cfg = loadConfig();
fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
fs.mkdirSync(cfg.uploadsDir, { recursive: true });

const db = openDb(cfg.dbFile);
const app = createApp({ db, uploadsDir: cfg.uploadsDir, cookieSecure: cfg.cookieSecure });
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
