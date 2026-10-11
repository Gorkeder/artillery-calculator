# Interactive Map Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/map` page with several interactive game maps that an admin edits in the browser (points, polygons, lines, categories, text + photos) and visitors view; data lives on the server.

**Architecture:** A zero-dependency Node 22 API (`server/`, `node:http` + `node:sqlite`) behind nginx at `/api/`, SQLite for data, uploaded images on disk served by nginx. The frontend stays build-less: `map.html` + vendored Leaflet (viewer) and Leaflet-Geoman (editor, lazy-loaded only after an admin logs in on desktop). Coordinates are stored as fractions 0..1 of the map image; permissions go through one `can()` function so user accounts can be added later without touching the map.

**Tech Stack:** Node 22 (`node:sqlite`, `node:test`, `crypto.scrypt`), SQLite, Leaflet 1.9.4 (`CRS.Simple`), Leaflet-Geoman 2.17.0, plain JS/CSS, nginx, systemd, GitHub Actions rsync deploy.

**Spec:** `docs/superpowers/specs/2026-10-11-interactive-map-editor-design.md`

## Global Constraints

- Backend: Node 22, **no npm dependencies** (`node:http`, `node:sqlite`, `crypto.scrypt`); no `package.json`, no `node_modules`. Frontend: **no build step**.
- `node:sqlite` needs Node 22.5+ (without a flag: 22.13+); on mismatch update Node, do not add a native dependency.
- Coordinates are **fractions 0..1** of the image width/height (`x` right, `y` down); never pixels.
- Shapes: `point`, `polygon`, `line` only. No circles, no on-map text labels.
- User text is output **only via `textContent`/DOM text nodes**; HTML in titles/descriptions is not supported.
- Uploads: PNG/JPEG/WebP only (type by file signature, never by `Content-Type`), **no SVG**, limit **8 MB**, random file names; nginx serves `/uploads/` with `X-Content-Type-Options: nosniff`.
- Session cookie `sid`: `HttpOnly; Secure; SameSite=Strict`, 30 days, token stored hashed (sha256). All non-GET API requests require header `X-Requested-With`.
- Login attempts rate-limited in the app and in nginx (`limit_req`). Admin is created only via server CLI (`create-admin`), never via web or repo.
- Writes only for role `admin`, through the single `can(user, action, resource)` in `server/permissions.js`; no `role === 'admin'` checks elsewhere. Public reads return `approved` features only; author sees own `pending`; admin sees all.
- Editor is **desktop only** (hidden under 900 px). The viewer is responsive.
- No CDN: Leaflet/Geoman are vendored in `vendor/`. Palette: `#121212` background, `#d4c24f` accent.
- Paths: API on `127.0.0.1:3000`, code in `/opt/anoma-api`, DB `/var/lib/anoma/db/anoma.db` (dir 0700, owner `anoma`), uploads `/var/lib/anoma/uploads/`.
- Tests: `node --test server/test/` and `node --test tools/` (existing style: CommonJS, `'use strict'`, `node:test`, `node:assert/strict`).
- Do not modify `art-calc.html` or `map.js`. `map.js` is listed in `.gitignore`; never commit it.
- Commit messages follow the session's attribution-trailer setting; examples below omit the trailer for brevity.

## Review Focus

Failure modes the spec implies but a plain happy-path suite would miss, most likely first. Each has a test in the named task.

1. **Orphaned upload files** — deleting a feature/category/map, or replacing a map image, must delete the files from disk and must not touch features (Task 7).
2. **Leaking unpublished maps / `pending` features** to anonymous users via the list or by slug (Task 4).
3. **Fake image bodies** — SVG/HTML sent as `image/png`, truncated PNG, empty body, body over 8 MB (Task 7).
4. **Shape/geometry mismatches** — moving a feature to a category of another shape; changing a category's shape while it has features; out-of-range/NaN-like coordinates (Tasks 2 and 6).
5. **Viewer empty/bad states** — no maps yet, map with no image, `?m=nope&f=999` deep link must show a message, never a blank page or exception (Task 10 checklist).

---

## File Structure

```
server/
  db.js                 open SQLite + schema
  validate.js           input validation, image sniffing/size
  auth.js               scrypt, sessions, cookies, rate limiter, createUser
  permissions.js        can(), capabilities(), featureFilter()
  http-util.js          HttpError, readBody, readJson, sendJson
  files.js              storeFile, unlinkAll, EXT
  repo.js               all SQL reads/writes
  app.js                createApp(): routing, CSRF, auth context, error handling
  routes/auth.js        /api/login /api/logout /api/me
  routes/content.js     maps, categories, features
  routes/images.js      map image, feature photos
  static.js             DEV-only static file handler
  config.js             env -> {port, dbFile, uploadsDir, ...}
  index.js              http server entry
  seed.js               seedMap(): map.js data URI -> file + maps row
  cli.js                create-admin, seed-map
  deploy/               nginx snippet + systemd unit (not served)
  test/                 *.test.js + helpers.js
vendor/leaflet/, vendor/geoman/, vendor/README.md
map.html                page shell
map-app.css             styles (viewer + editor)
map-common.js           window.MapApi, window.h (DOM helper)
map-geo.js              pure geometry/style helpers (UMD, unit-tested)
map-icons.js            window.MAP_ICONS (20 SVG icons)
map-app.js              viewer -> window.MapViewer
map-editor.js           editor core (lazy)
map-editor-dialogs.js   category/map managers (lazy)
tools/map-geo.test.js
```

---

### Task 1: Server scaffold and database schema

**Files:**
- Create: `server/db.js`
- Test: `server/test/db.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `openDb(file: string): DatabaseSync` — opens the file (use `':memory:'` in tests), applies schema idempotently. Tables: `users, sessions, maps, categories, features, feature_images`.

- [ ] **Step 1: Check the runtime**

Run: `node --version && node -e "require('node:sqlite'); console.log('sqlite ok')"`
Expected: version `v22.13.0` or newer and `sqlite ok` (an ExperimentalWarning on stderr is fine). If it fails, stop and update Node (locally; the VPS is checked in Task 14).

- [ ] **Step 2: Write the failing test**

Create `server/test/db.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');

test('openDb creates all tables', () => {
  const db = openDb(':memory:');
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all()
    .map((r) => r.name);
  for (const t of ['users', 'sessions', 'maps', 'categories', 'features', 'feature_images']) {
    assert.ok(names.includes(t), 'missing table ' + t);
  }
});

test('deleting a map cascades to categories, features and feature images', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO maps (slug, title) VALUES ('a', 'A')").run();
  db.prepare("INSERT INTO categories (map_id, name) VALUES (1, 'c')").run();
  db.prepare("INSERT INTO features (map_id, category_id, geometry) VALUES (1, 1, '{}')").run();
  db.prepare("INSERT INTO feature_images (feature_id, path) VALUES (1, 'x.png')").run();
  db.prepare('DELETE FROM maps WHERE id = 1').run();
  for (const t of ['categories', 'features', 'feature_images']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  }
});

test('features.status only accepts approved or pending', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO maps (slug, title) VALUES ('a', 'A')").run();
  db.prepare("INSERT INTO categories (map_id, name) VALUES (1, 'c')").run();
  assert.throws(() =>
    db
      .prepare("INSERT INTO features (map_id, category_id, geometry, status) VALUES (1, 1, '{}', 'bogus')")
      .run(),
  );
});

test('users.role only accepts admin or user', () => {
  const db = openDb(':memory:');
  assert.throws(() =>
    db.prepare("INSERT INTO users (login, password_hash, role) VALUES ('a', 'h', 'root')").run(),
  );
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test server/test/db.test.js`
Expected: FAIL — `Cannot find module '../db'`.

- [ ] **Step 4: Write the implementation**

Create `server/db.js`:

```js
'use strict';

const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  image_path TEXT,
  width INTEGER,
  height INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#d4c24f',
  icon TEXT NOT NULL DEFAULT 'question',
  shape TEXT NOT NULL DEFAULT 'point' CHECK (shape IN ('point', 'polygon', 'line')),
  visible_default INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  geometry TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT,
  opacity REAL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_features_map ON features(map_id);
CREATE INDEX IF NOT EXISTS idx_features_category ON features(category_id);
CREATE TABLE IF NOT EXISTS feature_images (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
`;

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb };
```

Append to `.gitignore`:

```
# Локальная dev-база и загрузки редактора карты.
.dev/
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test server/test/db.test.js`
Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/test/db.test.js .gitignore
git commit -m "feat(server): SQLite schema for maps, categories, features, users"
```

---

### Task 2: Input validation and image sniffing

**Files:**
- Create: `server/validate.js`
- Test: `server/test/validate.test.js`

**Interfaces:**
- Produces (all return `{ok:true, value}` or `{ok:false, error:string}` unless noted):
  - `validateGeometry(shape: 'point'|'polygon'|'line', g: any)` → value `{x,y}` or `{points:[[x,y],…]}`
  - `validateCategory(input, {create?: boolean})` → value subset of `{name,color,icon,shape,visible_default(0|1),sort}`
  - `validateFeature(input, {create?: boolean})` → value subset of `{title,description,color,opacity}`
  - `validateMap(input, {create?: boolean})` → value subset of `{slug,title,sort,published(0|1)}`
  - `sniffImageType(buf: Buffer): 'png'|'jpeg'|'webp'|null`
  - `imageSize(buf: Buffer): {width,height}|null`

- [ ] **Step 1: Write the failing test**

Create `server/test/validate.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../validate');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w, h) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.alloc(9),
  ]);
const jpeg = (w, h) =>
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 3,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const le24 = (n) => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255]);
const webpX = (w, h) =>
  Buffer.concat([
    Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.from('VP8X'),
    Buffer.from([10, 0, 0, 0]), Buffer.alloc(4), le24(w - 1), le24(h - 1),
  ]);

test('validateGeometry accepts a point in the unit square', () => {
  assert.deepEqual(v.validateGeometry('point', { x: 0, y: 1, extra: 1 }), { ok: true, value: { x: 0, y: 1 } });
});

test('validateGeometry rejects out-of-range, non-numeric and non-finite coordinates', () => {
  for (const bad of [{ x: 1.01, y: 0 }, { x: -0.1, y: 0 }, { x: '0.5', y: 0 }, { x: null, y: 0 }, { x: NaN, y: 0 }, { x: Infinity, y: 0 }, {}]) {
    assert.equal(v.validateGeometry('point', bad).ok, false, JSON.stringify(bad));
  }
});

test('validateGeometry polygon needs 3+ points, line needs 2+', () => {
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0], [1, 0]] }).ok, false);
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0], [1, 0], [1, 1]] }).ok, true);
  assert.equal(v.validateGeometry('line', { points: [[0, 0]] }).ok, false);
  assert.equal(v.validateGeometry('line', { points: [[0, 0], [1, 1]] }).ok, true);
});

test('validateGeometry rejects malformed points and oversized point lists', () => {
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0], [1, 0], [2, 1]] }).ok, false);
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0], [1, 0], 'x'] }).ok, false);
  assert.equal(v.validateGeometry('polygon', { points: [[0, 0, 0], [1, 0], [1, 1]] }).ok, false);
  const many = Array.from({ length: 2001 }, () => [0.5, 0.5]);
  assert.equal(v.validateGeometry('polygon', { points: many }).ok, false);
  assert.equal(v.validateGeometry('hexagon', { x: 0, y: 0 }).ok, false);
});

test('validateCategory create requires a name and checks every field', () => {
  assert.equal(v.validateCategory({}, { create: true }).ok, false);
  const r = v.validateCategory(
    { name: '  Тайники ', color: '#aabbcc', icon: 'cache', shape: 'point', visible_default: false, sort: 3 },
    { create: true },
  );
  assert.deepEqual(r.value, { name: 'Тайники', color: '#aabbcc', icon: 'cache', shape: 'point', visible_default: 0, sort: 3 });
  assert.equal(v.validateCategory({ color: 'red' }).ok, false);
  assert.equal(v.validateCategory({ icon: '<script>' }).ok, false);
  assert.equal(v.validateCategory({ shape: 'circle' }).ok, false);
  assert.equal(v.validateCategory({ name: 'x'.repeat(61) }).ok, false);
});

test('validateCategory partial update only returns provided fields', () => {
  assert.deepEqual(v.validateCategory({ color: '#000000' }).value, { color: '#000000' });
});

test('validateFeature checks title, description, color and opacity', () => {
  assert.deepEqual(v.validateFeature({ title: 'Т', description: 'd', color: null, opacity: 0.5 }).value, {
    title: 'Т', description: 'd', color: null, opacity: 0.5,
  });
  assert.equal(v.validateFeature({ title: 'x'.repeat(121) }).ok, false);
  assert.equal(v.validateFeature({ description: 'x'.repeat(4001) }).ok, false);
  assert.equal(v.validateFeature({ color: 'blue' }).ok, false);
  assert.equal(v.validateFeature({ opacity: 1.5 }).ok, false);
  assert.equal(v.validateFeature({ title: 5 }).ok, false);
});

test('validateMap create needs slug and title; slug charset is restricted', () => {
  assert.equal(v.validateMap({ title: 'T' }, { create: true }).ok, false);
  assert.equal(v.validateMap({ slug: 'Wild North', title: 'T' }, { create: true }).ok, false);
  assert.deepEqual(v.validateMap({ slug: 'wild-north', title: ' Дикий север ', published: true }, { create: true }).value, {
    slug: 'wild-north', title: 'Дикий север', published: 1,
  });
  assert.equal(v.validateMap({ published: 'yes' }).ok, false);
});

test('sniffImageType detects png/jpeg/webp by signature and rejects everything else', () => {
  assert.equal(v.sniffImageType(png(1, 1)), 'png');
  assert.equal(v.sniffImageType(jpeg(1, 1)), 'jpeg');
  assert.equal(v.sniffImageType(webpX(1, 1)), 'webp');
  assert.equal(v.sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(v.sniffImageType(Buffer.from('<html><script>alert(1)</script>')), null);
  assert.equal(v.sniffImageType(Buffer.alloc(0)), null);
});

test('imageSize reads dimensions of png, jpeg and webp', () => {
  assert.deepEqual(v.imageSize(png(640, 480)), { width: 640, height: 480 });
  assert.deepEqual(v.imageSize(jpeg(300, 200)), { width: 300, height: 200 });
  assert.deepEqual(v.imageSize(webpX(1024, 768)), { width: 1024, height: 768 });
});

test('imageSize returns null for truncated files', () => {
  assert.equal(v.imageSize(png(10, 10).subarray(0, 12)), null);
  assert.equal(v.imageSize(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), null);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test server/test/validate.test.js`
Expected: FAIL — `Cannot find module '../validate'`.

- [ ] **Step 3: Write the implementation**

Create `server/validate.js`:

```js
'use strict';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const ICON_RE = /^[a-z0-9-]{1,32}$/;
const SHAPES = ['point', 'polygon', 'line'];
const MAX_POINTS = 2000;

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

function inUnit(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

function validateGeometry(shape, g) {
  if (!g || typeof g !== 'object') return fail('geometry must be an object');
  if (shape === 'point') {
    if (!inUnit(g.x) || !inUnit(g.y)) return fail('point x and y must be numbers in 0..1');
    return ok({ x: g.x, y: g.y });
  }
  if (shape === 'polygon' || shape === 'line') {
    const min = shape === 'polygon' ? 3 : 2;
    if (!Array.isArray(g.points) || g.points.length < min || g.points.length > MAX_POINTS) {
      return fail(`${shape} needs ${min}..${MAX_POINTS} points`);
    }
    const points = [];
    for (const p of g.points) {
      if (!Array.isArray(p) || p.length !== 2 || !inUnit(p[0]) || !inUnit(p[1])) {
        return fail('every point must be [x, y] with numbers in 0..1');
      }
      points.push([p[0], p[1]]);
    }
    return ok({ points });
  }
  return fail('unknown shape');
}

function validateCategory(input, { create = false } = {}) {
  const out = {};
  if (create || 'name' in input) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60) {
      return fail('name must be 1..60 characters');
    }
    out.name = input.name.trim();
  }
  if ('color' in input) {
    if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) return fail('color must be #rrggbb');
    out.color = input.color;
  }
  if ('icon' in input) {
    if (typeof input.icon !== 'string' || !ICON_RE.test(input.icon)) return fail('icon must match [a-z0-9-]{1,32}');
    out.icon = input.icon;
  }
  if ('shape' in input) {
    if (!SHAPES.includes(input.shape)) return fail('shape must be point, polygon or line');
    out.shape = input.shape;
  }
  if ('visible_default' in input) {
    if (typeof input.visible_default !== 'boolean') return fail('visible_default must be boolean');
    out.visible_default = input.visible_default ? 1 : 0;
  }
  if ('sort' in input) {
    if (!Number.isInteger(input.sort)) return fail('sort must be an integer');
    out.sort = input.sort;
  }
  return ok(out);
}

function validateFeature(input, { create = false } = {}) {
  void create;
  const out = {};
  if ('title' in input) {
    if (typeof input.title !== 'string' || input.title.length > 120) return fail('title must be a string up to 120 characters');
    out.title = input.title;
  }
  if ('description' in input) {
    if (typeof input.description !== 'string' || input.description.length > 4000) {
      return fail('description must be a string up to 4000 characters');
    }
    out.description = input.description;
  }
  if ('color' in input) {
    if (input.color !== null && (typeof input.color !== 'string' || !COLOR_RE.test(input.color))) {
      return fail('color must be null or #rrggbb');
    }
    out.color = input.color;
  }
  if ('opacity' in input) {
    if (input.opacity !== null && !inUnit(input.opacity)) return fail('opacity must be null or a number in 0..1');
    out.opacity = input.opacity;
  }
  return ok(out);
}

function validateMap(input, { create = false } = {}) {
  const out = {};
  if (create || 'slug' in input) {
    if (typeof input.slug !== 'string' || !SLUG_RE.test(input.slug)) return fail('slug must match [a-z0-9-]{1,40}');
    out.slug = input.slug;
  }
  if (create || 'title' in input) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80) {
      return fail('title must be 1..80 characters');
    }
    out.title = input.title.trim();
  }
  if ('sort' in input) {
    if (!Number.isInteger(input.sort)) return fail('sort must be an integer');
    out.sort = input.sort;
  }
  if ('published' in input) {
    if (typeof input.published !== 'boolean') return fail('published must be boolean');
    out.published = input.published ? 1 : 0;
  }
  return ok(out);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sniffImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

