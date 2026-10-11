'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStaticHandler } = require('../static');

test('dev static maps /account and /privacy to their html files', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-static-'));
  fs.writeFileSync(path.join(root, 'account.html'), '<h1>acc</h1>');
  fs.writeFileSync(path.join(root, 'privacy.html'), '<h1>priv</h1>');
  const server = http.createServer(createStaticHandler({ root, uploadsDir: root }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  assert.equal(await (await fetch(base + '/account')).text(), '<h1>acc</h1>');
  assert.equal(await (await fetch(base + '/privacy')).text(), '<h1>priv</h1>');
});
