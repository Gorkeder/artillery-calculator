# Предложения пользователей и модерация (этап B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вошедший пользователь предлагает на общую карту новые объекты и жалуется на ошибки, админ модерирует очередь и может заблокировать автора.

**Architecture:** Предложение — строка `features` со `status='pending'` (отклонённое: `pending` + `reject_reason`), миграция 4 добавляет поля и таблицу `reports`. Права живут в `permissions.js`, новые маршруты в `server/routes/moderation.js`, пользовательские правки идут через существующие `/api/features*`. На фронтенде тот же `MapEditor` работает в упрощённом режиме «Предложить», у админа появляется диалог «Модерация».

**Tech Stack:** Node 22 (`node:http`, `node:sqlite`, `node:test`), без npm-зависимостей; Leaflet + Leaflet-Geoman; чистый JS без сборки.

**Spec:** `docs/superpowers/specs/2026-10-11-proposals-moderation-design.md`

## Global Constraints

- Node 22+, без npm-зависимостей и без сборки; тесты: `node --test server/test/*.test.js tools/*.test.js`.
- Ветка `proposals-moderation`; в `master` не пушить (пуш в `master` деплоит на прод).
- Состояния: опубликован (`approved`, `reject_reason NULL`), на модерации (`pending`, `NULL`), отклонён (`pending`, причина). Опубликованный в отклонённый не переходит (409). Отклонённый → опубликованный разрешён.
- Права не-админа: создаёт `pending`; правит только свой неотклонённый `pending`; удаляет только свой `pending` (включая отклонённый). Чужое, опубликованное и несуществующее: **404**.
- Заблокированный автор: 403 `proposals_blocked` на создание предложений и жалоб; вход и личные метки работают. Блокировка отклоняет его неотклонённые `pending` с причиной `Автор заблокирован`. Админа блокировать нельзя (400).
- Лимиты: 10 неотклонённых ожидающих предложений на пользователя (409 `proposals_limit`); 20 открытых жалоб на пользователя (409 `reports_limit`); 1 открытая жалоба на объект от пользователя (409 `report_exists`); 60 запросов записи за 10 минут на пользователя (429, лимитер `proposalsWrite`); жалоба 1..500 символов; причина отклонения 1..200.
- Поля `color` и `opacity` в телах от не-админа игнорируются; `status`, `author_id`, `reject_reason`, `reviewed_*` в телах не принимаются вообще.
- Публичный ответ `GET /api/maps/:slug` не содержит `author_id` (только админу); у остальных `mine: boolean`; `reject_reason` виден автору и админу.
- Фото к предложениям нет: `image:write` остаётся только у админа.
- Отклонённые объекты старше 30 дней (`reviewed_at`) и без фото удаляет ежечасная очистка.
- Пользовательский текст в DOM только через `textContent` (хелпер `h()` создаёт текстовые узлы).
- Редактор предложений только на ПК (`min-width: 900px`); кнопка жалобы и статусы видны и на телефоне.
- Строки интерфейса на русском, комментарии к коду на английском.
- Коммиты оканчиваются строкой `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Входы и условия, которые спек подразумевает, но явно не перечисляет (каждый закреплён тестом в указанной задаче):

1. Тело `POST`/`PATCH` от пользователя с `status`, `author_id`, `reject_reason`, `reviewed_by`, `color`, `opacity`: сервер игнорирует (Task 3).
2. Автор не может править и удалять уже опубликованный объект; отклонённый можно только удалить (Task 3).
3. Публичный ответ карты не содержит `author_id`, чужие `pending` невидимы (Task 3).
4. Не-админ на маршрутах модерации: 401/403; не-админ не может закрыть жалобу (Task 4).
5. Блокировка не трогает опубликованные объекты автора, его личные метки и вход (Task 4).
6. Повторное одобрение/отклонение и отклонение опубликованного: 409, данные не меняются (Task 4).
7. Жалоба на `pending` или объект неопубликованной карты: 404 без утечки существования (Task 5).
8. Очистка не удаляет свежие отклонённые и отклонённые с фото; удаление пользователя оставляет его опубликованные объекты (Task 5).
9. Два одновременных запроса не обходят лимит 10 (счёт и вставка в одном синхронном куске без `await`) (Task 3).

## File Structure

| Файл | Действие | Ответственность |
|------|----------|-----------------|
| `server/db.js` | изменить | миграция 4, экспорт `MIGRATIONS` |
| `server/auth.js` | изменить | `proposalsBlocked` в пользователе сессии |
| `server/me.js` | изменить | `proposalsBlocked`, `blockReason`, `can` с учётом блокировки |
| `server/permissions.js` | изменить | `feature:propose`, `report:create`, `moderation:*`, правила владельца |
| `server/repo.js` | изменить | `featureOut` с приватностью, счётчики, `moderationOverview` |
| `server/routes/content.js` | изменить | `POST/PATCH/DELETE /api/features` для пользователей |
| `server/routes/moderation.js` | создать | очередь, одобрение, отклонение, блокировка, жалобы |
| `server/app.js` | изменить | регистрация модуля и лимитер `proposalsWrite` |
| `server/tokens.js` | изменить | очистка старых отклонённых в `cleanup` |
| `server/test/proposals.test.js` | создать | тесты миграции, прав, маршрутов, очистки |
| `map-app.js`, `map-app.css` | изменить | статус на карте, пунктир, жалоба, заметка о блокировке |
| `map-editor.js`, `map-marks-editor.js` | изменить | упрощённый режим «Предложить», подписи переключателя |
| `map-editor-dialogs.js` | изменить | диалог «Модерация» |
| `privacy.html`, `CLAUDE.md`, `RELEASE.md` | изменить | документация |

---

### Task 1: Миграция 4, флаг блокировки в сессии и `/api/me`

**Files:**
- Modify: `server/db.js:3-4,64-110`
- Modify: `server/auth.js:102-115`
- Modify: `server/me.js`
- Modify: `server/test/db.test.js:58`
- Test: `server/test/proposals.test.js` (создать)

**Interfaces:**
- Produces: `db.js` экспортирует `MIGRATIONS`; в БД: `features.reject_reason/reviewed_at/reviewed_by`, `users.proposals_blocked_at/proposals_block_reason`, таблица `reports`; пользователь сессии получает `proposalsBlocked: boolean`; `meBody(...).user` получает `proposalsBlocked: boolean` и `blockReason: string|null`.

- [ ] **Step 1: Написать падающие тесты**

Создать `server/test/proposals.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { startTestServer } = require('./helpers');
const { SCHEMA, MIGRATIONS, migrate } = require('../db');
const { createRateLimiter, createUser, createSession } = require('../auth');
const { cleanup } = require('../tokens');
const repo = require('../repo');

async function setup(t, opts) {
  const s = await startTestServer(opts);
  t.after(() => s.cleanup());
  const mapId = repo.insertRow(s.db, 'maps', { slug: 'main', title: 'Main', published: 1 });
  const draftId = repo.insertRow(s.db, 'maps', { slug: 'draft', title: 'Draft', published: 0 });
  const pointCat = repo.insertRow(s.db, 'categories', { map_id: mapId, name: 'Cache', shape: 'point' });
  const polyCat = repo.insertRow(s.db, 'categories', { map_id: mapId, name: 'Zone', shape: 'polygon' });
  const alice = createUser(s.db, { login: 'alice', password: 'alice-pass-1', role: 'user' });
  const bob = createUser(s.db, { login: 'bob', password: 'bob-pass-12', role: 'user' });
  const cookieFor = (id) => 'sid=' + createSession(s.db, id, Date.now());
  return { s, mapId, draftId, pointCat, polyCat, alice, bob, aliceCookie: cookieFor(alice), bobCookie: cookieFor(bob) };
}

const body = (ctx, over = {}) => ({
  map_id: ctx.mapId, category_id: ctx.pointCat, geometry: { x: 0.3, y: 0.4 }, title: 'Cache A', description: 'Under the bridge', ...over,
});
const propose = (ctx, cookie, over) => ctx.s.api('POST', '/api/features', { cookie, body: body(ctx, over) });
const features = async (ctx, cookie) => (await ctx.s.api('GET', '/api/maps/main', { cookie })).json.features;
const block = (ctx, userId, reason = 'spam') =>
  ctx.s.db.prepare("UPDATE users SET proposals_blocked_at = datetime('now'), proposals_block_reason = ? WHERE id = ?").run(reason, userId);
// Inserts a feature straight into the DB: { status, rejectReason, author }.
function seedFeature(ctx, { status = 'approved', rejectReason = null, author = ctx.alice, title = 'Seed', category = ctx.pointCat, reviewedAt = null } = {}) {
  return repo.insertRow(ctx.s.db, 'features', {
    map_id: ctx.mapId, category_id: category, geometry: JSON.stringify({ x: 0.1, y: 0.1 }),
    title, status, reject_reason: rejectReason, author_id: author, reviewed_at: reviewedAt,
  });
}

// ---------- migration 4 ----------

test('migration 4 upgrades a version 3 database without losing data', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const m of MIGRATIONS.filter((x) => x.version <= 3)) db.exec(m.sql);
  db.exec('PRAGMA user_version = 3');
  db.exec("INSERT INTO users (login, password_hash, role) VALUES ('old', 'x', 'user')");
  db.exec("INSERT INTO maps (slug, title, published) VALUES ('m', 'M', 1)");
  db.exec("INSERT INTO categories (map_id, name, shape) VALUES (1, 'C', 'point')");
  db.exec(`INSERT INTO features (map_id, category_id, geometry, title, status, author_id)
           VALUES (1, 1, '{"x":0,"y":0}', 'F', 'pending', 1)`);
  migrate(db);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  const f = db.prepare('SELECT title, status, reject_reason, reviewed_at, reviewed_by FROM features').get();
  assert.deepEqual({ ...f }, { title: 'F', status: 'pending', reject_reason: null, reviewed_at: null, reviewed_by: null });
  const u = db.prepare('SELECT login, proposals_blocked_at, proposals_block_reason FROM users').get();
  assert.deepEqual({ ...u }, { login: 'old', proposals_blocked_at: null, proposals_block_reason: null });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reports').get().n, 0);
  db.close();
});

// ---------- session user and /api/me ----------