function imageSize(buf) {
  const type = sniffImageType(buf);
  if (type === 'png') {
    if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (type === 'jpeg') {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (type === 'webp') {
    const fourcc = buf.toString('latin1', 12, 16);
    if (fourcc === 'VP8X' && buf.length >= 30) {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  return null;
}

module.exports = {
  validateGeometry,
  validateCategory,
  validateFeature,
  validateMap,
  sniffImageType,
  imageSize,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/test/validate.test.js`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/validate.js server/test/validate.test.js
git commit -m "feat(server): input validation and image signature/size parsing"
```

---

### Task 3: Authentication primitives and permissions

**Files:**
- Create: `server/auth.js`, `server/permissions.js`
- Test: `server/test/auth.test.js`, `server/test/permissions.test.js`

**Interfaces:**
- Consumes: `openDb` (Task 1).
- Produces (`server/auth.js`):
  - `hashPassword(password: string): string`, `verifyPassword(password: string, stored: string): boolean`
  - `createUser(db, {login, password, role}): number` — throws `Error` on invalid login (`/^[A-Za-z0-9_.-]{3,32}$/`) or password < 8 chars; role `'admin'|'user'`
  - `createSession(db, userId: number, nowMs: number, ttlMs?: number): string` (raw token)
  - `getSessionUser(db, token: string|null, nowMs: number): {id, login, role}|null`
  - `destroySession(db, token: string): void`
  - `parseCookies(header: string|undefined): Record<string,string>`
  - `sessionCookie(token, {secure}): string`, `clearCookie({secure}): string`
  - `createRateLimiter({max, windowMs}): {allow(key: string, nowMs: number): boolean}`
- Produces (`server/permissions.js`):
  - `can(user|null, action, resource?): boolean` — actions: `'map:write'|'category:write'|'feature:create'|'feature:update'|'feature:delete'|'image:write'`; throws on unknown action
  - `capabilities(user|null): {map: boolean, category: boolean, feature: boolean}`
  - `featureFilter(user|null): {all: boolean, authorId: number|null}`

- [ ] **Step 1: Write the failing tests**

Create `server/test/auth.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const a = require('../auth');

test('hashPassword/verifyPassword round-trip and reject wrong password', () => {
  const stored = a.hashPassword('correct horse');
  assert.ok(stored.startsWith('scrypt$'));
  assert.equal(a.verifyPassword('correct horse', stored), true);
  assert.equal(a.verifyPassword('wrong', stored), false);
  assert.equal(a.verifyPassword('x', 'garbage'), false);
});

test('hashPassword uses a fresh salt each time', () => {
  assert.notEqual(a.hashPassword('same-password'), a.hashPassword('same-password'));
});

test('createUser validates login and password and stores a hash', () => {
  const db = openDb(':memory:');
  assert.throws(() => a.createUser(db, { login: 'a', password: 'longenough', role: 'admin' }));
  assert.throws(() => a.createUser(db, { login: 'admin', password: 'short', role: 'admin' }));
  assert.throws(() => a.createUser(db, { login: 'admin', password: 'longenough', role: 'root' }));
  const id = a.createUser(db, { login: 'admin', password: 'longenough', role: 'admin' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  assert.equal(row.role, 'admin');
  assert.notEqual(row.password_hash, 'longenough');
});

test('sessions: valid token resolves user, token is stored hashed, expiry and destroy invalidate', () => {
  const db = openDb(':memory:');
  const uid = a.createUser(db, { login: 'admin', password: 'longenough', role: 'admin' });
  const token = a.createSession(db, uid, 1000, 5000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(token).n, 0);
  assert.deepEqual({ ...a.getSessionUser(db, token, 2000) }, { id: uid, login: 'admin', role: 'admin' });
  assert.equal(a.getSessionUser(db, token, 6000), null);
  const t2 = a.createSession(db, uid, 1000, 5000);
  a.destroySession(db, t2);
  assert.equal(a.getSessionUser(db, t2, 2000), null);
  assert.equal(a.getSessionUser(db, null, 2000), null);
  assert.equal(a.getSessionUser(db, 'nonsense', 2000), null);
});

test('deleting a user invalidates their sessions', () => {
  const db = openDb(':memory:');
  const uid = a.createUser(db, { login: 'bob_user', password: 'longenough', role: 'user' });
  const token = a.createSession(db, uid, 0);
  db.prepare('DELETE FROM users WHERE id = ?').run(uid);
  assert.equal(a.getSessionUser(db, token, 1), null);
});

test('parseCookies handles multiple cookies, spaces and bad escapes', () => {
  assert.deepEqual(a.parseCookies('a=1; sid=abc; b=%20x'), { a: '1', sid: 'abc', b: ' x' });
  assert.deepEqual(a.parseCookies(undefined), {});
  assert.deepEqual(a.parseCookies('bad=%E0%A4%A; ok=1'), { ok: '1' });
});

test('sessionCookie has HttpOnly, SameSite=Strict, 30-day Max-Age; Secure is optional', () => {
  const c = a.sessionCookie('tok', { secure: true });
  assert.match(c, /^sid=tok; /);
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Max-Age=2592000', 'Path=/', 'Secure']) assert.ok(c.includes(part), part);
  assert.ok(!a.sessionCookie('tok', { secure: false }).includes('Secure'));
  assert.match(a.clearCookie({ secure: true }), /Max-Age=0/);
});

test('rate limiter blocks after max hits inside the window and recovers', () => {
  const rl = a.createRateLimiter({ max: 2, windowMs: 1000 });
  assert.equal(rl.allow('ip', 0), true);
  assert.equal(rl.allow('ip', 10), true);
  assert.equal(rl.allow('ip', 20), false);
  assert.equal(rl.allow('other', 20), true);
  assert.equal(rl.allow('ip', 1500), true);
});
```

Create `server/test/permissions.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { can, capabilities, featureFilter } = require('../permissions');

const admin = { id: 1, login: 'a', role: 'admin' };
const user = { id: 2, login: 'u', role: 'user' };

test('v1: only admin can write', () => {
  for (const action of ['map:write', 'category:write', 'feature:create', 'feature:update', 'feature:delete', 'image:write']) {
    assert.equal(can(admin, action), true, action);
    assert.equal(can(user, action), false, action);
    assert.equal(can(null, action), false, action);
  }
});

test('unknown action throws so typos cannot silently deny/allow', () => {
  assert.throws(() => can(admin, 'feature:publish'));
});

test('capabilities reflect can()', () => {
  assert.deepEqual(capabilities(admin), { map: true, category: true, feature: true });
  assert.deepEqual(capabilities(null), { map: false, category: false, feature: false });
});

test('featureFilter: admin sees all, user sees approved + own, anonymous only approved', () => {
  assert.deepEqual(featureFilter(admin), { all: true, authorId: null });
  assert.deepEqual(featureFilter(user), { all: false, authorId: 2 });
  assert.deepEqual(featureFilter(null), { all: false, authorId: null });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test server/test/auth.test.js server/test/permissions.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

Create `server/auth.js`:

```js
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
```

Create `server/permissions.js`:

```js
'use strict';

const ACTIONS = new Set([
  'map:write',
  'category:write',
  'feature:create',
  'feature:update',
  'feature:delete',
  'image:write',
]);

// The only place that decides who may do what. v1: admins only.
// Later: let role 'user' create features (status 'pending') and update/delete their own
// pending ones by inspecting `resource` (a feature row with author_id/status).
function can(user, action, resource) {
  void resource;
  if (!ACTIONS.has(action)) throw new Error('unknown action: ' + action);
  if (!user) return false;
  return user.role === 'admin';
}

function capabilities(user) {
  return {
    map: can(user, 'map:write'),
    category: can(user, 'category:write'),
    feature: can(user, 'feature:create'),
  };
}

// Which features a viewer may read: everything, or approved + their own.
function featureFilter(user) {
  if (user && user.role === 'admin') return { all: true, authorId: null };
  return { all: false, authorId: user ? user.id : null };
}

module.exports = { can, capabilities, featureFilter };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test server/test/auth.test.js server/test/permissions.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/auth.js server/permissions.js server/test/auth.test.js server/test/permissions.test.js
git commit -m "feat(server): password hashing, sessions, rate limiter, permissions"
```

---

### Task 4: HTTP core, repository and public read endpoints

**Files:**
- Create: `server/http-util.js`, `server/files.js`, `server/repo.js`, `server/app.js`, `server/routes/content.js`, `server/test/helpers.js`
- Test: `server/test/public.test.js`

**Interfaces:**
- Consumes: `openDb`, `createUser`, `createSession`, `getSessionUser`, `parseCookies`, `createRateLimiter`, `featureFilter`, `can`.
- Produces:
  - `http-util`: `HttpError(status, message)`, `readBody(req, limit): Promise<Buffer>` (413 over limit), `readJson(req, limit?): Promise<object>` (400 on bad JSON / non-object), `sendJson(res, status, body, headers?)`.
  - `files`: `EXT = {png:'png', jpeg:'jpg', webp:'webp'}`, `storeFile(uploadsDir, subdir, buf, ext): string` (relative path like `maps/<32hex>.png`), `unlinkAll(uploadsDir, relPaths: string[]): void` (best-effort, never escapes `uploadsDir`).
  - `repo` (all take `db` first): `listMaps(db,{includeUnpublished})`, `getMapBySlug(db,slug)`, `getMapById(db,id)`, `rawMapImagePath(db,id)`, `listCategories(db,mapId)`, `getCategory(db,id)`, `listFeatures(db,mapId,viewer)`, `getFeature(db,id)`, `rawFeature(db,id)`, `countFeaturesInCategory(db,id)`, `insertRow(db,table,fields): number`, `updateRow(db,table,id,fields)`, `deleteRow(db,table,id)`, `imagePathsFor(db,'feature'|'category'|'map',id): string[]`, `addFeatureImage(db,featureId,path): {id,url}`, `getFeatureImage(db,id)`, `countFeatureImages(db,featureId)`.
    - Map out: `{id,slug,title,width,height,image_url,sort,published}`; category out: `{id,map_id,name,color,icon,shape,visible_default,sort}`; feature out: `{id,map_id,category_id,geometry,title,description,color,opacity,status,author_id,images:[{id,url}]}`.
  - `app`: `createApp({db, uploadsDir, cookieSecure?, now?, loginLimiter?}): (req,res)=>Promise<void>`. Route modules are arrays of `{method, pattern, handler}`; `handler(c)` returns `{status?, body}`; context `c = {db, uploadsDir, cookieSecure, loginLimiter, now, req, res, params, query, user, token, headers, ip}`; handlers may set `c.headers['Set-Cookie']`.
  - `test/helpers`: `startTestServer({now?, loginLimiter?})` → `{db, api(method,url,{body?,raw?,cookie?,headers?}) → {status,json,headers}, base, uploadsDir, adminId, adminCookie, setNow(ms), cleanup()}`.

- [ ] **Step 1: Write the failing test**

Create `server/test/helpers.js`:

```js
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
```

Create `server/test/public.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

function seed(db) {
  db.prepare("INSERT INTO maps (slug, title, width, height, image_path, published, sort) VALUES ('pub', 'Pub', 100, 50, 'maps/a.png', 1, 0)").run();
  db.prepare("INSERT INTO maps (slug, title, published, sort) VALUES ('draft', 'Draft', 0, 1)").run();
  db.prepare("INSERT INTO categories (map_id, name, shape) VALUES (1, 'Тайники', 'point')").run();
  db.prepare(`INSERT INTO features (map_id, category_id, geometry, title, status) VALUES (1, 1, '{"x":0.5,"y":0.5}', 'Открытый', 'approved')`).run();
  db.prepare(`INSERT INTO features (map_id, category_id, geometry, title, status) VALUES (1, 1, '{"x":0.1,"y":0.1}', 'Ждёт', 'pending')`).run();
  db.prepare("INSERT INTO feature_images (feature_id, path) VALUES (1, 'features/p.jpg')").run();
}

test('GET /api/maps lists only published maps for anonymous visitors', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  const r = await s.api('GET', '/api/maps');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((m) => m.slug), ['pub']);
  assert.equal(r.json[0].image_url, '/uploads/maps/a.png');
});

test('GET /api/maps includes unpublished maps for admin', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  const r = await s.api('GET', '/api/maps', { cookie: s.adminCookie });
  assert.deepEqual(r.json.map((m) => m.slug), ['pub', 'draft']);
});

test('GET /api/maps/:slug returns categories and only approved features with photo urls', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  const r = await s.api('GET', '/api/maps/pub');
  assert.equal(r.status, 200);
  assert.equal(r.json.map.slug, 'pub');
  assert.equal(r.json.categories.length, 1);
  assert.equal(r.json.categories[0].visible_default, true);
  assert.deepEqual(r.json.features.map((f) => f.title), ['Открытый']);
  assert.deepEqual(r.json.features[0].geometry, { x: 0.5, y: 0.5 });
  assert.deepEqual(r.json.features[0].images.map((i) => i.url), ['/uploads/features/p.jpg']);
});

test('admin also sees pending features', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  const r = await s.api('GET', '/api/maps/pub', { cookie: s.adminCookie });
  assert.deepEqual(r.json.features.map((f) => f.title), ['Открытый', 'Ждёт']);
});

test('unpublished map is 404 for anonymous, visible for admin', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  seed(s.db);
  assert.equal((await s.api('GET', '/api/maps/draft')).status, 404);
  assert.equal((await s.api('GET', '/api/maps/draft', { cookie: s.adminCookie })).status, 200);
  assert.equal((await s.api('GET', '/api/maps/nope')).status, 404);
});

test('unknown api route is a json 404', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('GET', '/api/nothing');
  assert.equal(r.status, 404);
  assert.equal(typeof r.json.error, 'string');
});

test('non-GET requests without X-Requested-With are rejected with 403', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const res = await fetch(s.base + '/api/maps', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test server/test/public.test.js`
Expected: FAIL — `Cannot find module '../app'`.

- [ ] **Step 3: Write `server/http-util.js` and `server/files.js`**

Create `server/http-util.js`:

```js
'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Reads the whole body but drains (instead of destroying the socket) when over the limit,
// so the client still receives a clean 413 response.
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        tooBig = true;
        chunks.length = 0;
      } else if (!tooBig) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'payload too large')) : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 100 * 1024) {
  const buf = await readBody(req, limit);
  if (buf.length === 0) return {};
  let value;
  try {
    value = JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid json');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'json object expected');
  }
  return value;
}

function sendJson(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}

module.exports = { HttpError, readBody, readJson, sendJson };
```

Create `server/files.js`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };

function storeFile(uploadsDir, subdir, buf, ext) {
  const rel = `${subdir}/${crypto.randomBytes(16).toString('hex')}.${ext}`;
  const abs = path.join(uploadsDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
  return rel;
}

function unlinkAll(uploadsDir, relPaths) {
  const root = path.resolve(uploadsDir) + path.sep;
  for (const rel of relPaths) {
    if (!rel) continue;
    const abs = path.resolve(uploadsDir, rel);
    if (!abs.startsWith(root)) continue;
    try {
      fs.unlinkSync(abs);
    } catch {
      // already gone
    }
  }
}

module.exports = { EXT, storeFile, unlinkAll };
```

- [ ] **Step 4: Write `server/repo.js`**

Create `server/repo.js`:

```js
'use strict';

const { featureFilter } = require('./permissions');

const uploadUrl = (p) => '/uploads/' + p;

function mapOut(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    width: r.width,
    height: r.height,
    image_url: r.image_path ? uploadUrl(r.image_path) : null,
    sort: r.sort,
    published: !!r.published,
  };
}

function categoryOut(r) {
  return {
    id: r.id,
    map_id: r.map_id,
    name: r.name,
    color: r.color,
    icon: r.icon,
    shape: r.shape,
    visible_default: !!r.visible_default,
    sort: r.sort,
  };
}

function featureOut(r, images) {
  return {
    id: r.id,
    map_id: r.map_id,
    category_id: r.category_id,
    geometry: JSON.parse(r.geometry),
    title: r.title,
    description: r.description,
    color: r.color,
    opacity: r.opacity,
    status: r.status,
    author_id: r.author_id,
    images: images || [],
  };
}

function listMaps(db, { includeUnpublished = false } = {}) {
  const sql = 'SELECT * FROM maps' + (includeUnpublished ? '' : ' WHERE published = 1') + ' ORDER BY sort, id';
  return db.prepare(sql).all().map(mapOut);
}

function getMapBySlug(db, slug) {
  const r = db.prepare('SELECT * FROM maps WHERE slug = ?').get(slug);
  return r ? mapOut(r) : null;
}

function getMapById(db, id) {
  const r = db.prepare('SELECT * FROM maps WHERE id = ?').get(id);
  return r ? mapOut(r) : null;
}

function rawMapImagePath(db, id) {
  const r = db.prepare('SELECT image_path FROM maps WHERE id = ?').get(id);
  return r ? r.image_path : null;
}

function listCategories(db, mapId) {
  return db.prepare('SELECT * FROM categories WHERE map_id = ? ORDER BY sort, id').all(mapId).map(categoryOut);
}

function getCategory(db, id) {
  const r = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  return r ? categoryOut(r) : null;
}

function groupImages(rows) {
  const byFeature = new Map();
  for (const r of rows) {
    if (!byFeature.has(r.feature_id)) byFeature.set(r.feature_id, []);
    byFeature.get(r.feature_id).push({ id: r.id, url: uploadUrl(r.path) });
  }
  return byFeature;
}

function listFeatures(db, mapId, viewer) {
  const filter = featureFilter(viewer);
  let sql = 'SELECT * FROM features WHERE map_id = ?';
  const params = [mapId];
  if (!filter.all) {
    sql += " AND (status = 'approved'";
    if (filter.authorId !== null) {
      sql += ' OR author_id = ?';
      params.push(filter.authorId);
    }
    sql += ')';
  }
  sql += ' ORDER BY id';
  const rows = db.prepare(sql).all(...params);
  const imgs = groupImages(
    db
      .prepare(
        'SELECT fi.id, fi.feature_id, fi.path FROM feature_images fi JOIN features f ON f.id = fi.feature_id WHERE f.map_id = ? ORDER BY fi.sort, fi.id',
      )
      .all(mapId),
  );
  return rows.map((r) => featureOut(r, imgs.get(r.id)));
}

function rawFeature(db, id) {
  return db.prepare('SELECT * FROM features WHERE id = ?').get(id) || null;
}

function getFeature(db, id) {
  const r = rawFeature(db, id);
  if (!r) return null;
  const imgs = groupImages(
    db.prepare('SELECT id, feature_id, path FROM feature_images WHERE feature_id = ? ORDER BY sort, id').all(id),
  );
  return featureOut(r, imgs.get(id));
}

function countFeaturesInCategory(db, id) {
  return db.prepare('SELECT COUNT(*) AS n FROM features WHERE category_id = ?').get(id).n;
}

// `table` and the keys of `fields` always come from code / validators, never from request input.
function insertRow(db, table, fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(db.prepare(sql).run(...keys.map((k) => fields[k])).lastInsertRowid);
}

function updateRow(db, table, id, fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), id);
}

function deleteRow(db, table, id) {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

function imagePathsFor(db, kind, id) {
  const sql = {
    feature: 'SELECT path FROM feature_images WHERE feature_id = ?',
    category:
      'SELECT fi.path FROM feature_images fi JOIN features f ON f.id = fi.feature_id WHERE f.category_id = ?',
    map: 'SELECT fi.path FROM feature_images fi JOIN features f ON f.id = fi.feature_id WHERE f.map_id = ?',
  }[kind];
  return db.prepare(sql).all(id).map((r) => r.path);
}

function countFeatureImages(db, featureId) {
  return db.prepare('SELECT COUNT(*) AS n FROM feature_images WHERE feature_id = ?').get(featureId).n;
}

function addFeatureImage(db, featureId, path) {
  const id = insertRow(db, 'feature_images', { feature_id: featureId, path, sort: countFeatureImages(db, featureId) });
  return { id, url: uploadUrl(path) };
}

function getFeatureImage(db, id) {
  return db.prepare('SELECT id, feature_id, path FROM feature_images WHERE id = ?').get(id) || null;
}

module.exports = {
  listMaps,
  getMapBySlug,
  getMapById,
  rawMapImagePath,
  listCategories,
  getCategory,
  listFeatures,
  getFeature,
  rawFeature,
  countFeaturesInCategory,
  insertRow,
  updateRow,
  deleteRow,
  imagePathsFor,
  countFeatureImages,
  addFeatureImage,
  getFeatureImage,
};
```

- [ ] **Step 5: Write `server/routes/content.js` (public reads only for now) and `server/app.js`**

Create `server/routes/content.js`:

```js
'use strict';

const { HttpError } = require('../http-util');
const { can } = require('../permissions');
const repo = require('../repo');

module.exports = [
  {
    method: 'GET',
    pattern: '/api/maps',
    handler: async (c) => ({
      body: repo.listMaps(c.db, { includeUnpublished: can(c.user, 'map:write') }),
    }),
  },
  {
    method: 'GET',
    pattern: '/api/maps/:slug',
    handler: async (c) => {
      const map = repo.getMapBySlug(c.db, c.params.slug);
      if (!map || (!map.published && !can(c.user, 'map:write'))) throw new HttpError(404, 'map not found');
      return {
        body: {
          map,
          categories: repo.listCategories(c.db, map.id),
          features: repo.listFeatures(c.db, map.id, c.user),
        },
      };
    },
  },
];
```

Create `server/app.js`:

