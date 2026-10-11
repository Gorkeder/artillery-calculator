'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createUser } = require('./auth');
const { seedMap } = require('./seed');

function usage() {
  console.error(
    'Usage:\n' +
      '  ANOMA_PASSWORD=<password> node server/cli.js create-admin <login>\n' +
      '  node server/cli.js seed-map <slug> <title> <path-to-map.js>',
  );
  process.exit(2);
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const cfg = loadConfig();
  fs.mkdirSync(path.dirname(cfg.dbFile), { recursive: true });
  fs.mkdirSync(cfg.uploadsDir, { recursive: true });
  const db = openDb(cfg.dbFile);

  if (cmd === 'create-admin') {
    const [login] = args;
    const password = process.env.ANOMA_PASSWORD;
    if (!login || !password) usage();
    const id = createUser(db, { login, password, role: 'admin' });
    console.log(`admin "${login}" created (id ${id})`);
  } else if (cmd === 'seed-map') {
    const [slug, title, file] = args;
    if (!slug || !title || !file) usage();
    const id = seedMap(db, cfg.uploadsDir, { slug, title, text: fs.readFileSync(file, 'utf8') });
    console.log(`map "${slug}" created (id ${id}) from ${file}`);
  } else {
    usage();
  }
  db.close();
}

try {
  main();
} catch (err) {
  console.error('error:', err.message);
  process.exit(1);
}