test('/api/me and login report the proposals block', async (t) => {
  const ctx = await setup(t);
  block(ctx, ctx.alice, 'spam');
  const me = await ctx.s.api('GET', '/api/me', { cookie: ctx.aliceCookie });
  assert.equal(me.json.user.proposalsBlocked, true);
  assert.equal(me.json.user.blockReason, 'spam');
  const login = await ctx.s.api('POST', '/api/login', { body: { login: 'alice', password: 'alice-pass-1' } });
  assert.equal(login.status, 200, 'a blocked author can still sign in');
  assert.equal(login.json.user.proposalsBlocked, true);
  const clean = await ctx.s.api('GET', '/api/me', { cookie: ctx.bobCookie });
  assert.equal(clean.json.user.proposalsBlocked, false);
  assert.equal(clean.json.user.blockReason, null);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/proposals.test.js`
Expected: FAIL (`MIGRATIONS` не экспортируется, нет колонок, `proposalsBlocked` не определён).

- [ ] **Step 3: Миграция и экспорт**

В `server/db.js` в массив `MIGRATIONS` после записи `version: 3` добавить:

```js
  {
    version: 4,
    sql: `
ALTER TABLE features ADD COLUMN reject_reason TEXT;
ALTER TABLE features ADD COLUMN reviewed_at TEXT;
ALTER TABLE features ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN proposals_blocked_at TEXT;
ALTER TABLE users ADD COLUMN proposals_block_reason TEXT;
CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_reports_open ON reports(resolved_at, feature_id);
CREATE UNIQUE INDEX idx_reports_one_open ON reports(feature_id, user_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_features_status ON features(status, reviewed_at);
`,
  },
```

В конце файла: `module.exports = { openDb, migrate, SCHEMA, MIGRATIONS };`. В `server/test/db.test.js:58` ожидаемую версию `3` заменить на `4`.

- [ ] **Step 4: Флаг в пользователе сессии и в `/api/me`**

В `server/auth.js` (`getSessionUser`) заменить запрос и возврат:

```js
  const row = db
    .prepare(
      `SELECT s.expires_at, u.id, u.login, u.role, u.proposals_blocked_at
       FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token));
  if (!row) return null;
  if (row.expires_at <= nowMs) {
    destroySession(db, token);
    return null;
  }
  return { id: row.id, login: row.login, role: row.role, proposalsBlocked: Boolean(row.proposals_blocked_at) };
```

`server/me.js` заменить целиком:

```js
'use strict';

const { capabilities } = require('./permissions');

function meBody(db, user) {
  if (!user) return { user: null, can: capabilities(null) };
  const row = db
    .prepare('SELECT email, email_verified_at, proposals_blocked_at, proposals_block_reason FROM users WHERE id = ?')
    .get(user.id);
  const blocked = Boolean(row && row.proposals_blocked_at);
  // The caller may pass a row that does not carry the flag (login), so it is always re-read here.
  const effective = { ...user, proposalsBlocked: blocked };
  return {
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      email: row ? row.email : null,
      emailVerified: Boolean(row && row.email_verified_at),
      proposalsBlocked: blocked,
      blockReason: blocked ? (row.proposals_block_reason || '') : null,
    },
    can: capabilities(effective),
  };
}

module.exports = { meBody };
```

- [ ] **Step 5: Запустить все тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/auth.js server/me.js server/test/db.test.js server/test/proposals.test.js
git commit -m "feat(proposals): migration 4, block flag in session user and /api/me

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Права: предложения, жалобы, модерация, правила владельца

**Files:**
- Modify: `server/permissions.js`
- Test: `server/test/permissions.test.js`, `server/test/auth-routes.test.js:13,27,93`, `server/test/account.test.js` (строка с `me.json.can`)

**Interfaces:**
- Consumes: `user.proposalsBlocked` (Task 1).
- Produces: `can(user, 'feature:propose'|'report:create')` → вошедший и не заблокирован; `can(user, 'moderation:read'|'moderation:write')` → админ; `can(user, 'feature:update', row)` → админ, либо `row.author_id === user.id && row.status === 'pending' && !row.reject_reason`; `can(user, 'feature:delete', row)` → админ, либо `row.author_id === user.id && row.status === 'pending'`. `capabilities(user)` получает `propose: boolean`.

- [ ] **Step 1: Обновить и дополнить тесты**

В `server/test/permissions.test.js` заменить тест `capabilities reflect can()` и добавить новые (константы `admin`, `user` уже определены в файле):

```js
test('capabilities reflect can()', () => {
  assert.deepEqual(capabilities(admin), { map: true, category: true, feature: true, marks: true, propose: true });
  assert.deepEqual(capabilities(user), { map: false, category: false, feature: false, marks: true, propose: true });
  assert.deepEqual(capabilities({ ...user, proposalsBlocked: true }),
    { map: false, category: false, feature: false, marks: true, propose: false });
  assert.deepEqual(capabilities(null), { map: false, category: false, feature: false, marks: false, propose: false });
});

test('proposals: signed-in unblocked users propose and report; moderation is admin only', () => {
  const blocked = { ...user, proposalsBlocked: true };
  for (const action of ['feature:propose', 'report:create']) {
    assert.equal(can(user, action), true, action);
    assert.equal(can(blocked, action), false, action + ' blocked');
    assert.equal(can(null, action), false, action + ' guest');
  }
  for (const action of ['moderation:read', 'moderation:write']) {
    assert.equal(can(admin, action), true, action);
    assert.equal(can(user, action), false, action);
    assert.equal(can(null, action), false, action);
  }
});

test('an author edits only an open pending proposal and deletes any pending one, never a published one', () => {
  const open = { id: 1, author_id: 2, status: 'pending', reject_reason: null };
  const rejected = { id: 2, author_id: 2, status: 'pending', reject_reason: 'dup' };
  const published = { id: 3, author_id: 2, status: 'approved', reject_reason: null };
  const foreign = { id: 4, author_id: 9, status: 'pending', reject_reason: null };
  assert.equal(can(user, 'feature:update', open), true);
  assert.equal(can(user, 'feature:update', rejected), false);
  assert.equal(can(user, 'feature:update', published), false);
  assert.equal(can(user, 'feature:update', foreign), false);
  assert.equal(can(user, 'feature:delete', open), true);
  assert.equal(can(user, 'feature:delete', rejected), true);
  assert.equal(can(user, 'feature:delete', published), false);
  assert.equal(can(user, 'feature:delete', foreign), false);
  assert.equal(can(admin, 'feature:update', foreign), true);
  assert.equal(can(admin, 'feature:delete', published), true);
  assert.equal(can(null, 'feature:update', open), false);
});
```

В `server/test/auth-routes.test.js` заменить ожидания:
- строка 13: `can: { map: false, category: false, feature: false, marks: false, propose: false }`
- строка 27: `{ map: true, category: true, feature: true, marks: true, propose: true }`
- строка 93: `{ map: false, category: false, feature: false, marks: true, propose: true }`

В `server/test/account.test.js` ожидание `me.json.can` заменить на `{ map: false, category: false, feature: false, marks: true, propose: true }`.

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/permissions.test.js server/test/auth-routes.test.js server/test/account.test.js`
Expected: FAIL (`unknown action: feature:propose`, нет ключа `propose`).

- [ ] **Step 3: Реализовать**

В `server/permissions.js` заменить `ACTIONS`, `can` и `capabilities` (`featureFilter` и экспорты не меняются):

```js
const ACTIONS = new Set([
  'map:write',
  'category:write',
  'feature:create',
  'feature:update',
  'feature:delete',
  'image:write',
  'mark:create',
  'mark:update',
  'mark:delete',
  'feature:propose',
  'report:create',
  'moderation:read',
  'moderation:write',
]);

// The only place that decides who may do what. Direct publishing, maps, categories and photos: admins only.
// Users propose features (status 'pending') and manage only their own proposals.
function can(user, action, resource) {
  if (!ACTIONS.has(action)) throw new Error('unknown action: ' + action);
  if (!user) return false;
  const admin = user.role === 'admin';
  switch (action) {
    case 'mark:create':
      return true;
    case 'mark:update':
    case 'mark:delete':
      return Boolean(resource) && resource.user_id === user.id;
    case 'feature:propose':
    case 'report:create':
      return !user.proposalsBlocked;
    case 'feature:update':
      return admin || (Boolean(resource) && resource.author_id === user.id
        && resource.status === 'pending' && !resource.reject_reason);
    case 'feature:delete':
      return admin || (Boolean(resource) && resource.author_id === user.id && resource.status === 'pending');
    default:
      return admin;
  }
}

function capabilities(user) {
  return {
    map: can(user, 'map:write'),
    category: can(user, 'category:write'),
    feature: can(user, 'feature:create'),
    marks: can(user, 'mark:create'),
    propose: can(user, 'feature:propose'),
  };
}
```

- [ ] **Step 4: Запустить все тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS (существующие тесты на 403 для карт и категорий остаются зелёными: `default` возвращает `admin`).

- [ ] **Step 5: Commit**

```bash
git add server/permissions.js server/test/permissions.test.js server/test/auth-routes.test.js server/test/account.test.js
git commit -m "feat(proposals): permissions for proposals, reports and moderation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Пользовательские `POST/PATCH/DELETE /api/features` и приватность вывода

**Files:**
- Modify: `server/repo.js` (`featureOut`, `listFeatures`, `getFeature`, `countOpenProposals`)
- Modify: `server/routes/content.js:157-222` (блок features)
- Modify: `server/app.js` (лимитер)
- Test: `server/test/proposals.test.js` (дописать)

**Interfaces:**
- Consumes: `can('feature:propose'|'feature:update'|'feature:delete', row)` (Task 2), `rawFeature`.
- Produces: `repo.countOpenProposals(db, userId)` → число (`pending` и `reject_reason IS NULL`); `repo.getFeature(db, id, viewer)`; объект в ответах: `{id, map_id, category_id, geometry, title, description, color, opacity, status, reject_reason, mine, images}` плюс `author_id` только для админа; лимитер `c.limiters.proposalsWrite`.

- [ ] **Step 1: Дописать падающие тесты**

В конец `server/test/proposals.test.js`:

```js
// ---------- user features ----------

test('a proposal is created as pending, owned by the user, admin-only fields are ignored', async (t) => {
  const ctx = await setup(t);
  const r = await propose(ctx, ctx.aliceCookie, {
    color: '#ff0000', opacity: 0.9, status: 'approved', author_id: ctx.bob, reject_reason: 'x', reviewed_by: 1,
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.status, 'pending');
  assert.equal(r.json.mine, true);
  assert.equal('author_id' in r.json, false);
  assert.equal(r.json.color, null);
  assert.equal(r.json.opacity, null);
  const row = repo.rawFeature(ctx.s.db, r.json.id);
  assert.equal(row.author_id, ctx.alice);
  assert.equal(row.reject_reason, null);
  assert.equal(row.reviewed_by, null);
  const adm = await ctx.s.api('POST', '/api/features', { cookie: ctx.s.adminCookie, body: body(ctx, { title: 'Admin' }) });
  assert.equal(adm.status, 201);
  assert.equal(adm.json.status, 'approved');
  assert.equal(adm.json.author_id, ctx.s.adminId);
});

test('guests, blocked authors and unpublished maps cannot receive proposals', async (t) => {
  const ctx = await setup(t);
  assert.equal((await propose(ctx, undefined)).status, 401);
  assert.equal((await propose(ctx, ctx.aliceCookie, { map_id: ctx.draftId })).status, 404);
  block(ctx, ctx.alice);
  const r = await propose(ctx, ctx.aliceCookie);
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'proposals_blocked');
  assert.equal((await propose(ctx, ctx.bobCookie)).status, 201, 'other users are unaffected');
});

test('at most 10 open proposals per user; rejected ones do not count', async (t) => {
  const ctx = await setup(t);
  for (let i = 0; i < 10; i++) seedFeature(ctx, { status: 'pending', title: 'P' + i });
  const over = await propose(ctx, ctx.aliceCookie);
  assert.equal(over.status, 409);
  assert.equal(over.json.error, 'proposals_limit');
  ctx.s.db.prepare("UPDATE features SET reject_reason = 'no' WHERE author_id = ? AND title = 'P0'").run(ctx.alice);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 201, 'a rejected proposal frees a slot');
  assert.equal((await propose(ctx, ctx.bobCookie)).status, 201, 'the limit is per user');
});

test('an author edits only their own open proposal', async (t) => {
  const ctx = await setup(t);
  const p = (await propose(ctx, ctx.aliceCookie)).json;
  const url = '/api/features/' + p.id;
  const ok = await ctx.s.api('PATCH', url, { cookie: ctx.aliceCookie, body: { title: 'Renamed', color: '#00ff00', status: 'approved', author_id: ctx.bob } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.title, 'Renamed');
  assert.equal(ok.json.color, null, 'color is ignored for users');
  assert.equal(ok.json.status, 'pending');
  assert.equal(repo.rawFeature(ctx.s.db, p.id).author_id, ctx.alice);
  assert.equal((await ctx.s.api('PATCH', url, { cookie: ctx.bobCookie, body: { title: 'hack' } })).status, 404);
  assert.equal((await ctx.s.api('PATCH', url, { body: { title: 'hack' } })).status, 401);
  const wrongShape = await ctx.s.api('PATCH', url, { cookie: ctx.aliceCookie, body: { category_id: ctx.polyCat } });
  assert.equal(wrongShape.status, 400, 'a point cannot move into a polygon category');
  // Rejected: no more edits.
  ctx.s.db.prepare("UPDATE features SET reject_reason = 'dup' WHERE id = ?").run(p.id);
  assert.equal((await ctx.s.api('PATCH', url, { cookie: ctx.aliceCookie, body: { title: 'again' } })).status, 404);
  // Published: no more edits.
  ctx.s.db.prepare("UPDATE features SET reject_reason = NULL, status = 'approved' WHERE id = ?").run(p.id);
  assert.equal((await ctx.s.api('PATCH', url, { cookie: ctx.aliceCookie, body: { title: 'again' } })).status, 404);
  assert.equal(repo.rawFeature(ctx.s.db, p.id).title, 'Renamed');
});

test('an author deletes their pending or rejected proposal, never a published or foreign one', async (t) => {
  const ctx = await setup(t);
  const open = seedFeature(ctx, { status: 'pending' });
  const rejected = seedFeature(ctx, { status: 'pending', rejectReason: 'dup' });
  const published = seedFeature(ctx, { status: 'approved' });
  const foreign = seedFeature(ctx, { status: 'pending', author: ctx.bob });
  const del = (id, cookie) => ctx.s.api('DELETE', '/api/features/' + id, { cookie });
  assert.equal((await del(foreign, ctx.aliceCookie)).status, 404);
  assert.equal((await del(published, ctx.aliceCookie)).status, 404);
  assert.equal((await del(open, ctx.aliceCookie)).status, 200);
  assert.equal((await del(rejected, ctx.aliceCookie)).status, 200);
  assert.equal((await del(open, undefined)).status, 401);
  assert.equal(repo.rawFeature(ctx.s.db, published).title, 'Seed');
  assert.equal((await del(published, ctx.s.adminCookie)).status, 200, 'admin deletes anything');
});

test('public output hides author_id and foreign pending objects; authors see their own status', async (t) => {
  const ctx = await setup(t);
  const mine = (await propose(ctx, ctx.aliceCookie, { title: 'Mine' })).json;
  seedFeature(ctx, { status: 'approved', author: ctx.bob, title: 'Public' });
  seedFeature(ctx, { status: 'pending', rejectReason: 'duplicate', author: ctx.alice, title: 'Rejected' });
  const guest = await features(ctx, undefined);
  assert.deepEqual(guest.map((f) => f.title), ['Public']);
  assert.equal('author_id' in guest[0], false);
  assert.equal(guest[0].mine, false);
  assert.equal(guest[0].reject_reason, null);
  const bobView = await features(ctx, ctx.bobCookie);
  assert.deepEqual(bobView.map((f) => f.title), ['Public']);
  assert.equal(bobView[0].mine, true, 'bob is the author of the published one');
  assert.equal('author_id' in bobView[0], false);
  const aliceView = await features(ctx, ctx.aliceCookie);
  assert.deepEqual(aliceView.map((f) => f.title).sort(), ['Mine', 'Public', 'Rejected']);
  const rejected = aliceView.find((f) => f.title === 'Rejected');
  assert.equal(rejected.reject_reason, 'duplicate');
  assert.equal(aliceView.find((f) => f.id === mine.id).status, 'pending');
  const admin = await features(ctx, ctx.s.adminCookie);
  assert.equal(admin.length, 3);
  assert.equal(admin.find((f) => f.title === 'Mine').author_id, ctx.alice);
});

test('users cannot upload photos', async (t) => {
  const ctx = await setup(t);
  const p = (await propose(ctx, ctx.aliceCookie)).json;
  const r = await ctx.s.api('PUT', '/api/features/' + p.id + '/images', {
    cookie: ctx.aliceCookie, raw: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  });
  assert.equal(r.status, 403);
});

test('proposal writes are rate limited per user, reads are not', async (t) => {
  const ctx = await setup(t, { limiters: { proposalsWrite: createRateLimiter({ max: 2, windowMs: 60000 }) } });
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 201);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 201);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 429);
  assert.equal((await ctx.s.api('GET', '/api/maps/main', { cookie: ctx.aliceCookie })).status, 200);
  assert.equal((await propose(ctx, ctx.bobCookie)).status, 201, 'another user is unaffected');
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/proposals.test.js`
Expected: FAIL (пользовательский `POST /api/features` отвечает 403, нет `mine`, `author_id` виден).

- [ ] **Step 3: Репозиторий**

В `server/repo.js` заменить `featureOut`:

```js
// author_id is only for admins; everyone else gets `mine` (are they the author) so the public
// payload never carries user ids. A rejection reason is for the author and the admin.
function featureOut(r, images, viewer) {
  const admin = Boolean(viewer) && viewer.role === 'admin';
  const mine = Boolean(viewer) && r.author_id !== null && r.author_id === viewer.id;
  const out = {
    id: r.id,
    map_id: r.map_id,
    category_id: r.category_id,
    geometry: JSON.parse(r.geometry),
    title: r.title,
    description: r.description,
    color: r.color,
    opacity: r.opacity,
    status: r.status,
    reject_reason: admin || mine ? r.reject_reason || null : null,
    mine,
    images: images || [],
  };
  if (admin) out.author_id = r.author_id;
  return out;
}
```

В `listFeatures` последнюю строку заменить на `return rows.map((r) => featureOut(r, imgs.get(r.id), viewer));`. `getFeature` заменить:

```js
function getFeature(db, id, viewer) {
  const r = rawFeature(db, id);
  if (!r) return null;
  const imgs = groupImages(
    db.prepare('SELECT id, feature_id, path FROM feature_images WHERE feature_id = ? ORDER BY sort, id').all(id),
  );
  return featureOut(r, imgs.get(id), viewer);
}

// Proposals that still wait for a decision (a rejected one no longer counts against the limit).
function countOpenProposals(db, userId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM features WHERE author_id = ? AND status = 'pending' AND reject_reason IS NULL")
    .get(userId).n;
}
```

и добавить `countOpenProposals,` в `module.exports`.

- [ ] **Step 4: Маршруты**

В `server/routes/content.js`: после `const repo = require('../repo');` добавить константу

```js
const MAX_OPEN_PROPOSALS = 10;

// Proposal writes of non-admins share one per-user limit.
function limitProposalWrites(c) {
  if (!c.limiters.proposalsWrite.allow('u:' + c.user.id, c.now())) {
    throw new HttpError(429, 'too many requests, try again later');
  }
}
```

Заменить три обработчика блока `// ---- features ----` (POST, PATCH, DELETE на `/api/features`) целиком:

```js
  // ---- features ----
  {
    method: 'POST',
    pattern: '/api/features',
    handler: async (c) => {
      if (!c.user) throw new HttpError(401, 'login required');
      const direct = can(c.user, 'feature:create');
      if (!direct) {
        if (!can(c.user, 'feature:propose')) throw new HttpError(403, 'proposals_blocked');
        limitProposalWrites(c);
      }
      const body = await readJson(c.req);
      const mapId = intField(body.map_id, 'map_id');
      const categoryId = intField(body.category_id, 'category_id');
      const map = mapOr404(c, mapId);
      if (!direct && !map.published) throw new HttpError(404, 'map not found');
      const cat = repo.getCategory(c.db, categoryId);
      if (!cat || cat.map_id !== mapId) throw new HttpError(400, 'category does not belong to this map');
      const geometry = checked(v.validateGeometry(cat.shape, body.geometry));
      const fields = checked(v.validateFeature(body, { create: true }));
      if (!direct) {
        // Appearance is the admin's call; and the limit check + insert below run with no await in between.
        delete fields.color;
        delete fields.opacity;
        if (repo.countOpenProposals(c.db, c.user.id) >= MAX_OPEN_PROPOSALS) throw new HttpError(409, 'proposals_limit');
      }
      const id = repo.insertRow(c.db, 'features', {
        ...fields,
        map_id: mapId,
        category_id: categoryId,
        geometry: JSON.stringify(geometry),
        author_id: c.user.id,
        status: direct ? 'approved' : 'pending',
        updated_by: c.user.id,
        updated_at: sqlTime(c.now()),
      });
      return { status: 201, body: repo.getFeature(c.db, id, c.user) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/features/:id',
    handler: async (c) => {
      if (!c.user) throw new HttpError(401, 'login required');
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      // A foreign, published or missing feature look the same to a non-admin.
      if (!row || !can(c.user, 'feature:update', row)) throw new HttpError(404, 'feature not found');
      const admin = c.user.role === 'admin';
      if (!admin) limitProposalWrites(c);
      const body = await readJson(c.req);
      const categoryId = 'category_id' in body ? intField(body.category_id, 'category_id') : row.category_id;
      const cat = repo.getCategory(c.db, categoryId);
      if (!cat || cat.map_id !== row.map_id) throw new HttpError(400, 'category does not belong to this map');
      const geometryIn = 'geometry' in body ? body.geometry : JSON.parse(row.geometry);
      const geometry = checked(v.validateGeometry(cat.shape, geometryIn));
      const fields = checked(v.validateFeature(body));
      if (!admin) {
        delete fields.color;
        delete fields.opacity;
      }
      repo.updateRow(c.db, 'features', id, {
        ...fields,
        category_id: categoryId,
        geometry: JSON.stringify(geometry),
        updated_by: c.user.id,
        updated_at: sqlTime(c.now()),
      });
      return { body: repo.getFeature(c.db, id, c.user) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/features/:id',
    handler: async (c) => {
      if (!c.user) throw new HttpError(401, 'login required');
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row || !can(c.user, 'feature:delete', row)) throw new HttpError(404, 'feature not found');
      if (c.user.role !== 'admin') limitProposalWrites(c);
      const files = repo.imagePathsFor(c.db, 'feature', id);
      repo.deleteRow(c.db, 'features', id);
      unlinkAll(c.uploadsDir, files);
      return { body: { ok: true } };
    },
  },
];
```

(закрывающая `];` — конец массива `module.exports`, как в исходном файле). В `server/app.js` в объект `limiters` после `marksWrite` добавить:

```js
    proposalsWrite: createRateLimiter({ max: 60, windowMs: 10 * MIN }),
```

- [ ] **Step 5: Запустить все тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS. Если упал существующий тест в `content.test.js`/`images.test.js` на статус 403 вместо 404 для не-админа на `PATCH`/`DELETE /api/features/:id`, привести его ожидание к 404 (спек: чужое и недоступное по состоянию — 404) и записать это в ledger как `Ruling`.

- [ ] **Step 6: Commit**

```bash
git add server/repo.js server/routes/content.js server/app.js server/test/proposals.test.js
git commit -m "feat(proposals): users propose, edit and delete their own pending features

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Модерация: очередь, одобрение, отклонение, блокировка

**Files:**
- Create: `server/routes/moderation.js`
- Modify: `server/repo.js` (`moderationOverview`)
- Modify: `server/app.js:7-13`
- Test: `server/test/proposals.test.js` (дописать)

**Interfaces:**
- Consumes: `can('moderation:read'|'moderation:write')`, `repo.rawFeature/getFeature/updateRow`.
- Produces:
  - `repo.moderationOverview(db)` → `{ proposals: [{id, map_id, map_slug, map_title, category_id, category_name, shape, title, description, geometry, author_id, author_login, created: updated_at}], reports: [{id, feature_id, feature_title, map_slug, text, created_at, reporter_id, reporter_login}], blocked: [{id, login, blocked_at, reason}] }`;
  - `GET /api/moderation`; `POST /api/features/:id/approve`; `POST /api/features/:id/reject {reason}`; `POST /api/users/:id/block-proposals {reason?}` → `{ok, rejected}`; `POST /api/users/:id/unblock-proposals`; `POST /api/reports/:id/resolve`.

- [ ] **Step 1: Дописать падающие тесты**

В конец `server/test/proposals.test.js`:

```js
// ---------- moderation ----------

const post = (ctx, url, cookie, bodyIn) => ctx.s.api('POST', url, { cookie, body: bodyIn || {} });

test('only the admin reads the moderation queue, and it lists open proposals only', async (t) => {
  const ctx = await setup(t);
  seedFeature(ctx, { status: 'pending', title: 'Open' });
  seedFeature(ctx, { status: 'pending', rejectReason: 'dup', title: 'Rejected' });
  seedFeature(ctx, { status: 'approved', title: 'Published' });
  assert.equal((await ctx.s.api('GET', '/api/moderation')).status, 401);
  assert.equal((await ctx.s.api('GET', '/api/moderation', { cookie: ctx.aliceCookie })).status, 403);
  const r = await ctx.s.api('GET', '/api/moderation', { cookie: ctx.s.adminCookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.proposals.map((p) => p.title), ['Open']);
  assert.equal(r.json.proposals[0].author_login, 'alice');
  assert.equal(r.json.proposals[0].map_slug, 'main');
  assert.equal(r.json.proposals[0].category_name, 'Cache');
  assert.deepEqual(r.json.reports, []);
  assert.deepEqual(r.json.blocked, []);
});

test('approve publishes a proposal, repeats are 409, a rejected one can be approved', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'pending', title: 'To publish' });
  assert.equal((await post(ctx, `/api/features/${id}/approve`, ctx.aliceCookie)).status, 403);
  assert.equal((await post(ctx, `/api/features/${id}/approve`, undefined)).status, 401);
  const ok = await post(ctx, `/api/features/${id}/approve`, ctx.s.adminCookie);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.status, 'approved');
  const row = repo.rawFeature(ctx.s.db, id);
  assert.equal(row.reviewed_by, ctx.s.adminId);
  assert.ok(row.reviewed_at);
  assert.deepEqual((await features(ctx, ctx.bobCookie)).map((f) => f.title), ['To publish']);
  assert.equal((await post(ctx, `/api/features/${id}/approve`, ctx.s.adminCookie)).status, 409);
  assert.equal((await post(ctx, '/api/features/99999/approve', ctx.s.adminCookie)).status, 404);
  const back = seedFeature(ctx, { status: 'pending', rejectReason: 'no', title: 'Second chance' });
  const again = await post(ctx, `/api/features/${back}/approve`, ctx.s.adminCookie);
  assert.equal(again.status, 200);
  assert.equal(repo.rawFeature(ctx.s.db, back).reject_reason, null);
});