```js
'use strict';

const { HttpError, sendJson } = require('./http-util');
const { parseCookies, getSessionUser, createRateLimiter } = require('./auth');

const ROUTE_MODULES = [require('./routes/content')];

function compile(pattern) {
  const keys = [];
  const source = pattern.replace(/:([a-z]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { re: new RegExp('^' + source + '/?$'), keys };
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function createApp(opts) {
  const { db, uploadsDir, cookieSecure = true, now = Date.now } = opts;
  const loginLimiter = opts.loginLimiter || createRateLimiter({ max: 10, windowMs: 10 * 60 * 1000 });
  const routes = ROUTE_MODULES.flat().map((r) => ({ ...r, ...compile(r.pattern) }));

  return async function app(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      let route = null;
      const params = {};
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        route = r;
        try {
          r.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
        } catch {
          throw new HttpError(400, 'bad url encoding');
        }
        break;
      }
      if (!route) throw new HttpError(404, 'not found');
      if (req.method !== 'GET' && !req.headers['x-requested-with']) {
        throw new HttpError(403, 'missing X-Requested-With header');
      }
      const token = parseCookies(req.headers.cookie).sid || null;
      const user = getSessionUser(db, token, now());
      const c = {
        db, uploadsDir, cookieSecure, loginLimiter, now, req, res,
        params, query: url.searchParams, user, token, headers: {}, ip: clientIp(req),
      };
      const result = await route.handler(c);
      sendJson(res, result.status || 200, result.body === undefined ? { ok: true } : result.body, c.headers);
    } catch (err) {
      if (err instanceof HttpError) return sendJson(res, err.status, { error: err.message });
      console.error(err);
      return sendJson(res, 500, { error: 'internal error' });
    }
  };
}

module.exports = { createApp };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `node --test server/test/public.test.js`
Expected: all 7 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add server/http-util.js server/files.js server/repo.js server/app.js server/routes/content.js server/test/helpers.js server/test/public.test.js
git commit -m "feat(server): http core, repository and public read endpoints"
```

---

### Task 5: Login, logout, me, CSRF and login rate limit

**Files:**
- Create: `server/routes/auth.js`
- Modify: `server/app.js` (register route module)
- Test: `server/test/auth-routes.test.js`

**Interfaces:**
- Consumes: `startTestServer` (Task 4), `createRateLimiter`, `createSession`, `verifyPassword`, `capabilities`.
- Produces: `GET /api/me` → `{user: {id,login,role}|null, can: {map,category,feature}}`; `POST /api/login {login,password}` → same shape + `Set-Cookie`; `POST /api/logout` → same shape with `user:null`. Errors: 401 invalid credentials, 429 rate limited, 403 missing header.

- [ ] **Step 1: Write the failing test**

Create `server/test/auth-routes.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { createRateLimiter, createUser } = require('../auth');

test('GET /api/me is anonymous without a cookie', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('GET', '/api/me');
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { user: null, can: { map: false, category: false, feature: false } });
});

test('login sets a hardened session cookie and /me reports admin capabilities', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('POST', '/api/login', { body: { login: 'admin', password: 'correct horse' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.role, 'admin');
  const setCookie = r.headers.get('set-cookie');
  for (const part of ['HttpOnly', 'SameSite=Strict', 'Max-Age=2592000']) assert.ok(setCookie.includes(part), part);
  const cookie = setCookie.split(';')[0];
  const me = await s.api('GET', '/api/me', { cookie });
  assert.equal(me.json.user.login, 'admin');
  assert.deepEqual(me.json.can, { map: true, category: true, feature: true });
});

test('wrong password and unknown login both give 401 with the same message', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const a = await s.api('POST', '/api/login', { body: { login: 'admin', password: 'nope' } });
  const b = await s.api('POST', '/api/login', { body: { login: 'ghost', password: 'nope' } });
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
  assert.equal(a.headers.get('set-cookie'), null);
});

test('login rejects non-string credentials', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('POST', '/api/login', { body: { login: { $ne: 1 }, password: 12345 } });
  assert.equal(r.status, 401);
});

test('login is rate limited per IP', async (t) => {
  const s = await startTestServer({ loginLimiter: createRateLimiter({ max: 3, windowMs: 60000 }) });
  t.after(() => s.cleanup());
  for (let i = 0; i < 3; i++) {
    assert.equal((await s.api('POST', '/api/login', { body: { login: 'admin', password: 'bad' + i } })).status, 401);
  }
  const blocked = await s.api('POST', '/api/login', { body: { login: 'admin', password: 'correct horse' } });
  assert.equal(blocked.status, 429);
});

test('login without X-Requested-With is rejected before any auth work', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const res = await fetch(s.base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ login: 'admin', password: 'correct horse' }),
  });
  assert.equal(res.status, 403);
});

test('logout invalidates the session server-side', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const out = await s.api('POST', '/api/logout', { cookie: s.adminCookie });
  assert.equal(out.json.user, null);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  const me = await s.api('GET', '/api/me', { cookie: s.adminCookie });
  assert.equal(me.json.user, null);
});

test('expired sessions stop working', async (t) => {
  const s = await startTestServer({ now: 1_000_000 });
  t.after(() => s.cleanup());
  assert.equal((await s.api('GET', '/api/me', { cookie: s.adminCookie })).json.user.login, 'admin');
  s.setNow(1_000_000 + 31 * 24 * 60 * 60 * 1000);
  assert.equal((await s.api('GET', '/api/me', { cookie: s.adminCookie })).json.user, null);
});

test('a normal user can log in but has no write capabilities', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  createUser(s.db, { login: 'visitor', password: 'visitor-pass', role: 'user' });
  const r = await s.api('POST', '/api/login', { body: { login: 'visitor', password: 'visitor-pass' } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.can, { map: false, category: false, feature: false });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test server/test/auth-routes.test.js`
Expected: FAIL — `/api/me` returns 404 (route missing).

- [ ] **Step 3: Write the implementation**

Create `server/routes/auth.js`:

```js
'use strict';

const { HttpError, readJson } = require('../http-util');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  sessionCookie,
  clearCookie,
} = require('../auth');
const { capabilities } = require('../permissions');

// Verified against when the login does not exist, so both failure paths cost the same time.
const DUMMY_HASH = hashPassword('timing-equalizer-password');

function me(user) {
  return {
    user: user ? { id: user.id, login: user.login, role: user.role } : null,
    can: capabilities(user),
  };
}

module.exports = [
  { method: 'GET', pattern: '/api/me', handler: async (c) => ({ body: me(c.user) }) },
  {
    method: 'POST',
    pattern: '/api/login',
    handler: async (c) => {
      if (!c.loginLimiter.allow(c.ip, c.now())) throw new HttpError(429, 'too many attempts, try again later');
      const body = await readJson(c.req);
      const login = typeof body.login === 'string' ? body.login : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const row = c.db.prepare('SELECT id, login, role, password_hash FROM users WHERE login = ?').get(login);
      const good = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
      if (!row || !good) throw new HttpError(401, 'invalid login or password');
      const token = createSession(c.db, row.id, c.now());
      c.headers['Set-Cookie'] = sessionCookie(token, { secure: c.cookieSecure });
      return { body: me(row) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/logout',
    handler: async (c) => {
      if (c.token) destroySession(c.db, c.token);
      c.headers['Set-Cookie'] = clearCookie({ secure: c.cookieSecure });
      return { body: me(null) };
    },
  },
];
```

In `server/app.js` replace

```js
const ROUTE_MODULES = [require('./routes/content')];
```

with

```js
const ROUTE_MODULES = [require('./routes/auth'), require('./routes/content')];
```

- [ ] **Step 4: Run all server tests**

Run: `node --test server/test/`
Expected: all PASS (public tests still green).

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.js server/app.js server/test/auth-routes.test.js
git commit -m "feat(server): login, logout, me with CSRF header and login rate limit"
```

---

### Task 6: Write endpoints for maps, categories and features

**Files:**
- Modify: `server/routes/content.js`
- Test: `server/test/content.test.js`

**Interfaces:**
- Consumes: `repo.*`, `validate.*`, `can`, `HttpError`, `readJson`, `unlinkAll` (Task 4), `startTestServer`.
- Produces (admin only; 401 anonymous, 403 non-admin):
  - `POST /api/maps {slug,title,sort?,published?}` → 201 map; 409 duplicate slug
  - `PATCH /api/maps/:id` → map; `DELETE /api/maps/:id` → `{ok:true}`
  - `POST /api/categories {map_id,name,color?,icon?,shape?,visible_default?,sort?}` → 201 category
  - `PATCH /api/categories/:id` → category; 409 if `shape` changes while the category has features
  - `DELETE /api/categories/:id` → `{ok:true}` (cascades to its features and their photo files)
  - `POST /api/features {map_id,category_id,geometry,title?,description?,color?,opacity?}` → 201 feature; geometry validated against the category's shape
  - `PATCH /api/features/:id {…}` → feature; `DELETE /api/features/:id` → `{ok:true}`

- [ ] **Step 1: Write the failing test**

Create `server/test/content.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { createUser, createSession } = require('../auth');

async function setup(t) {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const ck = s.adminCookie;
  const map = (await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'north', title: 'Север', published: true } })).json;
  const pt = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'Тайники', shape: 'point', icon: 'cache' } })).json;
  const poly = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'Заражение', shape: 'polygon', color: '#cc3322' } })).json;
  return { s, ck, map, pt, poly };
}

const tri = { points: [[0.1, 0.1], [0.4, 0.1], [0.3, 0.4]] };

test('anonymous and non-admin users cannot write', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const body = { slug: 'x', title: 'X' };
  assert.equal((await s.api('POST', '/api/maps', { body })).status, 401);
  createUser(s.db, { login: 'visitor', password: 'visitor-pass', role: 'user' });
  const uid = s.db.prepare("SELECT id FROM users WHERE login = 'visitor'").get().id;
  const cookie = 'sid=' + createSession(s.db, uid, Date.now());
  assert.equal((await s.api('POST', '/api/maps', { body, cookie })).status, 403);
});

test('map create/patch/delete and duplicate slug', async (t) => {
  const { s, ck, map } = await setup(t);
  assert.equal(map.published, true);
  const dup = await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'north', title: 'Другой' } });
  assert.equal(dup.status, 409);
  const bad = await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'Bad Slug', title: 'x' } });
  assert.equal(bad.status, 400);
  const p = await s.api('PATCH', '/api/maps/' + map.id, { cookie: ck, body: { title: 'Новый', published: false } });
  assert.equal(p.json.title, 'Новый');
  assert.equal(p.json.published, false);
  assert.equal((await s.api('PATCH', '/api/maps/' + map.id, { cookie: ck, body: {} })).status, 400);
  assert.equal((await s.api('PATCH', '/api/maps/9999', { cookie: ck, body: { title: 'x' } })).status, 404);
  assert.equal((await s.api('DELETE', '/api/maps/' + map.id, { cookie: ck })).status, 200);
  assert.equal((await s.api('GET', '/api/maps/north', { cookie: ck })).status, 404);
});

test('feature create validates geometry against the category shape', async (t) => {
  const { s, ck, map, pt, poly } = await setup(t);
  const ok = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0.2, y: 0.3 }, title: 'Т1' } });
  assert.equal(ok.status, 201);
  assert.deepEqual(ok.json.geometry, { x: 0.2, y: 0.3 });
  assert.equal(ok.json.status, 'approved');
  assert.equal(ok.json.author_id, s.adminId);

  const wrongShape = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: tri } });
  assert.equal(wrongShape.status, 400);
  const outOfRange = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 1.5, y: 0 } } });
  assert.equal(outOfRange.status, 400);
  const strCoords = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: '0.5', y: '0.5' } } });
  assert.equal(strCoords.status, 400);
  const polyOk = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: poly.id, geometry: tri, color: '#112233', opacity: 0.4 } });
  assert.equal(polyOk.status, 201);
  assert.equal(polyOk.json.color, '#112233');
});

test('feature create rejects a category from another map', async (t) => {
  const { s, ck, map } = await setup(t);
  const other = (await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'south', title: 'Юг' } })).json;
  const foreign = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: other.id, name: 'Чужая', shape: 'point' } })).json;
  const r = await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: foreign.id, geometry: { x: 0, y: 0 } } });
  assert.equal(r.status, 400);
});

test('moving a feature to a category with another shape is rejected', async (t) => {
  const { s, ck, map, pt, poly } = await setup(t);
  const f = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0.5, y: 0.5 } } })).json;
  const r = await s.api('PATCH', '/api/features/' + f.id, { cookie: ck, body: { category_id: poly.id } });
  assert.equal(r.status, 400);
  const g = await s.api('PATCH', '/api/features/' + f.id, { cookie: ck, body: { geometry: tri } });
  assert.equal(g.status, 400);
  const still = (await s.api('GET', '/api/maps/north', { cookie: ck })).json.features[0];
  assert.deepEqual(still.geometry, { x: 0.5, y: 0.5 });
});

test('changing a category shape is blocked while it has features', async (t) => {
  const { s, ck, map, pt } = await setup(t);
  await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0.5, y: 0.5 } } });
  const blocked = await s.api('PATCH', '/api/categories/' + pt.id, { cookie: ck, body: { shape: 'polygon' } });
  assert.equal(blocked.status, 409);
  const same = await s.api('PATCH', '/api/categories/' + pt.id, { cookie: ck, body: { shape: 'point', name: 'Схроны' } });
  assert.equal(same.status, 200);
  assert.equal(same.json.name, 'Схроны');
  const empty = await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'Пустая', shape: 'line' } });
  const flip = await s.api('PATCH', '/api/categories/' + empty.json.id, { cookie: ck, body: { shape: 'polygon' } });
  assert.equal(flip.status, 200);
});

test('feature patch updates fields, geometry, resets colour with null', async (t) => {
  const { s, ck, map, poly } = await setup(t);
  const f = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: poly.id, geometry: tri, color: '#112233' } })).json;
  const r = await s.api('PATCH', '/api/features/' + f.id, {
    cookie: ck,
    body: { title: 'Зона №1', description: 'Опасно!\nРадиация', color: null, opacity: 0.6, geometry: { points: [[0, 0], [1, 0], [1, 1]] } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.title, 'Зона №1');
  assert.equal(r.json.description, 'Опасно!\nРадиация');
  assert.equal(r.json.color, null);
  assert.equal(r.json.opacity, 0.6);
  assert.equal(r.json.geometry.points.length, 3);
  assert.equal(r.json.updated_by, undefined);
});

test('cyrillic and emoji text round-trips unchanged', async (t) => {
  const { s, ck, map, pt } = await setup(t);
  const title = 'Тайник «Свалка» 🔑';
  const f = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0, y: 0 }, title, description: 'Ёё — ъ' } })).json;
  const got = (await s.api('GET', '/api/maps/north')).json.features.find((x) => x.id === f.id);
  assert.equal(got.title, title);
  assert.equal(got.description, 'Ёё — ъ');
});

test('deleting a feature and a category removes their rows', async (t) => {
  const { s, ck, map, pt } = await setup(t);
  const f = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0, y: 0 } } })).json;
  assert.equal((await s.api('DELETE', '/api/features/' + f.id, { cookie: ck })).status, 200);
  assert.equal((await s.api('DELETE', '/api/features/' + f.id, { cookie: ck })).status, 404);
  await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: pt.id, geometry: { x: 0, y: 0 } } });
  assert.equal((await s.api('DELETE', '/api/categories/' + pt.id, { cookie: ck })).status, 200);
  const data = (await s.api('GET', '/api/maps/north', { cookie: ck })).json;
  assert.equal(data.features.length, 0);
});

test('malformed json body is a 400, not a 500', async (t) => {
  const { s, ck } = await setup(t);
  const r = await s.api('POST', '/api/maps', { cookie: ck, raw: '{not json', headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 400);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test server/test/content.test.js`
Expected: FAIL — POST routes return 404 (`status` mismatches).

- [ ] **Step 3: Write the implementation**

Replace `server/routes/content.js` entirely with:

```js
'use strict';

const { HttpError, readJson } = require('../http-util');
const { can } = require('../permissions');
const v = require('../validate');
const repo = require('../repo');
const { unlinkAll } = require('../files');

function need(c, action, resource) {
  if (!c.user) throw new HttpError(401, 'login required');
  if (!can(c.user, action, resource)) throw new HttpError(403, 'forbidden');
}

function idParam(c) {
  const n = Number(c.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'not found');
  return n;
}

function intField(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new HttpError(400, name + ' must be a positive integer');
  return value;
}

function checked(result) {
  if (!result.ok) throw new HttpError(400, result.error);
  return result.value;
}

const isUnique = (err) => /UNIQUE/i.test(String((err && err.message) || ''));
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function mapOr404(c, id) {
  const map = repo.getMapById(c.db, id);
  if (!map) throw new HttpError(404, 'map not found');
  return map;
}

module.exports = [
  // ---- public reads ----
  {
    method: 'GET',
    pattern: '/api/maps',
    handler: async (c) => ({
      body: repo.listMaps(c.db, { includeUnpublished: can(c.user, 'map:write') }),
    }),
  },
  {
    method: 'GET',
    pattern: '/api/maps/:slug',
    handler: async (c) => {
      const map = repo.getMapBySlug(c.db, c.params.slug);
      if (!map || (!map.published && !can(c.user, 'map:write'))) throw new HttpError(404, 'map not found');
      return {
        body: {
          map,
          categories: repo.listCategories(c.db, map.id),
          features: repo.listFeatures(c.db, map.id, c.user),
        },
      };
    },
  },

  // ---- maps ----
  {
    method: 'POST',
    pattern: '/api/maps',
    handler: async (c) => {
      need(c, 'map:write');
      const fields = checked(v.validateMap(await readJson(c.req), { create: true }));
      try {
        const id = repo.insertRow(c.db, 'maps', fields);
        return { status: 201, body: repo.getMapById(c.db, id) };
      } catch (err) {
        if (isUnique(err)) throw new HttpError(409, 'slug already exists');
        throw err;
      }
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/maps/:id',
    handler: async (c) => {
      need(c, 'map:write');
      const id = idParam(c);
      mapOr404(c, id);
      const fields = checked(v.validateMap(await readJson(c.req)));
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      try {
        repo.updateRow(c.db, 'maps', id, fields);
      } catch (err) {
        if (isUnique(err)) throw new HttpError(409, 'slug already exists');
        throw err;
      }
      return { body: repo.getMapById(c.db, id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/maps/:id',
    handler: async (c) => {
      need(c, 'map:write');
      const id = idParam(c);
      mapOr404(c, id);
      const files = [...repo.imagePathsFor(c.db, 'map', id), repo.rawMapImagePath(c.db, id)];
      repo.deleteRow(c.db, 'maps', id);
      unlinkAll(c.uploadsDir, files);
      return { body: { ok: true } };
    },
  },

  // ---- categories ----
  {
    method: 'POST',
    pattern: '/api/categories',
    handler: async (c) => {
      need(c, 'category:write');
      const body = await readJson(c.req);
      const mapId = intField(body.map_id, 'map_id');
      mapOr404(c, mapId);
      const fields = checked(v.validateCategory(body, { create: true }));
      const id = repo.insertRow(c.db, 'categories', { map_id: mapId, ...fields });
      return { status: 201, body: repo.getCategory(c.db, id) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/categories/:id',
    handler: async (c) => {
      need(c, 'category:write');
      const id = idParam(c);
      const cat = repo.getCategory(c.db, id);
      if (!cat) throw new HttpError(404, 'category not found');
      const fields = checked(v.validateCategory(await readJson(c.req)));
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      if (fields.shape && fields.shape !== cat.shape && repo.countFeaturesInCategory(c.db, id) > 0) {
        throw new HttpError(409, 'cannot change shape of a category that has features');
      }
      repo.updateRow(c.db, 'categories', id, fields);
      return { body: repo.getCategory(c.db, id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/categories/:id',
    handler: async (c) => {
      need(c, 'category:write');
      const id = idParam(c);
      if (!repo.getCategory(c.db, id)) throw new HttpError(404, 'category not found');
      const files = repo.imagePathsFor(c.db, 'category', id);
      repo.deleteRow(c.db, 'categories', id);
      unlinkAll(c.uploadsDir, files);
      return { body: { ok: true } };
    },
  },

  // ---- features ----
  {
    method: 'POST',
    pattern: '/api/features',
    handler: async (c) => {
      need(c, 'feature:create');
      const body = await readJson(c.req);
      const mapId = intField(body.map_id, 'map_id');
      const categoryId = intField(body.category_id, 'category_id');
      mapOr404(c, mapId);
      const cat = repo.getCategory(c.db, categoryId);
      if (!cat || cat.map_id !== mapId) throw new HttpError(400, 'category does not belong to this map');
      const geometry = checked(v.validateGeometry(cat.shape, body.geometry));
      const fields = checked(v.validateFeature(body, { create: true }));
      const id = repo.insertRow(c.db, 'features', {
        ...fields,
        map_id: mapId,
        category_id: categoryId,
        geometry: JSON.stringify(geometry),
        author_id: c.user.id,
        status: 'approved',
        updated_by: c.user.id,
        updated_at: sqlTime(c.now()),
      });
      return { status: 201, body: repo.getFeature(c.db, id) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/features/:id',
    handler: async (c) => {
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      need(c, 'feature:update', row);
      const body = await readJson(c.req);
      const categoryId = 'category_id' in body ? intField(body.category_id, 'category_id') : row.category_id;
      const cat = repo.getCategory(c.db, categoryId);
      if (!cat || cat.map_id !== row.map_id) throw new HttpError(400, 'category does not belong to this map');
      const geometryIn = 'geometry' in body ? body.geometry : JSON.parse(row.geometry);
      const geometry = checked(v.validateGeometry(cat.shape, geometryIn));
      const fields = checked(v.validateFeature(body));
      repo.updateRow(c.db, 'features', id, {
        ...fields,
        category_id: categoryId,
        geometry: JSON.stringify(geometry),
        updated_by: c.user.id,
        updated_at: sqlTime(c.now()),
      });
      return { body: repo.getFeature(c.db, id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/features/:id',
    handler: async (c) => {
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      need(c, 'feature:delete', row);
      const files = repo.imagePathsFor(c.db, 'feature', id);
      repo.deleteRow(c.db, 'features', id);
      unlinkAll(c.uploadsDir, files);
      return { body: { ok: true } };
    },
  },
];
```

- [ ] **Step 4: Run all server tests**

Run: `node --test server/test/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/content.js server/test/content.test.js
git commit -m "feat(server): write endpoints for maps, categories and features"
```

---

### Task 7: Image uploads (map image and feature photos)

**Files:**
- Create: `server/routes/images.js`
- Modify: `server/app.js` (register module)
- Test: `server/test/images.test.js`

**Interfaces:**
- Consumes: `storeFile`, `unlinkAll`, `EXT` (files.js), `sniffImageType`, `imageSize`, `readBody`, `repo.*`, `startTestServer`.
- Produces:
  - `PUT /api/maps/:id/image` — raw body (PNG/JPEG/WebP, ≤ 8 MB, each side ≤ 16384) → updated map `{…, image_url, width, height}`; old file removed; features untouched.
  - `PUT /api/features/:id/images` — raw body (image ≤ 8 MB), max 10 per feature → 201 `{id, url}`; 409 on the 11th.
  - `DELETE /api/feature-images/:id` → `{ok:true}`; file removed.

- [ ] **Step 1: Write the failing test**

Create `server/test/images.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startTestServer } = require('./helpers');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w, h, pad = 0) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.alloc(9), Buffer.alloc(pad),
  ]);

async function setup(t) {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const ck = s.adminCookie;
  const map = (await s.api('POST', '/api/maps', { cookie: ck, body: { slug: 'north', title: 'Север', published: true } })).json;
  const cat = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'Т', shape: 'point' } })).json;
  const feat = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: cat.id, geometry: { x: 0.5, y: 0.5 } } })).json;
  const onDisk = (url) => fs.existsSync(path.join(s.uploadsDir, url.replace(/^\/uploads\//, '')));
  return { s, ck, map, cat, feat, onDisk };
}

test('map image upload stores the file and records its size', async (t) => {
  const { s, ck, map, onDisk } = await setup(t);
  const r = await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(640, 480), headers: { 'content-type': 'image/png' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.width, 640);
  assert.equal(r.json.height, 480);
  assert.match(r.json.image_url, /^\/uploads\/maps\/[0-9a-f]{32}\.png$/);
  assert.ok(onDisk(r.json.image_url));
});

test('replacing the map image deletes the old file and keeps features untouched', async (t) => {
  const { s, ck, map, feat, onDisk } = await setup(t);
  const first = (await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(100, 100) })).json;
  const second = (await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(200, 400) })).json;
  assert.notEqual(first.image_url, second.image_url);
  assert.equal(onDisk(first.image_url), false);
  assert.ok(onDisk(second.image_url));
  const data = (await s.api('GET', '/api/maps/north', { cookie: ck })).json;
  assert.equal(data.map.width, 200);
  assert.deepEqual(data.features[0].geometry, { x: 0.5, y: 0.5 });
  assert.equal(data.features[0].id, feat.id);
});

test('fake or broken image bodies are rejected even with an image content-type', async (t) => {
  const { s, ck, map } = await setup(t);
  const url = `/api/maps/${map.id}/image`;
  const headers = { 'content-type': 'image/png' };
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');
  const html = Buffer.from('<html><script>alert(1)</script></html>');
  const truncated = png(10, 10).subarray(0, 12);
  for (const raw of [svg, html, truncated, Buffer.alloc(0)]) {
    const r = await s.api('PUT', url, { cookie: ck, raw, headers });
    assert.equal(r.status, 400, 'body of length ' + raw.length);
  }
  assert.equal(fs.readdirSync(s.uploadsDir).length, 0);
});

test('images over 8 MB are rejected with 413 and nothing is stored', async (t) => {
  const { s, ck, map } = await setup(t);
  const big = png(10, 10, 8 * 1024 * 1024);
  const r = await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: big });
  assert.equal(r.status, 413);
  assert.equal(fs.readdirSync(s.uploadsDir).length, 0);
});

test('absurd image dimensions are rejected', async (t) => {
  const { s, ck, map } = await setup(t);
  const r = await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(100000, 100000) });
  assert.equal(r.status, 400);
});

