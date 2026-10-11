# Личные метки пользователей (этап C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Вошедший пользователь ставит на карте личные метки (точка, полигон, линия), которые видит только он сам.

**Architecture:** Отдельная таблица `user_marks` (миграция 3) и четыре маршрута `/api/my/marks` в новом `server/routes/marks.js`; права через `can()`. На фронтенде два новых файла: `map-marks.js` (слой, фильтр, карточка) и `map-marks-editor.js` (рисование и правка). Существующий редактор админа получает только переключение режима. Перед всем этим закрывается автоматический вход после подтверждения почты.

**Tech Stack:** Node 22 (`node:http`, `node:sqlite`, `node:test`), без npm-зависимостей; Leaflet + Leaflet-Geoman в `vendor/`; чистый JS без сборки.

**Spec:** `docs/superpowers/specs/2026-10-11-personal-marks-design.md`

## Global Constraints

- Node 22+, без npm-зависимостей и без сборки; тесты: `node --test server/test/*.test.js tools/*.test.js`.
- Ветка `personal-marks`; в `master` не пушить (пуш в `master` деплоит на прод).
- Метки видит только автор; публичные `GET /api/maps` и `GET /api/maps/:slug` не меняются и меток не содержат.
- Лимиты: 300 меток на пользователя (409 `marks_limit`), 100 вершин у полигона/линии (400), название до 80, описание до 1000 символов, 120 запросов записи за 10 минут на пользователя (429).
- Чужая или несуществующая метка в `PATCH`/`DELETE` → 404 (не 403).
- Форма метки (`shape`) после создания не меняется.
- Координаты — доли 0..1 (формат `features`), проверка существующим `validateGeometry`.
- Все проверки прав только через `server/permissions.js` `can()`; проверок `role` в новых маршрутах нет.
- Пользовательский текст в DOM только через `textContent` (хелпер `h()` создаёт текстовые узлы).
- Редактор меток только на ПК (`min-width: 900px`), на телефоне метки видны и открываются карточкой.
- Все ответы API уже `Cache-Control: no-store` (`sendJson`).
- Строки интерфейса и комментарии к коду, как в соседнем коде: интерфейс на русском, комментарии на английском.
- Коммиты оканчиваются строкой `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

Входы и условия, которые спек подразумевает, но явно не перечисляет (каждый закреплён тестом в указанной задаче):

1. Тело `POST` с чужими `user_id`/`id`/`map_id`: метка всё равно создаётся для вошедшего, поля игнорируются (Task 4).
2. Неопубликованная или несуществующая карта в `GET`/`POST`: 404 без утечки существования (Task 4).
3. Админ не получает доступ к чужим меткам через `PATCH`/`DELETE`: тоже 404 (Task 3, Task 4).
4. Пустой `PATCH` и попытка сменить `shape`: 400, метка не меняется (Task 4).
5. Подтверждение почты не создаёт сессию, повторное использование токена по-прежнему 400 (Task 1).
6. Удаление карты или пользователя каскадно удаляет метки (Task 2).
7. Название/описание с HTML сохраняется как текст и показывается через `textContent` (Task 7, ручная проверка).

## File Structure

| Файл | Действие | Ответственность |
|------|----------|-----------------|
| `server/routes/account.js` | изменить | `verify-email` без сессии |
| `account.js` | изменить | после подтверждения показывает форму входа |
| `server/db.js` | изменить | миграция 3 (`user_marks`) |
| `server/validate.js` | изменить | `validateMark`, `validateMarkGeometry` |
| `server/repo.js` | изменить | `listMarks`, `getMark`, `getMarkRaw`, `countMarks` |
| `server/permissions.js` | изменить | действия `mark:*`, ключ `marks` в `capabilities` |
| `server/routes/marks.js` | создать | четыре маршрута `/api/my/marks` |
| `server/app.js` | изменить | регистрация модуля маршрутов и лимитер `marksWrite` |
| `server/test/marks.test.js` | создать | тесты миграции, валидации, прав, маршрутов |
| `map.html` | изменить | контейнер `#marks-slot` |
| `map-app.js` | изменить | `showCard`, режим, подписки, загрузка модулей меток |
| `map-marks.js` | создать | слой меток, фильтр, карточка |
| `map-marks-editor.js` | создать | инструменты, панель свойств, переключатель режима |
| `map-editor.js` | изменить | защита обработчиков по режиму, `setActive` |
| `map-app.css` | изменить | стили строки фильтра и переключателя режима |
| `privacy.html`, `CLAUDE.md`, `RELEASE.md` | изменить | документация |

---

### Task 1: Подтверждение почты не создаёт сессию

**Files:**
- Modify: `server/routes/account.js:4,8,104-120`
- Modify: `account.js:172-181`
- Test: `server/test/account.test.js:14-18,38-53,159-166`

**Interfaces:**
- Produces: `POST /api/verify-email` → `200 {ok: true}` без `Set-Cookie`. Ошибки прежние: 400 `token_invalid`.

- [ ] **Step 1: Обновить тесты под новое поведение**

В `server/test/account.test.js` заменить хелпер `registerAndVerify` (строки 14-18):

```js
async function registerAndVerify(s, over = {}) {
  const creds = { ...GOOD, ...over };
  await register(s, over);
  const res = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  // Verification no longer opens a session: sign in explicitly, as a real user must.
  const login = await s.api('POST', '/api/login', { body: { login: creds.login, password: creds.password } });
  return { res, cookie: login.headers.get('set-cookie').split(';')[0] };
}
```

Заменить тест `verify-email confirms once, opens a session and the token cannot be reused` (строки 38-53) целиком:

```js
test('verify-email confirms once, does NOT open a session and the token cannot be reused', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  const res = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { ok: true });
  assert.equal(res.headers.get('set-cookie'), null, 'no session cookie');
  const u = s.db.prepare("SELECT email_verified_at FROM users WHERE login = 'newbie'").get();
  assert.ok(u.email_verified_at);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = (SELECT id FROM users WHERE login = ?)').get('newbie').n, 0);
  const again = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'token_invalid');
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie@example.com', password: 'longenough1' } });
  assert.equal(login.status, 200);
  const me = await s.api('GET', '/api/me', { cookie: login.headers.get('set-cookie').split(';')[0] });
  assert.equal(me.json.user.login, 'newbie');
});
```

В тесте со `stale` токеном (строки 162-164) заменить две строки

```js
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.login, 'replacer');
```

на

```js
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { ok: true });
```

- [ ] **Step 2: Запустить тесты, убедиться, что они падают**

Run: `node --test server/test/account.test.js`
Expected: FAIL (`verify-email ... does NOT open a session` ожидает `{ ok: true }`, получает тело `/me`).

- [ ] **Step 3: Изменить маршрут**

В `server/routes/account.js` заменить тело обработчика `/api/verify-email` (строки 107-119):

```js
    handler: async (c) => {
      const b = await readJson(c.req);
      const userId = consumeToken(c.db, b.token, 'verify_email', c.now());
      if (userId === null) throw new HttpError(400, 'token_invalid');
      c.db
        .prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email_verified_at IS NULL")
        .run(userId);
      if (!c.db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) throw new HttpError(400, 'token_invalid');
      // No session here on purpose: whoever clicks the link may not be the person who typed the
      // password (an attacker can register with someone else's address). Signing in is explicit.
      return { body: { ok: true } };
    },
```

Затем проверить, что `createSession`, `sessionCookie` и `meBody` больше нигде в файле не используются, и убрать их из импортов (строки 4 и 8):

Run: `grep -n "createSession\|sessionCookie\|meBody" server/routes/account.js`
Expected: только строки импорта. Удалить `createSession, sessionCookie,` из строки 4 и строку 8 (`const { meBody } = require('../me');`).

- [ ] **Step 4: Изменить страницу `/account`**

В `account.js` заменить `showVerify` (строки 172-181):

```js
  function showVerify(token) {
    show(h('h1', null, 'Подтверждение почты'), h('p', { class: 'muted' }, 'Проверяем ссылку…'));
    api.post('/api/verify-email', { token: token }).then(function () {
      // Verification does not sign anyone in: the link may have been opened by someone else.
      show(h('h1', null, 'Почта подтверждена'), h('p', { class: 'ok' }, 'Теперь войдите, указав логин и пароль.'), loginForm());
    }, function (ex) {
      var box = h('div', null, h('h1', null, 'Ссылка не сработала'), h('p', { class: 'err' }, errorText(ex)),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: function () { showResend(''); } }, 'Выслать новую ссылку')));
      show(box);
    });
  }
```

`loginForm` и `show` уже используются в `showReset` (тот же файл, область видимости общая). Токен из адресной строки стирается в `start()` (`account.js`, около строки 304) до вызова `showVerify`, так что дополнительных правок не нужно. `afterLogin` форма входа вызовет сама: после входа сработает прежняя логика `next`/профиля.