test('reject needs a reason of 1..200 characters and never touches a published object', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'pending' });
  for (const reason of [undefined, '', '   ', 5, 'x'.repeat(201)]) {
    const r = await post(ctx, `/api/features/${id}/reject`, ctx.s.adminCookie, { reason });
    assert.equal(r.status, 400, JSON.stringify(reason));
  }
  assert.equal((await post(ctx, `/api/features/${id}/reject`, ctx.aliceCookie, { reason: 'x' })).status, 403);
  const ok = await post(ctx, `/api/features/${id}/reject`, ctx.s.adminCookie, { reason: ' Дубликат ' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.reject_reason, 'Дубликат');
  const aliceView = (await features(ctx, ctx.aliceCookie)).find((f) => f.id === id);
  assert.equal(aliceView.reject_reason, 'Дубликат');
  assert.equal((await features(ctx, ctx.bobCookie)).length, 0, 'others never see it');
  const pub = seedFeature(ctx, { status: 'approved', title: 'Published' });
  const bad = await post(ctx, `/api/features/${pub}/reject`, ctx.s.adminCookie, { reason: 'x' });
  assert.equal(bad.status, 409);
  assert.equal(repo.rawFeature(ctx.s.db, pub).status, 'approved');
});

test('blocking an author rejects their open proposals only and leaves sign-in and marks working', async (t) => {
  const ctx = await setup(t);
  const open1 = seedFeature(ctx, { status: 'pending', title: 'Open 1' });
  const open2 = seedFeature(ctx, { status: 'pending', title: 'Open 2' });
  const old = seedFeature(ctx, { status: 'pending', rejectReason: 'dup', title: 'Already rejected' });
  const pub = seedFeature(ctx, { status: 'approved', title: 'Published' });
  const bobs = seedFeature(ctx, { status: 'pending', author: ctx.bob, title: 'Bob open' });
  assert.equal((await post(ctx, `/api/users/${ctx.alice}/block-proposals`, ctx.aliceCookie)).status, 403);
  assert.equal((await post(ctx, `/api/users/${ctx.s.adminId}/block-proposals`, ctx.s.adminCookie)).status, 400, 'admins cannot be blocked');
  assert.equal((await post(ctx, '/api/users/99999/block-proposals', ctx.s.adminCookie)).status, 404);
  const r = await post(ctx, `/api/users/${ctx.alice}/block-proposals`, ctx.s.adminCookie, { reason: 'spam' });
  assert.equal(r.status, 200);
  assert.equal(r.json.rejected, 2);
  const reason = (id) => repo.rawFeature(ctx.s.db, id).reject_reason;
  assert.equal(reason(open1), 'Автор заблокирован');
  assert.equal(reason(open2), 'Автор заблокирован');
  assert.equal(reason(old), 'dup', 'an earlier reason is kept');
  assert.equal(repo.rawFeature(ctx.s.db, pub).status, 'approved');
  assert.equal(reason(bobs), null, 'other authors are untouched');
  // The block is visible to the user and closes proposals only.
  const me = await ctx.s.api('GET', '/api/me', { cookie: ctx.aliceCookie });
  assert.equal(me.json.user.proposalsBlocked, true);
  assert.equal(me.json.user.blockReason, 'spam');
  assert.equal(me.json.can.propose, false);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 403);
  const mark = await ctx.s.api('POST', '/api/my/marks', {
    cookie: ctx.aliceCookie, body: { map: 'main', shape: 'point', geometry: { x: 0.5, y: 0.5 } },
  });
  assert.equal(mark.status, 201, 'personal marks keep working');
  const queue = await ctx.s.api('GET', '/api/moderation', { cookie: ctx.s.adminCookie });
  assert.deepEqual(queue.json.blocked.map((b) => [b.login, b.reason]), [['alice', 'spam']]);
  assert.deepEqual(queue.json.proposals.map((p) => p.title), ['Bob open']);
});

