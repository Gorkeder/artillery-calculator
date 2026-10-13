'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStaticHandler } = require('../static');

test('dev static serves clan.html for /clan, /clans, /clans/<tag> and /clan/join/<token>', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-static-'));
  fs.writeFileSync(path.join(root, 'clan.html'), '<h1>clan</h1>');
  fs.writeFileSync(path.join(root, 'clan.js'), 'js');
  const server = http.createServer(createStaticHandler({ root, uploadsDir: root }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => { server.closeAllConnections(); server.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const base = 'http://127.0.0.1:' + server.address().port;
  for (const p of ['/clan', '/clans', '/clans/ALF', '/clans/%D0%92%D0%9E%D0%9B', '/clan/join/' + 'a'.repeat(64)]) {
    assert.equal(await (await fetch(base + p)).text(), '<h1>clan</h1>', p);
  }
  assert.equal(await (await fetch(base + '/clan.js')).text(), 'js', 'scripts are not swallowed');
  assert.equal((await fetch(base + '/clans/a/b')).status, 404);
});