- [ ] **Step 5: Запустить все тесты сервера**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS, все тесты зелёные.

- [ ] **Step 6: Commit**

```bash
git add server/routes/account.js account.js server/test/account.test.js
git commit -m "fix(accounts): e-mail verification no longer opens a session

An attacker could register with someone else's address and password; the
victim following the link landed inside the attacker's account. Verification
now only marks the address verified and the page asks to sign in.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Миграция 3, валидация и репозиторий меток

**Files:**
- Modify: `server/db.js:64-88`
- Modify: `server/validate.js` (перед `module.exports`, плюс экспорты)
- Modify: `server/repo.js` (функции и экспорты)
- Modify: `server/test/db.test.js:58`
- Create: `server/test/marks.test.js`

**Interfaces:**
- Produces (`server/validate.js`):
  - `validateMark(input, { create = false } = {})` → `{ ok: true, value }` | `{ ok: false, error }`. Поля `value`: `shape` (только при `create`), `title`, `description`, `color`, `icon` — только присутствующие во входе.
  - `validateMarkGeometry(shape, geometry)` → как `validateGeometry`, плюс не более 100 вершин.
- Produces (`server/repo.js`):
  - `listMarks(db, userId, mapId)` → массив `markOut`
  - `getMark(db, id)` → `markOut` | `null`
  - `getMarkRaw(db, id)` → строка `user_marks` (с `user_id`, `shape`) | `null`
  - `countMarks(db, userId)` → число
  - `markOut`: `{ id, map, shape, geometry, title, description, color, icon, created_at, updated_at }`.

- [ ] **Step 1: Написать падающие тесты**

Создать `server/test/marks.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startTestServer } = require('./helpers');
const { openDb } = require('../db');
const { createRateLimiter, createUser, createSession } = require('../auth');
const repo = require('../repo');
const v = require('../validate');

const POINT = { map: 'main', shape: 'point', geometry: { x: 0.25, y: 0.75 }, title: 'Stash' };

async function setup(t, opts) {
  const s = await startTestServer(opts);
  t.after(() => s.cleanup());
  const mapId = repo.insertRow(s.db, 'maps', { slug: 'main', title: 'Main', published: 1 });
  const draftId = repo.insertRow(s.db, 'maps', { slug: 'draft', title: 'Draft', published: 0 });
  const alice = createUser(s.db, { login: 'alice', password: 'alice-pass-1', role: 'user' });
  const bob = createUser(s.db, { login: 'bob', password: 'bob-pass-12', role: 'user' });
  const cookieFor = (id) => 'sid=' + createSession(s.db, id, Date.now());
  return { s, mapId, draftId, alice, bob, aliceCookie: cookieFor(alice), bobCookie: cookieFor(bob) };
}

// ---------- migration ----------

test('migration 3 creates user_marks and keeps existing data when upgrading from version 2', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anoma-mig-'));
  const file = path.join(dir, 'a.db');
  try {
    let db = openDb(file);
    createUser(db, { login: 'keeper', password: 'keeper-pass-1', role: 'user' });
    db.exec('DROP TABLE user_marks');
    db.exec('PRAGMA user_version = 2');
    db.close();
    db = openDb(file);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE login = ?').get('keeper').n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_marks').get().n, 0);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('deleting a user or a map deletes their marks', async (t) => {
  const { s, mapId, alice, bob } = await setup(t);
  const row = (userId) => ({ user_id: userId, map_id: mapId, shape: 'point', geometry: JSON.stringify({ x: 0, y: 0 }) });
  repo.insertRow(s.db, 'user_marks', row(alice));
  repo.insertRow(s.db, 'user_marks', row(bob));
  s.db.prepare('DELETE FROM users WHERE id = ?').run(alice);
  assert.equal(repo.countMarks(s.db, alice), 0);
  assert.equal(repo.countMarks(s.db, bob), 1);
  s.db.prepare('DELETE FROM maps WHERE id = ?').run(mapId);
  assert.equal(repo.countMarks(s.db, bob), 0);
});

// ---------- validation ----------

test('validateMark accepts good input and rejects bad fields', () => {
  assert.deepEqual(v.validateMark({ shape: 'point', title: 'T', color: '#aabbcc', icon: 'cache' }, { create: true }),
    { ok: true, value: { shape: 'point', title: 'T', color: '#aabbcc', icon: 'cache' } });
  assert.equal(v.validateMark({}, { create: true }).ok, false, 'shape is required on create');
  assert.equal(v.validateMark({ shape: 'circle' }, { create: true }).ok, false);
  assert.equal(v.validateMark({ title: 'x'.repeat(81) }).ok, false);
  assert.equal(v.validateMark({ title: 'x'.repeat(80) }).ok, true);
  assert.equal(v.validateMark({ description: 'x'.repeat(1001) }).ok, false);
  assert.equal(v.validateMark({ description: 'x'.repeat(1000) }).ok, true);
  assert.equal(v.validateMark({ color: 'red' }).ok, false);
  assert.equal(v.validateMark({ color: null }).ok, false, 'color is never null for a mark');
  assert.equal(v.validateMark({ icon: 'Bad Icon' }).ok, false);
  assert.deepEqual(v.validateMark({ shape: 'polygon', user_id: 5, id: 9 }), { ok: true, value: {} },
    'shape is ignored on update and unknown fields are dropped');
});

test('validateMarkGeometry limits vertices to 100', () => {
  const pts = (n) => ({ points: Array.from({ length: n }, (_, i) => [i / 200, 0.5]) });
  assert.equal(v.validateMarkGeometry('polygon', pts(100)).ok, true);
  assert.equal(v.validateMarkGeometry('polygon', pts(101)).ok, false);
  assert.equal(v.validateMarkGeometry('line', pts(2)).ok, true);
  assert.equal(v.validateMarkGeometry('line', pts(1)).ok, false);
  assert.equal(v.validateMarkGeometry('point', { x: 2, y: 0 }).ok, false);
});

// ---------- repo ----------