test('unblocking restores proposing but does not revive rejected proposals', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'pending' });
  await post(ctx, `/api/users/${ctx.alice}/block-proposals`, ctx.s.adminCookie);
  assert.equal((await post(ctx, `/api/users/${ctx.alice}/unblock-proposals`, ctx.aliceCookie)).status, 403);
  assert.equal((await post(ctx, `/api/users/${ctx.alice}/unblock-proposals`, ctx.s.adminCookie)).status, 200);
  assert.equal((await propose(ctx, ctx.aliceCookie)).status, 201);
  assert.equal(repo.rawFeature(ctx.s.db, id).reject_reason, 'Автор заблокирован');
  assert.equal((await post(ctx, '/api/users/99999/unblock-proposals', ctx.s.adminCookie)).status, 404);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/proposals.test.js`
Expected: FAIL (маршруты модерации отвечают 404 `not found`).

- [ ] **Step 3: Обзор модерации в репозитории**

В `server/repo.js` перед `module.exports` добавить:

```js
// Everything the moderation dialog needs, in one round trip. Only open proposals are listed:
// a rejected one is waiting for its author to delete it, not for a decision.
function moderationOverview(db) {
  const proposals = db
    .prepare(
      `SELECT f.id, f.map_id, m.slug AS map_slug, m.title AS map_title, f.category_id, c.name AS category_name,
              c.shape, f.title, f.description, f.geometry, f.author_id, u.login AS author_login, f.updated_at
       FROM features f
       JOIN maps m ON m.id = f.map_id
       JOIN categories c ON c.id = f.category_id
       LEFT JOIN users u ON u.id = f.author_id
       WHERE f.status = 'pending' AND f.reject_reason IS NULL
       ORDER BY f.id`,
    )
    .all()
    .map((r) => ({ ...r, geometry: JSON.parse(r.geometry) }));
  const reports = db
    .prepare(
      `SELECT r.id, r.feature_id, f.title AS feature_title, m.slug AS map_slug, r.text, r.created_at,
              r.user_id AS reporter_id, u.login AS reporter_login
       FROM reports r
       JOIN features f ON f.id = r.feature_id
       JOIN maps m ON m.id = f.map_id
       JOIN users u ON u.id = r.user_id
       WHERE r.resolved_at IS NULL
       ORDER BY r.id`,
    )
    .all()
    .map((r) => ({ ...r }));
  const blocked = db
    .prepare(
      `SELECT id, login, proposals_blocked_at AS blocked_at, proposals_block_reason AS reason
       FROM users WHERE proposals_blocked_at IS NOT NULL ORDER BY proposals_blocked_at, id`,
    )
    .all()
    .map((r) => ({ ...r }));
  return { proposals: proposals.map((r) => ({ ...r })), reports, blocked };
}
```

и добавить `moderationOverview,` в `module.exports`.

- [ ] **Step 4: Маршруты модерации**

Создать `server/routes/moderation.js`:

```js
'use strict';