test('image endpoints require admin', async (t) => {
  const { s, map, feat } = await setup(t);
  assert.equal((await s.api('PUT', `/api/maps/${map.id}/image`, { raw: png(1, 1) })).status, 401);
  assert.equal((await s.api('PUT', `/api/features/${feat.id}/images`, { raw: png(1, 1) })).status, 401);
});

test('feature photos: add, list in feature payload, limit of 10, delete removes the file', async (t) => {
  const { s, ck, feat, onDisk } = await setup(t);
  const added = [];
  for (let i = 0; i < 10; i++) {
    const r = await s.api('PUT', `/api/features/${feat.id}/images`, { cookie: ck, raw: png(5 + i, 5) });
    assert.equal(r.status, 201);
    added.push(r.json);
  }
  const eleventh = await s.api('PUT', `/api/features/${feat.id}/images`, { cookie: ck, raw: png(5, 5) });
  assert.equal(eleventh.status, 409);
  const data = (await s.api('GET', '/api/maps/north')).json;
  assert.equal(data.features[0].images.length, 10);
  assert.ok(onDisk(added[0].url));
  const del = await s.api('DELETE', `/api/feature-images/${added[0].id}`, { cookie: ck });
  assert.equal(del.status, 200);
  assert.equal(onDisk(added[0].url), false);
  assert.equal((await s.api('DELETE', `/api/feature-images/${added[0].id}`, { cookie: ck })).status, 404);
});

test('deleting a feature, a category or a map removes their photo files (no orphans)', async (t) => {
  const { s, ck, map, cat, feat, onDisk } = await setup(t);
  const mk = async (featureId) => (await s.api('PUT', `/api/features/${featureId}/images`, { cookie: ck, raw: png(8, 8) })).json.url;
  const mapImg = (await s.api('PUT', `/api/maps/${map.id}/image`, { cookie: ck, raw: png(50, 50) })).json.image_url;

  const a = await mk(feat.id);
  assert.equal((await s.api('DELETE', '/api/features/' + feat.id, { cookie: ck })).status, 200);
  assert.equal(onDisk(a), false);

  const f2 = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: cat.id, geometry: { x: 0, y: 0 } } })).json;
  const b = await mk(f2.id);
  assert.equal((await s.api('DELETE', '/api/categories/' + cat.id, { cookie: ck })).status, 200);
  assert.equal(onDisk(b), false);

  const cat2 = (await s.api('POST', '/api/categories', { cookie: ck, body: { map_id: map.id, name: 'К2', shape: 'point' } })).json;
  const f3 = (await s.api('POST', '/api/features', { cookie: ck, body: { map_id: map.id, category_id: cat2.id, geometry: { x: 0, y: 0 } } })).json;
  const c = await mk(f3.id);
  assert.ok(onDisk(mapImg) && onDisk(c));
  assert.equal((await s.api('DELETE', '/api/maps/' + map.id, { cookie: ck })).status, 200);
  assert.equal(onDisk(c), false);
  assert.equal(onDisk(mapImg), false);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test server/test/images.test.js`
Expected: FAIL — PUT routes return 404.

- [ ] **Step 3: Write the implementation**

Create `server/routes/images.js`:

```js
'use strict';

const { HttpError, readBody } = require('../http-util');
const { can } = require('../permissions');
const { sniffImageType, imageSize } = require('../validate');
const { EXT, storeFile, unlinkAll } = require('../files');
const repo = require('../repo');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const MAX_PHOTOS = 10;

function need(c, action, resource) {
  if (!c.user) throw new HttpError(401, 'login required');
  if (!can(c.user, action, resource)) throw new HttpError(403, 'forbidden');
}

function idParam(c) {
  const n = Number(c.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'not found');
  return n;
}

// The declared Content-Type is ignored on purpose: only the file signature counts.
async function readImage(c) {
  const buf = await readBody(c.req, MAX_IMAGE_BYTES);
  if (buf.length === 0) throw new HttpError(400, 'empty body');
  const type = sniffImageType(buf);
  if (!type) throw new HttpError(400, 'unsupported image type (png, jpeg or webp only)');
  return { buf, type };
}

module.exports = [
  {
    method: 'PUT',
    pattern: '/api/maps/:id/image',
    handler: async (c) => {
      need(c, 'image:write');
      const id = idParam(c);
      if (!repo.getMapById(c.db, id)) throw new HttpError(404, 'map not found');
      const { buf, type } = await readImage(c);
      const size = imageSize(buf);
      if (!size || size.width < 1 || size.height < 1) throw new HttpError(400, 'cannot read image dimensions');
      if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
        throw new HttpError(400, `image sides must not exceed ${MAX_DIMENSION}px`);
      }
      const old = repo.rawMapImagePath(c.db, id);
      const rel = storeFile(c.uploadsDir, 'maps', buf, EXT[type]);
      repo.updateRow(c.db, 'maps', id, { image_path: rel, width: size.width, height: size.height });
      unlinkAll(c.uploadsDir, [old]);
      return { body: repo.getMapById(c.db, id) };
    },
  },
  {
    method: 'PUT',
    pattern: '/api/features/:id/images',
    handler: async (c) => {
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      need(c, 'image:write', row);
      if (repo.countFeatureImages(c.db, id) >= MAX_PHOTOS) throw new HttpError(409, `at most ${MAX_PHOTOS} photos per object`);
      const { buf, type } = await readImage(c);
      const rel = storeFile(c.uploadsDir, 'features', buf, EXT[type]);
      return { status: 201, body: repo.addFeatureImage(c.db, id, rel) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/feature-images/:id',
    handler: async (c) => {
      need(c, 'image:write');
      const img = repo.getFeatureImage(c.db, idParam(c));
      if (!img) throw new HttpError(404, 'image not found');
      repo.deleteRow(c.db, 'feature_images', img.id);
      unlinkAll(c.uploadsDir, [img.path]);
      return { body: { ok: true } };
    },
  },
];
```

In `server/app.js` replace

```js
const ROUTE_MODULES = [require('./routes/auth'), require('./routes/content')];
```

with

```js
const ROUTE_MODULES = [require('./routes/auth'), require('./routes/content'), require('./routes/images')];
```

- [ ] **Step 4: Run all server tests**

Run: `node --test server/test/`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/images.js server/app.js server/test/images.test.js
git commit -m "feat(server): map image and feature photo uploads with signature checks"
```

---

### Task 8: Server entry point, dev static server, CLI and map seeding

**Files:**
- Create: `server/config.js`, `server/static.js`, `server/index.js`, `server/seed.js`, `server/cli.js`
- Test: `server/test/static.test.js`, `server/test/seed.test.js`

**Interfaces:**
- Consumes: `openDb`, `createApp`, `createUser`, `storeFile`, `EXT`, `sniffImageType`, `imageSize`, `repo.insertRow`.
- Produces:
  - `config.loadConfig(env): {port, dbFile, uploadsDir, cookieSecure, devStatic: string|null}`
  - `static.createStaticHandler({root, uploadsDir}): (req,res)=>void` — DEV only; serves `/` → `index.html`, `/map` → `map.html`, `/uploads/*` from `uploadsDir`; denies dotfiles, `server/`, `tools/`, `docs/`, path traversal.
  - `seed.extractDataUri(text): {type, buf}` (throws if none), `seed.seedMap(db, uploadsDir, {slug,title,text}): number` (new map id, published)
  - CLI: `node server/cli.js create-admin <login>` (password from env `ANOMA_PASSWORD`); `node server/cli.js seed-map <slug> <title> <path-to-map.js>`
  - Run: `node server/index.js` (env `PORT`, `ANOMA_DB`, `ANOMA_UPLOADS`, `COOKIE_SECURE=0` for http dev, `DEV_STATIC=<repo root>`).

- [ ] **Step 1: Write the failing tests**

Create `server/test/static.test.js`:

```js
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
```

Create `server/test/seed.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openDb } = require('../db');
const { extractDataUri, seedMap } = require('../seed');
const { createUser } = require('../auth');

const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const png = (w, h) =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    u32(13), Buffer.from('IHDR'), u32(w), u32(h), Buffer.alloc(9),
  ]);
const asMapJs = (buf) => `window.__ARTY_MAP__ = "data:image/png;base64,${buf.toString('base64')}";\n`;

test('extractDataUri decodes the base64 image from map.js text', () => {
  const buf = png(12, 34);
  const r = extractDataUri(asMapJs(buf));
  assert.equal(r.type, 'png');
  assert.ok(r.buf.equals(buf));
});

test('extractDataUri throws when there is no image', () => {
  assert.throws(() => extractDataUri('window.x = 1;'));
});

test('seedMap writes the file and creates a published map with its size', () => {
  const db = openDb(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-seed-'));
  try {
    const id = seedMap(db, dir, { slug: 'main', title: 'Основная', text: asMapJs(png(800, 600)) });
    const row = db.prepare('SELECT * FROM maps WHERE id = ?').get(id);
    assert.equal(row.slug, 'main');
    assert.equal(row.width, 800);
    assert.equal(row.height, 600);
    assert.equal(row.published, 1);
    assert.ok(fs.existsSync(path.join(dir, row.image_path)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('seedMap rejects data that is not a real image', () => {
  const db = openDb(':memory:');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-seed-'));
  try {
    const fake = `x = "data:image/png;base64,${Buffer.from('not an image').toString('base64')}"`;
    assert.throws(() => seedMap(db, dir, { slug: 'main', title: 'M', text: fake }));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maps').get().n, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createUser used by the CLI makes an admin that can be found by login', () => {
  const db = openDb(':memory:');
  createUser(db, { login: 'root_admin', password: 'a-long-password', role: 'admin' });
  assert.equal(db.prepare("SELECT role FROM users WHERE login = 'root_admin'").get().role, 'admin');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test server/test/static.test.js server/test/seed.test.js`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

Create `server/config.js`:

```js
'use strict';

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    dbFile: env.ANOMA_DB || '/var/lib/anoma/db/anoma.db',
    uploadsDir: env.ANOMA_UPLOADS || '/var/lib/anoma/uploads',
    cookieSecure: env.COOKIE_SECURE !== '0',
    devStatic: env.DEV_STATIC || null,
  };
}

module.exports = { loadConfig };
```

Create `server/static.js`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
const DENY = /^\/(\.|server(\/|$)|tools(\/|$)|docs(\/|$)|node_modules(\/|$))/;

// DEV ONLY: lets `node server/index.js` serve the whole site from one origin on localhost.
// In production nginx serves static files and /uploads/.
function createStaticHandler({ root, uploadsDir }) {
  const rootDir = path.resolve(root);
  const uploadsRoot = path.resolve(uploadsDir);

  function notFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }

  return function serve(req, res) {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return notFound(res);
    }
    if (pathname === '/') pathname = '/index.html';
    if (pathname === '/map') pathname = '/map.html';

    let base = rootDir;
    let rel = pathname;
    if (pathname.startsWith('/uploads/')) {
      base = uploadsRoot;
      rel = pathname.slice('/uploads'.length);
    } else if (DENY.test(pathname)) {
      return notFound(res);
    }
    const abs = path.resolve(base, '.' + rel);
    if (!abs.startsWith(base + path.sep)) return notFound(res);
    fs.stat(abs, (err, st) => {
      if (err || !st.isFile()) return notFound(res);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream',
        'Content-Length': st.size,
        'X-Content-Type-Options': 'nosniff',
      });
      fs.createReadStream(abs).pipe(res);
    });
  };
}

module.exports = { createStaticHandler };
```

Create `server/seed.js`:

```js
'use strict';

const { sniffImageType, imageSize } = require('./validate');
const { EXT, storeFile, unlinkAll } = require('./files');
const repo = require('./repo');

function extractDataUri(text) {
  const m = /data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)/.exec(text);
  if (!m) throw new Error('no base64 image data URI found');
  return { type: m[1], buf: Buffer.from(m[2], 'base64') };
}

function seedMap(db, uploadsDir, { slug, title, text }) {
  const { buf } = extractDataUri(text);
  const type = sniffImageType(buf);
  const size = imageSize(buf);
  if (!type || !size) throw new Error('data URI does not contain a valid png/jpeg/webp image');
  const rel = storeFile(uploadsDir, 'maps', buf, EXT[type]);
  try {
    return repo.insertRow(db, 'maps', {
      slug,
      title,
      image_path: rel,
      width: size.width,
      height: size.height,
      sort: 0,
      published: 1,
    });
  } catch (err) {
    unlinkAll(uploadsDir, [rel]);
    throw err;
  }
}