test('repo mark helpers return only the requested user and map and never expose user_id', async (t) => {
  const { s, mapId, alice, bob } = await setup(t);
  const other = repo.insertRow(s.db, 'maps', { slug: 'other', title: 'Other', published: 1 });
  const g = JSON.stringify({ x: 0.1, y: 0.2 });
  const a1 = repo.insertRow(s.db, 'user_marks', { user_id: alice, map_id: mapId, shape: 'point', geometry: g, title: 'a1' });
  repo.insertRow(s.db, 'user_marks', { user_id: alice, map_id: other, shape: 'point', geometry: g, title: 'a2' });
  repo.insertRow(s.db, 'user_marks', { user_id: bob, map_id: mapId, shape: 'point', geometry: g, title: 'b1' });
  const list = repo.listMarks(s.db, alice, mapId);
  assert.deepEqual(list.map((m) => m.title), ['a1']);
  assert.equal(list[0].map, 'main');
  assert.deepEqual(list[0].geometry, { x: 0.1, y: 0.2 });
  assert.equal('user_id' in list[0], false);
  assert.equal(repo.getMark(s.db, a1).title, 'a1');
  assert.equal(repo.getMarkRaw(s.db, a1).user_id, alice);
  assert.equal(repo.getMark(s.db, 99999), null);
  assert.equal(repo.countMarks(s.db, alice), 2);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/marks.test.js`
Expected: FAIL (`user_marks` не существует, `v.validateMark is not a function`).

- [ ] **Step 3: Добавить миграцию**

В `server/db.js` в массив `MIGRATIONS` после записи `version: 2` добавить:

```js
  {
    version: 3,
    sql: `
CREATE TABLE user_marks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  shape TEXT NOT NULL CHECK (shape IN ('point', 'polygon', 'line')),
  geometry TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#d4c24f',
  icon TEXT NOT NULL DEFAULT 'question',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_user_marks_user_map ON user_marks(user_id, map_id);
`,
  },
```

В `server/test/db.test.js:58` заменить ожидание версии `2` на `3`.

- [ ] **Step 4: Добавить валидацию**

В `server/validate.js` перед `const PNG_SIG` вставить:

```js
const MAX_MARK_POINTS = 100;

function validateMark(input, { create = false } = {}) {
  const out = {};
  if (create) {
    if (!SHAPES.includes(input.shape)) return fail('shape must be point, polygon or line');
    out.shape = input.shape;
  }
  if ('title' in input) {
    if (typeof input.title !== 'string' || input.title.length > 80) return fail('title must be a string up to 80 characters');
    out.title = input.title;
  }
  if ('description' in input) {
    if (typeof input.description !== 'string' || input.description.length > 1000) {
      return fail('description must be a string up to 1000 characters');
    }
    out.description = input.description;
  }
  if ('color' in input) {
    if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) return fail('color must be #rrggbb');
    out.color = input.color;
  }
  if ('icon' in input) {
    if (typeof input.icon !== 'string' || !ICON_RE.test(input.icon)) return fail('icon must match [a-z0-9-]{1,32}');
    out.icon = input.icon;
  }
  return ok(out);
}

function validateMarkGeometry(shape, g) {
  const r = validateGeometry(shape, g);
  if (r.ok && r.value.points && r.value.points.length > MAX_MARK_POINTS) {
    return fail(`${shape} may have at most ${MAX_MARK_POINTS} points`);
  }
  return r;
}
```

И добавить `validateMark, validateMarkGeometry,` в `module.exports`.

- [ ] **Step 5: Добавить функции репозитория**

В `server/repo.js` перед `module.exports` вставить:

```js
const MARK_SELECT =
  'SELECT m.*, mp.slug AS map_slug FROM user_marks m JOIN maps mp ON mp.id = m.map_id';

// user_id is deliberately absent: a mark is only ever shown to its owner.
function markOut(r) {
  return {
    id: r.id,
    map: r.map_slug,
    shape: r.shape,
    geometry: JSON.parse(r.geometry),
    title: r.title,
    description: r.description,
    color: r.color,
    icon: r.icon,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function listMarks(db, userId, mapId) {
  return db.prepare(MARK_SELECT + ' WHERE m.user_id = ? AND m.map_id = ? ORDER BY m.id').all(userId, mapId).map(markOut);
}

function getMark(db, id) {
  const r = db.prepare(MARK_SELECT + ' WHERE m.id = ?').get(id);
  return r ? markOut(r) : null;
}

function getMarkRaw(db, id) {
  return db.prepare('SELECT * FROM user_marks WHERE id = ?').get(id) || null;
}

function countMarks(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM user_marks WHERE user_id = ?').get(userId).n;
}
```

И добавить `listMarks, getMark, getMarkRaw, countMarks,` в `module.exports`.

- [ ] **Step 6: Запустить тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/db.js server/validate.js server/repo.js server/test/db.test.js server/test/marks.test.js
git commit -m "feat(marks): user_marks table, validation and repo helpers

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Права на метки и ключ `marks` в `/me`

**Files:**
- Modify: `server/permissions.js`
- Test: `server/test/permissions.test.js`, `server/test/auth-routes.test.js:13,27,93`, `server/test/account.test.js` (строка с `deepEqual(me.json.can` — в тесте после Task 1)

**Interfaces:**
- Produces: `can(user, 'mark:create')` → `true` для любого вошедшего; `can(user, 'mark:update'|'mark:delete', row)` → `true`, только если `row.user_id === user.id` (для админа тоже). `capabilities(user)` получает ключ `marks: boolean`.

- [ ] **Step 1: Обновить и дополнить тесты**

В `server/test/permissions.test.js` заменить тест `capabilities reflect can()` и добавить новый:

```js
test('capabilities reflect can()', () => {
  assert.deepEqual(capabilities(admin), { map: true, category: true, feature: true, marks: true });
  assert.deepEqual(capabilities(user), { map: false, category: false, feature: false, marks: true });
  assert.deepEqual(capabilities(null), { map: false, category: false, feature: false, marks: false });
});

test('marks: any signed-in user creates, only the owner updates or deletes (admin included)', () => {
  const mine = { id: 10, user_id: 2 };
  assert.equal(can(user, 'mark:create'), true);
  assert.equal(can(admin, 'mark:create'), true);
  assert.equal(can(null, 'mark:create'), false);
  for (const action of ['mark:update', 'mark:delete']) {
    assert.equal(can(user, action, mine), true, action + ' owner');
    assert.equal(can(admin, action, mine), false, action + ' admin is not the owner');
    assert.equal(can({ id: 3, login: 'x', role: 'user' }, action, mine), false, action + ' stranger');
    assert.equal(can(null, action, mine), false, action + ' guest');
    assert.equal(can(user, action), false, action + ' without a resource');
  }
});
```

В `server/test/auth-routes.test.js` заменить ожидания в трёх местах:
- строка 13: `can: { map: false, category: false, feature: false, marks: false }`
- строка 27: `{ map: true, category: true, feature: true, marks: true }`
- строка 93: `{ map: false, category: false, feature: false, marks: true }`

В `server/test/account.test.js` в тесте `verify-email confirms once...` (после Task 1) строка с `me.json.user.login` остаётся; добавить сразу после неё:

```js
  assert.deepEqual(me.json.can, { map: false, category: false, feature: false, marks: true });
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/permissions.test.js server/test/auth-routes.test.js server/test/account.test.js`
Expected: FAIL (нет ключа `marks`, `unknown action: mark:create`).

- [ ] **Step 3: Реализовать**

В `server/permissions.js`:

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
]);

// The only place that decides who may do what. v1: admins only for shared content.
// Later: let role 'user' create features (status 'pending') and update/delete their own
// pending ones by inspecting `resource` (a feature row with author_id/status).
function can(user, action, resource) {
  if (!ACTIONS.has(action)) throw new Error('unknown action: ' + action);
  if (!user) return false;
  // Personal marks: any signed-in user (admin too) creates; only the owner changes or deletes.
  if (action === 'mark:create') return true;
  if (action === 'mark:update' || action === 'mark:delete') {
    return Boolean(resource) && resource.user_id === user.id;
  }
  return user.role === 'admin';
}

function capabilities(user) {
  return {
    map: can(user, 'map:write'),
    category: can(user, 'category:write'),
    feature: can(user, 'feature:create'),
    marks: can(user, 'mark:create'),
  };
}
```

(`featureFilter` и экспорты не меняются.)

- [ ] **Step 4: Запустить все тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/permissions.js server/test/permissions.test.js server/test/auth-routes.test.js server/test/account.test.js
git commit -m "feat(marks): mark:* permissions and can.marks capability

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Маршруты `/api/my/marks`

**Files:**
- Create: `server/routes/marks.js`
- Modify: `server/app.js:7-12,35-43`
- Test: `server/test/marks.test.js` (дописать)

**Interfaces:**
- Consumes: `repo.listMarks/getMark/getMarkRaw/countMarks/getMapBySlug/insertRow/updateRow/deleteRow`, `v.validateMark`, `v.validateMarkGeometry`, `can()`, `c.limiters.marksWrite`, `HttpError`, `readJson`.
- Produces: `GET /api/my/marks?map=<slug>` → массив меток; `POST /api/my/marks` (201 + метка); `PATCH /api/my/marks/:id` (200 + метка); `DELETE /api/my/marks/:id` (200 `{ok: true}`).

- [ ] **Step 1: Дописать падающие тесты**

В конец `server/test/marks.test.js`:

```js
// ---------- routes ----------

test('guests get 401 on every marks route', async (t) => {
  const { s } = await setup(t);
  for (const [method, url, body] of [
    ['GET', '/api/my/marks?map=main'],
    ['POST', '/api/my/marks', POINT],
    ['PATCH', '/api/my/marks/1', { title: 'x' }],
    ['DELETE', '/api/my/marks/1'],
  ]) {
    const r = await s.api(method, url, { body });
    assert.equal(r.status, 401, method + ' ' + url);
  }
});

test('an owner creates, lists, edits and deletes a mark', async (t) => {
  const { s, aliceCookie } = await setup(t);
  const c = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT });
  assert.equal(c.status, 201);
  assert.equal(c.json.map, 'main');
  assert.equal(c.json.shape, 'point');
  assert.deepEqual(c.json.geometry, { x: 0.25, y: 0.75 });
  assert.equal(c.json.title, 'Stash');
  assert.equal(c.json.color, '#d4c24f');
  assert.equal(c.json.icon, 'question');
  assert.equal('user_id' in c.json, false);

  const list = await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie });
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.map((m) => m.id), [c.json.id]);

  const p = await s.api('PATCH', '/api/my/marks/' + c.json.id, {
    cookie: aliceCookie,
    body: { title: 'Renamed', description: 'Behind the tower', color: '#112233', icon: 'cache', geometry: { x: 0.5, y: 0.5 } },
  });
  assert.equal(p.status, 200);
  assert.equal(p.json.title, 'Renamed');
  assert.equal(p.json.description, 'Behind the tower');
  assert.equal(p.json.color, '#112233');
  assert.equal(p.json.icon, 'cache');
  assert.deepEqual(p.json.geometry, { x: 0.5, y: 0.5 });

  const d = await s.api('DELETE', '/api/my/marks/' + c.json.id, { cookie: aliceCookie });
  assert.equal(d.status, 200);
  assert.deepEqual(d.json, { ok: true });
  const after = await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie });
  assert.deepEqual(after.json, []);
});

test('polygons and lines are accepted with their own geometry', async (t) => {
  const { s, aliceCookie } = await setup(t);
  const poly = await s.api('POST', '/api/my/marks', {
    cookie: aliceCookie,
    body: { map: 'main', shape: 'polygon', geometry: { points: [[0.1, 0.1], [0.5, 0.1], [0.3, 0.6]] } },
  });
  assert.equal(poly.status, 201);
  const line = await s.api('POST', '/api/my/marks', {
    cookie: aliceCookie,
    body: { map: 'main', shape: 'line', geometry: { points: [[0.1, 0.1], [0.9, 0.9]] } },
  });
  assert.equal(line.status, 201);
});

test('bad input is refused with 400 and nothing is stored', async (t) => {
  const { s, alice, aliceCookie } = await setup(t);
  const bad = [
    { ...POINT, shape: 'circle' },
    { ...POINT, geometry: { x: 2, y: 0 } },
    { ...POINT, geometry: { points: [[0, 0], [1, 1]] } },
    { ...POINT, shape: 'polygon', geometry: { points: [[0, 0], [1, 1]] } },
    { ...POINT, title: 'x'.repeat(81) },
    { ...POINT, description: 'x'.repeat(1001) },
    { ...POINT, color: 'red' },
    { ...POINT, icon: 'No Good' },
    { ...POINT, map: undefined },
    { ...POINT, map: 5 },
  ];
  for (const body of bad) {
    const r = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body });
    assert.ok(r.status === 400 || r.status === 404, JSON.stringify(body) + ' -> ' + r.status);
  }
  assert.equal(repo.countMarks(s.db, alice), 0);
});

test('an unknown or unpublished map is a 404 for both reading and creating', async (t) => {
  const { s, aliceCookie } = await setup(t);
  for (const slug of ['nope', 'draft']) {
    const g = await s.api('GET', '/api/my/marks?map=' + slug, { cookie: aliceCookie });
    assert.equal(g.status, 404, 'GET ' + slug);
    const p = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: { ...POINT, map: slug } });
    assert.equal(p.status, 404, 'POST ' + slug);
  }
  const noMap = await s.api('GET', '/api/my/marks', { cookie: aliceCookie });
  assert.equal(noMap.status, 404);
});

test('users never see or touch each other\'s marks (admin included): everything is 404', async (t) => {
  const { s, aliceCookie, bobCookie } = await setup(t);
  const m = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT });
  const id = m.json.id;
  for (const cookie of [bobCookie, s.adminCookie]) {
    const list = await s.api('GET', '/api/my/marks?map=main', { cookie });
    assert.deepEqual(list.json, []);
    const patch = await s.api('PATCH', '/api/my/marks/' + id, { cookie, body: { title: 'hacked' } });
    assert.equal(patch.status, 404);
    const del = await s.api('DELETE', '/api/my/marks/' + id, { cookie });
    assert.equal(del.status, 404);
  }
  const missing = await s.api('PATCH', '/api/my/marks/99999', { cookie: bobCookie, body: { title: 'x' } });
  assert.equal(missing.status, 404, 'missing id looks the same as a foreign one');
  const still = await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie });
  assert.equal(still.json[0].title, 'Stash');
});

test('marks never appear in the public map payload', async (t) => {
  const { s, aliceCookie } = await setup(t);
  await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: { ...POINT, title: 'SecretStashTitle' } });
  for (const cookie of [undefined, aliceCookie, s.adminCookie]) {
    const one = await s.api('GET', '/api/maps/main', { cookie });
    assert.equal(one.status, 200);
    assert.equal(JSON.stringify(one.json).includes('SecretStashTitle'), false);
    const all = await s.api('GET', '/api/maps', { cookie });
    assert.equal(JSON.stringify(all.json).includes('SecretStashTitle'), false);
  }
});

test('ownership and ids in the body are ignored on create', async (t) => {
  const { s, alice, bob, mapId, aliceCookie } = await setup(t);
  const r = await s.api('POST', '/api/my/marks', {
    cookie: aliceCookie,
    body: { ...POINT, user_id: bob, id: 999, map_id: 77, created_at: '2000-01-01 00:00:00' },
  });
  assert.equal(r.status, 201);
  assert.notEqual(r.json.id, 999);
  const row = repo.getMarkRaw(s.db, r.json.id);
  assert.equal(row.user_id, alice);
  assert.equal(row.map_id, mapId);
  assert.notEqual(row.created_at, '2000-01-01 00:00:00');
});

test('PATCH with nothing to change or with another shape is refused and the mark stays intact', async (t) => {
  const { s, aliceCookie } = await setup(t);
  const m = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT });
  const empty = await s.api('PATCH', '/api/my/marks/' + m.json.id, { cookie: aliceCookie, body: {} });
  assert.equal(empty.status, 400);
  const shape = await s.api('PATCH', '/api/my/marks/' + m.json.id, { cookie: aliceCookie, body: { shape: 'polygon' } });
  assert.equal(shape.status, 400);
  const list = await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie });
  assert.equal(list.json[0].shape, 'point');
  assert.equal(list.json[0].title, 'Stash');
  const badId = await s.api('PATCH', '/api/my/marks/abc', { cookie: aliceCookie, body: { title: 'x' } });
  assert.equal(badId.status, 404);
});

test('limits: 300 marks per user, 100 vertices, write rate', async (t) => {
  const { s, mapId, alice, aliceCookie, bobCookie } = await setup(t);
  const g = JSON.stringify({ x: 0, y: 0 });
  for (let i = 0; i < 300; i++) {
    repo.insertRow(s.db, 'user_marks', { user_id: alice, map_id: mapId, shape: 'point', geometry: g });
  }
  const over = await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT });
  assert.equal(over.status, 409);
  assert.equal(over.json.error, 'marks_limit');
  const other = await s.api('POST', '/api/my/marks', { cookie: bobCookie, body: POINT });
  assert.equal(other.status, 201, 'the limit is per user');

  const points = Array.from({ length: 101 }, (_, i) => [i / 200, 0.5]);
  const many = await s.api('POST', '/api/my/marks', { cookie: bobCookie, body: { map: 'main', shape: 'line', geometry: { points } } });
  assert.equal(many.status, 400);
});

test('write rate is limited per user, reads are not', async (t) => {
  const { s, aliceCookie, bobCookie } = await setup(t, {
    limiters: { marksWrite: createRateLimiter({ max: 2, windowMs: 60000 }) },
  });
  assert.equal((await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT })).status, 201);
  assert.equal((await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT })).status, 201);
  assert.equal((await s.api('POST', '/api/my/marks', { cookie: aliceCookie, body: POINT })).status, 429);
  assert.equal((await s.api('GET', '/api/my/marks?map=main', { cookie: aliceCookie })).status, 200);
  assert.equal((await s.api('POST', '/api/my/marks', { cookie: bobCookie, body: POINT })).status, 201, 'another user is unaffected');
});

test('/api/me reports the marks capability', async (t) => {
  const { s, aliceCookie } = await setup(t);
  assert.equal((await s.api('GET', '/api/me')).json.can.marks, false);
  assert.equal((await s.api('GET', '/api/me', { cookie: aliceCookie })).json.can.marks, true);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/marks.test.js`
Expected: FAIL (маршруты отвечают 404 `not found`).

- [ ] **Step 3: Создать модуль маршрутов**

`server/routes/marks.js`:

```js
'use strict';

const { HttpError, readJson } = require('../http-util');
const { can } = require('../permissions');
const v = require('../validate');
const repo = require('../repo');

const MAX_MARKS_PER_USER = 300;

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function checked(result) {
  if (!result.ok) throw new HttpError(400, result.error);
  return result.value;
}

// Every route here is for a signed-in user; the per-user write limit is shared by POST/PATCH/DELETE.
function need(c) {
  if (!c.user) throw new HttpError(401, 'login required');
}

function limitWrites(c) {
  if (!c.limiters.marksWrite.allow('u:' + c.user.id, c.now())) {
    throw new HttpError(429, 'too many requests, try again later');
  }
}

function publishedMap(c, slug) {
  const map = typeof slug === 'string' ? repo.getMapBySlug(c.db, slug) : null;
  if (!map || !map.published) throw new HttpError(404, 'map not found');
  return map;
}

// A foreign mark and a missing one are indistinguishable on purpose: ids cannot be probed.
function ownMark(c, action) {
  const n = Number(c.params.id);
  const row = Number.isInteger(n) && n > 0 ? repo.getMarkRaw(c.db, n) : null;
  if (!row || !can(c.user, action, row)) throw new HttpError(404, 'mark not found');
  return row;
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/my/marks',
    handler: async (c) => {
      need(c);
      const map = publishedMap(c, c.query.get('map'));
      return { body: repo.listMarks(c.db, c.user.id, map.id) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/my/marks',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      if (!can(c.user, 'mark:create')) throw new HttpError(403, 'forbidden');
      const body = await readJson(c.req);
      const map = publishedMap(c, body.map);
      const fields = checked(v.validateMark(body, { create: true }));
      const geometry = checked(v.validateMarkGeometry(fields.shape, body.geometry));
      // Count and insert run with no await in between, so parallel requests cannot overshoot.
      if (repo.countMarks(c.db, c.user.id) >= MAX_MARKS_PER_USER) throw new HttpError(409, 'marks_limit');
      const now = sqlTime(c.now());
      const id = repo.insertRow(c.db, 'user_marks', {
        ...fields,
        user_id: c.user.id,
        map_id: map.id,
        geometry: JSON.stringify(geometry),
        created_at: now,
        updated_at: now,
      });
      return { status: 201, body: repo.getMark(c.db, id) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/my/marks/:id',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      const row = ownMark(c, 'mark:update');
      const body = await readJson(c.req);
      if ('shape' in body && body.shape !== row.shape) throw new HttpError(400, 'shape cannot be changed');
      const fields = checked(v.validateMark(body));
      if ('geometry' in body) {
        fields.geometry = JSON.stringify(checked(v.validateMarkGeometry(row.shape, body.geometry)));
      }
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      fields.updated_at = sqlTime(c.now());
      repo.updateRow(c.db, 'user_marks', row.id, fields);
      return { body: repo.getMark(c.db, row.id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/my/marks/:id',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      const row = ownMark(c, 'mark:delete');
      repo.deleteRow(c.db, 'user_marks', row.id);
      return { body: { ok: true } };
    },
  },
];
```

- [ ] **Step 4: Подключить в `app.js`**

В `server/app.js`:

```js
const ROUTE_MODULES = [
  require('./routes/auth'),
  require('./routes/account'),
  require('./routes/content'),
  require('./routes/images'),
  require('./routes/marks'),
];
```

и в объект `limiters` после `mailEmail`:

```js
    marksWrite: createRateLimiter({ max: 120, windowMs: 10 * MIN }),
```

- [ ] **Step 5: Запустить все тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/marks.js server/app.js server/test/marks.test.js
git commit -m "feat(marks): /api/my/marks CRUD for personal marks

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Просмотр: общий API карточки, режим, подписки (`map-app.js`)

Только рефакторинг без видимых изменений: после него карта работает как раньше, а модули меток могут подключаться. Автотестов у фронтенда нет, проверка ручная (шаг 5).

**Files:**
- Modify: `map-app.js`
- Modify: `map.html:44`

**Interfaces:**
- Produces в `window.MapViewer`:
  - `showCard(node, latlng, yOffset)` — показывает карточку (попап на ПК, шторка на телефоне);
  - `closeCard(silent)` (уже есть); `updateUrl()`; `svgIcon(id)` → DOM-узел иконки;
  - `defaultClick(id, e)` → `true` (открывает карточку общего объекта);
  - `mode()` → `'shared' | 'marks'`, `setMode(m)`;
  - `onMapLoaded(fn)` — `fn` вызывается после каждой загрузки карты;
  - `state()` теперь содержит `openMark` (id открытой метки или `null`) и `wantedMark` (id из `?mark=`, читается один раз).

- [ ] **Step 1: Контейнер в `map.html`**

После `<ul id="cats" class="cats"></ul>` (строка 44) добавить:

```html
    <div id="marks-slot" class="marks-slot"></div>
```

- [ ] **Step 2: Состояние, подписки, URL, закрытие карточки**

В `map-app.js`:

1. В объект `state` (строки 9-20) добавить поля после `openId: null,`:

```js
    openMark: null,
    mode: 'shared',
    wantedMark: null,
```

2. После строки `var hooks = { onLayer: null, afterCategories: null, afterLoad: null };` добавить:

```js
  var listeners = { mapLoaded: [] };
```

3. Заменить `updateUrl` (строки 180-186):

```js
  function updateUrl() {
    var q = new URLSearchParams();
    if (state.map) q.set('m', state.map.slug);
    if (state.openId !== null && state.openId !== undefined) q.set('f', String(state.openId));
    if (state.openMark !== null) q.set('mark', String(state.openMark));
    var s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }
```

4. В `closeCard` (строки 188-193) после `state.openId = null;` добавить `state.openMark = null;`.

5. В `createMap` заменить обработчик `popupclose`:

```js
    leaflet.on('popupclose', function () {
      if (state.openId !== null || state.openMark !== null) {
        state.openId = null;
        state.openMark = null;
        updateUrl();
      }
    });
```

- [ ] **Step 3: Вынести `showCard`, подписки при загрузке карты**

Заменить `openFeature` (строки 195-215) двумя функциями:

```js
  // Shows any card node: a popup on desktop, a bottom sheet on a narrow screen.
  function showCard(node, at, yOffset) {
    if (narrow.matches) {
      var sheet = $('sheet');
      sheet.textContent = '';
      sheet.appendChild(h('button', { class: 'card-x', type: 'button', 'aria-label': 'Закрыть', onclick: function () { closeCard(); } }, '×'));
      sheet.appendChild(node);
      sheet.hidden = false;
    } else {
      L.popup({ className: 'card-popup', minWidth: 260, maxWidth: 320, offset: [0, yOffset || 0], autoPanPadding: [40, 40] })
        .setLatLng(at).setContent(node).openOn(leaflet);
    }
  }

  function openFeature(id, latlng) {
    var f = featureById(id);
    var layer = state.layers[id];
    if (!f || !layer) return;
    closeCard(true);
    state.openId = id;
    var isPoint = !!layer.getLatLng;
    var at = isPoint ? layer.getLatLng() : (latlng || layer.getBounds().getCenter());
    showCard(cardNode(f), at, isPoint ? -14 : 0);
    updateUrl();
  }
```

В `loadMap` после `if (hooks.afterLoad) hooks.afterLoad();` добавить:

```js
      listeners.mapLoaded.forEach(function (fn) {
        try { fn(); } catch (e) { /* a listener must not break map loading */ }
      });
```

- [ ] **Step 4: Загрузка модулей меток**

1. Заменить `wantsEditor`:

```js
  // The editor scripts (and Geoman) are for desktop users who can draw something:
  // shared objects (admin) and/or personal marks (any signed-in user).
  function wantsEditor() {
    return !!(state.me.can.feature || state.me.can.marks) && window.matchMedia('(min-width: 900px)').matches;
  }
```

2. После `startEditor` добавить:

```js
  // Personal marks: the viewer part always loads for a signed-in user, the drawing part
  // only where Geoman is available (desktop).
  function startMarks() {
    var editable = geomanLoaded && wantsEditor();
    return loadScript('/map-marks.js')
      .then(function () {
        window.MapMarks.start(window.MapViewer);
        if (!editable) return null;
        return loadScript('/map-marks-editor.js').then(function () {
          window.MapMarksEditor.start(window.MapViewer, window.MapMarks);
        });
      });
  }
```

3. В `setupAuth` в конец функции добавить подсказку для гостя:

```js
    if (!user) {
      $('marks-slot').appendChild(h('p', { class: 'hint' }, 'Войдите, чтобы ставить свои метки. ',
        h('a', { href: '/account?next=' + encodeURIComponent(location.pathname + location.search) }, 'Войти')));
    }
```

4. В `init` заменить цепочку после `loadMap` (блоки `.then(function () { var q ...` и последний `.then`) так, чтобы запомнить `?mark=`:

В блоке с `var q = new URLSearchParams(location.search);` сразу после `var wanted = q.get('m');` добавить строку:

```js
        state.wantedMark = Number(q.get('mark')) || null;
```

Последний `.then` (запуск редактора) заменить на два:

```js
      .then(function () {
        if (geomanLoaded && wantsEditor() && state.me.can.feature) {
          return startEditor().catch(function () { notice('Не удалось загрузить редактор.'); });
        }
        return null;
      })
      .then(function () {
        if (!state.me.can.marks) return null;
        return startMarks().catch(function () { notice('Не удалось загрузить личные метки.'); });
      });
```

- [ ] **Step 5: Экспорт**

В объект `window.MapViewer` добавить:

```js
    showCard: showCard,
    updateUrl: updateUrl,
    svgIcon: svgIcon,
    defaultClick: defaultClick,
    mode: function () { return state.mode; },
    setMode: function (m) { state.mode = m; },
    onMapLoaded: function (fn) { listeners.mapLoaded.push(fn); },
```

- [ ] **Step 6: Ручная проверка (регрессия)**

Run: локальный запуск из `RELEASE.md` → «Локальная разработка», открыть `http://localhost:3000/map`.
Expected:
- гость: карта грузится, клик по объекту открывает карточку как раньше, в боковой панели виден текст «Войдите, чтобы ставить свои метки»;
- админ на ПК: редактор запускается, рисование и правка работают, в консоли браузера нет ошибок (`/map-marks.js` отвечает 404, это ожидаемо до Task 6: сообщение «Не удалось загрузить личные метки.»);
- ссылка `/map?m=main&f=<id>` по-прежнему открывает объект.

- [ ] **Step 7: Commit**

```bash
git add map-app.js map.html
git commit -m "refactor(map): showCard, mode and map-loaded listeners for personal marks

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Слой личных меток, фильтр, карточка (`map-marks.js`)

**Files:**
- Create: `map-marks.js`
- Modify: `map-app.css` (в конец, перед `@media`)

**Interfaces:**
- Consumes: `window.MapViewer` (Task 5), `window.MapApi`, `window.h`, `window.MapGeo`.
- Produces `window.MapMarks`:
  - `start(viewer)`; `list()` → массив меток текущей карты; `byId(id)`; `layers()` → `{ id: leafletLayer }`;
  - `hooks.onLayer(layer, mark)` — вызывается для каждого созданного слоя (редактор вешает обработчики);
  - `setClickHandler(fn|null)` — `fn(id, e)` → `false`, если клик не поглощён; по умолчанию открывает карточку;
  - `setMark(mark)` — добавляет или заменяет метку и перерисовывает её слой; `dropMark(id)`;
  - `open(id, latlng)`; `focus(id)`; `show()` — включает фильтр.

- [ ] **Step 1: Создать `map-marks.js`**

```js
(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;

  var V = null;
  var marks = [];
  var layers = {};
  var group = null;
  var visible = true;
  var clickHandler = null;
  var hooks = { onLayer: null };
  var els = {};

  function byId(id) {
    return marks.find(function (m) { return m.id === id; }) || null;
  }

  // ---------- layers ----------

  function markerIcon(m) {
    var el = h('div', { class: 'mk' }, V.svgIcon(m.icon));
    el.style.setProperty('--c', m.color);
    return L.divIcon({ html: el, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] });
  }

  function makeLayer(m) {
    var size = V.size();
    if (!size) return null;
    var layer;
    if (m.shape === 'point') {
      layer = L.marker(Geo.toLatLng(m.geometry, size), { icon: markerIcon(m), title: m.title || 'Моя метка', keyboard: false });
    } else if (m.shape === 'polygon') {
      layer = L.polygon(Geo.pointsToLatLngs(m.geometry.points, size),
        { color: m.color, fillColor: m.color, fillOpacity: 0.25, weight: 2 });
    } else {
      layer = L.polyline(Geo.pointsToLatLngs(m.geometry.points, size), { color: m.color, weight: 3 });
    }
    layer.markId = m.id;
    layer.on('click', function (e) {
      var consumed = clickHandler ? clickHandler(m.id, e) : open(m.id, e.latlng);
      if (consumed !== false) L.DomEvent.stopPropagation(e);
    });
    return layer;
  }

  function addLayer(m) {
    var layer = makeLayer(m);
    if (!layer) return;
    if (hooks.onLayer) hooks.onLayer(layer, m);
    layers[m.id] = layer;
    if (group) group.addLayer(layer);
  }

  function removeLayer(id) {
    var layer = layers[id];
    if (!layer) return;
    if (group) group.removeLayer(layer);
    layer.remove();
    delete layers[id];
  }

  function syncVisibility() {
    if (!group) return;
    if (visible) group.addTo(V.leaflet()); else group.remove();
    els.checkbox.checked = visible;
  }

  function updateCount() {
    els.count.textContent = String(marks.length);
  }

  function render() {
    if (group) group.remove();
    group = null;
    layers = {};
    if (!V.size()) { updateCount(); return; }
    group = L.layerGroup();
    marks.forEach(addLayer);
    syncVisibility();
    updateCount();
  }

  // ---------- card ----------

  function cardNode(m) {
    return h('div', { class: 'card' },
      h('h3', null, m.title || 'Моя метка'),
      h('div', { class: 'card-cat' }, 'Личная метка'),
      m.description ? h('p', { class: 'card-text' }, m.description) : null);
  }

  function open(id, latlng) {
    var m = byId(id);
    var layer = layers[id];
    if (!m || !layer) return true;
    V.closeCard(true);
    V.state().openMark = id;
    var isPoint = !!layer.getLatLng;
    var at = isPoint ? layer.getLatLng() : (latlng || layer.getBounds().getCenter());
    V.showCard(cardNode(m), at, isPoint ? -14 : 0);
    V.updateUrl();
    return true;
  }

  function focus(id) {
    var layer = layers[id];
    if (!layer) return;
    show();
    var leaflet = V.leaflet();
    if (layer.getLatLng) leaflet.flyTo(layer.getLatLng(), Math.max(leaflet.getZoom(), 1), { duration: 0.6 });
    else leaflet.flyToBounds(layer.getBounds(), { maxZoom: 2, duration: 0.6 });
    open(id);
  }

  // ---------- data ----------

  function show() {
    visible = true;
    syncVisibility();
  }

  function setMark(m) {
    var i = marks.findIndex(function (x) { return x.id === m.id; });
    if (i < 0) marks.push(m); else marks[i] = m;
    removeLayer(m.id);
    addLayer(m);
    updateCount();
    if (V.state().openMark === m.id) open(m.id);
  }

  function dropMark(id) {
    removeLayer(id);
    marks = marks.filter(function (m) { return m.id !== id; });
    updateCount();
    if (V.state().openMark === id) V.closeCard();
  }

  function load() {
    var map = V.state().map;
    marks = [];
    render();
    if (!map) return Promise.resolve();
    var slug = map.slug;
    return api.get('/api/my/marks?map=' + encodeURIComponent(slug)).then(function (list) {
      var current = V.state().map;
      if (!current || current.slug !== slug) return; // the user already switched to another map
      marks = list;
      render();
      var wanted = V.state().wantedMark;
      if (wanted !== null) {
        V.state().wantedMark = null; // a shared link is honoured once
        if (byId(wanted)) focus(wanted);
      }
    }).catch(function () {
      V.notice('Не удалось загрузить личные метки.');
    });
  }

  // ---------- start ----------

  function start(viewer) {
    V = viewer;
    els.checkbox = h('input', {
      type: 'checkbox', checked: true,
      onchange: function () { visible = els.checkbox.checked; syncVisibility(); },
    });
    els.count = h('span', { class: 'cat-n' }, '0');
    var slot = document.getElementById('marks-slot');
    slot.textContent = '';
    slot.appendChild(h('div', { class: 'cats-head' }, h('span', null, 'Личное')));
    slot.appendChild(h('label', { class: 'marks-row' },
      els.checkbox,
      h('span', { class: 'cat-name' }, 'Мои метки'),
      els.count));
    V.onMapLoaded(function () { load(); });
    return load();
  }

  window.MapMarks = {
    start: start,
    list: function () { return marks; },
    byId: byId,
    layers: function () { return layers; },
    hooks: hooks,
    setClickHandler: function (fn) { clickHandler = fn || null; },
    setMark: setMark,
    dropMark: dropMark,
    open: open,
    focus: focus,
    show: show,
  };
})();
```

- [ ] **Step 2: Стили**

В `map-app.css` перед блоком `@media (max-width: 720px)` добавить:

```css
/* personal marks */
.marks-row { display: flex; align-items: center; gap: 8px; padding: 5px 6px; cursor: pointer; }
.marks-row .cat-name { flex: 1; }
.marks-row .cat-n { color: var(--muted); font-size: 12px; }
.marks-slot .hint { margin: 14px 0 0; }
```

- [ ] **Step 3: Ручная проверка**

Подготовить пользователя и метку в локальной базе (см. `RELEASE.md` → «Локальная разработка» про `cli.js`/`MAIL_MODE=log`): войти обычным пользователем, затем создать метку запросом из консоли браузера:

```js
MapApi.post('/api/my/marks', { map: MapViewer.state().map.slug, shape: 'point', geometry: { x: 0.5, y: 0.5 }, title: 'Test <b>x</b>', description: '<img src=x onerror=alert(1)>' }).then(function () { location.reload(); });
```

Expected:
- в левой панели строка «Мои метки» со счётчиком 1, чекбокс скрывает и показывает метку;
- клик по метке открывает карточку, текст `Test <b>x</b>` и описание показаны буквально (не как HTML, никакого `alert`);
- перезагрузка с `?m=<slug>&mark=<id>` фокусирует метку и открывает карточку;
- переключение карты в выпадающем списке очищает метки предыдущей карты;
- на ширине 375 px (DevTools) метка открывается шторкой, редактора нет;
- под другим пользователем и у гостя метка не видна.

- [ ] **Step 4: Commit**

```bash
git add map-marks.js map-app.css
git commit -m "feat(map): personal marks layer with filter and card

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Редактор меток и переключатель режима для админа

**Files:**
- Create: `map-marks-editor.js`
- Modify: `map-editor.js` (защиты по режиму, `setActive`)
- Modify: `map-app.css`

**Interfaces:**
- Consumes: `MapViewer` (`leaflet()`, `size()`, `state()`, `mode()`, `setMode()`, `onMapLoaded()`, `closeCard()`), `MapMarks` (`byId`, `layers`, `setMark`, `dropMark`, `hooks`, `setClickHandler`, `show`, `open`, `focus`), `MapEditor.setActive(bool)` (создаётся в этой задаче).
- Produces: `window.MapMarksEditor.start(viewer, marksView)`.

- [ ] **Step 1: Защиты и `setActive` в `map-editor.js`**

1. В `onMapClick` (строка 144) первой строкой добавить:

```js
    if (V.mode() !== 'shared') return;
```

2. В `onCreate` (строка 150) первой строкой добавить:

```js
    if (V.mode() !== 'shared') return;
```

3. В `onFeatureClick` (строка 161) первой строкой добавить:

```js
    if (V.mode() !== 'shared') return V.defaultClick(id);
```

4. В `onKey` (строка 375) первой строкой добавить:

```js
    if (V.mode() !== 'shared') return;
```

5. В `window.MapEditor` добавить метод и функцию над ним:

```js
  // The admin switches between shared objects and personal marks: the inactive editor hides.
  function setActive(on) {
    els.toolbar.hidden = !on;
    if (!on) {
      setTool('select');
      deselect();
    }
  }
```

и в экспорт: `setActive: setActive,`.

- [ ] **Step 2: Создать `map-marks-editor.js`**

```js
(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;
  var ICONS = window.MAP_ICONS || {};

  var V = null;
  var M = null;
  var map = null;
  var ed = { tool: 'select', selectedId: null, drawing: false };
  var els = {};
  var DRAW_SHAPE = { polygon: 'Polygon', line: 'Line' };
  var DEFAULT_COLOR = '#d4c24f';

  function active() { return V.mode() === 'marks'; }

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
        if (err.status === 401) status('Сессия истекла: обновите страницу и войдите снова', 'error');
        else if (err.message === 'marks_limit') status('Достигнут лимит: 300 меток', 'error');
        else if (err.status === 429) status('Слишком часто, подождите минуту', 'error');
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
    bar.appendChild(els.status);
    els.toolbar = bar;
    document.getElementById('ed-slot').appendChild(bar);
    updateToolbar();
  }

  function updateToolbar() {
    Object.keys(els.toolBtns).forEach(function (k) {
      els.toolBtns[k].classList.toggle('on', ed.tool === k);
    });
  }

  // An admin edits either the shared map or their own marks; everybody else only has marks.
  function buildModeSwitch() {
    els.modeShared = h('button', { type: 'button', onclick: function () { setMode('shared'); } }, 'Общие');
    els.modeMarks = h('button', { type: 'button', onclick: function () { setMode('marks'); } }, 'Мои метки');
    var sw = h('div', { class: 'ed-mode' }, els.modeShared, els.modeMarks);
    var slot = document.getElementById('ed-slot');
    slot.insertBefore(sw, slot.firstChild);
  }

  function setMode(mode) {
    V.setMode(mode);
    var marksMode = mode === 'marks';
    els.toolbar.hidden = !marksMode;
    if (els.modeShared) {
      els.modeShared.classList.toggle('on', !marksMode);
      els.modeMarks.classList.toggle('on', marksMode);
    }
    if (window.MapEditor) window.MapEditor.setActive(!marksMode);
    if (!marksMode) {
      setTool('select');
      deselect();
    }
  }

  // ---------- tools ----------

  function drawOptions() {
    return {
      finishOn: 'dblclick',
      allowSelfIntersection: true,
      snappable: false,
      templineStyle: { color: DEFAULT_COLOR },
      hintlineStyle: { color: DEFAULT_COLOR, dashArray: [5, 5] },
      pathOptions: { color: DEFAULT_COLOR, fillColor: DEFAULT_COLOR, fillOpacity: 0.25 },
    };
  }

  function setTool(tool) {
    map.pm.disableDraw();
    ed.drawing = false;
    ed.tool = tool;
    if (tool !== 'select') deselect();
    map.getContainer().classList.toggle('crosshair', tool === 'point');
    if (DRAW_SHAPE[tool]) map.pm.enableDraw(DRAW_SHAPE[tool], drawOptions());
    updateToolbar();
  }

  function finishDraw() {
    var shape = DRAW_SHAPE[ed.tool];
    try {
      if (shape && map.pm.Draw[shape] && map.pm.Draw[shape]._finishShape) map.pm.Draw[shape]._finishShape();
    } catch (e) { /* Enter is a convenience; double click always works */ }
  }

  function createMark(shape, geometry) {
    var slug = V.state().map.slug;
    var body = { map: slug, shape: shape, geometry: geometry, title: '' };
    if (shape === 'point') body.icon = 'pin';
    save(function () { return api.post('/api/my/marks', body); }).then(function (m) {
      if (!m) return;
      M.show();
      M.setMark(m);
      select(m.id);
    });
  }

  function onMapClick(e) {
    if (!active() || !V.size()) return;
    if (ed.tool === 'point') createMark('point', Geo.fromLatLng(e.latlng, V.size()));
    else if (ed.tool === 'select') deselect();
  }

  function onCreate(e) {
    if (!active()) return;
    var shape = ed.tool;
    var ll = e.layer.getLatLngs();
    var ring = Array.isArray(ll[0]) ? ll[0] : ll;
    var points = Geo.latLngsToPoints(ring, V.size());
    e.layer.remove();
    setTool('select');
    if (shape === 'polygon' || shape === 'line') createMark(shape, { points: points });
  }

  // ---------- selection and geometry editing ----------

  function onMarkClick(id, e) {
    if (!active()) return M.open(id, e && e.latlng);
    if (ed.drawing || ed.tool === 'point') return false;
    if (ed.tool === 'select') { select(id); return true; }
    return false;
  }

  function highlight(id, on) {
    var layer = M.layers()[id];
    if (!layer) return;
    if (layer instanceof L.Marker) {
      var el = layer.getElement();
      var mk = el && el.querySelector('.mk');
      if (mk) mk.classList.toggle('sel', on);
    } else {
      layer.setStyle({ weight: on ? 4 : (layer instanceof L.Polygon ? 2 : 3) });
    }
  }

  function select(id) {
    deselect(true);
    var layer = M.layers()[id];
    var m = M.byId(id);
    if (!layer || !m) return;
    ed.selectedId = id;
    if (layer.pm) layer.pm.enable({ allowSelfIntersection: true });
    highlight(id, true);
    showProps(m);
    map.invalidateSize({ pan: false });
  }

  function deselect(keepPanel) {
    if (ed.selectedId !== null) {
      var layer = M.layers()[ed.selectedId];
      if (layer && layer.pm) layer.pm.disable();
      highlight(ed.selectedId, false);
    }
    ed.selectedId = null;
    if (!keepPanel) {
      els.panel.hidden = true;
      map.invalidateSize({ pan: false });
    }
  }

  function flat(latlngs) {
    return Array.isArray(latlngs[0]) ? latlngs[0] : latlngs;
  }

  function saveGeometry(id, layer) {
    var size = V.size();
    var geometry = layer instanceof L.Marker
      ? Geo.fromLatLng(layer.getLatLng(), size)
      : { points: Geo.latLngsToPoints(flat(layer.getLatLngs()), size) };
    save(function () { return api.patch('/api/my/marks/' + id, { geometry: geometry }); }).then(function (m) {
      if (!m) return;
      // Replace the data but keep the live layer so vertex editing is not interrupted.
      var list = M.list();
      var i = list.findIndex(function (x) { return x.id === id; });
      if (i >= 0) list[i] = m;
    });
  }

  function attachLayer(layer, mark) {
    var isMarker = layer instanceof L.Marker;
    layer.on(isMarker ? 'pm:dragend' : 'pm:edit', function () { saveGeometry(mark.id, layer); });
  }

  // ---------- properties panel ----------

  function buildProps() {
    els.title = h('input', { type: 'text', maxLength: 80, placeholder: 'Название' });
    els.desc = h('textarea', { rows: 5, maxLength: 1000, placeholder: 'Описание' });
    els.color = h('input', { type: 'color' });
    els.icon = h('select');
    Object.keys(ICONS).forEach(function (id) { els.icon.appendChild(h('option', { value: id }, ICONS[id].label)); });
    els.iconRow = h('div', null, h('label', null, 'Иконка'), els.icon);
    els.panel = h('aside', { class: 'ed-props', hidden: true },
      h('h2', null, 'Моя метка'),
      h('label', null, 'Название'), els.title,
      h('label', null, 'Описание'), els.desc,
      h('label', null, 'Цвет'), els.color,
      els.iconRow,
      h('p', null, h('button', { type: 'button', class: 'danger', onclick: deleteSelected }, 'Удалить метку')));
    document.getElementById('props-slot').appendChild(els.panel);

    els.title.addEventListener('change', function () { patch({ title: els.title.value }); });
    els.desc.addEventListener('change', function () { patch({ description: els.desc.value }); });
    els.color.addEventListener('change', function () { patch({ color: els.color.value }); });
    els.icon.addEventListener('change', function () { patch({ icon: els.icon.value }); });
  }

  function showProps(m) {
    // Never overwrite the field being typed in: a save for another field re-renders the panel.
    function put(el, value) { if (document.activeElement !== el) el.value = value; }
    els.panel.hidden = false;
    put(els.title, m.title || '');
    put(els.desc, m.description || '');
    put(els.color, m.color);
    put(els.icon, ICONS[m.icon] ? m.icon : 'question');
    els.iconRow.hidden = m.shape !== 'point';
  }

  function patch(fields) {
    var id = ed.selectedId;
    if (id === null) return;
    save(function () { return api.patch('/api/my/marks/' + id, fields); }).then(function (m) {
      if (!m) return;
      M.setMark(m);
      if (ed.selectedId === id) select(id); // re-enable editing on the re-created layer, refresh the panel
    });
  }

  function deleteSelected() {
    var id = ed.selectedId;
    if (id === null || !active()) return;
    var m = M.byId(id);
    if (!window.confirm('Удалить метку «' + ((m && m.title) || 'без названия') + '»?')) return;
    deselect();
    save(function () { return api.del('/api/my/marks/' + id); }).then(function (r) {
      if (r) M.dropMark(id);
    });
  }

  // ---------- keyboard ----------

  function onKey(e) {
    if (!active()) return;
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

  function start(viewer, marksView) {
    V = viewer;
    M = marksView;
    map = V.leaflet();
    document.body.classList.add('editing');
    buildToolbar();
    buildProps();

    M.hooks.onLayer = attachLayer;
    M.setClickHandler(onMarkClick);
    V.onMapLoaded(function () { deselect(); });
    map.on('click', onMapClick);
    map.on('pm:create', onCreate);
    map.on('pm:drawstart', function () { if (active()) ed.drawing = true; });
    map.on('pm:drawend', function () { if (active()) ed.drawing = false; });
    document.addEventListener('keydown', onKey);

    if (V.state().me.can.feature) {
      buildModeSwitch();
      setMode('shared');
    } else {
      setMode('marks');
    }
    // Layers drawn before this editor attached its handlers need them now.
    Object.keys(M.layers()).forEach(function (id) {
      var layer = M.layers()[id];
      var m = M.byId(Number(id));
      if (layer && m) attachLayer(layer, m);
    });
    status('Мои метки: видны только вам', '');
  }

  window.MapMarksEditor = { start: start };
})();
```

Замечание по реализации: `M.hooks.onLayer` устанавливается после того, как метки уже могли отрисоваться (`MapMarks.start` вызывается раньше). Цикл в конце `start` навешивает обработчики на уже созданные слои; при последующих `setMark`/перерисовках `hooks.onLayer` сработает сам.

- [ ] **Step 3: Стили переключателя**

В `map-app.css` рядом с блоком «personal marks» добавить:

```css
.ed-mode { display: flex; gap: 4px; margin-right: 10px; }
```

- [ ] **Step 4: Ручная проверка**

Run: локальный запуск, затем:

1. **Обычный пользователь на ПК (≥ 900 px).** В шапке инструменты «Выбор / Точка / Полигон / Линия / Удалить»; нет кнопок «Категории» и «Карты», нет переключателя «Общие / Мои метки». Поставить точку, полигон (двойной клик завершает), линию: каждая сохраняется, статус «Сохранено». Выбрать метку: правка вершин, перетаскивание точки сохраняется (проверить перезагрузкой). Правка названия, описания, цвета, иконки (иконка только у точки). Удаление с подтверждением. Esc отменяет рисование. Метка с названием `<b>x</b>` показывается буквально.
2. **Обычный пользователь, 375 px.** Редактора нет, метки видны, карточка шторкой.
3. **Админ.** Переключатель «Общие / Мои метки». В «Общие»: прежний редактор, клик на карте в режиме «Точка» создаёт общий объект, а не личную метку. В «Мои метки»: клик в режиме «Точка» создаёт личную метку, а общий редактор скрыт. Клик по общему объекту в режиме «Мои метки» открывает карточку, не выбирает его. Личная метка админа не видна другому пользователю.
4. **Два пользователя** в разных браузерах: метки друг друга не видны ни после перезагрузки, ни по ссылке `?mark=<id>`.
5. **Сессия.** Выйти в другой вкладке и сохранить правку: статус «Сессия истекла…».

Expected: все пункты выполняются, в консоли браузера нет ошибок.

- [ ] **Step 5: Commit**

```bash
git add map-marks-editor.js map-editor.js map-app.css
git commit -m "feat(map): personal marks editor and admin mode switch

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Документация и финальная проверка

**Files:**
- Modify: `privacy.html`
- Modify: `CLAUDE.md`
- Modify: `RELEASE.md`
- Modify: `docs/superpowers/specs/2026-10-11-personal-marks-design.md` (статус)

- [ ] **Step 1: `privacy.html`**

В `privacy.html` после абзаца «Какие данные мы храним» добавить:

```html
  <h2>Личные метки на карте</h2>
  <p>Если вы ставите на карте личные метки, мы храним их координаты, название, описание, цвет и иконку.
  Метки показываются только вам и не видны другим пользователям. Администратор сервера технически имеет
  доступ к базе данных, в которой они хранятся. Метки удаляются вместе с аккаунтом.</p>
```

- [ ] **Step 2: `CLAUDE.md`**

1. В «Статус проекта» → «Сделано» добавить пункт:

```markdown
- **Личные метки пользователей (этап C)** (ветка `personal-marks`): точки/полигоны/линии на карте, видны только
  автору; таблица `user_marks` (миграция 3), API `/api/my/marks`, слой и фильтр «Мои метки», редактор на ПК,
  у админа переключатель «Общие / Мои метки»; подтверждение почты больше не открывает сессию.
  Спек и план — `docs/superpowers/specs|plans/2026-10-11-personal-marks*`.
```

2. В «Не сделано» удалить пункт «Решить до этапа C, входить ли автоматически после подтверждения почты…» и в строке «Этап C: личные метки; этап B…» убрать «Этап C: личные метки;». Добавить пункт: «Перед анонсом личных меток пройти руками чек-лист из плана `2026-10-11-personal-marks.md` (Task 7) и добавить абзац про метки в `/privacy` на проверку владельцу/юристу.»

3. В раздел «Files» добавить после описания `map.html`:

```markdown
  Личные метки: `map-marks.js` (слой, фильтр, карточка) и `map-marks-editor.js` (рисование и правка, только ПК);
  сервер — `server/routes/marks.js`, таблица `user_marks`.
```

- [ ] **Step 3: `RELEASE.md`**

Добавить раздел (в стиле существующих, на русском) «Личные метки (этап C)»: миграция 3 выполняется сама при старте `anoma-api`; перед деплоем бэкап БД; после деплоя проверка на проде: регистрация тестового пользователя, подтверждение (сессии нет, вход вручную), метка, перезагрузка, проверка из второго аккаунта; метки удаляются каскадом вместе с пользователем или картой.

- [ ] **Step 4: Статус спека**

В `docs/superpowers/specs/2026-10-11-personal-marks-design.md` строку `Статус: на ревью.` заменить на `Статус: реализовано в ветке personal-marks.`

- [ ] **Step 5: Полный прогон тестов**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS, все тесты зелёные (включая прежние 175 и новые из `marks.test.js`).

- [ ] **Step 6: Commit**

```bash
git add privacy.html CLAUDE.md RELEASE.md docs/superpowers/specs/2026-10-11-personal-marks-design.md
git commit -m "docs(marks): privacy paragraph, status, release notes for personal marks

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Вливание**

Использовать `superpowers:finishing-a-development-branch`. В `master` не пушить без явного решения владельца: пуш деплоит на прод, а перед ним нужен бэкап БД.