const { HttpError, readJson } = require('../http-util');
const { can } = require('../permissions');
const repo = require('../repo');

const MAX_REASON = 200;
const BLOCK_REJECT_REASON = 'Автор заблокирован';

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function need(c, action) {
  if (!c.user) throw new HttpError(401, 'login required');
  if (!can(c.user, action)) throw new HttpError(403, 'forbidden');
}

function idParam(c) {
  const n = Number(c.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'not found');
  return n;
}

// A required, trimmed text of 1..MAX_REASON characters.
function requiredReason(body) {
  const s = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!s || s.length > MAX_REASON) throw new HttpError(400, 'reason must be 1..200 characters');
  return s;
}

function optionalReason(body) {
  if (body.reason === undefined || body.reason === null) return null;
  if (typeof body.reason !== 'string' || body.reason.length > MAX_REASON) {
    throw new HttpError(400, 'reason must be up to 200 characters');
  }
  return body.reason.trim() || null;
}

function targetUser(c) {
  const user = c.db.prepare('SELECT id, role FROM users WHERE id = ?').get(idParam(c));
  if (!user) throw new HttpError(404, 'user not found');
  return user;
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/moderation',
    handler: async (c) => {
      need(c, 'moderation:read');
      return { body: repo.moderationOverview(c.db) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/features/:id/approve',
    handler: async (c) => {
      need(c, 'moderation:write');
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      if (row.status !== 'pending') throw new HttpError(409, 'already published');
      repo.updateRow(c.db, 'features', id, {
        status: 'approved',
        reject_reason: null,
        reviewed_at: sqlTime(c.now()),
        reviewed_by: c.user.id,
      });
      return { body: repo.getFeature(c.db, id, c.user) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/features/:id/reject',
    handler: async (c) => {
      need(c, 'moderation:write');
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      const reason = requiredReason(await readJson(c.req));
      if (row.status !== 'pending') throw new HttpError(409, 'a published object cannot be rejected');
      repo.updateRow(c.db, 'features', id, {
        reject_reason: reason,
        reviewed_at: sqlTime(c.now()),
        reviewed_by: c.user.id,
      });
      return { body: repo.getFeature(c.db, id, c.user) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/users/:id/block-proposals',
    handler: async (c) => {
      need(c, 'moderation:write');
      const user = targetUser(c);
      if (user.role === 'admin') throw new HttpError(400, 'cannot block an admin');
      const reason = optionalReason(await readJson(c.req));
      const now = sqlTime(c.now());
      // The block and the rejection of the open proposals land together or not at all.
      c.db.exec('BEGIN');
      try {
        c.db
          .prepare('UPDATE users SET proposals_blocked_at = ?, proposals_block_reason = ? WHERE id = ?')
          .run(now, reason, user.id);
        const r = c.db
          .prepare(
            `UPDATE features SET reject_reason = ?, reviewed_at = ?, reviewed_by = ?
             WHERE author_id = ? AND status = 'pending' AND reject_reason IS NULL`,
          )
          .run(BLOCK_REJECT_REASON, now, c.user.id, user.id);
        c.db.exec('COMMIT');
        return { body: { ok: true, rejected: Number(r.changes) } };
      } catch (err) {
        c.db.exec('ROLLBACK');
        throw err;
      }
    },
  },
  {
    method: 'POST',
    pattern: '/api/users/:id/unblock-proposals',
    handler: async (c) => {
      need(c, 'moderation:write');
      const user = targetUser(c);
      c.db
        .prepare('UPDATE users SET proposals_blocked_at = NULL, proposals_block_reason = NULL WHERE id = ?')
        .run(user.id);
      return { body: { ok: true } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reports/:id/resolve',
    handler: async (c) => {
      need(c, 'moderation:write');
      const id = idParam(c);
      const row = c.db.prepare('SELECT id, resolved_at FROM reports WHERE id = ?').get(id);
      if (!row) throw new HttpError(404, 'report not found');
      if (row.resolved_at) throw new HttpError(409, 'already resolved');
      c.db
        .prepare('UPDATE reports SET resolved_at = ?, resolved_by = ? WHERE id = ?')
        .run(sqlTime(c.now()), c.user.id, id);
      return { body: { ok: true } };
    },
  },
];
```

В `server/app.js` в `ROUTE_MODULES` после `require('./routes/marks')` добавить `require('./routes/moderation'),`.

- [ ] **Step 5: Запустить все тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/moderation.js server/repo.js server/app.js server/test/proposals.test.js
git commit -m "feat(proposals): moderation queue, approve, reject and author blocking

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Жалобы на ошибки и очистка старых отклонённых

**Files:**
- Modify: `server/routes/moderation.js` (маршрут жалобы)
- Modify: `server/tokens.js:50-65`
- Test: `server/test/proposals.test.js` (дописать)

**Interfaces:**
- Consumes: `can('report:create')`, `c.limiters.proposalsWrite` (Task 3), `reports` (Task 1).
- Produces: `POST /api/features/:id/report {text}` → 201 `{ok: true}`; `cleanup(db, nowMs)` дополнительно удаляет отклонённые без фото старше 30 дней.

- [ ] **Step 1: Дописать падающие тесты**

В конец `server/test/proposals.test.js`:

```js
// ---------- reports ----------

const report = (ctx, id, cookie, text = 'The marker is on the wrong hill') =>
  ctx.s.api('POST', `/api/features/${id}/report`, { cookie, body: { text } });

test('a signed-in user reports a published object; duplicates and bad text are refused', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'approved', author: ctx.bob, title: 'Cache' });
  assert.equal((await report(ctx, id, undefined)).status, 401);
  const ok = await report(ctx, id, ctx.aliceCookie);
  assert.equal(ok.status, 201);
  const dup = await report(ctx, id, ctx.aliceCookie);
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'report_exists');
  assert.equal((await report(ctx, id, ctx.bobCookie)).status, 201, 'another user may report the same object');
  for (const text of [undefined, '', '   ', 7, 'x'.repeat(501)]) {
    const r = await ctx.s.api('POST', `/api/features/${id}/report`, { cookie: ctx.s.adminCookie, body: { text } });
    assert.equal(r.status, 400, JSON.stringify(text));
  }
  const queue = await ctx.s.api('GET', '/api/moderation', { cookie: ctx.s.adminCookie });
  assert.deepEqual(queue.json.reports.map((r) => [r.reporter_login, r.feature_title]).sort(), [['alice', 'Cache'], ['bob', 'Cache']]);
});

test('a report on a pending object or on a draft map is a 404', async (t) => {
  const ctx = await setup(t);
  const pending = seedFeature(ctx, { status: 'pending', author: ctx.bob });
  const onDraft = repo.insertRow(ctx.s.db, 'features', {
    map_id: ctx.draftId, category_id: ctx.pointCat, geometry: JSON.stringify({ x: 0, y: 0 }), title: 'Draft object', status: 'approved',
  });
  assert.equal((await report(ctx, pending, ctx.aliceCookie)).status, 404);
  assert.equal((await report(ctx, onDraft, ctx.aliceCookie)).status, 404);
  assert.equal((await report(ctx, 99999, ctx.aliceCookie)).status, 404);
});

test('a blocked author cannot report; the limit is 20 open reports per user', async (t) => {
  const ctx = await setup(t);
  const ids = [];
  for (let i = 0; i < 21; i++) ids.push(seedFeature(ctx, { status: 'approved', author: ctx.bob, title: 'F' + i }));
  for (let i = 0; i < 20; i++) {
    ctx.s.db.prepare('INSERT INTO reports (feature_id, user_id, text) VALUES (?, ?, ?)').run(ids[i], ctx.alice, 'old');
  }
  const over = await report(ctx, ids[20], ctx.aliceCookie);
  assert.equal(over.status, 409);
  assert.equal(over.json.error, 'reports_limit');
  block(ctx, ctx.bob);
  const blocked = await report(ctx, ids[0], ctx.bobCookie);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error, 'proposals_blocked');
});

test('only the admin resolves a report, and the same user may report again afterwards', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'approved', author: ctx.bob });
  await report(ctx, id, ctx.aliceCookie);
  const reportId = ctx.s.db.prepare('SELECT id FROM reports').get().id;
  assert.equal((await post(ctx, `/api/reports/${reportId}/resolve`, ctx.aliceCookie)).status, 403);
  assert.equal((await post(ctx, `/api/reports/${reportId}/resolve`, undefined)).status, 401);
  assert.equal((await post(ctx, `/api/reports/${reportId}/resolve`, ctx.s.adminCookie)).status, 200);
  assert.equal((await post(ctx, `/api/reports/${reportId}/resolve`, ctx.s.adminCookie)).status, 409);
  assert.equal((await post(ctx, '/api/reports/99999/resolve', ctx.s.adminCookie)).status, 404);
  const queue = await ctx.s.api('GET', '/api/moderation', { cookie: ctx.s.adminCookie });
  assert.deepEqual(queue.json.reports, []);
  assert.equal((await report(ctx, id, ctx.aliceCookie)).status, 201, 'a resolved report no longer blocks a new one');
});