module.exports = { extractDataUri, seedMap };
```

Create `server/index.js`:

```js
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
  res.end('not found');
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
```

Create `server/cli.js`:

```js
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
```

- [ ] **Step 4: Run all server tests**

Run: `node --test server/test/`
Expected: all PASS.

- [ ] **Step 5: Smoke-test the real server**

Run (bash, one terminal):

```bash
export ANOMA_DB=.dev/db/anoma.db ANOMA_UPLOADS=.dev/uploads COOKIE_SECURE=0 DEV_STATIC=. PORT=3000
ANOMA_PASSWORD='dev-password-1' node server/cli.js create-admin admin
node server/cli.js seed-map main "Основная карта" map.js
node server/index.js &
sleep 1
curl -s localhost:3000/api/maps
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/server/db.js
kill %1
```

Expected: `admin "admin" created (id 1)`, `map "main" created (id 1) …`, then JSON with one map whose `image_url` starts with `/uploads/maps/`, then `404`.

- [ ] **Step 6: Commit**

```bash
git add server/config.js server/static.js server/index.js server/seed.js server/cli.js server/test/static.test.js server/test/seed.test.js
git commit -m "feat(server): entry point, dev static server, admin/seed CLI"
```

---

### Task 9: Vendored libraries, geometry helpers and shared frontend utilities

**Files:**
- Create: `vendor/leaflet/leaflet.js`, `vendor/leaflet/leaflet.css`, `vendor/geoman/leaflet-geoman.min.js`, `vendor/geoman/leaflet-geoman.css`, `vendor/README.md`, `map-geo.js`, `map-common.js`, `map-icons.js`
- Test: `tools/map-geo.test.js`

**Interfaces:**
- Produces (`window.MapGeo` / `module.exports`): `toLatLng({x,y}, {width,height}): [lat,lng]`, `fromLatLng(latlng|[lat,lng], size): {x,y}` (clamped 0..1), `pointsToLatLngs(points, size): [[lat,lng],…]`, `latLngsToPoints(latlngs, size): [[x,y],…]`, `featureStyle(feature, category): {color, fillColor, fillOpacity, weight}`.
  Mapping: `lat = height * (1 - y)`, `lng = width * x` (Leaflet `CRS.Simple`, image bounds `[[0,0],[height,width]]`).
- Produces (`window.MapApi`): `get(url)`, `post(url, json)`, `patch(url, json)`, `del(url)`, `upload(method, url, blob)` — all return a Promise of parsed JSON, send `X-Requested-With: anoma`, reject with `Error` having `.status`.
- Produces (`window.h`): `h(tag, attrs?, ...children)` → `HTMLElement`; attrs: `class`, `style` (string), `on<event>` functions, DOM properties (`value`, `checked`, `hidden`, …), otherwise attributes; children: nodes, strings, arrays, `null` skipped.
- Produces (`window.MAP_ICONS`): `{ [id]: {label: string, svg: string} }` — inner SVG markup for a 24×24 viewBox drawn with `stroke="currentColor"`; 20 ids including `question`.

- [ ] **Step 1: Download and verify the libraries**

Run:

```bash
mkdir -p vendor/leaflet vendor/geoman
curl -fsSL -o vendor/leaflet/leaflet.js  https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js
curl -fsSL -o vendor/leaflet/leaflet.css https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css
curl -fsSL -o vendor/geoman/leaflet-geoman.min.js https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.min.js
curl -fsSL -o vendor/geoman/leaflet-geoman.css    https://cdn.jsdelivr.net/npm/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css
wc -c vendor/leaflet/* vendor/geoman/*
```

Expected: all four files download; `leaflet.js` ≈ 140 KB, `leaflet.css` ≈ 14 KB, `leaflet-geoman.min.js` > 100 KB, `leaflet-geoman.css` > 5 KB. If the Geoman URL is 404, run `npm view @geoman-io/leaflet-geoman-free versions --json`, pick the newest 2.x that is at least two weeks old, and use that version in the URLs and in `vendor/README.md`.

Create `vendor/README.md`:

```markdown
# Vendored front-end libraries

Self-hosted on purpose (external CDNs are unreliable from Russia). No build step.

| Library | Version | License | Source |
|---|---|---|---|
| Leaflet | 1.9.4 | BSD-2-Clause | https://leafletjs.com |
| Leaflet-Geoman Free | 2.17.0 | MIT | https://github.com/geoman-io/leaflet-geoman |

To update: download `dist/` files from jsDelivr (`npm/<package>@<version>/dist/…`) and change this table.
```

- [ ] **Step 2: Write the failing test**

Create `tools/map-geo.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Geo = require('../map-geo');

const size = { width: 2000, height: 1000 };

test('toLatLng maps image top-left to the top of the Leaflet plane and bottom-right to lng=width', () => {
  assert.deepEqual(Geo.toLatLng({ x: 0, y: 0 }, size), [1000, 0]);
  assert.deepEqual(Geo.toLatLng({ x: 1, y: 1 }, size), [0, 2000]);
  assert.deepEqual(Geo.toLatLng({ x: 0.5, y: 0.25 }, size), [750, 1000]);
});

test('fromLatLng is the inverse of toLatLng', () => {
  const p = Geo.fromLatLng(Geo.toLatLng({ x: 0.3, y: 0.7 }, size), size);
  assert.ok(Math.abs(p.x - 0.3) < 1e-9);
  assert.ok(Math.abs(p.y - 0.7) < 1e-9);
});

test('fromLatLng accepts {lat,lng} and clamps points outside the image', () => {
  assert.deepEqual(Geo.fromLatLng({ lat: 2000, lng: -50 }, size), { x: 0, y: 0 });
  assert.deepEqual(Geo.fromLatLng({ lat: -10, lng: 99999 }, size), { x: 1, y: 1 });
});

test('pointsToLatLngs / latLngsToPoints round-trip a polygon', () => {
  const pts = [[0.1, 0.2], [0.9, 0.2], [0.5, 0.8]];
  const back = Geo.latLngsToPoints(Geo.pointsToLatLngs(pts, size), size);
  back.forEach((p, i) => {
    assert.ok(Math.abs(p[0] - pts[i][0]) < 1e-9);
    assert.ok(Math.abs(p[1] - pts[i][1]) < 1e-9);
  });
});

test('featureStyle prefers the feature colour and falls back to the category colour', () => {
  const cat = { color: '#d4c24f' };
  assert.equal(Geo.featureStyle({ color: null, opacity: null }, cat).color, '#d4c24f');
  assert.equal(Geo.featureStyle({ color: '#112233', opacity: null }, cat).fillColor, '#112233');
});

test('featureStyle uses 0.25 fill opacity by default and honours explicit values including 0', () => {
  const cat = { color: '#d4c24f' };
  assert.equal(Geo.featureStyle({ color: null, opacity: null }, cat).fillOpacity, 0.25);
  assert.equal(Geo.featureStyle({ color: null, opacity: 0 }, cat).fillOpacity, 0);
  assert.equal(Geo.featureStyle({ color: null, opacity: 0.7 }, cat).fillOpacity, 0.7);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test tools/map-geo.test.js`
Expected: FAIL — `Cannot find module '../map-geo'`.

- [ ] **Step 4: Write `map-geo.js`**

Create `map-geo.js`:

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MapGeo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clamp01(n) {
    return n < 0 ? 0 : n > 1 ? 1 : n;
  }

  // Stored coordinates are fractions of the image (x right, y down, 0..1).
  // Leaflet CRS.Simple has y growing upwards, with image bounds [[0,0],[height,width]].
  function toLatLng(p, size) {
    return [size.height * (1 - p.y), size.width * p.x];
  }

  function fromLatLng(ll, size) {
    var lat = Array.isArray(ll) ? ll[0] : ll.lat;
    var lng = Array.isArray(ll) ? ll[1] : ll.lng;
    return { x: clamp01(lng / size.width), y: clamp01(1 - lat / size.height) };
  }

  function pointsToLatLngs(points, size) {
    return points.map(function (p) {
      return toLatLng({ x: p[0], y: p[1] }, size);
    });
  }

  function latLngsToPoints(latlngs, size) {
    return latlngs.map(function (ll) {
      var p = fromLatLng(ll, size);
      return [p.x, p.y];
    });
  }

  function featureStyle(feature, category) {
    var color = feature.color || category.color;
    var opacity = feature.opacity === null || feature.opacity === undefined ? 0.25 : feature.opacity;
    return { color: color, fillColor: color, fillOpacity: opacity, weight: 2 };
  }

  return {
    toLatLng: toLatLng,
    fromLatLng: fromLatLng,
    pointsToLatLngs: pointsToLatLngs,
    latLngsToPoints: latLngsToPoints,
    featureStyle: featureStyle,
  };
});
```

- [ ] **Step 5: Write `map-common.js` and `map-icons.js`**

Create `map-common.js`:

```js
(function () {
  'use strict';

  function request(method, url, options) {
    options = options || {};
    var headers = { 'X-Requested-With': 'anoma' };
    var body;
    if (options.raw) {
      body = options.raw;
      if (options.raw.type) headers['Content-Type'] = options.raw.type;
    } else if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    }
    return fetch(url, { method: method, headers: headers, body: body, credentials: 'same-origin' }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
        if (!res.ok) {
          var err = new Error((data && data.error) || 'HTTP ' + res.status);
          err.status = res.status;
          throw err;
        }
        return data;
      });
    });
  }

  window.MapApi = {
    get: function (url) { return request('GET', url); },
    post: function (url, json) { return request('POST', url, { json: json }); },
    patch: function (url, json) { return request('PATCH', url, { json: json }); },
    del: function (url) { return request('DELETE', url); },
    upload: function (method, url, blob) { return request(method, url, { raw: blob }); },
  };

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(el, c); });
    else el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }

  // h('div', {class: 'x', onclick: fn}, 'text', childNode, [more, nodes])
  window.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') el.className = value;
        else if (key === 'style') el.setAttribute('style', value);
        else if (key.slice(0, 2) === 'on' && typeof value === 'function') el.addEventListener(key.slice(2), value);
        else if (key in el) el[key] = value;
        else el.setAttribute(key, value === true ? '' : value);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  };
})();
```

Create `map-icons.js`:

```js
// Inner SVG markup for a 24x24 viewBox; rendered with stroke="currentColor", fill="none".
// Ids are validated server-side as [a-z0-9-]{1,32}; unknown ids fall back to "question".
window.MAP_ICONS = {
  question: { label: 'Вопрос', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><circle cx="12" cy="17" r=".6"/>' },
  cache: { label: 'Тайник', svg: '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>' },
  trader: { label: 'Торговец', svg: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.7 2.5 1.8-1 1.4-2.5 1.8-2.5.8-2.5 1.9S10.5 16 12 16s2.5-.5 2.5-1.5"/>' },
  danger: { label: 'Опасность', svg: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6"/>' },
  radiation: { label: 'Радиация', svg: '<circle cx="12" cy="12" r="10"/><path d="M12 12V3M12 12l7.8 4.5M12 12l-7.8 4.5"/>' },
  entrance: { label: 'Вход', svg: '<path d="M6 21V4h12v17"/><path d="M3 21h18"/><circle cx="14.5" cy="13" r=".7"/>' },
  camp: { label: 'Лагерь', svg: '<path d="M2 20L12 4l10 16z"/><path d="M9 20l3-6 3 6"/>' },
  flag: { label: 'Флаг', svg: '<path d="M5 21V3"/><path d="M5 4h13l-3 4 3 4H5"/>' },
  star: { label: 'Звезда', svg: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>' },
  pin: { label: 'Метка', svg: '<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>' },
  eye: { label: 'Наблюдение', svg: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>' },
  key: { label: 'Ключ', svg: '<circle cx="8" cy="12" r="4"/><path d="M12 12h10M18 12v4M21 12v3"/>' },
  anomaly: { label: 'Аномалия', svg: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
  bag: { label: 'Лут', svg: '<path d="M5 8h14l1 13H4z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>' },
  skull: { label: 'Смерть', svg: '<path d="M5 14a7 7 0 1 1 14 0v3H5z"/><circle cx="9.5" cy="12" r="1.3"/><circle cx="14.5" cy="12" r="1.3"/><path d="M9 17v3M12 17v3M15 17v3"/>' },
  target: { label: 'Цель', svg: '<circle cx="12" cy="12" r="8"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/>' },
  house: { label: 'Здание', svg: '<path d="M3 11l9-8 9 8"/><path d="M5 10v11h14V10"/>' },
  tower: { label: 'Вышка', svg: '<path d="M7 21l2-13h6l2 13"/><path d="M6 8h12M8 14h8M12 3v5"/>' },
  water: { label: 'Вода', svg: '<path d="M12 3s7 7 7 12a7 7 0 0 1-14 0c0-5 7-12 7-12z"/>' },
  car: { label: 'Транспорт', svg: '<path d="M3 16v-4l2-5h14l2 5v4z"/><circle cx="7" cy="17" r="1.8"/><circle cx="17" cy="17" r="1.8"/>' },
};
```

- [ ] **Step 6: Run the tests**

Run: `node --test tools/map-geo.test.js tools/`
Expected: `map-geo` tests PASS (existing tool tests unaffected).

- [ ] **Step 7: Commit**

```bash
git add vendor map-geo.js map-common.js map-icons.js tools/map-geo.test.js
git commit -m "feat(map): vendored Leaflet/Geoman, geometry helpers, API client, icon set"
```

---

### Task 10: Map page — viewer (view-only experience)

**Files:**
- Create: `map.html`, `map-app.css`, `map-app.js`

**Interfaces:**
- Consumes: `window.MapApi`, `window.h`, `window.MapGeo`, `window.MAP_ICONS`, Leaflet global `L`; API from Tasks 4–5.
- Produces `window.MapViewer`:
  - `state()` → `{me:{user,can}, maps, map, size:{width,height}|null, categories, features, hidden:{[catId]:true}, groups, layers, openId}`
  - `leaflet()` → `L.Map`; `layers()` → `{[featureId]: L.Layer}`; `size()`; `featureById(id)`; `catById(id)`
  - `renderAll()` (rebuild all layers), `renderCategories()` (rebuild the side list, then call `hooks.afterCategories()`)
  - `setFeature(feature, rerender = true)` (insert/replace in state; `rerender === false` keeps the live layer), `dropFeature(id)`, `setCategory(category)` (insert/replace, then `renderAll` + `renderCategories`)
  - `loadMap(slug, {keepView?})` (fetch + render; calls `hooks.afterLoad()`), `reloadMaps()` (refresh map list + selector)
  - `openFeature(id, latlng?)`, `closeCard()`, `focusFeature(id)`
  - `setClickHandler(fn)` where `fn(featureId, leafletEvent)` returns `false` if it did **not** consume the click (then it propagates to the map); default opens the card
  - `hooks = {onLayer(layer, feature), afterCategories(), afterLoad()}` — assignable
  - `notice(text|null)`
- DOM contract used by the editor: `#ed-slot` (toolbar mount), `#props-slot` (properties panel mount), `#cats` (category `<li data-id>` list), `#map`.
- After init, if `me.can.feature` and the viewport is ≥ 900 px wide, the viewer loads `/vendor/geoman/leaflet-geoman.min.js`, `/map-editor.js`, `/map-editor-dialogs.js` (the last two are added in Tasks 11–12; missing files are tolerated) and calls `window.MapEditor.start(window.MapViewer)`.

- [ ] **Step 1: Write `map.html`**

Copy the `<link rel="icon" …>` line and the whole Yandex.Metrika `<script>`/`<noscript>` blocks from `index.html`'s `<head>`/`<body>` verbatim (same counter for the whole site). Then create `map.html`:

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Карта — ANOMA WIKI</title>
<!-- PASTE here: <link rel="icon"> and the Yandex.Metrika snippet copied from index.html -->
<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">
<link rel="stylesheet" href="/vendor/geoman/leaflet-geoman.css">
<link rel="stylesheet" href="/map-app.css">
</head>
<body>
<header class="mbar">
  <a class="mbar-brand" href="/">&larr; ANOMA WIKI</a>
  <select id="map-select" aria-label="Карта"></select>
  <div id="ed-slot" class="ed-slot"></div>
  <span class="grow"></span>
  <button id="layers-btn" class="only-narrow" type="button">Слои</button>
  <button id="auth-btn" class="auth-btn" type="button" hidden></button>
</header>
<div class="mapwrap">
  <aside id="side" class="side">
    <input id="search" type="search" placeholder="Поиск по названию" autocomplete="off">
    <ul id="search-results" class="results"></ul>
    <div class="cats-head">
      <span>Категории</span>
      <span class="grow"></span>
      <button id="show-all" type="button">все</button>
      <button id="hide-all" type="button">скрыть</button>
    </div>
    <ul id="cats" class="cats"></ul>
  </aside>
  <main id="map" class="map"></main>
  <div id="props-slot"></div>
</div>
<div id="sheet" class="sheet" hidden></div>
<div id="notice" class="notice" hidden></div>
<dialog id="login-dlg" class="dlg">
  <form id="login-form">
    <h2>Вход для редакторов</h2>
    <label>Логин <input name="login" autocomplete="username" required></label>
    <label>Пароль <input name="password" type="password" autocomplete="current-password" required></label>
    <p id="login-err" class="err" hidden></p>
    <div class="row">
      <button type="submit" class="primary">Войти</button>
      <button type="button" id="login-cancel">Отмена</button>
    </div>
  </form>
</dialog>
<script src="/vendor/leaflet/leaflet.js"></script>
<script src="/map-common.js"></script>
<script src="/map-icons.js"></script>
<script src="/map-geo.js"></script>
<script src="/map-app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `map-app.css`**

Create `map-app.css`:

```css
:root {
  --bg: #121212;
  --panel: #1b1b18;
  --panel-2: #1f1f1c;
  --border: #33322a;
  --text: #e9e6d8;
  --muted: #9a9a86;
  --accent: #d4c24f;
  --accent-dim: #8a7f3e;
  --danger: #c8553d;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  display: flex; flex-direction: column;
  background: var(--bg); color: var(--text);
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
}
a { color: var(--accent); }
button, input, select, textarea { font: inherit; color: inherit; }
button {
  background: var(--panel-2); border: 1px solid var(--border); border-radius: 6px;
  padding: 5px 10px; cursor: pointer;
}
button:hover { border-color: var(--accent-dim); }
button.on, button.primary { background: var(--accent); color: #151510; border-color: var(--accent); }
button.danger { color: var(--danger); }
input[type=text], input[type=search], input[type=password], input:not([type]), select, textarea {
  background: #151512; border: 1px solid var(--border); border-radius: 6px; padding: 5px 8px; width: 100%;
}
.grow { flex: 1; }
.only-narrow { display: none; }
.err { color: var(--danger); margin: 6px 0; }

.mbar {
  display: flex; align-items: center; gap: 10px; height: 44px; flex: none;
  padding: 0 12px; background: var(--panel); border-bottom: 1px solid var(--border);
}
.mbar-brand { font-weight: 700; letter-spacing: 1px; text-decoration: none; white-space: nowrap; }
#map-select { width: auto; max-width: 220px; }
.mapwrap { flex: 1; min-height: 0; display: flex; }
.side {
  width: 270px; flex: none; overflow: auto; padding: 10px;
  background: var(--panel); border-right: 1px solid var(--border);
}
.map { flex: 1; min-width: 0; background: #0c0c0b; position: relative; }
.map.crosshair, .map.crosshair .leaflet-interactive { cursor: crosshair; }

.results { list-style: none; margin: 4px 0 0; padding: 0; }
.results button { width: 100%; text-align: left; border-radius: 0; border-width: 0 0 1px; }
.cats-head { display: flex; align-items: center; gap: 6px; margin: 14px 0 6px; color: var(--muted); }
.cats-head button { padding: 1px 8px; font-size: 12px; }
.cats { list-style: none; margin: 0; padding: 0; }
.cats li {
  display: flex; align-items: center; gap: 8px; padding: 5px 6px;
  border-radius: 6px; border: 1px solid transparent; cursor: pointer;
}
.cats li:hover { background: var(--panel-2); }
.cats li.active { border-color: var(--accent); }
.cats .cat-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cats .cat-n { color: var(--muted); font-size: 12px; }
.ico { display: inline-flex; width: 18px; height: 18px; }
.ico svg { width: 100%; height: 100%; }

.mk {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--panel); color: var(--c, var(--accent));
  border: 2px solid var(--c, var(--accent)); box-shadow: 0 1px 4px rgba(0, 0, 0, .6);
}
.mk .ico { width: 18px; height: 18px; }
.mk.sel { box-shadow: 0 0 0 3px rgba(212, 194, 79, .6); }

.leaflet-popup.card-popup .leaflet-popup-content-wrapper {
  background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 10px;
}
.leaflet-popup.card-popup .leaflet-popup-tip { background: var(--panel); }
.leaflet-popup.card-popup .leaflet-popup-content { margin: 12px 14px; }
.card { max-height: 320px; overflow: auto; }
.card h3 { margin: 0 0 2px; font-size: 16px; }
.card-cat { color: var(--muted); font-size: 12px; margin-bottom: 8px; }
.card-text { white-space: pre-wrap; margin: 0 0 8px; }
.card-photos { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.card-photos img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 6px; display: block; }

.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 1200; max-height: 60vh; overflow: auto;
  padding: 14px 16px 18px; background: var(--panel); border-top: 1px solid var(--accent-dim);
  border-radius: 14px 14px 0 0;
}
.sheet .card-x { position: absolute; top: 6px; right: 8px; font-size: 20px; line-height: 1; padding: 2px 9px; }
.notice {
  position: fixed; top: 60px; left: 50%; transform: translateX(-50%); z-index: 1300;
  background: var(--panel); border: 1px solid var(--accent-dim); border-radius: 8px; padding: 10px 16px;
  max-width: 90vw;
}

.dlg { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 18px; }
.dlg::backdrop { background: rgba(0, 0, 0, .6); }
.dlg label { display: block; margin: 8px 0; }
.dlg .row { display: flex; gap: 8px; margin-top: 12px; }

/* editor */
.ed-slot { display: none; }
body.editing .ed-slot { display: flex; }
.ed-toolbar { display: flex; align-items: center; gap: 6px; }
.ed-sep { width: 1px; height: 22px; background: var(--border); margin: 0 4px; }
.ed-status { color: var(--muted); font-size: 12px; margin-left: 8px; }
.ed-status.error { color: var(--danger); }
.ed-status.ok { color: #8fbf6a; }
#props-slot { display: none; }
body.editing #props-slot { display: block; }
.ed-props { width: 310px; height: 100%; overflow: auto; padding: 12px; background: var(--panel); border-left: 1px solid var(--border); }
.ed-props h2 { font-size: 15px; margin: 0 0 10px; }
.ed-props label { display: block; margin: 10px 0 2px; color: var(--muted); font-size: 12px; }
.ed-props .row { display: flex; gap: 8px; align-items: center; }
.ed-props input[type=color] { width: 44px; height: 30px; padding: 0; border: 1px solid var(--border); background: none; }
.ed-photos { display: flex; flex-wrap: wrap; gap: 6px; }
.ed-photos .ph { position: relative; width: 64px; height: 64px; }
.ed-photos .ph img { width: 100%; height: 100%; object-fit: cover; border-radius: 6px; }
.ed-photos .ph button { position: absolute; top: -6px; right: -6px; padding: 0 6px; line-height: 18px; border-radius: 50%; }
.dlg-list { max-height: 55vh; overflow: auto; min-width: min(640px, 80vw); }
.dlg-row { display: flex; gap: 6px; align-items: center; padding: 6px 0; border-bottom: 1px solid var(--border); }
.dlg-row input[type=text], .dlg-row select { width: auto; flex: 1; min-width: 0; }

@media (max-width: 899px) { .auth-btn { display: none; } }
@media (max-width: 720px) {
  .only-narrow { display: inline-block; }
  .side { position: fixed; z-index: 1100; top: 44px; bottom: 0; left: 0; transform: translateX(-100%); transition: transform .2s; }
  .side.open { transform: none; }
  .mbar-brand { font-size: 12px; }
}
```

- [ ] **Step 3: Write `map-app.js`**

Create `map-app.js`:

```js
(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;
  var ICONS = window.MAP_ICONS;

  var state = {
    me: { user: null, can: {} },
    maps: [],
    map: null,
    size: null,
    categories: [],
    features: [],
    hidden: {},
    groups: {},
    layers: {},
    openId: null,
  };
  var hooks = { onLayer: null, afterCategories: null, afterLoad: null };
  var leaflet = null;
  var overlay = null;
  var clickHandler = defaultClick;
  var narrow = window.matchMedia('(max-width: 720px)');

  function $(id) { return document.getElementById(id); }
  function catById(id) { return state.categories.find(function (c) { return c.id === id; }); }
  function featureById(id) { return state.features.find(function (f) { return f.id === id; }); }

  function svgIcon(id) {
    var def = Object.prototype.hasOwnProperty.call(ICONS, id) ? ICONS[id] : ICONS.question;
    var wrap = document.createElement('span');
    wrap.className = 'ico';
    // def.svg is static markup from map-icons.js, never user input
    wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + def.svg + '</svg>';
    return wrap;
  }

  function notice(text) {
    var el = $('notice');
    if (!text) { el.hidden = true; return; }
    el.textContent = text;
    el.hidden = false;
  }

  // ---------- layers ----------

  function markerIcon(feature, cat) {
    var el = h('div', { class: 'mk' }, svgIcon(cat.icon));
    el.style.setProperty('--c', feature.color || cat.color);
    return L.divIcon({ html: el, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] });
  }

  function makeLayer(feature) {
    var cat = catById(feature.category_id);
    if (!cat || !state.size) return null;
    var size = state.size;
    var style = Geo.featureStyle(feature, cat);
    var layer;
    if (cat.shape === 'point') {
      layer = L.marker(Geo.toLatLng(feature.geometry, size), {
        icon: markerIcon(feature, cat), title: feature.title || cat.name, keyboard: false,
      });
    } else if (cat.shape === 'polygon') {
      layer = L.polygon(Geo.pointsToLatLngs(feature.geometry.points, size), style);
    } else {
      layer = L.polyline(Geo.pointsToLatLngs(feature.geometry.points, size), { color: style.color, weight: 3 });
    }
    layer.featureId = feature.id;
    layer.on('click', function (e) {
      var consumed = clickHandler(feature.id, e);
      if (consumed !== false) L.DomEvent.stopPropagation(e);
    });
    return layer;
  }

  function defaultClick(id, e) {
    openFeature(id, e && e.latlng);
    return true;
  }

  function addFeatureLayer(feature) {
    var layer = makeLayer(feature);
    if (!layer) return;
    if (hooks.onLayer) hooks.onLayer(layer, feature);
    state.layers[feature.id] = layer;
    if (state.groups[feature.category_id]) state.groups[feature.category_id].addLayer(layer);
  }

  function removeLayer(id) {
    var layer = state.layers[id];
    if (!layer) return;
    var f = featureById(id);
    var group = f && state.groups[f.category_id];
    if (group) group.removeLayer(layer);
    layer.remove();
    delete state.layers[id];
  }

  function clearLayers() {
    Object.keys(state.groups).forEach(function (k) { state.groups[k].remove(); });
    state.groups = {};
    state.layers = {};
  }

  function syncVisibility() {
    state.categories.forEach(function (c) {
      var g = state.groups[c.id];
      if (!g) return;
      if (state.hidden[c.id]) g.remove(); else g.addTo(leaflet);
    });
  }

  function renderAll() {
    clearLayers();
    if (!state.size) return;
    state.categories.forEach(function (c) { state.groups[c.id] = L.layerGroup(); });
    state.features.forEach(addFeatureLayer);
    syncVisibility();
  }

  // ---------- category list / search ----------

  function renderCategories() {
    var ul = $('cats');
    ul.textContent = '';
    state.categories.forEach(function (c) {
      var count = state.features.filter(function (f) { return f.category_id === c.id; }).length;
      var cb = h('input', {
        type: 'checkbox', checked: !state.hidden[c.id],
        onchange: function () { state.hidden[c.id] = !cb.checked; syncVisibility(); },
      });
      ul.appendChild(h('li', { 'data-id': c.id },
        cb,
        h('span', { style: 'color:' + c.color }, svgIcon(c.icon)),
        h('span', { class: 'cat-name' }, c.name),
        h('span', { class: 'cat-n' }, String(count))));
    });
    if (hooks.afterCategories) hooks.afterCategories();
  }

  function setupSearch() {
    var input = $('search');
    var out = $('search-results');
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      out.textContent = '';
      if (!q) return;
      state.features
        .filter(function (f) { return (f.title || '').toLowerCase().indexOf(q) >= 0; })
        .slice(0, 8)
        .forEach(function (f) {
          out.appendChild(h('li', null, h('button', {
            type: 'button', onclick: function () { focusFeature(f.id); },
          }, f.title)));
        });
    });
    $('show-all').addEventListener('click', function () { state.hidden = {}; syncVisibility(); renderCategories(); });
    $('hide-all').addEventListener('click', function () {
      state.categories.forEach(function (c) { state.hidden[c.id] = true; });
      syncVisibility();
      renderCategories();
    });
  }

  // ---------- card ----------

  function cardNode(feature) {
    var cat = catById(feature.category_id);
    return h('div', { class: 'card' },
      h('h3', null, feature.title || (cat ? cat.name : '')),
      h('div', { class: 'card-cat' }, cat ? cat.name : ''),
      feature.description ? h('p', { class: 'card-text' }, feature.description) : null,
      feature.images.length ? h('div', { class: 'card-photos' }, feature.images.map(function (img) {
        return h('a', { href: img.url, target: '_blank', rel: 'noopener' },
          h('img', { src: img.url, loading: 'lazy', alt: '' }));
      })) : null);
  }

  function updateUrl() {
    var q = new URLSearchParams();
    if (state.map) q.set('m', state.map.slug);
    if (state.openId !== null && state.openId !== undefined) q.set('f', String(state.openId));
    var s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }

  function closeCard(silent) {
    state.openId = null;
    if (leaflet) leaflet.closePopup();
    $('sheet').hidden = true;
    if (!silent) updateUrl();
  }

  function openFeature(id, latlng) {
    var f = featureById(id);
    var layer = state.layers[id];
    if (!f || !layer) return;
    closeCard(true);
    state.openId = id;
    var node = cardNode(f);
    if (narrow.matches) {
      var sheet = $('sheet');
      sheet.textContent = '';
      sheet.appendChild(h('button', { class: 'card-x', type: 'button', 'aria-label': 'Закрыть', onclick: function () { closeCard(); } }, '×'));
      sheet.appendChild(node);
      sheet.hidden = false;
    } else {
      var isPoint = !!layer.getLatLng;
      var at = isPoint ? layer.getLatLng() : (latlng || layer.getBounds().getCenter());
      L.popup({ className: 'card-popup', minWidth: 260, maxWidth: 320, offset: isPoint ? [0, -14] : [0, 0], autoPanPadding: [40, 40] })
        .setLatLng(at).setContent(node).openOn(leaflet);
    }
    updateUrl();
  }

  function focusFeature(id) {
    var f = featureById(id);
    var layer = state.layers[id];
    if (!f || !layer) return;
    if (state.hidden[f.category_id]) {
      state.hidden[f.category_id] = false;
      syncVisibility();
      renderCategories();
    }
    if (layer.getLatLng) leaflet.flyTo(layer.getLatLng(), Math.max(leaflet.getZoom(), 1), { duration: 0.6 });
    else leaflet.flyToBounds(layer.getBounds(), { maxZoom: 2, duration: 0.6 });
    openFeature(id);
  }

  // ---------- data mutation helpers (used by the editor) ----------

  function setFeature(f, rerender) {
    var i = state.features.findIndex(function (x) { return x.id === f.id; });
    var isNew = i < 0;
    if (isNew) state.features.push(f); else state.features[i] = f;
    if (rerender === false && !isNew && state.layers[f.id]) return;
    removeLayer(f.id);
    addFeatureLayer(f);
    renderCategories();
    if (state.openId === f.id) openFeature(f.id);
  }

  function dropFeature(id) {
    removeLayer(id);
    state.features = state.features.filter(function (f) { return f.id !== id; });
    if (state.openId === id) closeCard();
    renderCategories();
  }

  function setCategory(c) {
    var i = state.categories.findIndex(function (x) { return x.id === c.id; });
    if (i < 0) state.categories.push(c); else state.categories[i] = c;
    renderAll();
    renderCategories();
  }

  // ---------- maps ----------

  function fillMapSelect() {
    var sel = $('map-select');
    sel.textContent = '';
    state.maps.forEach(function (m) {
      sel.appendChild(h('option', { value: m.slug, selected: state.map && state.map.slug === m.slug },
        m.title + (m.published ? '' : ' (черновик)')));
    });
    sel.hidden = state.maps.length === 0;
  }

  function reloadMaps() {
    return api.get('/api/maps').then(function (maps) {
      state.maps = maps;
      fillMapSelect();
    });
  }

  function loadMap(slug, opts) {
    opts = opts || {};
    return api.get('/api/maps/' + encodeURIComponent(slug)).then(function (data) {
      state.map = data.map;
      state.categories = data.categories;
      state.features = data.features;
      state.hidden = {};
      data.categories.forEach(function (c) { if (!c.visible_default) state.hidden[c.id] = true; });
      closeCard(true);
      if (overlay) { overlay.remove(); overlay = null; }
      clearLayers();
      notice(null);
      if (data.map.image_url && data.map.width && data.map.height) {
        state.size = { width: data.map.width, height: data.map.height };
        var bounds = [[0, 0], [state.size.height, state.size.width]];
        overlay = L.imageOverlay(data.map.image_url, bounds).addTo(leaflet);
        leaflet.setMaxBounds(L.latLngBounds(bounds).pad(0.5));
        if (!opts.keepView) leaflet.fitBounds(bounds);
        renderAll();
      } else {
        state.size = null;
        notice('У этой карты ещё нет изображения.');
      }
      renderCategories();
      fillMapSelect();
      updateUrl();
      if (hooks.afterLoad) hooks.afterLoad();
    });
  }

  // ---------- auth UI / editor loading ----------

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function optionalScript(src) {
    return loadScript(src).catch(function () { /* added in a later task; tolerated */ });
  }

  function startEditor() {
    return loadScript('/vendor/geoman/leaflet-geoman.min.js')
      .then(function () { return loadScript('/map-editor.js'); })
      .then(function () { return optionalScript('/map-editor-dialogs.js'); })
      .then(function () { window.MapEditor.start(window.MapViewer); });
  }

  function setupAuth() {
    var btn = $('auth-btn');
    var dlg = $('login-dlg');
    var user = state.me.user;
    btn.hidden = false;
    btn.textContent = user ? 'Выйти (' + user.login + ')' : '🔒';
    btn.title = user ? 'Выйти' : 'Вход для редакторов';
    btn.addEventListener('click', function () {
      if (user) api.post('/api/logout', {}).then(function () { location.reload(); });
      else dlg.showModal();
    });
    $('login-cancel').addEventListener('click', function () { dlg.close(); });
    $('login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var form = e.target;
      var err = $('login-err');
      err.hidden = true;
      api.post('/api/login', { login: form.login.value, password: form.password.value })
        .then(function () { location.reload(); })
        .catch(function (ex) { err.textContent = ex.status === 429 ? 'Слишком много попыток, подождите.' : 'Неверный логин или пароль.'; err.hidden = false; });
    });
  }

  // ---------- init ----------

  function init() {
    leaflet = L.map('map', {
      crs: L.CRS.Simple, minZoom: -5, maxZoom: 3, zoomSnap: 0.25, zoomDelta: 0.5,
      attributionControl: false, zoomControl: true,
    });
    leaflet.on('popupclose', function () {
      if (state.openId !== null) { state.openId = null; updateUrl(); }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCard(); });
    $('map-select').addEventListener('change', function (e) { loadMap(e.target.value); });
    $('layers-btn').addEventListener('click', function () { $('side').classList.toggle('open'); });
    setupSearch();

    return api.get('/api/me')
      .then(function (me) { state.me = me; })
      .catch(function () { /* anonymous */ })
      .then(function () { setupAuth(); return reloadMaps(); })
      .then(function () {
        var q = new URLSearchParams(location.search);
        var wanted = q.get('m');
        var slug = state.maps.some(function (m) { return m.slug === wanted; }) ? wanted : (state.maps[0] && state.maps[0].slug);
        if (!slug) {
          notice(state.me.can.map ? 'Карт пока нет. Нажмите «Карты» и добавьте первую.' : 'Карт пока нет.');
          return null;
        }
        return loadMap(slug).then(function () {
          var f = Number(q.get('f'));
          if (f && featureById(f)) focusFeature(f);
        });
      })
      .catch(function () { notice('Не удалось загрузить карту. Обновите страницу.'); })
      .then(function () {
        if (state.me.can.feature && window.matchMedia('(min-width: 900px)').matches) {
          return startEditor().catch(function () { notice('Не удалось загрузить редактор.'); });
        }
        return null;
      });
  }

  window.MapViewer = {
    hooks: hooks,
    state: function () { return state; },
    leaflet: function () { return leaflet; },
    layers: function () { return state.layers; },
    size: function () { return state.size; },
    featureById: featureById,
    catById: catById,
    renderAll: renderAll,
    renderCategories: renderCategories,
    setFeature: setFeature,
    dropFeature: dropFeature,
    setCategory: setCategory,
    loadMap: loadMap,
    reloadMaps: reloadMaps,
    openFeature: openFeature,
    closeCard: closeCard,
    focusFeature: focusFeature,
    notice: notice,
    setClickHandler: function (fn) { clickHandler = fn || defaultClick; },
  };

  init();
})();
```

- [ ] **Step 4: Run the page locally and verify**

Run (from the repo root):

```bash
export ANOMA_DB=.dev/db/anoma.db ANOMA_UPLOADS=.dev/uploads COOKIE_SECURE=0 DEV_STATIC=. PORT=3000
node server/index.js
```

Seed some data in a second terminal (the DB/map from Task 8 Step 5 is reused; if `.dev/` is empty run the `create-admin` and `seed-map` commands from there first):

```bash
curl -s -c .dev/cj -H 'X-Requested-With: x' -H 'Content-Type: application/json' -d '{"login":"admin","password":"dev-password-1"}' localhost:3000/api/login
curl -s -b .dev/cj -H 'X-Requested-With: x' -H 'Content-Type: application/json' -d '{"map_id":1,"name":"Тайники","shape":"point","icon":"cache","color":"#d4c24f"}' localhost:3000/api/categories
curl -s -b .dev/cj -H 'X-Requested-With: x' -H 'Content-Type: application/json' -d '{"map_id":1,"name":"Заражение","shape":"polygon","color":"#cc3322"}' localhost:3000/api/categories
curl -s -b .dev/cj -H 'X-Requested-With: x' -H 'Content-Type: application/json' -d '{"map_id":1,"category_id":1,"geometry":{"x":0.5,"y":0.5},"title":"Тест","description":"Описание\nвторая строка"}' localhost:3000/api/features
curl -s -b .dev/cj -H 'X-Requested-With: x' -H 'Content-Type: application/json' -d '{"map_id":1,"category_id":2,"geometry":{"points":[[0.3,0.3],[0.45,0.3],[0.4,0.45]]},"title":"Зона","color":"#cc3322"}' localhost:3000/api/features
```

Open `http://localhost:3000/map` and verify each:

- [ ] The map image is shown fitted to the window; mouse wheel zoom and drag work.
- [ ] The side panel lists both categories with counts 1; unchecking one hides its objects; «скрыть»/«все» work.
- [ ] Clicking the marker opens a card with title, category and the description on two lines; Esc, ×-less click on empty map, and clicking elsewhere close it; the URL gains `?m=main&f=1` and loses `f` on close.
- [ ] Clicking the polygon opens its card; reloading `/map?m=main&f=2` flies to the polygon and opens its card.
- [ ] Typing «Те» in search lists «Тест»; clicking it centres and opens it.
- [ ] Browser width < 720 px: the «Слои» button shows the drawer; a click on an object opens a bottom sheet with a × button.
- [ ] Empty states: `/map?m=nope&f=999` falls back to the first map without errors in the console; create a map without an image via `curl … /api/maps` and select it → notice «У этой карты ещё нет изображения.» and no exception; stop the server → reload shows «Не удалось загрузить карту…».
- [ ] No console errors on a normal load (a `/map-editor.js` 404 is expected only when logged in, until Task 11).

- [ ] **Step 5: Commit**

```bash
git add map.html map-app.css map-app.js
git commit -m "feat(map): public viewer page with categories, search, cards and deep links"
```

---

### Task 11: Editor core — login flow, drawing, vertex editing, properties

**Files:**
- Create: `map-editor.js`

**Interfaces:**
- Consumes: `window.MapViewer` (Task 10 contract), `window.MapApi`, `window.h`, `window.MapGeo`, Leaflet `L` with Geoman (`map.pm`), API from Tasks 5–6.
- Produces: `window.MapEditor = { start(viewer) }`. Also exposes on `window.MapEditor` for Task 12: `status(text, kind, retryFn?)`, `save(fn)` (wraps an API promise with the «Сохранение…/Сохранено/Ошибка» status; resolves the value or `null` on error), `toolbar` (the toolbar `<div>` so buttons can be appended), `renderPhotos` (assigned by Task 12; called with the selected feature), `selectedFeature()`.

- [ ] **Step 1: Write `map-editor.js`**

Create `map-editor.js`:

```js
(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;

  var V = null;
  var map = null;
  var ed = { tool: 'select', catId: null, selectedId: null, drawing: false };
  var els = {};
  var SHAPE_LABEL = { point: 'Точка', polygon: 'Полигон', line: 'Линия' };
  var DRAW_SHAPE = { polygon: 'Polygon', line: 'Line' };

  // ---------- status / saving ----------

  function status(text, kind, retry) {
    els.status.textContent = text;
    els.status.className = 'ed-status' + (kind ? ' ' + kind : '');
    if (retry) {
      els.status.appendChild(document.createTextNode(' '));
      els.status.appendChild(h('button', { type: 'button', onclick: retry }, 'Повторить'));
    }
  }

  // Runs an API call with visible status; resolves its value, or null after showing an error.
  function save(fn) {
    status('Сохранение…', 'busy');
    return fn().then(
      function (value) { status('Сохранено', 'ok'); return value; },
      function (err) {
        if (err.status === 401) status('Сессия истекла — обновите страницу и войдите снова', 'error');
        else status('Ошибка: ' + err.message, 'error', function () { save(fn); });
        return null;
      });
  }

  // ---------- toolbar ----------

  function buildToolbar() {
    els.status = h('span', { class: 'ed-status' });
    els.toolBtns = {};
    var bar = h('div', { class: 'ed-toolbar' });
    [['select', 'Выбор'], ['point', 'Точка'], ['polygon', 'Полигон'], ['line', 'Линия']].forEach(function (t) {
      var b = h('button', { type: 'button', onclick: function () { setTool(t[0]); } }, t[1]);
      els.toolBtns[t[0]] = b;
      bar.appendChild(b);
    });
    bar.appendChild(h('button', { type: 'button', class: 'danger', onclick: deleteSelected }, 'Удалить'));
    bar.appendChild(h('span', { class: 'ed-sep' }));
    bar.appendChild(els.status);
    document.getElementById('ed-slot').appendChild(bar);
    els.toolbar = bar;
    window.MapEditor.toolbar = bar;
    updateToolbar();
  }

  function updateToolbar() {
    Object.keys(els.toolBtns).forEach(function (k) {
      els.toolBtns[k].classList.toggle('on', ed.tool === k);
    });
  }

  // ---------- active category ----------

  function setActiveCat(id) {
    ed.catId = id;
    markActiveCategory();
  }

  function markActiveCategory() {
    var items = document.querySelectorAll('#cats li');
    for (var i = 0; i < items.length; i++) {
      items[i].classList.toggle('active', Number(items[i].getAttribute('data-id')) === ed.catId);
    }
  }

  // ---------- tools ----------

  function drawOptions(cat) {
    return {
      finishOn: 'dblclick',
      allowSelfIntersection: true,
      snappable: false,
      templineStyle: { color: cat.color },
      hintlineStyle: { color: cat.color, dashArray: [5, 5] },
      pathOptions: { color: cat.color, fillColor: cat.color, fillOpacity: 0.25 },
    };
  }

  function setTool(tool) {
    map.pm.disableDraw();
    ed.drawing = false;
    ed.tool = tool;
    if (tool !== 'select') deselect();
    map.getContainer().classList.toggle('crosshair', tool === 'point');
    if (tool !== 'select') {
      var cat = V.catById(ed.catId);
      if (!cat || cat.shape !== tool) {
        cat = V.state().categories.find(function (c) { return c.shape === tool; });
        if (!cat) {
          status('Нет категории с типом «' + SHAPE_LABEL[tool] + '». Создайте её в «Категории».', 'error');
          ed.tool = 'select';
          map.getContainer().classList.remove('crosshair');
          updateToolbar();
          return;
        }
        setActiveCat(cat.id);
      }
      if (DRAW_SHAPE[tool]) map.pm.enableDraw(DRAW_SHAPE[tool], drawOptions(cat));
    }
    updateToolbar();
  }

  function finishDraw() {
    var shape = DRAW_SHAPE[ed.tool];
    try {
      if (shape && map.pm.Draw[shape] && map.pm.Draw[shape]._finishShape) map.pm.Draw[shape]._finishShape();
    } catch (e) { /* Enter is a convenience; double click always works */ }
  }

  function createFeature(geometry) {
    var cat = V.catById(ed.catId);
    if (!cat) return;
    var mapId = V.state().map.id;
    save(function () {
      return api.post('/api/features', { map_id: mapId, category_id: cat.id, geometry: geometry, title: '' });
    }).then(function (f) {
      if (!f) return;
      V.setFeature(f, true);
      select(f.id);
    });
  }

  function onMapClick(e) {
    if (ed.tool === 'point') createFeature(Geo.fromLatLng(e.latlng, V.size()));
    else if (ed.tool === 'select') deselect();
  }

  function onCreate(e) {
    var ll = e.layer.getLatLngs();
    var ring = Array.isArray(ll[0]) ? ll[0] : ll;
    var points = Geo.latLngsToPoints(ring, V.size());
    e.layer.remove();
    setTool('select');
    createFeature({ points: points });
  }

  // ---------- selection and geometry editing ----------

  function onFeatureClick(id) {
    if (ed.drawing || ed.tool === 'point') return false;
    if (ed.tool === 'select') { select(id); return true; }
    return false;
  }

  function highlight(id, on) {
    var layer = V.layers()[id];
    if (!layer) return;
    if (layer instanceof L.Marker) {
      var el = layer.getElement();
      if (el) {
        var mk = el.querySelector('.mk');
        if (mk) mk.classList.toggle('sel', on);
      }
    } else {
      layer.setStyle({ weight: on ? 4 : (layer instanceof L.Polygon ? 2 : 3) });
    }
  }

  function enableEdit(layer) {
    if (layer.pm) layer.pm.enable({ allowSelfIntersection: true });
  }

  function select(id) {
    deselect(true);
    var layer = V.layers()[id];
    var f = V.featureById(id);
    if (!layer || !f) return;
    ed.selectedId = id;
    enableEdit(layer);
    highlight(id, true);
    showProps(f);
  }

  function deselect(keepPanel) {
    if (ed.selectedId !== null) {
      var layer = V.layers()[ed.selectedId];
      if (layer && layer.pm) layer.pm.disable();
      highlight(ed.selectedId, false);
    }
    ed.selectedId = null;
    if (!keepPanel) els.panel.hidden = true;
  }

  function flat(latlngs) {
    return Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  }

  function saveGeometry(id, layer) {
    var size = V.size();
    var geometry = layer instanceof L.Marker
      ? Geo.fromLatLng(layer.getLatLng(), size)
      : { points: Geo.latLngsToPoints(flat(layer.getLatLngs()), size) };
    save(function () { return api.patch('/api/features/' + id, { geometry: geometry }); }).then(function (f) {
      if (f) V.setFeature(f, false); // geometry only: keep the live layer so vertex editing is not interrupted
    });
  }

  function attachLayer(layer, feature) {
    var isMarker = layer instanceof L.Marker;
    layer.on(isMarker ? 'pm:dragend' : 'pm:edit', function () { saveGeometry(feature.id, layer); });
  }

  // ---------- properties panel ----------

  function buildProps() {
    els.title = h('input', { type: 'text', maxLength: 120, placeholder: 'Название' });
    els.desc = h('textarea', { rows: 6, maxLength: 4000, placeholder: 'Описание' });
    els.cat = h('select');
    els.color = h('input', { type: 'color' });
    els.colorReset = h('button', { type: 'button' }, 'Как у категории');
    els.opacity = h('input', { type: 'range', min: 0, max: 1, step: 0.05 });
    els.opacityRow = h('div', null, h('label', null, 'Прозрачность заливки'), els.opacity);
    els.photos = h('div', { class: 'ed-photos' });
    els.panel = h('aside', { class: 'ed-props', hidden: true },
      h('h2', null, 'Объект'),
      h('label', null, 'Название'), els.title,
      h('label', null, 'Категория'), els.cat,
      h('label', null, 'Описание'), els.desc,
      h('label', null, 'Цвет'),
      h('div', { class: 'row' }, els.color, els.colorReset),
      els.opacityRow,
      h('label', null, 'Фото'), els.photos,
      h('p', null, h('button', { type: 'button', class: 'danger', onclick: deleteSelected }, 'Удалить объект')));
    document.getElementById('props-slot').appendChild(els.panel);

    els.title.addEventListener('change', function () { patch({ title: els.title.value }); });
    els.desc.addEventListener('change', function () { patch({ description: els.desc.value }); });
    els.cat.addEventListener('change', function () { patch({ category_id: Number(els.cat.value) }); });
    els.color.addEventListener('change', function () { patch({ color: els.color.value }); });
    els.colorReset.addEventListener('click', function () { patch({ color: null }); });
    els.opacity.addEventListener('change', function () { patch({ opacity: Number(els.opacity.value) }); });
  }

  function showProps(f) {
    var cat = V.catById(f.category_id);
    els.panel.hidden = false;
    els.title.value = f.title || '';
    els.desc.value = f.description || '';
    els.cat.textContent = '';
    V.state().categories.forEach(function (c) {
      if (c.shape === cat.shape) els.cat.appendChild(h('option', { value: c.id, selected: c.id === f.category_id }, c.name));
    });
    els.color.value = f.color || cat.color;
    els.opacity.value = f.opacity === null ? 0.25 : f.opacity;
    els.opacityRow.hidden = cat.shape !== 'polygon';
    els.colorReset.hidden = f.color === null;
    if (window.MapEditor.renderPhotos) window.MapEditor.renderPhotos(f);
  }

  function patch(fields) {
    var id = ed.selectedId;
    if (id === null) return;
    save(function () { return api.patch('/api/features/' + id, fields); }).then(function (f) {
      if (!f) return;
      V.setFeature(f, true);
      if (ed.selectedId === id) select(id); // re-enable editing on the re-created layer, refresh the panel
    });
  }

  function deleteSelected() {
    var id = ed.selectedId;
    if (id === null) return;
    var f = V.featureById(id);
    if (!window.confirm('Удалить объект «' + (f.title || 'без названия') + '»?')) return;
    deselect();
    save(function () { return api.del('/api/features/' + id); }).then(function (r) {
      if (r) V.dropFeature(id);
    });
  }

  // ---------- keyboard ----------

  function onKey(e) {
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select';
    if (e.key === 'Escape') {
      if (ed.drawing || ed.tool !== 'select') setTool('select'); else deselect();
    } else if (e.key === 'Delete' && !typing) {
      deleteSelected();
    } else if (e.key === 'Enter' && ed.drawing && !typing) {
      finishDraw();
    }
  }

  // ---------- start ----------

  function start(viewer) {
    V = viewer;
    map = V.leaflet();
    document.body.classList.add('editing');
    buildToolbar();
    buildProps();

    V.hooks.onLayer = attachLayer;
    V.hooks.afterCategories = markActiveCategory;
    V.hooks.afterLoad = function () {
      deselect();
      var cats = V.state().categories;
      ed.catId = cats.length ? cats[0].id : null;
      markActiveCategory();
    };
    V.setClickHandler(onFeatureClick);

    document.getElementById('cats').addEventListener('click', function (e) {
      if (e.target.tagName === 'INPUT') return;
      var li = e.target.closest('li');
      if (li) setActiveCat(Number(li.getAttribute('data-id')));
    });
    map.on('click', onMapClick);
    map.on('pm:create', onCreate);
    map.on('pm:drawstart', function () { ed.drawing = true; });
    map.on('pm:drawend', function () { ed.drawing = false; });
    document.addEventListener('keydown', onKey);

    // Layers created before Geoman was loaded have no `pm`; rebuild them.
    V.renderAll();
    V.renderCategories();
    var cats = V.state().categories;
    if (cats.length && ed.catId === null) setActiveCat(cats[0].id);
    status('Режим редактора', '');
  }

  window.MapEditor = {
    start: start,
    status: status,
    save: save,
    selectedFeature: function () { return ed.selectedId === null ? null : V.featureById(ed.selectedId); },
    reselect: function () { if (ed.selectedId !== null) select(ed.selectedId); },
  };
})();
```

- [ ] **Step 2: Verify in the browser**

With the dev server and seed data from Task 10 Step 4 running, open `http://localhost:3000/map` in a window ≥ 900 px wide.

- [ ] Click 🔒, log in as `admin` / `dev-password-1` → page reloads, toolbar «Выбор / Точка / Полигон / Линия / Удалить» appears with status «Режим редактора» and the right-hand panel is hidden until selection. Wrong password shows «Неверный логин или пароль.»
- [ ] **Select tool:** click the marker → panel opens with its title/description/category/colour; edit the title, click elsewhere → status «Сохранение…» → «Сохранено»; reload the page → the new title persists.
- [ ] Drag the selected marker → «Сохранено»; reload → the marker is at the new place.
- [ ] Click the polygon → vertices appear; drag a vertex, click the midpoint handle to add one → «Сохранено», reload keeps the change.
- [ ] Change the polygon colour with the colour input and opacity slider → fill updates; «Как у категории» resets it.
- [ ] **Point tool:** pick «Точка», click on empty map twice → two new markers appear (tool stays active); Esc returns to «Выбор».
- [ ] **Polygon tool:** click the «Заражение» category in the side list (it gets a gold outline), pick «Полигон», click four points, double-click to finish → polygon is created and selected. Repeat finishing with Enter. Esc during drawing cancels without creating anything.
- [ ] **Line tool** without a line category shows «Нет категории с типом «Линия»…» and the tool stays on «Выбор» (line category is added in Task 12).
- [ ] Draw a polygon starting by clicking *inside* an existing polygon → a vertex is placed (the existing polygon does not swallow the click).
- [ ] «Удалить» / Delete key asks for confirmation, removes the object; reload confirms it is gone.
- [ ] Stop the server, change a title → status shows «Ошибка: …» with «Повторить»; restart the server and click it → «Сохранено».
- [ ] Narrow the window below 900 px and reload → no editor toolbar (viewer only).

- [ ] **Step 3: Commit**

```bash
git add map-editor.js
git commit -m "feat(map): editor core — drawing, vertex editing, properties, save status"
```

---

### Task 12: Editor — photos, category manager, map manager

**Files:**
- Create: `map-editor-dialogs.js`
- Modify: `map-editor.js` (photos block + toolbar buttons)

**Interfaces:**
- Consumes: `window.MapEditor` (`save`, `status`, `toolbar`, `selectedFeature`, `reselect`), `window.MapViewer`, `window.MapApi`, `window.h`, `window.MAP_ICONS`; API from Tasks 6–7.
- Produces: `window.MapEditorDialogs = { categories(), maps() }` (each opens a modal `<dialog>`); `window.MapEditor.renderPhotos(feature)`.

- [ ] **Step 1: Add photo upload to the properties panel**

In `map-editor.js`, add this block directly **above** the `// ---------- keyboard ----------` comment:

```js
  // ---------- photos ----------

  function resizeImage(file, maxSide) {
    return createImageBitmap(file).then(function (bmp) {
      var k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * k));
      var hgt = Math.max(1, Math.round(bmp.height * k));
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = hgt;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, hgt);
      ctx.drawImage(bmp, 0, 0, w, hgt);
      return new Promise(function (resolve, reject) {
        canvas.toBlob(function (blob) {
          if (blob) resolve(blob); else reject(new Error('не удалось сжать изображение'));
        }, 'image/jpeg', 0.85);
      });
    });
  }

  function addPhotos(featureId, files) {
    files.reduce(function (chain, file) {
      return chain.then(function () {
        return save(function () {
          return resizeImage(file, 1600).then(function (blob) {
            return api.upload('PUT', '/api/features/' + featureId + '/images', blob);
          });
        }).then(function (img) {
          if (!img) return;
          var f = V.featureById(featureId);
          if (!f) return;
          f.images = f.images.concat([img]);
          V.setFeature(f, false);
          if (ed.selectedId === featureId) renderPhotos(f);
        });
      });
    }, Promise.resolve());
  }

  function removePhoto(featureId, imageId) {
    save(function () { return api.del('/api/feature-images/' + imageId); }).then(function (r) {
      if (!r) return;
      var f = V.featureById(featureId);
      if (!f) return;
      f.images = f.images.filter(function (i) { return i.id !== imageId; });
      V.setFeature(f, false);
      if (ed.selectedId === featureId) renderPhotos(f);
    });
  }

  function renderPhotos(f) {
    els.photos.textContent = '';
    f.images.forEach(function (img) {
      els.photos.appendChild(h('div', { class: 'ph' },
        h('img', { src: img.url, alt: '' }),
        h('button', { type: 'button', title: 'Удалить фото', onclick: function () { removePhoto(f.id, img.id); } }, '×')));
    });
    if (f.images.length < 10) {
      var input = h('input', {
        type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true,
        onchange: function () { addPhotos(f.id, Array.prototype.slice.call(input.files)); input.value = ''; },
      });
      els.photos.appendChild(input);
      els.photos.appendChild(h('button', { type: 'button', onclick: function () { input.click(); } }, '+ Фото'));
    }
  }

```

At the bottom of `map-editor.js`, in the `window.MapEditor = { … }` object, add `renderPhotos: renderPhotos,` after `status: status,`.

- [ ] **Step 2: Add the manager buttons to the toolbar**

In `buildToolbar()` of `map-editor.js`, replace

```js
    bar.appendChild(h('span', { class: 'ed-sep' }));
    bar.appendChild(els.status);
```

with

```js
    bar.appendChild(h('span', { class: 'ed-sep' }));
    bar.appendChild(h('button', { type: 'button', onclick: function () { openDialog('categories'); } }, 'Категории'));
    bar.appendChild(h('button', { type: 'button', onclick: function () { openDialog('maps'); } }, 'Карты'));
    bar.appendChild(els.status);
```

and add above `// ---------- toolbar ----------`:

```js
  function openDialog(name) {
    if (window.MapEditorDialogs) window.MapEditorDialogs[name]();
    else status('Диалоги не загружены — обновите страницу', 'error');
  }

```

- [ ] **Step 3: Write `map-editor-dialogs.js`**

Create `map-editor-dialogs.js`:

```js
(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var ICONS = window.MAP_ICONS;

  function V() { return window.MapViewer; }
  function E() { return window.MapEditor; }

  function openDialog(title, body) {
    var errBox = h('p', { class: 'err', hidden: true });
    var dlg = h('dialog', { class: 'dlg' },
      h('h2', null, title), errBox, body,
      h('div', { class: 'row' }, h('button', { type: 'button', onclick: function () { dlg.close(); } }, 'Закрыть')));
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.showError = function (text) { errBox.textContent = text || ''; errBox.hidden = !text; };
    return dlg;
  }

  function run(dlg, fn) {
    dlg.showError('');
    return E().save(fn).then(function (value) {
      return value;
    });
  }

  // ---------- categories ----------

  function categories() {
    var viewer = V();
    var st = viewer.state();
    if (!st.map) { E().status('Сначала создайте карту', 'error'); return; }
    var list = h('div', { class: 'dlg-list' });
    var dlg;

    function featureCount(id) {
      return st.features.filter(function (f) { return f.category_id === id; }).length;
    }

    function patch(c, fields) {
      return run(dlg, function () { return api.patch('/api/categories/' + c.id, fields); }).then(function (res) {
        if (res) viewer.setCategory(res);
      });
    }

    function row(c) {
      var n = featureCount(c.id);
      var icon = h('select', { onchange: function () { patch(c, { icon: icon.value }); } },
        Object.keys(ICONS).map(function (id) { return h('option', { value: id, selected: id === c.icon }, ICONS[id].label); }));
      var shape = h('select', { disabled: n > 0, title: n > 0 ? 'Тип нельзя менять, пока в категории есть объекты' : '', onchange: function () { patch(c, { shape: shape.value }); } },
        [['point', 'Точка'], ['polygon', 'Полигон'], ['line', 'Линия']].map(function (s) { return h('option', { value: s[0], selected: s[0] === c.shape }, s[1]); }));
      var name = h('input', { type: 'text', value: c.name, maxLength: 60, onchange: function () { patch(c, { name: name.value }); } });
      var color = h('input', { type: 'color', value: c.color, onchange: function () { patch(c, { color: color.value }); } });
      var vis = h('input', { type: 'checkbox', checked: c.visible_default, title: 'Показывать по умолчанию', onchange: function () { patch(c, { visible_default: vis.checked }); } });
      var del = h('button', { type: 'button', class: 'danger', onclick: function () {
        if (!window.confirm('Удалить категорию «' + c.name + '»' + (n ? ' вместе с объектами (' + n + ')' : '') + '?')) return;
        run(dlg, function () { return api.del('/api/categories/' + c.id); }).then(function (res) {
          if (!res) return;
          viewer.loadMap(st.map.slug, { keepView: true }).then(render);
        });
      } }, 'Удалить');
      return h('div', { class: 'dlg-row' }, color, name, icon, shape, vis, del);
    }

    function render() {
      list.textContent = '';
      st.categories.forEach(function (c) { list.appendChild(row(c)); });
      if (!st.categories.length) list.appendChild(h('p', null, 'Категорий пока нет.'));
    }

    var newName = h('input', { type: 'text', placeholder: 'Новая категория', maxLength: 60 });
    var newShape = h('select', null,
      [['point', 'Точка'], ['polygon', 'Полигон'], ['line', 'Линия']].map(function (s) { return h('option', { value: s[0] }, s[1]); }));
    var addForm = h('div', { class: 'dlg-row' }, newName, newShape, h('button', { type: 'button', class: 'primary', onclick: function () {
      if (!newName.value.trim()) return;
      var body = { map_id: st.map.id, name: newName.value.trim(), shape: newShape.value };
      run(dlg, function () { return api.post('/api/categories', body); }).then(function (c) {
        if (!c) return;
        newName.value = '';
        viewer.setCategory(c);
        render();
      });
    } }, 'Добавить'));

    dlg = openDialog('Категории — ' + st.map.title, h('div', null, list, addForm));
    render();
  }

  // ---------- maps ----------

  function maps() {
    var viewer = V();
    var st = viewer.state();
    var list = h('div', { class: 'dlg-list' });
    var dlg;

    function refresh() {
      return viewer.reloadMaps().then(render);
    }

    function patch(m, fields) {
      return run(dlg, function () { return api.patch('/api/maps/' + m.id, fields); }).then(function (res) {
        if (res) refresh();
      });
    }

    function row(m) {
      var title = h('input', { type: 'text', value: m.title, maxLength: 80, onchange: function () { patch(m, { title: title.value }); } });
      var pub = h('input', { type: 'checkbox', checked: m.published, title: 'Опубликована', onchange: function () { patch(m, { published: pub.checked }); } });
      var file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onchange: function () {
        var f = file.files[0];
        file.value = '';
        if (!f) return;
        run(dlg, function () { return api.upload('PUT', '/api/maps/' + m.id + '/image', f); }).then(function (res) {
          if (!res) return;
          refresh();
          if (st.map && st.map.id === m.id) viewer.loadMap(m.slug);
        });
      } });
      var open = h('button', { type: 'button', onclick: function () { viewer.loadMap(m.slug); dlg.close(); } }, 'Открыть');
      var up = h('button', { type: 'button', onclick: function () { file.click(); } }, m.image_url ? 'Заменить картинку' : 'Загрузить картинку');
      var del = h('button', { type: 'button', class: 'danger', onclick: function () {
        if (!window.confirm('Удалить карту «' + m.title + '» со всеми категориями и объектами? Это необратимо.')) return;
        run(dlg, function () { return api.del('/api/maps/' + m.id); }).then(function (res) {
          if (!res) return;
          viewer.reloadMaps().then(function () {
            var next = viewer.state().maps[0];
            if (st.map && st.map.id === m.id && next) return viewer.loadMap(next.slug);
            return null;
          }).then(render);
        });
      } }, 'Удалить');
      return h('div', { class: 'dlg-row' }, pub, title, h('code', null, m.slug), open, up, file, del);
    }

    function render() {
      list.textContent = '';
      st.maps.forEach(function (m) { list.appendChild(row(m)); });
      if (!st.maps.length) list.appendChild(h('p', null, 'Карт пока нет.'));
    }

    var slug = h('input', { type: 'text', placeholder: 'slug (a-z, 0-9, -)', maxLength: 40 });
    var title = h('input', { type: 'text', placeholder: 'Название', maxLength: 80 });
    var addForm = h('div', { class: 'dlg-row' }, slug, title, h('button', { type: 'button', class: 'primary', onclick: function () {
      var body = { slug: slug.value.trim(), title: title.value.trim(), published: false };
      run(dlg, function () { return api.post('/api/maps', body); }).then(function (m) {
        if (!m) return;
        slug.value = '';
        title.value = '';
        refresh();
      });
    } }, 'Добавить карту'));

    dlg = openDialog('Карты', h('div', null, list, addForm,
      h('p', { class: 'hint' }, 'Новая карта — черновик: отметьте «опубликована», когда будет готова. Замена картинки не сдвигает объекты.')));
    render();
  }

  window.MapEditorDialogs = { categories: categories, maps: maps };
})();
```

