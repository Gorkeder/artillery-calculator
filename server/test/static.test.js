'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { createStaticHandler } = require('../static');

async function start(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-root-'));
  const uploads = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-up-'));
  fs.writeFileSync(path.join(root, 'index.html'), 'INDEX');
  fs.writeFileSync(path.join(root, 'map.html'), 'MAP');
  fs.writeFileSync(path.join(root, 'app.js'), 'JS');
  fs.mkdirSync(path.join(root, 'server'));
  fs.writeFileSync(path.join(root, 'server', 'db.js'), 'SECRET');
  fs.writeFileSync(path.join(root, '.env'), 'SECRET');
  fs.writeFileSync(path.join(uploads, 'p.png'), 'PNG');
  fs.writeFileSync(path.join(path.dirname(root), 'outside.txt'), 'OUTSIDE');
  const serve = createStaticHandler({ root, uploadsDir: uploads });
  const server = http.createServer(serve);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => {
    server.closeAllConnections();
    server.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(uploads, { recursive: true, force: true });
    fs.rmSync(path.join(path.dirname(root), 'outside.txt'), { force: true });
  });
  const get = async (p) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${p}`);
    return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
  };
  return { get, rootName: path.basename(root) };
}

test('serves index, /map, regular files and uploads with the right types', async (t) => {
  const { get } = await start(t);
  assert.equal((await get('/')).text, 'INDEX');
  assert.equal((await get('/map')).text, 'MAP');
  const js = await get('/app.js');
  assert.equal(js.text, 'JS');
  assert.match(js.type, /javascript/);
  assert.equal((await get('/uploads/p.png')).text, 'PNG');
});

test('denies dotfiles, server sources and path traversal', async (t) => {
  const { get, rootName } = await start(t);
  for (const p of ['/.env', '/server/db.js', '/../outside.txt', '/%2e%2e/outside.txt', `/..%2f${rootName}/.env`, '/uploads/../.env']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.notEqual(r.text, 'SECRET', p);
    assert.notEqual(r.text, 'OUTSIDE', p);
  }
});