test('deleting an object or a user removes the reports; published objects survive their author', async (t) => {
  const ctx = await setup(t);
  const id = seedFeature(ctx, { status: 'approved', author: ctx.bob, title: 'Survives' });
  const other = seedFeature(ctx, { status: 'approved', author: ctx.bob, title: 'Deleted' });
  await report(ctx, id, ctx.aliceCookie);
  await report(ctx, other, ctx.aliceCookie);
  await ctx.s.api('DELETE', `/api/features/${other}`, { cookie: ctx.s.adminCookie });
  assert.equal(ctx.s.db.prepare('SELECT COUNT(*) AS n FROM reports WHERE feature_id = ?').get(other).n, 0);
  ctx.s.db.prepare('DELETE FROM users WHERE id = ?').run(ctx.alice);
  assert.equal(ctx.s.db.prepare('SELECT COUNT(*) AS n FROM reports').get().n, 0, 'the reporter is gone, so are their reports');
  ctx.s.db.prepare('DELETE FROM users WHERE id = ?').run(ctx.bob);
  const row = repo.rawFeature(ctx.s.db, id);
  assert.equal(row.title, 'Survives');
  assert.equal(row.author_id, null);
});

// ---------- cleanup ----------

test('cleanup deletes old rejected proposals without photos and keeps everything else', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  migrate(db);
  db.exec("INSERT INTO maps (slug, title, published) VALUES ('m', 'M', 1)");
  db.exec("INSERT INTO categories (map_id, name, shape) VALUES (1, 'C', 'point')");
  const now = Date.UTC(2026, 9, 11, 12, 0, 0);
  const day = 24 * 60 * 60 * 1000;
  const stamp = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
  const add = (title, status, reason, reviewedAt) => Number(db.prepare(
    `INSERT INTO features (map_id, category_id, geometry, title, status, reject_reason, reviewed_at)
     VALUES (1, 1, '{"x":0,"y":0}', ?, ?, ?, ?)`).run(title, status, reason, reviewedAt).lastInsertRowid);
  add('old rejected', 'pending', 'dup', stamp(now - 31 * day));
  add('fresh rejected', 'pending', 'dup', stamp(now - 5 * day));
  add('open pending', 'pending', null, null);
  add('old published', 'approved', null, stamp(now - 90 * day));
  const withPhoto = add('old rejected with photo', 'pending', 'dup', stamp(now - 40 * day));
  db.prepare("INSERT INTO feature_images (feature_id, path) VALUES (?, 'features/a.jpg')").run(withPhoto);
  cleanup(db, now);
  const titles = db.prepare('SELECT title FROM features ORDER BY id').all().map((r) => r.title);
  assert.deepEqual(titles, ['fresh rejected', 'open pending', 'old published', 'old rejected with photo']);
  db.close();
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/proposals.test.js`
Expected: FAIL (`POST /api/features/:id/report` отвечает 404 `not found`, очистка не удаляет отклонённые).

- [ ] **Step 3: Маршрут жалобы**

В `server/routes/moderation.js` добавить константы после `const BLOCK_REJECT_REASON`:

```js
const MAX_REPORT_TEXT = 500;
const MAX_OPEN_REPORTS = 20;
```

и в массив маршрутов (перед `/api/reports/:id/resolve`) добавить:

```js
  {
    method: 'POST',
    pattern: '/api/features/:id/report',
    handler: async (c) => {
      if (!c.user) throw new HttpError(401, 'login required');
      if (!can(c.user, 'report:create')) throw new HttpError(403, 'proposals_blocked');
      if (!c.limiters.proposalsWrite.allow('u:' + c.user.id, c.now())) {
        throw new HttpError(429, 'too many requests, try again later');
      }
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      // Only what the public sees can be reported; anything else looks like a missing object.
      const map = row ? repo.getMapById(c.db, row.map_id) : null;
      if (!row || row.status !== 'approved' || !map || (!map.published && c.user.role !== 'admin')) {
        throw new HttpError(404, 'feature not found');
      }
      const body = await readJson(c.req);
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text || text.length > MAX_REPORT_TEXT) throw new HttpError(400, 'text must be 1..500 characters');
      const open = c.db
        .prepare('SELECT 1 FROM reports WHERE feature_id = ? AND user_id = ? AND resolved_at IS NULL')
        .get(id, c.user.id);
      if (open) throw new HttpError(409, 'report_exists');
      const n = c.db
        .prepare('SELECT COUNT(*) AS n FROM reports WHERE user_id = ? AND resolved_at IS NULL')
        .get(c.user.id).n;
      if (n >= MAX_OPEN_REPORTS) throw new HttpError(409, 'reports_limit');
      c.db
        .prepare('INSERT INTO reports (feature_id, user_id, text, created_at) VALUES (?, ?, ?, ?)')
        .run(id, c.user.id, text, sqlTime(c.now()));
      return { status: 201, body: { ok: true } };
    },
  },
```

- [ ] **Step 4: Очистка**

В `server/tokens.js` в конец функции `cleanup` (перед закрывающей `}`) добавить:

```js
  // Rejected proposals nobody deleted: 30 days after the decision. Ones with photos stay: their files
  // live outside the database and this function has no uploads directory to remove them from.
  db.prepare(
    `DELETE FROM features
     WHERE status = 'pending' AND reject_reason IS NOT NULL
       AND reviewed_at IS NOT NULL AND reviewed_at < datetime(? / 1000, 'unixepoch')
       AND NOT EXISTS (SELECT 1 FROM feature_images fi WHERE fi.feature_id = features.id)`,
  ).run(nowMs - 30 * 24 * HOUR);
```

- [ ] **Step 5: Запустить все тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/moderation.js server/tokens.js server/test/proposals.test.js
git commit -m "feat(proposals): reports on published objects and cleanup of old rejections

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Просмотр: статус на карте, пунктир, жалоба, заметка о блокировке

Фронтенд без автотестов: проверка ручная (шаг 5). Файлы в CRLF: правки делать с сохранением окончаний.

**Files:**
- Modify: `map-app.js` (`makeLayer`, `markerIcon`, `cardNode`, `setupAuth`)
- Modify: `map-app.css`

**Interfaces:**
- Consumes: поля объекта `status`, `reject_reason`, `mine` (Task 3); `state.me.can.propose`, `state.me.user.proposalsBlocked/blockReason` (Task 1-2); `POST /api/features/:id/report` (Task 5).

- [ ] **Step 1: Пунктир и пометка ожидающих**

В `map-app.js`:

1. В `markerIcon(feature, cat)` после строки `el.style.setProperty('--c', feature.color || cat.color);` добавить:

```js
    if (feature.status === 'pending') el.classList.add('pending');
```

2. В `makeLayer` после строки `var style = Geo.featureStyle(feature, cat);` добавить:

```js
    if (feature.status === 'pending') style.dashArray = '6 4';
```

и строку линии `layer = L.polyline(Geo.pointsToLatLngs(feature.geometry.points, size), { color: style.color, weight: 3 });` заменить на:

```js
      layer = L.polyline(Geo.pointsToLatLngs(feature.geometry.points, size),
        { color: style.color, weight: 3, dashArray: style.dashArray });
```

- [ ] **Step 2: Статус и жалоба в карточке**

Заменить `cardNode` целиком:

```js
  // "На модерации" / "Отклонено: причина" for the author's own unpublished object.
  function statusLine(feature) {
    if (feature.status !== 'pending') return null;
    var text = feature.reject_reason ? 'Отклонено: ' + feature.reject_reason : 'На модерации';
    return h('div', { class: 'card-status' + (feature.reject_reason ? ' rejected' : '') }, text);
  }

  var REPORT_ERRORS = {
    report_exists: 'Вы уже сообщали об этом объекте, мы рассмотрим.',
    reports_limit: 'Слишком много открытых жалоб, дождитесь решения по прежним.',
    proposals_blocked: 'Отправка сообщений для вас закрыта.',
  };

  // A collapsed "Сообщить об ошибке" form for a published object (not for guests or blocked users).
  function reportBox(feature) {
    if (feature.status !== 'approved' || !state.me.can.propose) return null;
    var note = h('p', { class: 'hint' });
    var text = h('textarea', { rows: 3, maxLength: 500, placeholder: 'Что не так с этим объектом?' });
    var send = h('button', { type: 'button', class: 'primary' }, 'Отправить');
    var form = h('div', { class: 'report-form', hidden: true }, text, h('div', { class: 'row' }, send), note);
    // The form lives inside a Leaflet popup: keys typed here must not pan/zoom the map or close the card.
    L.DomEvent.disableClickPropagation(form);
    L.DomEvent.on(form, 'keydown keyup keypress', L.DomEvent.stopPropagation);
    var open = h('button', { type: 'button', class: 'link' }, 'Сообщить об ошибке');
    open.addEventListener('click', function () { form.hidden = !form.hidden; });
    send.addEventListener('click', function () {
      var value = text.value.trim();
      if (!value) { note.textContent = 'Опишите ошибку.'; return; }
      send.disabled = true;
      api.post('/api/features/' + feature.id + '/report', { text: value }).then(function () {
        form.textContent = '';
        form.appendChild(h('p', { class: 'ok' }, 'Спасибо, сообщение отправлено.'));
      }, function (err) {
        send.disabled = false;
        note.textContent = REPORT_ERRORS[err.message] || (err.status === 429 ? 'Слишком часто, подождите немного.' : 'Не удалось отправить: ' + err.message);
      });
    });
    return h('div', { class: 'report' }, open, form);
  }

  function cardNode(feature) {
    var cat = catById(feature.category_id);
    return h('div', { class: 'card' },
      h('h3', null, feature.title || (cat ? cat.name : '')),
      h('div', { class: 'card-cat' }, cat ? cat.name : ''),
      statusLine(feature),
      feature.description ? h('p', { class: 'card-text' }, feature.description) : null,
      feature.images.length ? h('div', { class: 'card-photos' }, feature.images.map(function (img) {
        return h('a', { href: img.url, target: '_blank', rel: 'noopener' },
          h('img', { src: img.url, loading: 'lazy', alt: '' }));
      })) : null,
      reportBox(feature));
  }