- [ ] **Step 4: Verify in the browser**

With the dev server running and logged in as admin:

- [ ] **Categories dialog:** «Категории» lists both categories; change a colour → markers/polygons recolour immediately; rename → side list updates; change an icon → marker icon changes; the shape selector is disabled for a category that has objects, enabled for an empty one; add «Маршруты» with type «Линия» → appears in the side list; delete it → gone. Server errors (e.g. duplicate nothing) show in the status bar with «Повторить».
- [ ] **Line tool:** select the new line category, pick «Линия», click 3 points, double-click → a polyline is created; edit its vertices; reload keeps it.
- [ ] **Maps dialog:** «Карты» shows `main`; add slug `south` / title «Юг» → appears in the selector as «Юг (черновик)»; upload a PNG via «Загрузить картинку» → opening it shows the image; open the page in a private window → `south` is **not** in the selector until «опубликована» is ticked.
- [ ] Replace the image of `main` with a PNG of a different size → existing markers stay at the same relative places.
- [ ] **Photos:** select an object → «+ Фото» → choose 2 JPG/PNG files (one larger than 3000 px) → thumbnails appear; the stored file is ≤ 1600 px (check `.dev/uploads/features/`); open the object's card in view mode (log out or private window) → photos shown in a 2-column grid; clicking one opens it in a new tab. Delete a photo with × → thumbnail gone, file removed from `.dev/uploads/features/`.
- [ ] Uploading a non-image (rename a `.txt` to `.png`) → status shows an error from the server and nothing is stored.

- [ ] **Step 5: Commit**

```bash
git add map-editor.js map-editor-dialogs.js
git commit -m "feat(map): editor photos, category manager and map manager"
```

---

### Task 13: Deployment files, workflow and documentation

**Files:**
- Create: `server/deploy/anoma-api.service`, `server/deploy/nginx-map.conf`, `server/deploy/nginx-limits.conf`
- Modify: `.github/workflows/deploy.yml`, `RELEASE.md`, `CLAUDE.md`

**Interfaces:**
- Produces: a systemd unit `anoma-api` (user `anoma`, code `/opt/anoma-api`); nginx location blocks to paste into the `anoma` server block; a deploy workflow that rsyncs `server/` to `/opt/anoma-api/` and restarts the service. Static rsync must **not** publish `server/`.

- [ ] **Step 1: Create the systemd unit**

Create `server/deploy/anoma-api.service`:

```ini
[Unit]
Description=ANOMA WIKI map API
After=network.target

[Service]
User=anoma
Group=anoma
WorkingDirectory=/opt/anoma-api
Environment=PORT=3000
Environment=ANOMA_DB=/var/lib/anoma/db/anoma.db
Environment=ANOMA_UPLOADS=/var/lib/anoma/uploads
ExecStart=/usr/bin/node /opt/anoma-api/index.js
Restart=on-failure
RestartSec=3
UMask=0022
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/var/lib/anoma

[Install]
WantedBy=multi-user.target
```

(If `which node` on the VPS is not `/usr/bin/node`, adjust `ExecStart` during Task 14.)

- [ ] **Step 2: Create the nginx snippets**

Create `server/deploy/nginx-limits.conf` (goes to `/etc/nginx/conf.d/anoma-limits.conf`, http context):

```nginx
# Brute-force protection for /api/login (the app has its own limiter too).
limit_req_zone $binary_remote_addr zone=anoma_login:10m rate=5r/m;
```

Create `server/deploy/nginx-map.conf` (paste inside the HTTPS `server { … }` block of `/etc/nginx/sites-available/anoma`, before `location /`):

```nginx
    # --- ANOMA map: page, API, uploads ---
    location = /map {
        try_files /map.html =404;
    }

    location = /api/login {
        limit_req zone=anoma_login burst=5 nodelay;
        client_max_body_size 8m;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        client_max_body_size 8m;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        alias /var/lib/anoma/uploads/;
        add_header X-Content-Type-Options nosniff always;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }
```

- [ ] **Step 3: Update the deploy workflow**

In `.github/workflows/deploy.yml`, add two excludes to the static rsync (after `--exclude '.claude' \`):

```yaml
            --exclude 'server' \
            --exclude '.dev' \
```

and append a new step at the end of the file:

```yaml
      - name: Deploy API server
        # server/ is excluded from the static sync above; it goes to /opt/anoma-api
        # (not web-accessible). The database and uploads live in /var/lib/anoma and are never touched.
        run: |
          rsync -avz --delete \
            --exclude 'test' \
            --exclude 'deploy' \
            -e "ssh -o StrictHostKeyChecking=no" \
            ./server/ "${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }}:/opt/anoma-api/"
          ssh -o StrictHostKeyChecking=no "${{ secrets.SSH_USER }}@${{ secrets.SSH_HOST }}" \
            "sudo systemctl restart anoma-api"
```

- [ ] **Step 4: Document operations in `RELEASE.md`**

Append to `RELEASE.md`:

```markdown

## Карта-редактор (`/map`) — API и данные

Страница `map.html` (`/map`) работает поверх маленького API (`server/`, Node 22, без зависимостей).
Данные: SQLite `/var/lib/anoma/db/anoma.db` (каталог `db/` — 0700, владелец `anoma`, внутри хэши паролей),
фото и картинки карт — `/var/lib/anoma/uploads/` (их отдаёт nginx). Код — `/opt/anoma-api`,
сервис `anoma-api` (systemd), слушает `127.0.0.1:3000`, проксируется на `/api/`.

**Деплой.** Пуш в `master` выкладывает статику в `/var/www/anoma` и синхронизирует `server/` в
`/opt/anoma-api` с перезапуском сервиса. База и загрузки деплоем не затрагиваются.

**Первичная установка** (один раз, на VPS):

    sudo useradd --system --home /var/lib/anoma --shell /usr/sbin/nologin anoma
    sudo install -d -o anoma -g anoma -m 0755 /var/lib/anoma /var/lib/anoma/uploads
    sudo install -d -o anoma -g anoma -m 0700 /var/lib/anoma/db
    sudo install -d -o deploy -g deploy -m 0755 /opt/anoma-api
    # скопировать server/ в /opt/anoma-api, положить server/deploy/anoma-api.service
    # в /etc/systemd/system/, затем:
    sudo systemctl daemon-reload && sudo systemctl enable --now anoma-api

**Создать администратора** (пароль не попадает в историю команд и репозиторий):

    read -rs ANOMA_PASSWORD && export ANOMA_PASSWORD
    sudo -u anoma --preserve-env=ANOMA_PASSWORD env ANOMA_DB=/var/lib/anoma/db/anoma.db \
      ANOMA_UPLOADS=/var/lib/anoma/uploads node /opt/anoma-api/cli.js create-admin <login>
    unset ANOMA_PASSWORD

**Первая карта из `map.js`:**

    sudo -u anoma env ANOMA_DB=/var/lib/anoma/db/anoma.db ANOMA_UPLOADS=/var/lib/anoma/uploads \
      node /opt/anoma-api/cli.js seed-map main "Основная карта" /var/www/anoma/map.js

**Бэкап.** Копировать нужно `/var/lib/anoma/db/anoma.db` (через `sqlite3 … ".backup …"`) и каталог
`/var/lib/anoma/uploads`. Ежедневный cron из сентябрьской настройки VPS должен указывать на новый путь БД.

**Локальная разработка:**

    export ANOMA_DB=.dev/db/anoma.db ANOMA_UPLOADS=.dev/uploads COOKIE_SECURE=0 DEV_STATIC=.
    ANOMA_PASSWORD=dev-password-1 node server/cli.js create-admin admin
    node server/cli.js seed-map main "Основная карта" map.js
    node server/index.js          # http://localhost:3000/map

**Тесты:** `node --test server/test/ tools/`.

**Откат.** Сервис: вернуть предыдущий коммит и пушнуть (или `sudo systemctl stop anoma-api` — тогда
`/map` покажет «Не удалось загрузить карту», остальной сайт не затронут). Данные: восстановить
`anoma.db` из бэкапа при остановленном сервисе.
```

- [ ] **Step 5: Update `CLAUDE.md`**

In `CLAUDE.md`:

1. In the intro paragraph, replace the sentence `There is no build step, no linter, and no test suite in this repo — don't invent commands for them.` with:

```
There is no build step and no linter for the static site — don't invent commands for them. The
`server/` API is a separate zero-dependency Node service with its own tests.
Run tests with `node --test server/test/ tools/`.
```

2. In the `## Files` list, add:

```
- `map.html` — interactive map page (served at `/map`). Viewer for everyone; after an admin logs in
  on desktop it lazy-loads the editor. Scripts: `map-common.js` (API client + DOM helper),
  `map-geo.js` (pure geometry helpers, tested in `tools/map-geo.test.js`), `map-icons.js`,
  `map-app.js` (viewer), `map-editor.js` + `map-editor-dialogs.js` (editor), styles in `map-app.css`.
  Leaflet and Leaflet-Geoman are vendored in `vendor/` (no CDN).
- `server/` — Node 22 API (`node:http` + `node:sqlite`, no npm deps) for maps, categories, features,
  photos and admin login. Deployed separately to `/opt/anoma-api`; **never published** by the static
  rsync. Data lives in `/var/lib/anoma/` on the VPS. See `RELEASE.md` ("Карта-редактор").
  All write permissions go through `server/permissions.js` `can()`; coordinates are stored as 0..1
  fractions of the map image.
```

3. In `## Deployment`, add one paragraph after the first one:

```
The same workflow also rsyncs `server/` to `/opt/anoma-api/` and restarts the `anoma-api` systemd
service. nginx proxies `/api/` to it and serves `/uploads/` from `/var/lib/anoma/uploads/`.
```

- [ ] **Step 6: Run the whole test suite**

Run: `node --test server/test/ tools/`
Expected: everything PASSES.

- [ ] **Step 7: Commit**

```bash
git add server/deploy .github/workflows/deploy.yml RELEASE.md CLAUDE.md
git commit -m "chore: deployment files, workflow and docs for the map API"
```

---

### Task 14: Production rollout and final verification

> **This task changes the production VPS. Confirm each remote step with the user before running it** (the plan lists commands; do not batch them silently). The VPS is `104.128.130.39`; use the SSH recipe from memory (`anoma-wiki-vps`): ASCII `HOME`, copied key, retry on "banner exchange" timeouts. Do this **before** merging to `master`, because the new workflow step restarts `anoma-api`.

**Files:** none in the repo (server provisioning), except fixes found during rollout.

**Interfaces:**
- Consumes: Task 13 artifacts; secrets `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER` already configured.
- Produces: a running `anoma-api` service, an admin account, the first map seeded, nginx routing `/map`, `/api/`, `/uploads/`.

- [ ] **Step 1: Check the server runtime**

Run on the VPS: `node --version; which node; ls /etc/cron.daily /etc/cron.d 2>/dev/null; sudo crontab -l | grep -i -E "sqlite|backup"`
Expected: Node ≥ 22.13 (if lower, upgrade Node 22 first and re-check `node -e "require('node:sqlite')"`); note the real `which node` path (fix `ExecStart` if it is not `/usr/bin/node`); locate the existing daily SQLite backup script.

- [ ] **Step 2: Create the user, directories and service**

Run the "Первичная установка" commands from `RELEASE.md`, then copy `server/` to `/opt/anoma-api` (`rsync -avz --exclude test --exclude deploy server/ deploy@HOST:/opt/anoma-api/`), install `server/deploy/anoma-api.service` into `/etc/systemd/system/`, `sudo systemctl daemon-reload && sudo systemctl enable --now anoma-api`.
Expected: `systemctl is-active anoma-api` → `active`; `curl -s http://127.0.0.1:3000/api/maps` on the VPS → `[]`.

- [ ] **Step 3: Create the admin and seed the first map**

Run the `create-admin` command from `RELEASE.md` (ask the user to type the password themselves with `! read -rs …` style, or have them run the command via the `!` prefix; never put the password in chat history). Then ask the user for the first map's slug and title (default: `main` / «Основная карта») and run `seed-map` against `/var/www/anoma/map.js`.
Expected: `map "main" created (id 1) …`.

- [ ] **Step 4: Wire nginx**

On the VPS: back up `/etc/nginx/sites-available/anoma` (`sudo cp … anoma.bak4`), install `server/deploy/nginx-limits.conf` as `/etc/nginx/conf.d/anoma-limits.conf`, paste `server/deploy/nginx-map.conf` into the HTTPS server block of `anoma` before `location /`, then `sudo nginx -t && sudo systemctl reload nginx`.
Expected: `nginx -t` OK. If it fails, restore the backup and reload.

- [ ] **Step 5: Point the DB backup at the new path**

Edit the existing backup script/cron found in Step 1 so it also backs up `/var/lib/anoma/db/anoma.db` (via `sqlite3 /var/lib/anoma/db/anoma.db ".backup '<dest>'"`) and `/var/lib/anoma/uploads`. Run the script once by hand and check the backup files exist.

- [ ] **Step 6: Merge and deploy**

Open a PR from the feature branch (or merge to `master` if the user prefers), push, and watch the GitHub Actions run. Expected: both rsync steps and `systemctl restart anoma-api` succeed.

- [ ] **Step 7: Smoke test production**

Run from the local machine:

```bash
curl -s -o /dev/null -w "%{http_code} map\n"      https://anoma-wiki.ru/map
curl -s                                            https://anoma-wiki.ru/api/maps
curl -s -o /dev/null -w "%{http_code} server-src\n" https://anoma-wiki.ru/server/db.js
curl -s -o /dev/null -w "%{http_code} tools\n"      https://anoma-wiki.ru/tools/cli.js
curl -sI https://anoma-wiki.ru/api/maps | grep -i set-cookie || echo "no cookie on anonymous GET (ok)"
```

Expected: `200 map`; JSON array with the seeded map; `404 server-src`; `404 tools`; no `Set-Cookie`.

Then in a browser on `https://anoma-wiki.ru/map`:

- [ ] The seeded map is visible to a logged-out visitor.
- [ ] Log in as the admin; the cookie is `Secure; HttpOnly; SameSite=Strict` (DevTools → Application).
- [ ] Create a category, a point, a polygon and a line; add a title, description and a photo; log out in a private window and confirm everything is visible there and photos load from `/uploads/…` with `X-Content-Type-Options: nosniff`.
- [ ] 6+ wrong passwords in a row from `/api/login` eventually return `429` or `503` (nginx `limit_req`) — confirm and then log in normally after a minute.
- [ ] `sudo journalctl -u anoma-api -n 50` shows no errors.

- [ ] **Step 8: Report**

Update the memory note `anoma-wiki-vps` with the new service, paths and the backup change, and tell the user what was done and what remains (user accounts are intentionally not built).

---

## Self-Review

**Spec coverage** (spec section → task):
- Цель/требования: several maps, points/polygons/lines, categories, per-object colour, description, photos, card with «?» fallback → Tasks 6, 10, 11, 12 (card in 10, `question` icon default in 1/9/10).
- Только ПК для редактора → Task 10 (`min-width: 900px` gate, CSS) and Task 11 check.
- Архитектура (Leaflet + Geoman, Node, SQLite, vendored) → Tasks 1–9.
- Модель данных (incl. `author_id`, `status`, `feature_images`, `sessions`) → Task 1; fractions → Tasks 2, 9.
- API (public reads, admin CRUD, raw image PUTs, `/me`) → Tasks 4–7.
- Интерфейс просмотра (map switcher, filters, card, search, deep link) → Task 10; editor (tools, vertices, props, managers, status) → Tasks 11–12; photo resize to 1600 px → Task 12.
- Безопасность (scrypt, hashed session, cookie flags, X-Requested-With, limits, textContent, signature sniffing, nosniff, CLI admin) → Tasks 3, 5, 7, 8, 10 (`textContent` via `h`), 13.
- Расширяемость (`can()`, `author_id/status`, status-filtered reads, editor driven by `/me`) → Tasks 1, 3, 4 and Task 10 start condition uses `me.can.feature`.
- Деплой (nginx locations, systemd, workflow, backup, seed, CLAUDE.md) → Tasks 13–14; DB path `db/` subdirectory reflected in the spec edit.
- Тестирование (`node --test`, manual frontend checklist) → every task.

**Placeholder scan:** no TBD/TODO/"similar to Task N". One deliberate fill-in: Task 10 Step 1 tells the engineer to paste the favicon/Metrika snippet *copied from `index.html`* (content is in the repo, not invented here); Task 14 asks the user for the first map's slug/title with a stated default.

**Type/name consistency:** `MapViewer` members used by the editor (`leaflet, state, layers, size, featureById, catById, renderAll, renderCategories, setFeature, dropFeature, setCategory, loadMap, reloadMaps, setClickHandler, hooks`) are all defined in Task 10's interface and implementation; `MapEditor` members used by dialogs (`save, status`) exist in Task 11; `renderPhotos` is added to `MapEditor` in Task 12 and called via `window.MapEditor.renderPhotos` in `showProps` (Task 11). Server: `repo.*` names used in routes match Task 4's list; `files.EXT/storeFile/unlinkAll` match Tasks 4/7/8; `createUser` signature `{login,password,role}` consistent across Tasks 3, 4 helpers, 5, 8.

**Review Focus coverage:** (1) orphan files → Task 7 tests; (2) leaks → Task 4 tests; (3) fake images → Task 7 tests; (4) shape mismatch → Tasks 2 and 6 tests; (5) viewer empty states → Task 10 checklist.