```

- [ ] **Step 3: Заметка о блокировке**

В `setupAuth` после блока `if (!user) { ... }` (подсказка гостю) добавить:

```js
    if (user && user.proposalsBlocked) {
      $('side').appendChild(h('p', { class: 'hint' },
        'Отправка предложений для вас закрыта' + (user.blockReason ? ': ' + user.blockReason : '') + '.'));
    }
```

- [ ] **Step 4: Стили**

В `map-app.css` перед блоком `@media (max-width: 720px)` добавить:

```css
/* proposals and reports */
.mk.pending { opacity: .65; border-style: dashed; }
.card-status { margin: 0 0 8px; padding: 2px 8px; border-radius: 6px; font-size: 12px; background: #2a2a1c; color: var(--accent); }
.card-status.rejected { background: #2e1c18; color: var(--danger); }
.report { margin-top: 10px; }
.report .link { background: none; border: 0; padding: 0; color: var(--muted); text-decoration: underline; cursor: pointer; }
.report-form { margin-top: 6px; }
.report-form textarea { width: 100%; }
.ok { color: #8fbf6a; margin: 6px 0; }
```

- [ ] **Step 5: Ручная проверка**

Run: локальный запуск из `RELEASE.md` → «Локальная разработка»; создать пользователя и категорию, объект админа.
Expected:
- гость: карточка без кнопки жалобы;
- вошедший: у опубликованного объекта «Сообщить об ошибке» раскрывает форму, отправка показывает «Спасибо…», повторная отправка по тому же объекту: «Вы уже сообщали…»;
- свои `pending`-объекты (созданные запросом `MapApi.post('/api/features', ...)` из консоли): пунктир, в карточке «На модерации», у отклонённого красная «Отклонено: причина»;
- заблокированный (через `UPDATE users SET proposals_blocked_at = ...`): в боковой панели «Отправка предложений для вас закрыта…», кнопки жалобы нет;
- в поле жалобы можно печатать (пробел, `+`, `-`, стрелки, Esc), карта при этом не двигается и не зумится, карточка не закрывается;
- 375 px (iframe): статус и кнопка жалобы работают, шторка не ломается.

- [ ] **Step 6: Commit**

```bash
git add map-app.js map-app.css
git commit -m "feat(map): proposal status, dashed style, report form and block note

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Режим «Предложить» в редакторе

Фронтенд без автотестов: ручная проверка (шаг 5). Файлы в CRLF.

**Files:**
- Modify: `map-editor.js`
- Modify: `map-marks-editor.js` (`buildModeSwitch`, `start`)
- Modify: `map-app.js` (`startEditor` условие)

**Interfaces:**
- Consumes: `state.me.can.feature` (админ), `state.me.can.propose`; `feature.mine/status/reject_reason` (Task 3); `V.defaultClick` (этап C).
- Produces: `MapEditor` работает в двух режимах по `isAdmin`; у не-админа нет «Категории/Карты/Модерация», цвета, прозрачности, фото; свои отклонённые объекты заблокированы для правки и доступны для удаления.

- [ ] **Step 1: Роль в `map-editor.js`**

1. После `var els = {};` добавить `var isAdmin = false;`.
2. В `start(viewer)` после `map = V.leaflet();` добавить `isAdmin = !!V.state().me.can.feature;`.
3. В `buildToolbar` заменить три строки (разделитель и кнопки «Категории», «Карты») на:

```js
    if (isAdmin) {
      bar.appendChild(h('span', { class: 'ed-sep' }));
      bar.appendChild(h('button', { type: 'button', onclick: function () { openDialog('categories'); } }, 'Категории'));
      bar.appendChild(h('button', { type: 'button', onclick: function () { openDialog('maps'); } }, 'Карты'));
      els.moderationBtn = h('button', { type: 'button', onclick: function () { openDialog('moderation'); } }, 'Модерация');
      bar.appendChild(els.moderationBtn);
    }
```

- [ ] **Step 2: Панель свойств без админских полей**

В `buildProps` заменить создание панели на (метки «Цвет» и «Фото» вынесены в элементы, чтобы их скрыть):

```js
    els.photos = h('div', { class: 'ed-photos' });
    els.colorLabel = h('label', null, 'Цвет');
    els.colorRow = h('div', { class: 'row' }, els.color, els.colorReset);
    els.photosLabel = h('label', null, 'Фото');
    els.note = h('p', { class: 'hint' });
    els.panel = h('aside', { class: 'ed-props', hidden: true },
      h('h2', null, 'Объект'),
      els.note,
      h('label', null, 'Название'), els.title,
      h('label', null, 'Категория'), els.cat,
      h('label', null, 'Описание'), els.desc,
      els.colorLabel, els.colorRow,
      els.opacityRow,
      els.photosLabel, els.photos,
      h('p', null, h('button', { type: 'button', class: 'danger', onclick: deleteSelected }, 'Удалить объект')));
    if (!isAdmin) {
      // Appearance and photos are the admin's call; a proposal is a position, a category and a text.
      [els.colorLabel, els.colorRow, els.opacityRow, els.photosLabel, els.photos].forEach(function (el) { el.hidden = true; });
    }
```

(строка `document.getElementById('props-slot').appendChild(els.panel);` и обработчики ниже остаются.)

В `showProps` заменить блок от `put(els.color, ...)` до `if (window.MapEditor.renderPhotos) ...` на:

```js
    put(els.color, f.color || cat.color);
    put(els.opacity, f.opacity === null ? 0.25 : f.opacity);
    if (isAdmin) {
      els.opacityRow.hidden = cat.shape !== 'polygon';
      els.colorReset.hidden = f.color === null;
      if (window.MapEditor.renderPhotos) window.MapEditor.renderPhotos(f);
    }
    // A user's own proposal: show where it stands; a rejected one can only be deleted.
    var locked = isLocked(f);
    els.title.disabled = locked;
    els.desc.disabled = locked;
    els.cat.disabled = locked;
    els.note.hidden = isAdmin || f.status !== 'pending';
    els.note.textContent = f.reject_reason ? 'Отклонено: ' + f.reject_reason : 'На модерации';
```

и перед `function showProps(f) {` добавить:

```js
  // A rejected proposal of a non-admin cannot be edited any more (the server answers 404).
  function isLocked(f) {
    return !isAdmin && f.status === 'pending' && !!f.reject_reason;
  }

```

- [ ] **Step 3: Выбор и правка только своего**

1. Заменить `onFeatureClick`:

```js
  function onFeatureClick(id, e) {
    if (V.mode() !== 'shared') return V.defaultClick(id, e);
    // A user may only select their own unpublished objects; everything else opens its card.
    var f = V.featureById(id);
    if (!isAdmin && !(f && f.mine && f.status === 'pending')) return V.defaultClick(id, e);
    if (ed.drawing || ed.tool === 'point') return false;
    if (ed.tool === 'select') { select(id); return true; }
    return false;
  }
```

2. В `select(id)` строку `enableEdit(layer);` заменить на `if (!isLocked(f)) enableEdit(layer);`.

- [ ] **Step 4: Переключатель режимов для пользователей**

В `map-marks-editor.js`:

1. `buildModeSwitch` заменить на версию с подписью первой кнопки:

```js
  function buildModeSwitch(sharedLabel) {
    els.modeShared = h('button', { type: 'button', onclick: function () { setMode('shared'); } }, sharedLabel);
    els.modeMarks = h('button', { type: 'button', onclick: function () { setMode('marks'); } }, 'Мои метки');
    var sw = h('div', { class: 'ed-mode' }, els.modeShared, els.modeMarks);
    var slot = document.getElementById('ed-slot');
    slot.insertBefore(sw, slot.firstChild);
  }
```

2. В `start` заменить блок `if (V.state().me.can.feature) { buildModeSwitch(); setMode('shared'); } else { setMode('marks'); }` на:

```js
    var can = V.state().me.can;
    if (can.feature) {
      buildModeSwitch('Общие');
      setMode('shared');
    } else if (can.propose && window.MapEditor) {
      // A user chooses between proposing to the shared map and their private marks; private is the default.
      buildModeSwitch('Предложить');
      setMode('marks');
    } else {
      setMode('marks');
    }
```

3. В `map-app.js` в `init` условие запуска общего редактора заменить на:

```js
        if (geomanLoaded && wantsEditor() && (state.me.can.feature || state.me.can.propose)) {
```

- [ ] **Step 5: Ручная проверка**

Run: локальный сервер; пользователь `alice`, категория-точка и категория-полигон, один общий объект.
Expected:
- пользователь на ПК: переключатель «Предложить / Мои метки», по умолчанию «Мои метки»; в «Предложить» инструменты точка/полигон/линия, нет «Категории», «Карты», «Модерация», в панели нет цвета, прозрачности, фото; поставленная точка получает статус «На модерации», пунктир;
- клик по чужому общему объекту открывает карточку, а не панель правки;
- свой отклонённый (выставить `reject_reason` в БД): панель с красной пометкой, поля заблокированы, «Удалить» работает, вершины не двигаются;
- админ: «Общие / Мои метки», прежний редактор с кнопками «Категории», «Карты», «Модерация», фото и цвет на месте;
- заблокированный: переключателя нет, только «Мои метки».

- [ ] **Step 6: Commit**

```bash
git add map-editor.js map-marks-editor.js map-app.js
git commit -m "feat(map): proposal mode of the editor for signed-in users

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Диалог «Модерация» для админа

Фронтенд без автотестов: ручная проверка (шаг 4).

**Files:**
- Modify: `map-editor-dialogs.js`
- Modify: `map-editor.js` (счётчик на кнопке)
- Modify: `map-app.css`

**Interfaces:**
- Consumes: `GET /api/moderation`, `POST /api/features/:id/approve|reject`, `POST /api/users/:id/block-proposals|unblock-proposals`, `POST /api/reports/:id/resolve` (Task 4); `MapEditor.save`, `MapViewer.loadMap/focusFeature/state` (существуют).
- Produces: `MapEditorDialogs.moderation()`; `MapEditor.setModerationCount(n)`.

- [ ] **Step 1: Счётчик на кнопке**

В `map-editor.js`:

1. Перед `window.MapEditor = {` добавить:

```js
  function setModerationCount(n) {
    if (els.moderationBtn) els.moderationBtn.textContent = 'Модерация' + (n ? ' (' + n + ')' : '');
  }

  function refreshModeration() {
    if (!isAdmin) return;
    api.get('/api/moderation').then(function (d) {
      setModerationCount(d.proposals.length + d.reports.length);
    }, function () { /* the badge is a convenience */ });
  }
```

2. В `start` перед `status('Режим редактора', '');` добавить `refreshModeration();`.
3. В `window.MapEditor` добавить `setModerationCount: setModerationCount,`.

- [ ] **Step 2: Диалог**

В `map-editor-dialogs.js` перед `window.MapEditorDialogs = ...` добавить функцию и заменить экспорт:

```js
  // ---------- moderation ----------

  function moderation() {
    var viewer = V();
    var data = { proposals: [], reports: [], blocked: [] };
    var tab = 'proposals';
    var TITLES = { proposals: 'Предложения', reports: 'Жалобы', blocked: 'Заблокированные' };
    var tabs = h('div', { class: 'row' });
    var list = h('div', { class: 'dlg-list' });
    var dlg;

    function reload() {
      return api.get('/api/moderation').then(function (d) {
        data = d;
        E().setModerationCount(d.proposals.length + d.reports.length);
        render();
      }, function (err) {
        list.textContent = 'Ошибка: ' + err.message;
      });
    }

    // Runs a moderation call with the editor's status line, then refreshes the queue (and the map).
    function act(fn, reloadMap) {
      return E().save(fn).then(function (res) {
        if (!res) return;
        var st = viewer.state();
        if (reloadMap && st.map) viewer.loadMap(st.map.slug, { keepView: true });
        reload();
      });
    }

    function showOnMap(slug, featureId) {
      dlg.close();
      var st = viewer.state();
      var go = st.map && st.map.slug === slug ? Promise.resolve() : viewer.loadMap(slug);
      go.then(function () { viewer.focusFeature(featureId); });
    }

    function proposalRow(p) {
      var reason = h('input', { type: 'text', maxLength: 200, placeholder: 'Причина отклонения' });
      return h('div', { class: 'dlg-row mod-row' },
        h('div', { class: 'mod-info' },
          h('strong', null, p.title || 'Без названия'),
          h('div', { class: 'hint' }, p.category_name + ' · ' + p.map_title + ' · ' + (p.author_login || 'аккаунт удалён')),
          p.description ? h('div', { class: 'mod-text' }, p.description) : null),
        reason,
        h('button', { type: 'button', onclick: function () { showOnMap(p.map_slug, p.id); } }, 'Показать'),
        h('button', { type: 'button', class: 'primary', onclick: function () {
          act(function () { return api.post('/api/features/' + p.id + '/approve', {}); }, true);
        } }, 'Одобрить'),
        h('button', { type: 'button', class: 'danger', onclick: function () {
          if (!reason.value.trim()) { reason.focus(); return; }
          act(function () { return api.post('/api/features/' + p.id + '/reject', { reason: reason.value.trim() }); }, true);
        } }, 'Отклонить'),
        p.author_id ? h('button', { type: 'button', class: 'danger', onclick: function () { blockAuthor(p.author_id, p.author_login); } },
          'Заблокировать автора') : null);
    }

    function blockAuthor(userId, login) {
      var why = window.prompt('Заблокировать «' + login + '» для предложений и жалоб. Причина (необязательно):', '');
      if (why === null) return;
      act(function () { return api.post('/api/users/' + userId + '/block-proposals', { reason: why.trim() }); }, true);
    }

    function reportRow(r) {
      return h('div', { class: 'dlg-row mod-row' },
        h('div', { class: 'mod-info' },
          h('strong', null, r.feature_title || 'Без названия'),
          h('div', { class: 'hint' }, 'от ' + r.reporter_login + ' · ' + r.created_at),
          h('div', { class: 'mod-text' }, r.text)),
        h('button', { type: 'button', onclick: function () { showOnMap(r.map_slug, r.feature_id); } }, 'Показать'),
        h('button', { type: 'button', class: 'primary', onclick: function () {
          act(function () { return api.post('/api/reports/' + r.id + '/resolve', {}); }, false);
        } }, 'Решено'));
    }

    function blockedRow(b) {
      return h('div', { class: 'dlg-row mod-row' },
        h('div', { class: 'mod-info' },
          h('strong', null, b.login),
          h('div', { class: 'hint' }, b.reason ? 'Причина: ' + b.reason : 'Без причины')),
        h('button', { type: 'button', onclick: function () {
          act(function () { return api.post('/api/users/' + b.id + '/unblock-proposals', {}); }, false);
        } }, 'Разблокировать'));
    }

    function render() {
      tabs.textContent = '';
      Object.keys(TITLES).forEach(function (k) {
        var b = h('button', { type: 'button', class: tab === k ? 'on' : '', onclick: function () { tab = k; render(); } },
          TITLES[k] + ' (' + data[k].length + ')');
        tabs.appendChild(b);
      });
      list.textContent = '';
      var rowFor = { proposals: proposalRow, reports: reportRow, blocked: blockedRow }[tab];
      data[tab].forEach(function (item) { list.appendChild(rowFor(item)); });
      if (!data[tab].length) list.appendChild(h('p', null, 'Пока пусто.'));
    }

    dlg = openDialog('Модерация', h('div', null, tabs, list));
    reload();
  }

  window.MapEditorDialogs = { categories: categories, maps: maps, moderation: moderation };
```

(прежнюю строку `window.MapEditorDialogs = { categories: categories, maps: maps };` удалить).

- [ ] **Step 3: Стили**

В `map-app.css` рядом с блоком «proposals and reports» добавить:

```css
.mod-row { align-items: flex-start; flex-wrap: wrap; }
.mod-info { flex: 1 1 260px; min-width: 0; }
.mod-text { white-space: pre-wrap; margin-top: 4px; }
```

- [ ] **Step 4: Ручная проверка**

Run: локальный сервер; два пользователя, у каждого по предложению, пара жалоб, один заблокированный.
Expected:
- кнопка «Модерация (N)» показывает число ожидающих предложений и жалоб;
- вкладка «Предложения»: «Показать» центрирует карту на объекте, «Одобрить» делает объект общим (его видит второй пользователь), «Отклонить» без причины не отправляется, с причиной отклоняет (автор видит «Отклонено: …»);
- «Заблокировать автора» спрашивает причину, после этого предложения автора исчезают из очереди, а он сам появляется во вкладке «Заблокированные»; «Разблокировать» возвращает возможность предлагать;
- вкладка «Жалобы»: «Решено» убирает жалобу; текст жалобы с HTML показан буквально (никакого `alert`);
- в консоли браузера нет ошибок.

- [ ] **Step 5: Commit**

```bash
git add map-editor.js map-editor-dialogs.js map-app.css
git commit -m "feat(map): moderation dialog for the admin

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Документация и финальная проверка

**Files:**
- Modify: `privacy.html`, `CLAUDE.md`, `RELEASE.md`
- Modify: `docs/superpowers/specs/2026-10-11-proposals-moderation-design.md` (статус)

- [ ] **Step 1: `privacy.html`**

После абзаца «Личные метки на карте» добавить:

```html
  <h2>Предложения и сообщения об ошибках</h2>
  <p>Если вы предлагаете объект на общую карту или сообщаете об ошибке, мы храним ваше предложение или текст
  сообщения вместе с привязкой к аккаунту. Их видите вы и администратор сайта. Одобренный объект становится
  общим и остаётся на карте без привязки к вашему аккаунту, даже если аккаунт будет удалён. Администратор может
  закрыть вам отправку предложений и сообщений, о причине вы увидите на карте.</p>
```

- [ ] **Step 2: `CLAUDE.md`**

1. В «Сделано» после пункта про личные метки добавить:

```markdown
- **Предложения пользователей и модерация (этап B)** (ветка `proposals-moderation`): пользователь предлагает новые
  объекты (статус `pending`, виден автору и админу), жалуется на ошибки, админ модерирует очередь в диалоге
  «Модерация» (одобрить, отклонить с причиной, заблокировать автора для предложений); миграция 4, API
  `/api/moderation`, `/api/features/:id/approve|reject|report`, `/api/users/:id/block-proposals`.
  Спек и план — `docs/superpowers/specs|plans/2026-10-11-proposals-moderation*`.
```

2. В «Не сделано» убрать «Этап B: предложения точек с модерацией;» из строки про дальнейшие этапы и добавить пункт: «Перед анонсом предложений руками пройти чек-лист из плана `2026-10-11-proposals-moderation.md` (Tasks 6-8) и показать абзац про предложения в `/privacy` владельцу/юристу».
3. В «Files» после описания личных меток добавить: `Модерация: server/routes/moderation.js, диалог в map-editor-dialogs.js; предложения идут через /api/features (status pending).`

- [ ] **Step 3: `RELEASE.md`**

Перед разделом «## Аккаунты пользователей и почта» добавить раздел «## Предложения и модерация (этап B)»: код (`server/routes/moderation.js`, `server/routes/content.js`, `map-editor*.js`); миграция 4 выполняется сама при старте, перед деплоем бэкап БД; лимиты (10 ожидающих предложений, 20 открытых жалоб, 60 записей за 10 минут, `proposalsWrite` в `server/app.js`); отклонённые без фото удаляются через 30 дней ежечасной очисткой; проверка после деплоя (тестовый пользователь предлагает точку, админ одобряет, второй пользователь её видит, жалоба видна в очереди, блокировка закрывает предложения); откат: предыдущий коммит, поля и таблица `reports` остаются в БД и старому коду не мешают.

- [ ] **Step 4: Статус спека**

В `docs/superpowers/specs/2026-10-11-proposals-moderation-design.md` строку `Статус: на ревью.` заменить на `Статус: реализовано в ветке proposals-moderation.`

- [ ] **Step 5: Полный прогон тестов**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS, все тесты зелёные (включая прежние и новые из `proposals.test.js`).

- [ ] **Step 6: Commit**

```bash
git add privacy.html CLAUDE.md RELEASE.md docs/superpowers/specs/2026-10-11-proposals-moderation-design.md
git commit -m "docs(proposals): privacy paragraph, status and release notes for moderation

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Вливание**

Использовать `superpowers:finishing-a-development-branch`. В `master` не пушить без явного решения владельца: пуш деплоит на прод, а перед ним нужен бэкап БД.
