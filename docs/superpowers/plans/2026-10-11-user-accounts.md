# Аккаунты обычных пользователей (этап A) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать обычным посетителям ANOMA WIKI регистрацию, вход, подтверждение почты, сброс и смену пароля, список сессий и страницу профиля.

**Architecture:** Расширяем существующий API `server/` (Node 22, `node:http` + `node:sqlite`, без npm): миграция схемы v2, таблица `auth_tokens`, свой SMTP-клиент на `node:tls`, новый модуль маршрутов `routes/account.js`. Клиент — отдельная статическая страница `/account` на ванильном JS поверх уже существующих `map-common.js` (`MapApi`, `h`).

**Tech Stack:** Node 22 (`node:sqlite`, `node:crypto`, `node:tls`, `node:test`), SQLite, vanilla JS/HTML/CSS, nginx.

**Spec:** `docs/superpowers/specs/2026-10-11-user-accounts-design.md`

## Global Constraints

- Сервер без npm-зависимостей: только встроенные модули Node. Тесты: `node --test server/test/*.test.js tools/*.test.js`.
- Сайт статический, без сборки и фреймворков; пользовательский текст выводится только через `textContent` (хелпер `h()` делает это сам).
- Логин: `[A-Za-z0-9_.-]{3,32}`, уникален без учёта регистра. Пароль: 8–128 символов, не равен логину. Почта: нижний регистр, до 254 символов.
- Зарезервированные логины: `admin`, `administrator`, `moderator`, `support`, `root`, `system`, `anoma`.
- Токены: 32 случайных байта (64 hex), в БД только sha256. Подтверждение почты — 24 ч, сброс пароля — 1 ч, одноразовые.
- Сессия: cookie `sid`, HttpOnly, SameSite=Strict, 30 дней. Не-GET запросы требуют заголовок `X-Requested-With`.
- Коды ошибок API (поле `error`) — строки из списка: `login_taken`, `login_invalid`, `login_reserved`, `email_invalid`, `password_short`, `password_long`, `password_equals_login`, `consent_required`, `email_not_verified`, `token_invalid`, `current_password_wrong`, `mail_not_configured`; для неверного логина/пароля сохраняется прежнее `invalid login or password`.
- Лимиты: регистрация 5/час с IP и 3/сутки на почту; письма 3/час на почту и 10/час с IP; вход по IP 10/10 мин (как сейчас) и 10/10 мин на аккаунт.
- Письма только `text/plain`, UTF-8, base64; SMTP — неявный TLS на порту 465, `AUTH PLAIN`.
- Роль `user` по-прежнему не получает прав записи: `can()` и `capabilities()` для неё возвращают `false`.
- Каждый коммит заканчивается строками атрибуции из системной подсказки сессии (`Co-Authored-By: …` и `Claude-Session: …`).
- Работа ведётся в ветке `user-accounts`, созданной от `map-editor-spec` (спек уже закоммичен там, а в `master` эта ветка ещё не влита).
- Деплой на VPS и любые команды по SSH выполняются только после явного подтверждения владельца (см. Task 12).

## Review Focus

Входы и сбои, которые спек подразумевает, но явные тесты задач 1–11 их не закрывают без отдельной строки. Каждая строка получает тест в задаче-владельце.

1. **Огромный пароль** (5000 символов) при регистрации и смене пароля — ответ `password_long` без вычисления scrypt (Task 7, Task 8).
2. **Токен неправильного типа** (`{"token": {"$ne": 1}}`, число, короткая строка, верхний регистр hex) — 400 `token_invalid`, не 500 (Task 7).
3. **Недоступный SMTP**: регистрация отвечает 200, аккаунт создан, необработанного отклонения промиса нет (Task 7).
4. **Открытый редирект** через `?next=//evil.example` или `?next=/\evil` на странице `/account` — игнорируется (Task 10, проверка в браузере и юнит-проверка функции).
5. **Пробелы и регистр** в логине/почте при входе и регистрации: `" User@Example.COM "` находит и создаёт того же пользователя, `Admin` не регистрируется рядом с `admin` (Task 6, Task 7).
6. **Чужая сессия**: `DELETE /api/sessions/:id` с отпечатком сессии другого пользователя — 404, сессия жива; кривой `id` — 400 (Task 8).

---

### Task 1: Миграция схемы v2 и расширение `createUser` / `createSession`

**Files:**
- Modify: `server/db.js`
- Modify: `server/auth.js`
- Test: `server/test/db.test.js`, `server/test/auth.test.js`

**Interfaces:**
- Produces:
  - `db.js`: `openDb(file)`, `migrate(db)`, `SCHEMA`. После `openDb` `PRAGMA user_version = 2`.
  - Таблица `users` получает `email`, `email_verified_at`, `password_changed_at`; `sessions` — `created_at`, `last_seen_at` (мс), `ip`, `user_agent`; новая `auth_tokens(token_hash PK, user_id, kind, expires_at, used_at)`.
  - `auth.js`: `createUser(db, { login, password, role, email = null, emailVerified = true }) -> id`;
    `createSession(db, userId, nowMs, ttlMs = SESSION_TTL_MS, meta = {}) -> token` (`meta = { ip, userAgent }`);
    `touchSession(db, token, nowMs)`; `sessionId(token) -> 16 hex`; экспорт `sha256`, `LOGIN_RE`.

- [ ] **Step 1: Написать падающие тесты миграции**

В `server/test/db.test.js` в тесте `openDb creates all tables` заменить список таблиц на
`['users', 'sessions', 'maps', 'categories', 'features', 'feature_images', 'auth_tokens']`, затем добавить в конец файла:

```js
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA, migrate } = require('../db');

test('migration v2 upgrades a v1 database and keeps the admin verified', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (login, password_hash, role) VALUES ('admin', 'h', 'admin')").run();
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('t', 1, 99)").run();
  migrate(db);
  const u = db.prepare('SELECT email, email_verified_at, created_at FROM users').get();
  assert.equal(u.email, null);
  assert.equal(u.email_verified_at, u.created_at);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'auth_tokens'").get());
  const s = db.prepare('SELECT created_at, last_seen_at, ip, user_agent FROM sessions').get();
  assert.equal(s.created_at, 0);
  assert.equal(s.ip, null);
  migrate(db); // second run is a no-op
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
});

test('logins and emails are unique case-insensitively', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (login, password_hash, email) VALUES ('Anna', 'h', 'a@x.io')").run();
  assert.throws(() => db.prepare("INSERT INTO users (login, password_hash) VALUES ('anna', 'h')").run());
  assert.throws(() => db.prepare("INSERT INTO users (login, password_hash, email) VALUES ('bob', 'h', 'A@X.IO')").run());
  db.prepare("INSERT INTO users (login, password_hash) VALUES ('c1', 'h')").run();
  db.prepare("INSERT INTO users (login, password_hash) VALUES ('c2', 'h')").run(); // NULL emails may repeat
});

test('deleting a user cascades to auth_tokens', () => {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO users (login, password_hash) VALUES ('u1', 'h')").run();
  db.prepare("INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES ('x', 1, 'verify_email', 1)").run();
  db.prepare('DELETE FROM users WHERE id = 1').run();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get().n, 0);
});
```

В `server/test/auth.test.js` добавить в конец:

```js
test('createUser stores a lower-cased email and marks it verified unless told otherwise', () => {
  const db = openDb(':memory:');
  const a = require('../auth');
  const id1 = a.createUser(db, { login: 'mail1', password: 'password-1', role: 'user', email: 'Mail1@Example.COM' });
  const id2 = a.createUser(db, { login: 'mail2', password: 'password-2', role: 'user', email: 'mail2@example.com', emailVerified: false });
  const r1 = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(id1);
  const r2 = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(id2);
  assert.equal(r1.email, 'mail1@example.com');
  assert.ok(r1.email_verified_at);
  assert.equal(r2.email_verified_at, null);
});

test('createSession records meta; touchSession updates last_seen_at at most every 10 minutes', () => {
  const db = openDb(':memory:');
  const a = require('../auth');
  const uid = a.createUser(db, { login: 'sess', password: 'password-1', role: 'user' });
  const token = a.createSession(db, uid, 1_000, undefined, { ip: '1.2.3.4', userAgent: 'UA/1' });
  const row = () => db.prepare('SELECT created_at, last_seen_at, ip, user_agent FROM sessions').get();
  assert.equal(row().created_at, 1_000);
  assert.equal(row().ip, '1.2.3.4');
  assert.equal(row().user_agent, 'UA/1');
  a.touchSession(db, token, 1_000 + 5 * 60 * 1000);
  assert.equal(row().last_seen_at, 1_000);
  a.touchSession(db, token, 1_000 + 11 * 60 * 1000);
  assert.equal(row().last_seen_at, 1_000 + 11 * 60 * 1000);
  assert.equal(a.sessionId(token).length, 16);
  assert.equal(a.sessionId(token), a.sha256(token).slice(0, 16));
});
```

Если в начале `auth.test.js` нет `const { openDb } = require('../db');`, добавить эту строку.

- [ ] **Step 2: Запустить тесты и убедиться, что они падают**

Run: `node --test server/test/db.test.js server/test/auth.test.js`
Expected: FAIL (нет `migrate`/`SCHEMA`, нет таблицы `auth_tokens`, `touchSession is not a function`).

- [ ] **Step 3: Реализовать миграцию в `server/db.js`**

Заменить функцию `openDb` и экспорт в конце файла (константа `SCHEMA` остаётся как есть):

```js
// Version 1 is the SCHEMA above (the schema as it was in production before accounts).
// Each entry runs once, inside a transaction, when user_version is lower than its version.
const MIGRATIONS = [
  {
    version: 2,
    sql: `
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
UPDATE users SET email_verified_at = created_at;
CREATE UNIQUE INDEX idx_users_login_lower ON users(lower(login));
CREATE UNIQUE INDEX idx_users_email_lower ON users(lower(email)) WHERE email IS NOT NULL;
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id, kind);
`,
  },
];

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { openDb, migrate, SCHEMA };
```

- [ ] **Step 4: Расширить `server/auth.js`**

Заменить функцию `createUser` целиком:

```js
function createUser(db, { login, password, role, email = null, emailVerified = true }) {
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) throw new Error('login must match [A-Za-z0-9_.-]{3,32}');
  if (typeof password !== 'string' || password.length < 8) throw new Error('password must be at least 8 characters');
  if (role !== 'admin' && role !== 'user') throw new Error('role must be admin or user');
  const r = db
    .prepare(
      `INSERT INTO users (login, password_hash, role, email, email_verified_at, password_changed_at)
       VALUES (?, ?, ?, ?, CASE WHEN ? THEN datetime('now') END, datetime('now'))`,
    )
    .run(login, hashPassword(password), role, email === null ? null : String(email).toLowerCase(), emailVerified ? 1 : 0);
  return Number(r.lastInsertRowid);
}
```

Заменить `createSession` и добавить `touchSession`, `sessionId` сразу после неё:

```js
function createSession(db, userId, nowMs, ttlMs = SESSION_TTL_MS, meta = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at, created_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(
    sha256(token),
    userId,
    nowMs + ttlMs,
    nowMs,
    nowMs,
    meta.ip ? String(meta.ip).slice(0, 64) : null,
    meta.userAgent ? String(meta.userAgent).slice(0, 200) : null,
  );
  return token;
}

const TOUCH_INTERVAL_MS = 10 * 60 * 1000;

// Cheap "last seen": at most one write per session per 10 minutes.
function touchSession(db, token, nowMs) {
  if (!token || typeof token !== 'string') return;
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ? AND last_seen_at < ?').run(
    nowMs,
    sha256(token),
    nowMs - TOUCH_INTERVAL_MS,
  );
}

// Public, non-secret handle of a session: the first 16 hex chars of its stored hash.
function sessionId(token) {
  return sha256(String(token)).slice(0, 16);
}
```

В `module.exports` добавить `touchSession`, `sessionId`, `sha256`, `LOGIN_RE`.

- [ ] **Step 5: Запустить весь набор тестов**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS (все прежние тесты зелёные, новые проходят).

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/auth.js server/test/db.test.js server/test/auth.test.js
git commit -m "feat(accounts): schema migration v2, email fields, session metadata"
```

---

### Task 2: Правила валидации аккаунта

**Files:**
- Create: `server/account-rules.js`
- Test: `server/test/account-rules.test.js`

**Interfaces:**
- Consumes: `LOGIN_RE` из `server/auth.js`.
- Produces: `normalizeEmail(value) -> string | null`; `checkLogin(login) -> null | 'login_invalid' | 'login_reserved'`; `checkPassword(password, login) -> null | 'password_short' | 'password_long' | 'password_equals_login'`; `RESERVED_LOGINS` (Set).

- [ ] **Step 1: Написать падающий тест**

`server/test/account-rules.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, checkLogin, checkPassword } = require('../account-rules');

test('normalizeEmail trims, lower-cases and rejects junk', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeEmail('a.b+tag@sub.example.org'), 'a.b+tag@sub.example.org');
  for (const bad of ['', 'nope', 'a@b', 'a b@c.de', 'a@b.c', '<x>@y.zz', 'a@@b.cc', null, 42, {}]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
  assert.equal(normalizeEmail('a'.repeat(250) + '@x.io'), null);
});

test('checkLogin enforces the pattern and reserved names (any case)', () => {
  assert.equal(checkLogin('good_name-1'), null);
  assert.equal(checkLogin('ab'), 'login_invalid');
  assert.equal(checkLogin('has space'), 'login_invalid');
  assert.equal(checkLogin('юзер'), 'login_invalid');
  assert.equal(checkLogin(undefined), 'login_invalid');
  for (const name of ['admin', 'Admin', 'ROOT', 'Support', 'anoma']) assert.equal(checkLogin(name), 'login_reserved', name);
});

test('checkPassword enforces 8..128 and rejects the login itself', () => {
  assert.equal(checkPassword('longenough', 'user1'), null);
  assert.equal(checkPassword('short', 'user1'), 'password_short');
  assert.equal(checkPassword(undefined, 'user1'), 'password_short');
  assert.equal(checkPassword('x'.repeat(129), 'user1'), 'password_long');
  assert.equal(checkPassword('x'.repeat(128), 'user1'), null);
  assert.equal(checkPassword('SameAsLogin', 'sameaslogin'), 'password_equals_login');
});
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `node --test server/test/account-rules.test.js`
Expected: FAIL — `Cannot find module '../account-rules'`.

- [ ] **Step 3: Реализовать**

`server/account-rules.js`:

```js
'use strict';

const { LOGIN_RE } = require('./auth');

const RESERVED_LOGINS = new Set(['admin', 'administrator', 'moderator', 'support', 'root', 'system', 'anoma']);
const EMAIL_RE = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]{2,}$/;

function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

function checkLogin(login) {
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) return 'login_invalid';
  if (RESERVED_LOGINS.has(login.toLowerCase())) return 'login_reserved';
  return null;
}

function checkPassword(password, login) {
  if (typeof password !== 'string' || password.length < 8) return 'password_short';
  if (password.length > 128) return 'password_long';
  if (login && password.toLowerCase() === String(login).toLowerCase()) return 'password_equals_login';
  return null;
}

module.exports = { normalizeEmail, checkLogin, checkPassword, RESERVED_LOGINS };
```

- [ ] **Step 4: Запустить тест**

Run: `node --test server/test/account-rules.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/account-rules.js server/test/account-rules.test.js
git commit -m "feat(accounts): login, email and password rules"
```

---

### Task 3: Одноразовые токены и очистка

**Files:**
- Create: `server/tokens.js`
- Test: `server/test/tokens.test.js`

**Interfaces:**
- Consumes: `sha256` из `server/auth.js`; таблица `auth_tokens` (Task 1).
- Produces:
  - `issueToken(db, userId, kind, nowMs) -> token` (hex 64). Гасит прежние неиспользованные токены того же `kind` для пользователя.
  - `peekToken(db, token, kind, nowMs) -> userId | null` (ничего не меняет).
  - `consumeToken(db, token, kind, nowMs) -> userId | null` (атомарно, одноразово).
  - `revokeTokens(db, userId, kind, nowMs)`.
  - `cleanup(db, nowMs)`: удаляет старые токены и неподтверждённых пользователей.

- [ ] **Step 1: Написать падающий тест**

`server/test/tokens.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createUser } = require('../auth');
const { issueToken, peekToken, consumeToken, revokeTokens, cleanup } = require('../tokens');

const H = 60 * 60 * 1000;

function setup() {
  const db = openDb(':memory:');
  const uid = createUser(db, { login: 'tok1', password: 'password-1', role: 'user', email: 't@x.io', emailVerified: false });
  return { db, uid };
}

test('a token works once and only for its kind', () => {
  const { db, uid } = setup();
  const t = issueToken(db, uid, 'verify_email', 1000);
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE token_hash = ?').get(t).n, 0, 'raw token is not stored');
  assert.equal(consumeToken(db, t, 'reset_password', 2000), null);
  assert.equal(peekToken(db, t, 'verify_email', 2000), uid);
  assert.equal(consumeToken(db, t, 'verify_email', 2000), uid);
  assert.equal(consumeToken(db, t, 'verify_email', 2000), null);
  assert.equal(peekToken(db, t, 'verify_email', 2000), null);
});

test('tokens expire: 24 h for verification, 1 h for reset', () => {
  const { db, uid } = setup();
  const v = issueToken(db, uid, 'verify_email', 0);
  const r = issueToken(db, uid, 'reset_password', 0);
  assert.equal(peekToken(db, v, 'verify_email', 23 * H), uid);
  assert.equal(peekToken(db, v, 'verify_email', 25 * H), null);
  assert.equal(peekToken(db, r, 'reset_password', 30 * 60 * 1000), uid);
  assert.equal(peekToken(db, r, 'reset_password', 2 * H), null);
});

test('issuing a new token revokes the previous one of the same kind', () => {
  const { db, uid } = setup();
  const first = issueToken(db, uid, 'verify_email', 0);
  const second = issueToken(db, uid, 'verify_email', 1);
  assert.equal(consumeToken(db, first, 'verify_email', 2), null);
  assert.equal(consumeToken(db, second, 'verify_email', 2), uid);
});

test('revokeTokens kills every open token of a kind', () => {
  const { db, uid } = setup();
  const t = issueToken(db, uid, 'reset_password', 0);
  revokeTokens(db, uid, 'reset_password', 1);
  assert.equal(consumeToken(db, t, 'reset_password', 2), null);
});

test('malformed tokens are rejected without touching the database', () => {
  const { db } = setup();
  for (const bad of [undefined, null, 5, {}, [], '', 'abc', 'G'.repeat(64), 'A'.repeat(64)]) {
    assert.equal(consumeToken(db, bad, 'verify_email', 0), null, String(bad));
    assert.equal(peekToken(db, bad, 'verify_email', 0), null, String(bad));
  }
});

test('cleanup drops stale tokens and unverified accounts, keeps live ones', () => {
  const { db, uid } = setup(); // unverified, created "now" (real clock)
  const real = Date.now();
  issueToken(db, uid, 'verify_email', real);
  const keeper = createUser(db, { login: 'keeper', password: 'password-1', role: 'user', email: 'k@x.io' });
  // 1 hour later: everything is still alive
  cleanup(db, real + 1 * H);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid));
  // 3 days later: the unverified account and its expired token are gone, the verified one stays
  cleanup(db, real + 72 * H);
  assert.equal(db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid), undefined);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(keeper));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_tokens').get().n, 0);
});

test('cleanup keeps an unverified account while its verification token is alive', () => {
  const { db, uid } = setup();
  const real = Date.now();
  issueToken(db, uid, 'verify_email', real + 40 * H); // re-sent later, still valid at real + 50h
  cleanup(db, real + 50 * H);
  assert.ok(db.prepare('SELECT 1 FROM users WHERE id = ?').get(uid));
});
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `node --test server/test/tokens.test.js`
Expected: FAIL — `Cannot find module '../tokens'`.

- [ ] **Step 3: Реализовать**

`server/tokens.js`:

```js
'use strict';

const crypto = require('node:crypto');
const { sha256 } = require('./auth');

const HOUR = 60 * 60 * 1000;
const TTL_MS = { verify_email: 24 * HOUR, reset_password: HOUR };
const TOKEN_RE = /^[0-9a-f]{64}$/;

function issueToken(db, userId, kind, nowMs) {
  if (!(kind in TTL_MS)) throw new Error('unknown token kind: ' + kind);
  revokeTokens(db, userId, kind, nowMs);
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO auth_tokens (token_hash, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    kind,
    nowMs + TTL_MS[kind],
  );
  return token;
}

function revokeTokens(db, userId, kind, nowMs) {
  db.prepare('UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND kind = ? AND used_at IS NULL').run(
    nowMs,
    userId,
    kind,
  );
}

function peekToken(db, token, kind, nowMs) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const row = db
    .prepare('SELECT user_id FROM auth_tokens WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .get(sha256(token), kind, nowMs);
  return row ? row.user_id : null;
}

// Atomic: of two concurrent requests with the same token exactly one gets changes === 1.
function consumeToken(db, token, kind, nowMs) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const hash = sha256(token);
  const r = db
    .prepare('UPDATE auth_tokens SET used_at = ? WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > ?')
    .run(nowMs, hash, kind, nowMs);
  if (r.changes !== 1) return null;
  return db.prepare('SELECT user_id FROM auth_tokens WHERE token_hash = ?').get(hash).user_id;
}

// Drops stale tokens, then unverified accounts older than a day that have no live verification token.
function cleanup(db, nowMs) {
  const dayAgo = nowMs - 24 * HOUR;
  db.prepare(
    'DELETE FROM auth_tokens WHERE expires_at < ? OR (used_at IS NOT NULL AND used_at < ?)',
  ).run(dayAgo, dayAgo);
  db.prepare(
    `DELETE FROM users
     WHERE email_verified_at IS NULL
       AND created_at < datetime(? / 1000, 'unixepoch')
       AND NOT EXISTS (
         SELECT 1 FROM auth_tokens t
         WHERE t.user_id = users.id AND t.kind = 'verify_email' AND t.used_at IS NULL AND t.expires_at > ?
       )`,
  ).run(dayAgo, nowMs);
}

module.exports = { issueToken, peekToken, consumeToken, revokeTokens, cleanup };
```

- [ ] **Step 4: Запустить тест**

Run: `node --test server/test/tokens.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/tokens.js server/test/tokens.test.js
git commit -m "feat(accounts): one-time auth tokens and account cleanup"
```

---

### Task 4: Почтовый модуль (SMTP-клиент, log и memory) и шаблоны писем

**Files:**
- Create: `server/mailer.js`
- Create: `server/mail-templates.js`
- Test: `server/test/mailer.test.js`

**Interfaces:**
- Produces:
  - `buildMessage({ from, to, subject, text, nowMs, fromName? }) -> string` (RFC 5322 с CRLF; бросает при плохом адресе).
  - `createSmtpMailer({ host, port, user, pass, from, connect?, timeoutMs?, now? })`, `createLogMailer()`, `createMemoryMailer()`, `createMailer(cfg)`. У всех: `configured: boolean`, `send({ to, subject, text }) -> Promise<void>`; у memory ещё `sent: Array<{to, subject, text}>`.
  - `cfg` для `createMailer`: `{ mailMode, smtpHost, smtpPort, smtpUser, smtpPass, mailFrom }`; без `mailMode` возвращает mailer с `configured: false`.
  - `mail-templates.js`: `verifyEmailMessage({ login, url }) -> { subject, text }`, `resetPasswordMessage({ login, url }) -> { subject, text }`.

- [ ] **Step 1: Написать падающий тест**

`server/test/mailer.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {
  buildMessage,
  createSmtpMailer,
  createMemoryMailer,
  createMailer,
} = require('../mailer');
const { verifyEmailMessage, resetPasswordMessage } = require('../mail-templates');

function decodeBody(message) {
  const body = message.split('\r\n\r\n')[1];
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

test('buildMessage encodes subject and body, uses CRLF and a unique Message-ID', () => {
  const m = buildMessage({ from: 'noreply@anoma-wiki.ru', to: 'a@b.cc', subject: 'Проверка', text: 'Привет\nссылка', nowMs: 0 });
  assert.match(m, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <noreply@anoma-wiki\.ru>\r\n/);
  assert.match(m, /\r\nTo: <a@b\.cc>\r\n/);
  assert.match(m, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(m, /\r\nContent-Transfer-Encoding: base64\r\n/);
  assert.match(m, /\r\nMessage-ID: <[0-9a-f]+@anoma-wiki\.ru>\r\n/);
  assert.equal(decodeBody(m), 'Привет\nссылка');
  const subj = /Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/.exec(m)[1];
  assert.equal(Buffer.from(subj, 'base64').toString('utf8'), 'Проверка');
});

test('buildMessage refuses addresses that could inject headers', () => {
  const base = { from: 'noreply@anoma-wiki.ru', subject: 's', text: 't', nowMs: 0 };
  assert.throws(() => buildMessage({ ...base, to: 'a@b.cc\r\nBcc: x@y.zz' }));
  assert.throws(() => buildMessage({ ...base, to: 'a b@c.dd' }));
  assert.throws(() => buildMessage({ ...base, to: '<a@b.cc>' }));
  assert.throws(() => buildMessage({ ...base, to: 'a@b.cc', from: 'x@y.zz\nBcc: q@w.ee' }));
});

// A tiny scripted SMTP server (plain TCP: the mailer takes an injectable `connect`).
function fakeSmtp({ failAuth = false, silent = false } = {}) {
  const received = [];
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    const cur = {};
    let buf = '';
    let inData = false;
    const say = (s) => sock.write(s + '\r\n');
    if (!silent) say('220 fake ESMTP');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          cur.data = buf.slice(0, end + 2);
          buf = buf.slice(end + 5);
          inData = false;
          received.push({ ...cur });
          say('250 queued');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^EHLO /.test(line)) say('250-fake\r\n250 AUTH PLAIN');
        else if (/^AUTH PLAIN /.test(line)) {
          cur.auth = line.slice('AUTH PLAIN '.length);
          say(failAuth ? '535 bad credentials' : '235 ok');
        } else if (/^MAIL FROM:/.test(line)) { cur.from = line.slice(10); say('250 ok'); }
        else if (/^RCPT TO:/.test(line)) { cur.to = line.slice(8); say('250 ok'); }
        else if (line === 'DATA') { inData = true; say('354 go'); }
        else if (line === 'QUIT') { say('221 bye'); sock.end(); }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }));
  });
}

function mailerFor(port, extra = {}) {
  return createSmtpMailer({
    host: 'smtp.test', port, user: 'noreply@anoma-wiki.ru', pass: 'p@ss', from: 'noreply@anoma-wiki.ru',
    connect: () => net.connect(port, '127.0.0.1'),
    ...extra,
  });
}

test('smtp mailer speaks EHLO/AUTH/MAIL/RCPT/DATA and delivers an encoded message', async (t) => {
  const f = await fakeSmtp();
  t.after(() => f.server.close());
  await mailerFor(f.port).send({ to: 'user@example.com', subject: 'Тема', text: 'Тело письма\n.точка в начале строки' });
  assert.equal(f.received.length, 1);
  const r = f.received[0];
  assert.equal(r.from, '<noreply@anoma-wiki.ru>');
  assert.equal(r.to, '<user@example.com>');
  assert.equal(Buffer.from(r.auth, 'base64').toString(), '\0noreply@anoma-wiki.ru\0p@ss');
  assert.equal(decodeBody(r.data), 'Тело письма\n.точка в начале строки');
});

test('smtp mailer rejects on auth failure and on a silent server (timeout)', async (t) => {
  const bad = await fakeSmtp({ failAuth: true });
  const quiet = await fakeSmtp({ silent: true });
  t.after(() => { bad.server.close(); quiet.server.close(); });
  await assert.rejects(() => mailerFor(bad.port).send({ to: 'u@example.com', subject: 's', text: 't' }), /535|unexpected reply/);
  await assert.rejects(
    () => mailerFor(quiet.port, { timeoutMs: 150 }).send({ to: 'u@example.com', subject: 's', text: 't' }),
    /timeout/,
  );
});

test('memory mailer collects messages; createMailer picks implementation by mode', async () => {
  const m = createMemoryMailer();
  await m.send({ to: 'a@b.cc', subject: 's', text: 't' });
  assert.deepEqual(m.sent, [{ to: 'a@b.cc', subject: 's', text: 't' }]);
  assert.equal(createMailer({}).configured, false);
  await assert.rejects(() => createMailer({}).send({ to: 'a@b.cc', subject: 's', text: 't' }));
  assert.equal(createMailer({ mailMode: 'log' }).configured, true);
  assert.throws(() => createMailer({ mailMode: 'smtp' }), /SMTP_HOST/);
  assert.equal(
    createMailer({ mailMode: 'smtp', smtpHost: 'h', smtpPort: 465, smtpUser: 'u', smtpPass: 'p', mailFrom: 'n@x.io' }).configured,
    true,
  );
});

test('templates mention the login, the link and the lifetime', () => {
  const v = verifyEmailMessage({ login: 'stalker', url: 'https://x.test/account#verify=abc' });
  assert.match(v.subject, /ANOMA WIKI/);
  assert.ok(v.text.includes('stalker') && v.text.includes('https://x.test/account#verify=abc') && v.text.includes('24'));
  const r = resetPasswordMessage({ login: 'stalker', url: 'https://x.test/account#reset=abc' });
  assert.ok(r.text.includes('https://x.test/account#reset=abc') && r.text.includes('1 час'));
});
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `node --test server/test/mailer.test.js`
Expected: FAIL — `Cannot find module '../mailer'`.

- [ ] **Step 3: Реализовать шаблоны**

`server/mail-templates.js`:

```js
'use strict';

function verifyEmailMessage({ login, url }) {
  return {
    subject: 'ANOMA WIKI: подтвердите почту',
    text:
      `Здравствуйте, ${login}!\n\n` +
      'Чтобы завершить регистрацию на ANOMA WIKI, подтвердите адрес почты по ссылке:\n\n' +
      `${url}\n\n` +
      'Ссылка действует 24 часа.\n\n' +
      'Если вы не регистрировались на сайте, просто проигнорируйте это письмо.\n',
  };
}

function resetPasswordMessage({ login, url }) {
  return {
    subject: 'ANOMA WIKI: сброс пароля',
    text:
      `Здравствуйте, ${login}!\n\n` +
      'Для аккаунта на ANOMA WIKI запрошен сброс пароля. Задайте новый пароль по ссылке:\n\n' +
      `${url}\n\n` +
      'Ссылка действует 1 час и работает один раз.\n\n' +
      'Если вы не запрашивали сброс, ничего не делайте: пароль останется прежним.\n',
  };
}

module.exports = { verifyEmailMessage, resetPasswordMessage };
```

- [ ] **Step 4: Реализовать `server/mailer.js`**

```js
'use strict';

const crypto = require('node:crypto');
const tls = require('node:tls');

const ADDR_RE = /^[^\s<>"@,;:\\]+@[^\s<>"@,;:\\]+$/;

function assertAddress(addr) {
  if (typeof addr !== 'string' || !ADDR_RE.test(addr)) throw new Error('bad mail address');
}

function encodeWord(s) {
  return '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';
}

function wrap76(b64) {
  return b64.replace(/.{1,76}/g, '$&\r\n');
}

function buildMessage({ from, to, subject, text, nowMs, fromName = 'ANOMA WIKI' }) {
  assertAddress(from);
  assertAddress(to);
  const domain = from.split('@')[1];
  return [
    `From: ${encodeWord(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${new Date(nowMs).toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(String(text), 'utf8').toString('base64')),
  ].join('\r\n');
}

// One message per connection. `connect()` must return a connected duplex socket
// (tls.connect in production, plain net in tests).
function smtpSend({ user, pass, helo, connect, timeoutMs }, { from, to, data }) {
  return new Promise((resolve, reject) => {
    const socket = connect();
    let buf = '';
    let waiter = null;
    let done = false;
    const timer = setTimeout(() => finish(new Error('smtp timeout')), timeoutMs);

    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    }

    function deliver() {
      if (!waiter) return;
      const lines = buf.split('\r\n');
      const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
      if (end < 0) return;
      buf = lines.slice(end + 1).join('\r\n');
      const w = waiter;
      waiter = null;
      w({ code: Number(lines[end].slice(0, 3)) });
    }

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { buf += chunk; deliver(); });
    socket.on('error', finish);
    socket.on('close', () => finish(new Error('smtp connection closed')));

    const read = () => new Promise((res) => { waiter = res; deliver(); });
    const say = (line) => socket.write(line + '\r\n');
    const expect = async (codes) => {
      const r = await read();
      if (!codes.includes(r.code)) throw new Error('smtp: unexpected reply ' + r.code);
    };

    (async () => {
      try {
        await expect([220]);
        say('EHLO ' + helo);
        await expect([250]);
        say('AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64'));
        await expect([235]);
        say(`MAIL FROM:<${from}>`);
        await expect([250]);
        say(`RCPT TO:<${to}>`);
        await expect([250, 251]);
        say('DATA');
        await expect([354]);
        const stuffed = data.replace(/^\./gm, '..');
        socket.write(stuffed + (stuffed.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
        await expect([250]);
        say('QUIT');
        finish();
      } catch (err) {
        finish(err);
      }
    })();
  });
}

function createSmtpMailer({ host, port, user, pass, from, connect, timeoutMs = 20000, now = Date.now }) {
  const open = connect || (() => tls.connect({ host, port, servername: host }));
  const helo = from.split('@')[1];
  return {
    configured: true,
    async send({ to, subject, text }) {
      const data = buildMessage({ from, to, subject, text, nowMs: now() });
      await smtpSend({ user, pass, helo, connect: open, timeoutMs }, { from, to, data });
    },
  };
}

function createLogMailer() {
  return {
    configured: true,
    async send({ to, subject, text }) {
      console.log(`[mail] to=${to} subject=${subject}\n${text}`);
    },
  };
}

function createMemoryMailer() {
  const sent = [];
  return {
    configured: true,
    sent,
    async send(message) {
      sent.push({ to: message.to, subject: message.subject, text: message.text });
    },
  };
}

function createUnconfiguredMailer() {
  return {
    configured: false,
    async send() {
      throw new Error('mail is not configured');
    },
  };
}

function createMailer(cfg) {
  if (cfg.mailMode === 'log') return createLogMailer();
  if (cfg.mailMode === 'smtp') {
    const missing = [
      ['SMTP_HOST', cfg.smtpHost],
      ['SMTP_USER', cfg.smtpUser],
      ['SMTP_PASS', cfg.smtpPass],
      ['MAIL_FROM', cfg.mailFrom],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error('MAIL_MODE=smtp requires ' + missing.join(', '));
    return createSmtpMailer({
      host: cfg.smtpHost, port: cfg.smtpPort || 465, user: cfg.smtpUser, pass: cfg.smtpPass, from: cfg.mailFrom,
    });
  }
  return createUnconfiguredMailer();
}

module.exports = {
  buildMessage,
  createSmtpMailer,
  createLogMailer,
  createMemoryMailer,
  createUnconfiguredMailer,
  createMailer,
};
```

- [ ] **Step 5: Запустить тест**

Run: `node --test server/test/mailer.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/mailer.js server/mail-templates.js server/test/mailer.test.js
git commit -m "feat(accounts): mailer with minimal SMTP client, templates"
```

---

### Task 5: Проводка в приложении (конфиг, лимитеры, mailer, мета сессии, `meBody`)

Это рефакторинг без новых публичных маршрутов: существующий набор тестов остаётся зелёным, а следующие задачи получают нужные поля контекста.

**Files:**
- Modify: `server/config.js`
- Modify: `server/app.js`
- Modify: `server/index.js`
- Create: `server/me.js`
- Modify: `server/test/helpers.js`

**Interfaces:**
- Consumes: `createMailer`, `createMemoryMailer`, `createUnconfiguredMailer` (Task 4); `touchSession` (Task 1); `cleanup` (Task 3).
- Produces (контекст обработчика `c`):
  - `c.mailer` (`{ configured, send }`), `c.publicUrl` (без хвостового `/`), `c.clientMeta = { ip, userAgent }`;
  - `c.limiters = { login, loginAccount, registerIp, registerEmail, mailIp, mailEmail }` (каждый имеет `.allow(key, nowMs)`), `c.loginLimiter` остаётся алиасом `c.limiters.login`.
  - `meBody(db, user) -> { user: {id, login, role, email, emailVerified} | null, can }` в `server/me.js`.
  - Тестовый хелпер: `startTestServer({ now, loginLimiter, limiters, mailer, noMailer })` возвращает `mailer` (memory) и `lastToken(kind) -> hex | null` (`kind` = `'verify'` или `'reset'`).

- [ ] **Step 1: `server/config.js`**

Заменить тело возвращаемого объекта:

```js
function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    dbFile: env.ANOMA_DB || '/var/lib/anoma/db/anoma.db',
    uploadsDir: env.ANOMA_UPLOADS || '/var/lib/anoma/uploads',
    cookieSecure: env.COOKIE_SECURE !== '0',
    devStatic: env.DEV_STATIC || null,
    mailMode: env.MAIL_MODE || null,
    smtpHost: env.SMTP_HOST || null,
    smtpPort: Number(env.SMTP_PORT || 465),
    smtpUser: env.SMTP_USER || null,
    smtpPass: env.SMTP_PASS || null,
    mailFrom: env.MAIL_FROM || null,
    publicUrl: (env.PUBLIC_URL || 'https://anoma-wiki.ru').replace(/\/+$/, ''),
  };
}
```

- [ ] **Step 2: `server/me.js`**

```js
'use strict';

const { capabilities } = require('./permissions');

function meBody(db, user) {
  if (!user) return { user: null, can: capabilities(null) };
  const row = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(user.id);
  return {
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      email: row ? row.email : null,
      emailVerified: Boolean(row && row.email_verified_at),
    },
    can: capabilities(user),
  };
}

module.exports = { meBody };
```

- [ ] **Step 3: `server/app.js`**

Заменить импорт `auth` и начало `createApp`; в формировании контекста добавить новые поля:

```js
const { parseCookies, getSessionUser, touchSession, createRateLimiter } = require('./auth');
const { createUnconfiguredMailer } = require('./mailer');
```

```js
function createApp(opts) {
  const { db, uploadsDir, cookieSecure = true, now = Date.now } = opts;
  const mailer = opts.mailer || createUnconfiguredMailer();
  const publicUrl = (opts.publicUrl || 'https://anoma-wiki.ru').replace(/\/+$/, '');
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const limiters = {
    login: opts.loginLimiter || createRateLimiter({ max: 10, windowMs: 10 * MIN }),
    loginAccount: createRateLimiter({ max: 10, windowMs: 10 * MIN }),
    registerIp: createRateLimiter({ max: 5, windowMs: HOUR }),
    registerEmail: createRateLimiter({ max: 3, windowMs: 24 * HOUR }),
    mailIp: createRateLimiter({ max: 10, windowMs: HOUR }),
    mailEmail: createRateLimiter({ max: 3, windowMs: HOUR }),
    ...(opts.limiters || {}),
  };
  const routes = ROUTE_MODULES.flat().map((r) => ({ ...r, ...compile(r.pattern) }));
```

и в обработчике после `const user = getSessionUser(db, token, now());`:

```js
      if (user) touchSession(db, token, now());
      const ip = clientIp(req);
      const c = {
        db, uploadsDir, cookieSecure, now, req, res,
        loginLimiter: limiters.login, limiters, mailer, publicUrl,
        params, query: url.searchParams, user, token, headers: {}, ip,
        clientMeta: { ip, userAgent: String(req.headers['user-agent'] || '').slice(0, 200) },
      };
```

(старое объявление `const c = {...}` и `loginLimiter` в начале `createApp` удалить).

- [ ] **Step 4: `server/index.js`**

Добавить импорты и использование:

```js
const { createMailer } = require('./mailer');
const { cleanup } = require('./tokens');
```

```js
const db = openDb(cfg.dbFile);
const mailer = createMailer(cfg);
if (!mailer.configured) {
  console.warn('anoma-api: MAIL_MODE is not set, registration and password reset are disabled (503)');
}
const app = createApp({
  db, uploadsDir: cfg.uploadsDir, cookieSecure: cfg.cookieSecure, mailer, publicUrl: cfg.publicUrl,
});
cleanup(db, Date.now());
setInterval(() => cleanup(db, Date.now()), 60 * 60 * 1000).unref();
```

(строку `const app = createApp({ db, uploadsDir: ..., cookieSecure: ... });` заменить.)

- [ ] **Step 5: `server/test/helpers.js`**

Добавить импорт `createMemoryMailer` и изменить создание приложения и возвращаемый объект:

```js
const { createMemoryMailer } = require('../mailer');
```

```js
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
```

и в возвращаемый объект добавить:

```js
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
```

- [ ] **Step 6: Запустить полный набор тестов**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS (поведение не менялось).

- [ ] **Step 7: Commit**

```bash
git add server/config.js server/app.js server/index.js server/me.js server/test/helpers.js
git commit -m "refactor(accounts): wire mailer, limiters and client meta into the app"
```

---

### Task 6: Вход по логину или почте, `/api/me` с почтой, мета сессии

**Files:**
- Modify: `server/routes/auth.js`
- Test: `server/test/auth-routes.test.js`

**Interfaces:**
- Consumes: `meBody` (Task 5), `c.limiters`, `c.clientMeta`, `createSession(..., meta)`.
- Produces: `POST /api/login` принимает `{ login, password }`, где `login` — логин или почта (если содержит `@`). Ответы: 200 `meBody`, 401 `invalid login or password`, 403 `email_not_verified` (только при верном пароле), 429.

- [ ] **Step 1: Написать падающие тесты**

Добавить в конец `server/test/auth-routes.test.js`:

```js
test('login accepts the email instead of the login, ignoring case and spaces', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  createUser(s.db, { login: 'Visitor', password: 'visitor-pass', role: 'user', email: 'visitor@example.com' });
  const byEmail = await s.api('POST', '/api/login', { body: { login: ' Visitor@Example.COM ', password: 'visitor-pass' } });
  assert.equal(byEmail.status, 200);
  assert.equal(byEmail.json.user.login, 'Visitor');
  const byLogin = await s.api('POST', '/api/login', { body: { login: 'VISITOR', password: 'visitor-pass' } });
  assert.equal(byLogin.status, 200);
  assert.equal(byLogin.json.user.email, 'visitor@example.com');
  assert.equal(byLogin.json.user.emailVerified, true);
});

test('an unverified account gets email_not_verified only with the right password', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  createUser(s.db, { login: 'pending', password: 'pending-pass', role: 'user', email: 'p@example.com', emailVerified: false });
  const right = await s.api('POST', '/api/login', { body: { login: 'pending', password: 'pending-pass' } });
  assert.equal(right.status, 403);
  assert.equal(right.json.error, 'email_not_verified');
  assert.equal(right.headers.get('set-cookie'), null);
  const wrong = await s.api('POST', '/api/login', { body: { login: 'pending', password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, 'invalid login or password');
});

test('login is also rate limited per account across different IPs', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  for (let i = 0; i < 10; i++) {
    const r = await s.api('POST', '/api/login', {
      body: { login: 'admin', password: 'bad' + i },
      headers: { 'x-forwarded-for': `10.0.0.${i + 1}` },
    });
    assert.equal(r.status, 401);
  }
  const blocked = await s.api('POST', '/api/login', {
    body: { login: 'admin', password: 'correct horse' },
    headers: { 'x-forwarded-for': '10.0.0.99' },
  });
  assert.equal(blocked.status, 429);
});

test('login stores the client IP and user agent on the session', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await s.api('POST', '/api/login', {
    body: { login: 'admin', password: 'correct horse' },
    headers: { 'x-forwarded-for': '203.0.113.7', 'user-agent': 'TestAgent/1.0' },
  });
  const row = s.db.prepare('SELECT ip, user_agent FROM sessions ORDER BY created_at DESC, rowid DESC LIMIT 1').get();
  assert.equal(row.ip, '203.0.113.7');
  assert.equal(row.user_agent, 'TestAgent/1.0');
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `node --test server/test/auth-routes.test.js`
Expected: FAIL (вход по почте/регистру не работает, нет `email_not_verified`).

- [ ] **Step 3: Реализовать `server/routes/auth.js`**

Заменить файл целиком:

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
const { meBody } = require('../me');

// Verified against when the login does not exist, so both failure paths cost the same time.
const DUMMY_HASH = hashPassword('timing-equalizer-password');

const BY_LOGIN = 'SELECT id, login, role, password_hash, email_verified_at FROM users WHERE lower(login) = lower(?)';
const BY_EMAIL = 'SELECT id, login, role, password_hash, email_verified_at FROM users WHERE lower(email) = lower(?)';

module.exports = [
  { method: 'GET', pattern: '/api/me', handler: async (c) => ({ body: meBody(c.db, c.user) }) },
  {
    method: 'POST',
    pattern: '/api/login',
    handler: async (c) => {
      const now = c.now();
      if (!c.limiters.login.allow(c.ip, now)) throw new HttpError(429, 'too many attempts, try again later');
      const body = await readJson(c.req);
      const ident = (typeof body.login === 'string' ? body.login : '').trim().slice(0, 254);
      const password = typeof body.password === 'string' ? body.password : '';
      if (!c.limiters.loginAccount.allow('acct:' + ident.toLowerCase(), now)) {
        throw new HttpError(429, 'too many attempts, try again later');
      }
      const row = c.db.prepare(ident.includes('@') ? BY_EMAIL : BY_LOGIN).get(ident);
      const good = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
      if (!row || !good) throw new HttpError(401, 'invalid login or password');
      if (!row.email_verified_at) throw new HttpError(403, 'email_not_verified');
      const token = createSession(c.db, row.id, now, undefined, c.clientMeta);
      c.headers['Set-Cookie'] = sessionCookie(token, { secure: c.cookieSecure });
      return { body: meBody(c.db, row) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/logout',
    handler: async (c) => {
      if (c.token) destroySession(c.db, c.token);
      c.headers['Set-Cookie'] = clearCookie({ secure: c.cookieSecure });
      return { body: meBody(c.db, null) };
    },
  },
];
```

- [ ] **Step 4: Запустить весь набор**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.js server/test/auth-routes.test.js
git commit -m "feat(accounts): login by login or email, per-account limiter, session meta"
```

---

### Task 7: Регистрация, подтверждение почты и повторная отправка

**Files:**
- Create: `server/routes/account.js`
- Modify: `server/app.js` (добавить модуль в `ROUTE_MODULES`)
- Test: `server/test/account.test.js`

**Interfaces:**
- Consumes: `normalizeEmail`, `checkLogin`, `checkPassword` (Task 2); `issueToken`, `consumeToken` (Task 3); `verifyEmailMessage` (Task 4); `meBody` (Task 5); `c.mailer`, `c.limiters`, `c.publicUrl`.
- Produces: маршруты `POST /api/register`, `POST /api/verify-email`, `POST /api/resend-verification`. Ответ регистрации и повторной отправки всегда `200 { ok: true }`. Файл `routes/account.js` экспортирует массив маршрутов; в Task 8 в него добавляются остальные.
- Внутренние хелперы файла (в том же модуле, используются в Task 8): `GENERIC`, `str(v)`, `tooMany()`, `requireUser(c)`, `requireMail(c)`, `checkMailLimits(c, email)`, `queueMail(c, to, message)`.

- [ ] **Step 1: Написать падающие тесты**

`server/test/account.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');
const { createRateLimiter } = require('../auth');

const GOOD = { login: 'newbie', email: 'newbie@example.com', password: 'longenough1', consent: true };

function register(s, over = {}) {
  return s.api('POST', '/api/register', { body: { ...GOOD, ...over } });
}

async function registerAndVerify(s, over = {}) {
  await register(s, over);
  const res = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  return { res, cookie: res.headers.get('set-cookie').split(';')[0] };
}

test('register creates an unverified user and mails a verification link', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await register(s);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  const u = s.db.prepare("SELECT login, email, email_verified_at, role FROM users WHERE login = 'newbie'").get();
  assert.equal(u.email, 'newbie@example.com');
  assert.equal(u.email_verified_at, null);
  assert.equal(u.role, 'user');
  assert.equal(s.mailer.sent.length, 1);
  assert.equal(s.mailer.sent[0].to, 'newbie@example.com');
  assert.match(s.mailer.sent[0].text, /https:\/\/test\.local\/account#verify=[0-9a-f]{64}/);
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } });
  assert.equal(login.status, 403);
  assert.equal(login.json.error, 'email_not_verified');
});

test('verify-email confirms once, opens a session and the token cannot be reused', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { res, cookie } = await registerAndVerify(s);
  assert.equal(res.status, 200);
  assert.equal(res.json.user.login, 'newbie');
  assert.equal(res.json.user.emailVerified, true);
  const me = await s.api('GET', '/api/me', { cookie });
  assert.equal(me.json.user.login, 'newbie');
  assert.deepEqual(me.json.can, { map: false, category: false, feature: false });
  const again = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(again.status, 400);
  assert.equal(again.json.error, 'token_invalid');
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie@example.com', password: 'longenough1' } });
  assert.equal(login.status, 200);
});

test('an expired verification token is refused', async (t) => {
  const s = await startTestServer({ now: 1_000_000 });
  t.after(() => s.cleanup());
  await register(s);
  s.setNow(1_000_000 + 25 * 60 * 60 * 1000);
  const r = await s.api('POST', '/api/verify-email', { body: { token: s.lastToken('verify') } });
  assert.equal(r.status, 400);
});

test('validation errors carry stable codes', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const cases = [
    [{ login: 'ab' }, 'login_invalid'],
    [{ login: 'Admin' }, 'login_reserved'],
    [{ email: 'not-an-email' }, 'email_invalid'],
    [{ password: 'short' }, 'password_short'],
    [{ password: 'x'.repeat(5000) }, 'password_long'],
    [{ consent: false }, 'consent_required'],
    [{ consent: undefined }, 'consent_required'],
  ];
  for (const [over, code] of cases) {
    const r = await register(s, over);
    assert.equal(r.status, 400, JSON.stringify(over).slice(0, 60));
    assert.equal(r.json.error, code);
  }
  const eq = await register(s, { login: 'samename', password: 'SameName' });
  assert.equal(eq.json.error, 'password_equals_login');
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1, 'only the seeded admin exists');
  assert.equal(s.mailer.sent.length, 0);
});

test('non-object field types do not crash registration', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await s.api('POST', '/api/register', {
    body: { login: { $ne: 1 }, email: ['a@b.cc'], password: 123456789, consent: 'yes', website: 5 },
  });
  assert.equal(r.status, 400);
});

test('a taken login (any case) is reported; a taken email is not revealed', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s);
  const dupLogin = await register(s, { login: 'NEWBIE', email: 'other@example.com' });
  assert.equal(dupLogin.status, 409);
  assert.equal(dupLogin.json.error, 'login_taken');
  const before = s.mailer.sent.length;
  const dupEmail = await register(s, { login: 'another', email: ' NewBie@Example.com ' });
  assert.equal(dupEmail.status, 200);
  assert.deepEqual(dupEmail.json, { ok: true });
  assert.equal(s.mailer.sent.length, before, 'verified owner is not spammed');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'another'").get().n, 0);
});

test('registering again with the email of an unverified account re-sends the link', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  const first = s.lastToken('verify');
  const r = await register(s, { login: 'newbie' });
  assert.equal(r.status, 200);
  assert.equal(s.mailer.sent.length, 2);
  assert.notEqual(s.lastToken('verify'), first);
  assert.equal((await s.api('POST', '/api/verify-email', { body: { token: first } })).status, 400);
});

test('the honeypot field silently swallows bot registrations', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const r = await register(s, { website: 'http://spam.example' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { ok: true });
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'newbie'").get().n, 0);
  assert.equal(s.mailer.sent.length, 0);
});

test('registration is rate limited per IP and per email', async (t) => {
  const s = await startTestServer({ limiters: { registerIp: createRateLimiter({ max: 2, windowMs: 60000 }) } });
  t.after(() => s.cleanup());
  assert.equal((await register(s, { login: 'u1', email: 'u1@example.com' })).status, 200);
  assert.equal((await register(s, { login: 'u2', email: 'u2@example.com' })).status, 200);
  assert.equal((await register(s, { login: 'u3', email: 'u3@example.com' })).status, 429);
  const s2 = await startTestServer();
  t.after(() => s2.cleanup());
  for (let i = 0; i < 3; i++) {
    assert.equal((await register(s2, { login: 'same' + i, email: 'same@example.com' })).status, 200);
  }
  assert.equal((await register(s2, { login: 'same9', email: 'same@example.com' })).status, 429);
});

test('without a configured mailer registration answers 503 and creates nothing', async (t) => {
  const s = await startTestServer({ noMailer: true });
  t.after(() => s.cleanup());
  const r = await register(s);
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'mail_not_configured');
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'newbie'").get().n, 0);
  assert.equal((await s.api('POST', '/api/forgot-password', { body: { email: 'a@b.cc' } })).status, 503);
});

test('a failing mailer does not break registration or leak a rejection', async (t) => {
  t.mock.method(console, 'error', () => {});
  const failing = { configured: true, send: async () => { throw new Error('smtp down'); } };
  const s = await startTestServer({ mailer: failing });
  t.after(() => s.cleanup());
  const r = await register(s);
  assert.equal(r.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE login = 'newbie'").get().n, 1);
});

test('resend-verification gives the same answer for known and unknown addresses', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  const known = await s.api('POST', '/api/resend-verification', { body: { email: 'newbie@example.com' } });
  const unknown = await s.api('POST', '/api/resend-verification', { body: { email: 'ghost@example.com' } });
  assert.equal(known.status, 200);
  assert.deepEqual(known.json, unknown.json);
  assert.equal(s.mailer.sent.length, 2, 'only the real unverified address got a second mail');
  assert.equal(s.mailer.sent[1].to, 'newbie@example.com');
});

test('verify-email rejects malformed tokens without crashing', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  for (const token of [undefined, null, 5, { $ne: 1 }, [], '', 'short', 'A'.repeat(64), 'z'.repeat(64)]) {
    const r = await s.api('POST', '/api/verify-email', { body: { token } });
    assert.equal(r.status, 400, JSON.stringify(token));
    assert.equal(r.json.error, 'token_invalid');
  }
});

test('a normal verified user still cannot write to the map', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  const r = await s.api('POST', '/api/maps', { cookie, body: { slug: 'x', title: 'X' } });
  assert.equal(r.status, 403);
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `node --test server/test/account.test.js`
Expected: FAIL (маршруты не существуют, 404).

- [ ] **Step 3: Реализовать `server/routes/account.js`**

```js
'use strict';

const { HttpError, readJson } = require('../http-util');
const { hashPassword, createSession, sessionCookie } = require('../auth');
const { normalizeEmail, checkLogin, checkPassword } = require('../account-rules');
const { issueToken, consumeToken } = require('../tokens');
const { verifyEmailMessage } = require('../mail-templates');
const { meBody } = require('../me');

const GENERIC = { ok: true };

const str = (v) => (typeof v === 'string' ? v : '');
const tooMany = () => new HttpError(429, 'too many attempts, try again later');

function requireUser(c) {
  if (!c.user) throw new HttpError(401, 'login required');
  return c.user;
}

function requireMail(c) {
  if (!c.mailer.configured) throw new HttpError(503, 'mail_not_configured');
}

function checkMailLimits(c, email) {
  const now = c.now();
  if (!c.limiters.mailEmail.allow(email, now) || !c.limiters.mailIp.allow(c.ip, now)) throw tooMany();
}

// Fire and forget: the response must not depend on (or reveal) how long SMTP takes.
function queueMail(c, to, message) {
  Promise.resolve()
    .then(() => c.mailer.send({ to, ...message }))
    .catch((err) => console.error('mail send failed:', err.message));
}

function sendVerification(c, user) {
  const token = issueToken(c.db, user.id, 'verify_email', c.now());
  queueMail(c, user.email, verifyEmailMessage({ login: user.login, url: `${c.publicUrl}/account#verify=${token}` }));
}

const routes = [
  {
    method: 'POST',
    pattern: '/api/register',
    handler: async (c) => {
      requireMail(c);
      const now = c.now();
      if (!c.limiters.registerIp.allow(c.ip, now)) throw tooMany();
      const b = await readJson(c.req);
      if (typeof b.website === 'string' && b.website !== '') return { body: GENERIC }; // honeypot
      const login = str(b.login);
      const password = str(b.password);
      const email = normalizeEmail(b.email);
      const loginErr = checkLogin(login);
      if (loginErr) throw new HttpError(400, loginErr);
      if (!email) throw new HttpError(400, 'email_invalid');
      const passErr = checkPassword(password, login);
      if (passErr) throw new HttpError(400, passErr);
      if (b.consent !== true) throw new HttpError(400, 'consent_required');
      if (!c.limiters.registerEmail.allow(email, now)) throw tooMany();
      checkMailLimits(c, email);

      // Always pay for scrypt, so "email already registered" is not distinguishable by timing.
      const hash = hashPassword(password);
      const byEmail = c.db
        .prepare('SELECT id, login, email, email_verified_at FROM users WHERE lower(email) = ?')
        .get(email);
      if (byEmail) {
        if (!byEmail.email_verified_at) sendVerification(c, byEmail);
        return { body: GENERIC };
      }
      if (c.db.prepare('SELECT 1 FROM users WHERE lower(login) = lower(?)').get(login)) {
        throw new HttpError(409, 'login_taken');
      }
      let id;
      try {
        const r = c.db
          .prepare(
            `INSERT INTO users (login, password_hash, role, email, password_changed_at)
             VALUES (?, ?, 'user', ?, datetime('now'))`,
          )
          .run(login, hash, email);
        id = Number(r.lastInsertRowid);
      } catch (err) {
        if (/UNIQUE/i.test(String(err.message))) throw new HttpError(409, 'login_taken');
        throw err;
      }
      sendVerification(c, { id, login, email });
      return { body: GENERIC };
    },
  },
  {
    method: 'POST',
    pattern: '/api/verify-email',
    handler: async (c) => {
      const b = await readJson(c.req);
      const userId = consumeToken(c.db, b.token, 'verify_email', c.now());
      if (userId === null) throw new HttpError(400, 'token_invalid');
      c.db
        .prepare("UPDATE users SET email_verified_at = datetime('now') WHERE id = ? AND email_verified_at IS NULL")
        .run(userId);
      const user = c.db.prepare('SELECT id, login, role FROM users WHERE id = ?').get(userId);
      const session = createSession(c.db, userId, c.now(), undefined, c.clientMeta);
      c.headers['Set-Cookie'] = sessionCookie(session, { secure: c.cookieSecure });
      return { body: meBody(c.db, user) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/resend-verification',
    handler: async (c) => {
      requireMail(c);
      const b = await readJson(c.req);
      const email = normalizeEmail(b.email);
      if (!email) throw new HttpError(400, 'email_invalid');
      checkMailLimits(c, email);
      const user = c.db
        .prepare('SELECT id, login, email, email_verified_at FROM users WHERE lower(email) = ?')
        .get(email);
      if (user && !user.email_verified_at) sendVerification(c, user);
      return { body: GENERIC };
    },
  },
];

module.exports = routes;
```

- [ ] **Step 4: Подключить модуль в `server/app.js`**

```js
const ROUTE_MODULES = [
  require('./routes/auth'),
  require('./routes/account'),
  require('./routes/content'),
  require('./routes/images'),
];
```

- [ ] **Step 5: Запустить тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/account.js server/app.js server/test/account.test.js
git commit -m "feat(accounts): registration, email verification and resend"
```

---

### Task 8: Сброс и смена пароля, список и завершение сессий

**Files:**
- Modify: `server/routes/account.js`
- Test: `server/test/account.test.js` (дописать)

**Interfaces:**
- Consumes: хелперы Task 7, `peekToken`, `revokeTokens` (Task 3), `resetPasswordMessage` (Task 4), `sessionId`, `sha256`, `clearCookie` из `server/auth.js`.
- Produces: `POST /api/forgot-password`, `POST /api/reset-password`, `POST /api/change-password`, `GET /api/sessions`, `DELETE /api/sessions/:id`, `POST /api/sessions/revoke-others`.
  - `GET /api/sessions` → `{ sessions: [{ id, createdAt, lastSeenAt, ip, userAgent, current }] }` (время в мс).

- [ ] **Step 1: Дописать падающие тесты в `server/test/account.test.js`**

```js
const { createUser } = require('../auth');

test('forgot-password answers identically and mails only a known address', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s);
  const before = s.mailer.sent.length;
  const known = await s.api('POST', '/api/forgot-password', { body: { email: 'NewBie@example.com' } });
  const unknown = await s.api('POST', '/api/forgot-password', { body: { email: 'ghost@example.com' } });
  assert.equal(known.status, 200);
  assert.deepEqual(known.json, unknown.json);
  assert.equal(s.mailer.sent.length, before + 1);
  assert.match(s.mailer.sent[before].text, /#reset=[0-9a-f]{64}/);
});

test('reset-password sets a new password, closes every session and burns the token', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const token = s.lastToken('reset');
  const tooShort = await s.api('POST', '/api/reset-password', { body: { token, password: 'short' } });
  assert.equal(tooShort.json.error, 'password_short');
  const sameAsLogin = await s.api('POST', '/api/reset-password', { body: { token, password: 'NewBie' + 'xx' } });
  assert.equal(sameAsLogin.status, 400, 'a rejected password does not burn the token');
  const ok = await s.api('POST', '/api/reset-password', { body: { token, password: 'brand-new-pass' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('set-cookie'), null, 'reset does not log the user in');
  assert.equal((await s.api('GET', '/api/me', { cookie })).json.user, null);
  const reuse = await s.api('POST', '/api/reset-password', { body: { token, password: 'another-pass-1' } });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.json.error, 'token_invalid');
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'brand-new-pass' } });
  assert.equal(login.status, 200);
});

test('reset-password with a valid token marks an unverified address verified', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await register(s);
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const r = await s.api('POST', '/api/reset-password', { body: { token: s.lastToken('reset'), password: 'fresh-password-1' } });
  assert.equal(r.status, 200);
  const login = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'fresh-password-1' } });
  assert.equal(login.status, 200);
});

test('reset-password rejects huge passwords and malformed tokens', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  await registerAndVerify(s);
  await s.api('POST', '/api/forgot-password', { body: { email: 'newbie@example.com' } });
  const token = s.lastToken('reset');
  const big = await s.api('POST', '/api/reset-password', { body: { token, password: 'p'.repeat(5000) } });
  assert.equal(big.json.error, 'password_long');
  for (const bad of [undefined, 7, { $ne: 1 }, 'nope']) {
    const r = await s.api('POST', '/api/reset-password', { body: { token: bad, password: 'fresh-password-1' } });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'token_invalid');
  }
  const ok = await s.api('POST', '/api/reset-password', { body: { token, password: 'fresh-password-1' } });
  assert.equal(ok.status, 200, 'rejected attempts did not burn the token');
});

test('change-password needs the current password and keeps only the current session', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  const second = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } });
  const otherCookie = second.headers.get('set-cookie').split(';')[0];
  assert.equal((await s.api('POST', '/api/change-password', { body: { current: 'longenough1', next: 'x' } })).status, 401);
  const wrong = await s.api('POST', '/api/change-password', { cookie, body: { current: 'wrong-wrong', next: 'new-password-1' } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.json.error, 'current_password_wrong');
  const short = await s.api('POST', '/api/change-password', { cookie, body: { current: 'longenough1', next: 'tiny' } });
  assert.equal(short.json.error, 'password_short');
  const huge = await s.api('POST', '/api/change-password', { cookie, body: { current: 'longenough1', next: 'p'.repeat(5000) } });
  assert.equal(huge.json.error, 'password_long');
  const ok = await s.api('POST', '/api/change-password', { cookie, body: { current: 'longenough1', next: 'new-password-1' } });
  assert.equal(ok.status, 200);
  assert.equal((await s.api('GET', '/api/me', { cookie })).json.user.login, 'newbie');
  assert.equal((await s.api('GET', '/api/me', { cookie: otherCookie })).json.user, null);
  assert.equal((await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } })).status, 401);
  assert.equal((await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'new-password-1' } })).status, 200);
});

test('sessions: list marks the current one, single and bulk revoke work', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  const other = await s.api('POST', '/api/login', {
    body: { login: 'newbie', password: 'longenough1' },
    headers: { 'user-agent': 'Phone/2' },
  });
  const otherCookie = other.headers.get('set-cookie').split(';')[0];
  const list = await s.api('GET', '/api/sessions', { cookie });
  assert.equal(list.status, 200);
  assert.equal(list.json.sessions.length, 2);
  const current = list.json.sessions.filter((x) => x.current);
  assert.equal(current.length, 1);
  const phone = list.json.sessions.find((x) => x.userAgent === 'Phone/2');
  assert.match(phone.id, /^[0-9a-f]{16}$/);
  assert.equal(phone.current, false);

  const del = await s.api('DELETE', '/api/sessions/' + phone.id, { cookie });
  assert.equal(del.status, 200);
  assert.equal((await s.api('GET', '/api/me', { cookie: otherCookie })).json.user, null);
  assert.equal((await s.api('DELETE', '/api/sessions/' + phone.id, { cookie })).status, 404);
  assert.equal((await s.api('DELETE', '/api/sessions/not-an-id', { cookie })).status, 400);

  const third = await s.api('POST', '/api/login', { body: { login: 'newbie', password: 'longenough1' } });
  const thirdCookie = third.headers.get('set-cookie').split(';')[0];
  const bulk = await s.api('POST', '/api/sessions/revoke-others', { cookie });
  assert.equal(bulk.status, 200);
  assert.equal((await s.api('GET', '/api/me', { cookie: thirdCookie })).json.user, null);
  assert.equal((await s.api('GET', '/api/me', { cookie })).json.user.login, 'newbie');
});

test("a user cannot revoke another user's session", async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  const { cookie } = await registerAndVerify(s);
  createUser(s.db, { login: 'victim', password: 'victim-pass-1', role: 'user', email: 'v@example.com' });
  const v = await s.api('POST', '/api/login', { body: { login: 'victim', password: 'victim-pass-1' } });
  const vCookie = v.headers.get('set-cookie').split(';')[0];
  const vList = await s.api('GET', '/api/sessions', { cookie: vCookie });
  const victimSessionId = vList.json.sessions[0].id;
  const r = await s.api('DELETE', '/api/sessions/' + victimSessionId, { cookie });
  assert.equal(r.status, 404);
  assert.equal((await s.api('GET', '/api/me', { cookie: vCookie })).json.user.login, 'victim');
});

test('sessions endpoints require a login', async (t) => {
  const s = await startTestServer();
  t.after(() => s.cleanup());
  assert.equal((await s.api('GET', '/api/sessions')).status, 401);
  assert.equal((await s.api('POST', '/api/sessions/revoke-others')).status, 401);
  assert.equal((await s.api('POST', '/api/change-password', { body: {} })).status, 401);
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `node --test server/test/account.test.js`
Expected: FAIL (новые маршруты отсутствуют).

- [ ] **Step 3: Реализовать маршруты**

В `server/routes/account.js` обновить импорты:

```js
const { hashPassword, verifyPassword, createSession, sessionCookie, clearCookie, sha256 } = require('../auth');
const { issueToken, peekToken, consumeToken } = require('../tokens');
const { verifyEmailMessage, resetPasswordMessage } = require('../mail-templates');
```

и вставить перед `module.exports = routes;` дополнительные маршруты (через `routes.push`):

```js
function closeSessions(c, userId, exceptToken) {
  if (exceptToken) {
    c.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, sha256(exceptToken));
  } else {
    c.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

routes.push(
  {
    method: 'POST',
    pattern: '/api/forgot-password',
    handler: async (c) => {
      requireMail(c);
      const b = await readJson(c.req);
      const email = normalizeEmail(b.email);
      if (!email) throw new HttpError(400, 'email_invalid');
      checkMailLimits(c, email);
      const user = c.db.prepare('SELECT id, login, email FROM users WHERE lower(email) = ?').get(email);
      if (user) {
        const token = issueToken(c.db, user.id, 'reset_password', c.now());
        queueMail(c, user.email, resetPasswordMessage({ login: user.login, url: `${c.publicUrl}/account#reset=${token}` }));
      }
      return { body: GENERIC };
    },
  },
  {
    method: 'POST',
    pattern: '/api/reset-password',
    handler: async (c) => {
      const b = await readJson(c.req);
      const password = str(b.password);
      // Peek first: a rejected password must not burn the one-time token.
      const userId = peekToken(c.db, b.token, 'reset_password', c.now());
      if (userId === null) throw new HttpError(400, 'token_invalid');
      const user = c.db.prepare('SELECT id, login FROM users WHERE id = ?').get(userId);
      const passErr = checkPassword(password, user.login);
      if (passErr) throw new HttpError(400, passErr);
      if (consumeToken(c.db, b.token, 'reset_password', c.now()) === null) throw new HttpError(400, 'token_invalid');
      c.db
        .prepare(
          `UPDATE users SET password_hash = ?, password_changed_at = datetime('now'),
             email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?`,
        )
        .run(hashPassword(password), userId);
      closeSessions(c, userId, null);
      return { body: GENERIC };
    },
  },
  {
    method: 'POST',
    pattern: '/api/change-password',
    handler: async (c) => {
      const user = requireUser(c);
      const b = await readJson(c.req);
      const next = str(b.next);
      const passErr = checkPassword(next, user.login);
      if (passErr) throw new HttpError(400, passErr);
      // Same budget as login: a stolen session must not be able to brute-force the current password.
      if (!c.limiters.loginAccount.allow('acct:' + user.login.toLowerCase(), c.now())) throw tooMany();
      const row = c.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
      if (!verifyPassword(str(b.current), row.password_hash)) throw new HttpError(400, 'current_password_wrong');
      c.db
        .prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?")
        .run(hashPassword(next), user.id);
      closeSessions(c, user.id, c.token);
      return { body: GENERIC };
    },
  },
  {
    method: 'GET',
    pattern: '/api/sessions',
    handler: async (c) => {
      const user = requireUser(c);
      const currentHash = sha256(c.token);
      const rows = c.db
        .prepare(
          `SELECT token_hash, created_at, last_seen_at, ip, user_agent FROM sessions
           WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC, created_at DESC`,
        )
        .all(user.id, c.now());
      return {
        body: {
          sessions: rows.map((r) => ({
            id: r.token_hash.slice(0, 16),
            createdAt: r.created_at,
            lastSeenAt: r.last_seen_at,
            ip: r.ip,
            userAgent: r.user_agent,
            current: r.token_hash === currentHash,
          })),
        },
      };
    },
  },
  {
    method: 'POST',
    pattern: '/api/sessions/revoke-others',
    handler: async (c) => {
      const user = requireUser(c);
      closeSessions(c, user.id, c.token);
      return { body: GENERIC };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/sessions/:id',
    handler: async (c) => {
      const user = requireUser(c);
      if (!/^[0-9a-f]{16}$/.test(c.params.id)) throw new HttpError(400, 'bad session id');
      const r = c.db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND substr(token_hash, 1, 16) = ?')
        .run(user.id, c.params.id);
      if (r.changes === 0) throw new HttpError(404, 'not found');
      if (c.params.id === sha256(c.token).slice(0, 16)) {
        c.headers['Set-Cookie'] = clearCookie({ secure: c.cookieSecure });
      }
      return { body: GENERIC };
    },
  },
);
```

- [ ] **Step 4: Запустить полный набор**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/account.js server/test/account.test.js
git commit -m "feat(accounts): password reset and change, session list and revoke"
```

---

### Task 9: Прод-зависимости локального сервера: статика `/account` и `/privacy`, CLI смены пароля админа

В `server/static.js` (dev-статика) нужны чистые адреса новых страниц, а у админа до сих пор нет команды смены пароля (она закрывает пункт из «не сделано»).

**Files:**
- Modify: `server/static.js`
- Modify: `server/cli.js`
- Test: `server/test/static-account.test.js`, `server/test/set-password.test.js`

**Interfaces:**
- Produces: `/account` → `account.html`, `/privacy` → `privacy.html` в dev-статике; `node server/cli.js set-password <login>` (пароль из `ANOMA_PASSWORD`) — ставит новый пароль и закрывает сессии пользователя; экспорт `setPassword(db, login, password)` из `server/auth.js`.

- [ ] **Step 1: Падающие тесты**

`server/test/static-account.test.js`:

```js
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
```

`server/test/set-password.test.js` (тестируем функцию, а не процесс):

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const { createUser, createSession, getSessionUser, setPassword, verifyPassword } = require('../auth');

test('setPassword replaces the hash and closes the user sessions', () => {
  const db = openDb(':memory:');
  const uid = createUser(db, { login: 'admin', password: 'old-password-1', role: 'admin' });
  const token = createSession(db, uid, 1000);
  setPassword(db, 'ADMIN', 'new-password-1');
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(uid);
  assert.equal(verifyPassword('new-password-1', row.password_hash), true);
  assert.equal(verifyPassword('old-password-1', row.password_hash), false);
  assert.equal(getSessionUser(db, token, 2000), null);
  assert.throws(() => setPassword(db, 'ghost', 'new-password-1'), /not found/);
  assert.throws(() => setPassword(db, 'admin', 'short'), /at least 8/);
});
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `node --test server/test/static-account.test.js server/test/set-password.test.js`
Expected: FAIL.

- [ ] **Step 3: Реализация**

В `server/static.js` после строки `if (pathname === '/map') pathname = '/map.html';` добавить:

```js
    if (pathname === '/account') pathname = '/account.html';
    if (pathname === '/privacy') pathname = '/privacy.html';
```

В `server/auth.js` добавить функцию и экспорт `setPassword`:

```js
function setPassword(db, login, password) {
  if (typeof password !== 'string' || password.length < 8) throw new Error('password must be at least 8 characters');
  const row = db.prepare('SELECT id FROM users WHERE lower(login) = lower(?)').get(String(login));
  if (!row) throw new Error('user not found: ' + login);
  db.prepare("UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?").run(
    hashPassword(password),
    row.id,
  );
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
}
```

(добавить `setPassword` и `verifyPassword` уже в экспорте).

В `server/cli.js`: импорт `setPassword`, строка usage `'  ANOMA_PASSWORD=<password> node server/cli.js set-password <login>\n'` и ветка:

```js
  } else if (cmd === 'set-password') {
    const [login] = args;
    const password = process.env.ANOMA_PASSWORD;
    if (!login || !password) usage();
    setPassword(db, login, password);
    console.log(`password for "${login}" changed, sessions closed`);
```

(вставить перед веткой `seed-map`; добавить `setPassword` в `require('./auth')`).

- [ ] **Step 4: Запустить тесты**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/static.js server/cli.js server/auth.js server/test/static-account.test.js server/test/set-password.test.js
git commit -m "feat(accounts): dev static routes for /account and /privacy, set-password CLI"
```

---

### Task 10: Страница `/account` и `/privacy`

**Files:**
- Create: `account.html`, `account.css`, `account.js`, `privacy.html`

**Interfaces:**
- Consumes: `window.MapApi` и `window.h` из `map-common.js`; API из Task 6–8.
- Produces: страница `/account` с состояниями из спека: гость (вход/регистрация/«забыли пароль»), «проверьте почту», подтверждение `#verify=`, сброс `#reset=`, профиль (смена пароля, сессии, выход). Читает `?next=` и возвращает пользователя только на путь, начинающийся с одного `/`.

- [ ] **Step 1: `account.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>Аккаунт — ANOMA WIKI</title>
<link rel="icon" href="/favicon.jpg" type="image/jpeg">
<!-- Yandex.Metrika counter (webvisor off: this page holds password forms) -->
<script type="text/javascript">
    (function(m,e,t,r,i,k,a){
        m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)
    })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id=112397124', 'ym');

    ym(112397124, 'init', {ssr:true, webvisor:false, clickmap:false, referrer: document.referrer, url: location.origin + location.pathname, accurateTrackBounce:true});
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/112397124" style="position:absolute; left:-9999px;" alt="" /></div></noscript>
<!-- /Yandex.Metrika counter -->
<link rel="stylesheet" href="/account.css">
</head>
<body>
<header class="bar">
  <a class="brand" href="/">&larr; ANOMA WIKI</a>
  <span class="grow"></span>
  <a href="/map">Карта</a>
</header>
<main class="card" id="app">
  <p class="muted">Загрузка…</p>
</main>
<noscript><p class="card">Для работы страницы нужен JavaScript.</p></noscript>
<script src="/map-common.js"></script>
<script src="/account.js"></script>
</body>
</html>
```

Метрика передаёт `url: location.origin + location.pathname`, чтобы токены из фрагмента и параметры не уходили в аналитику.

- [ ] **Step 2: `account.css`**

```css
:root {
  --bg: #121212; --panel: #1b1b18; --border: #33322a; --text: #e9e6d8;
  --muted: #9a9a86; --accent: #d4c24f; --danger: #c8553d; --ok: #7fb069;
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
a { color: var(--accent); }
.bar { display: flex; gap: 12px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--panel); }
.bar .brand { font-weight: 700; letter-spacing: 1px; text-decoration: none; }
.grow { flex: 1; }
.card { max-width: 520px; margin: 24px auto; padding: 20px; background: var(--panel); border: 1px solid var(--border); border-radius: 10px; }
@media (max-width: 560px) { .card { margin: 12px 16px; padding: 16px; } }
h1 { font-size: 22px; margin: 0 0 12px; }
h2 { font-size: 17px; margin: 22px 0 8px; }
.tabs { display: flex; gap: 8px; margin-bottom: 12px; }
.tabs button { flex: 1; }
label { display: block; margin: 10px 0; }
input[type=text], input[type=email], input[type=password] {
  width: 100%; padding: 9px 10px; margin-top: 4px; background: #101010; color: var(--text);
  border: 1px solid var(--border); border-radius: 6px; font: inherit;
}
input:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
button { padding: 9px 14px; background: #23221c; color: var(--text); border: 1px solid var(--border); border-radius: 6px; font: inherit; cursor: pointer; }
button.primary, button.on { background: var(--accent); color: #151510; border-color: var(--accent); font-weight: 600; }
button:disabled { opacity: .55; cursor: default; }
.err { color: var(--danger); min-height: 1.4em; margin: 6px 0; }
.ok { color: var(--ok); }
.muted { color: var(--muted); }
.check { display: flex; gap: 8px; align-items: flex-start; }
.check input { margin-top: 5px; }
.hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.links { display: flex; justify-content: space-between; margin-top: 12px; font-size: 14px; }
.links button { background: none; border: 0; padding: 0; color: var(--accent); text-decoration: underline; }
.sessions { list-style: none; padding: 0; margin: 0; }
.sessions li { display: flex; gap: 10px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); }
.sessions .what { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.sessions .when { font-size: 13px; color: var(--muted); }
.badge { font-size: 12px; color: #151510; background: var(--accent); border-radius: 4px; padding: 1px 6px; }
.row { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; }
```

- [ ] **Step 3: `account.js`**

```js
(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var app = document.getElementById('app');

  var MESSAGES = {
    login_taken: 'Этот логин уже занят.',
    login_invalid: 'Логин: 3–32 символа — латинские буквы, цифры, _ . -',
    login_reserved: 'Этот логин зарезервирован, выберите другой.',
    email_invalid: 'Проверьте адрес почты.',
    password_short: 'Пароль: минимум 8 символов.',
    password_long: 'Пароль: максимум 128 символов.',
    password_equals_login: 'Пароль не должен совпадать с логином.',
    consent_required: 'Нужно согласие на обработку персональных данных.',
    token_invalid: 'Ссылка недействительна или уже использована.',
    current_password_wrong: 'Текущий пароль указан неверно.',
    mail_not_configured: 'Регистрация временно недоступна. Загляните позже.',
    'invalid login or password': 'Неверный логин или пароль.',
    email_not_verified: 'Почта ещё не подтверждена.',
  };

  function errorText(ex) {
    if (ex && ex.status === 429) return 'Слишком много попыток, попробуйте чуть позже.';
    return (ex && MESSAGES[ex.message]) || 'Что-то пошло не так. Попробуйте ещё раз.';
  }

  // Only same-site absolute paths: "/map?m=a" yes, "//evil", "/\evil", "http://…" no.
  function safeNext() {
    var next = new URLSearchParams(location.search).get('next');
    if (!next || !/^\/(?![\/\\])/.test(next) || /[\u0000-\u001f]/.test(next)) return null;
    return next;
  }

  function show() {
    app.textContent = '';
    for (var i = 0; i < arguments.length; i++) app.appendChild(arguments[i]);
  }

  function field(label, attrs) {
    var input = h('input', attrs);
    return { el: h('label', null, label, input), input: input };
  }

  // Disables the submit button while the request runs and prints errors into errEl.
  function bind(formEl, errEl, work) {
    formEl.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = formEl.querySelector('button[type=submit]');
      errEl.textContent = '';
      btn.disabled = true;
      Promise.resolve()
        .then(work)
        .catch(function (ex) { errEl.textContent = errorText(ex); })
        .then(function () { btn.disabled = false; });
    });
  }

  function afterLogin(me) {
    var next = safeNext();
    if (next) location.href = next;
    else showProfile(me);
  }

  // ---------- guest ----------

  function showGuest(tab) {
    var tabs = h('div', { class: 'tabs' },
      h('button', { type: 'button', class: tab === 'login' ? 'on' : '', onclick: function () { showGuest('login'); } }, 'Вход'),
      h('button', { type: 'button', class: tab === 'register' ? 'on' : '', onclick: function () { showGuest('register'); } }, 'Регистрация'));
    show(h('h1', null, 'Аккаунт'), tabs, tab === 'register' ? registerForm() : loginForm());
  }

  function loginForm() {
    var login = field('Логин или почта', { name: 'login', type: 'text', autocomplete: 'username', required: true });
    var pass = field('Пароль', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null, login.el, pass.el, err, h('button', { type: 'submit', class: 'primary' }, 'Войти'),
      h('div', { class: 'links' },
        h('button', { type: 'button', onclick: showForgot }, 'Забыли пароль?')));
    bind(form, err, function () {
      return api.post('/api/login', { login: login.input.value, password: pass.input.value }).then(afterLogin, function (ex) {
        if (ex.message === 'email_not_verified') return showResend(login.input.value);
        throw ex;
      });
    });
    return form;
  }

  function registerForm() {
    var login = field('Логин (публичное имя)', { name: 'login', type: 'text', autocomplete: 'username', required: true, maxLength: 32 });
    var email = field('Почта (не показывается другим)', { name: 'email', type: 'email', autocomplete: 'email', required: true });
    var pass = field('Пароль (минимум 8 символов)', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 128 });
    var pass2 = field('Пароль ещё раз', { name: 'password2', type: 'password', autocomplete: 'new-password', required: true });
    var trap = h('input', { name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' });
    var consent = h('input', { type: 'checkbox', name: 'consent', required: true });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null,
      login.el, email.el, pass.el, pass2.el,
      h('div', { class: 'hp', 'aria-hidden': 'true' }, h('label', null, 'Не заполняйте это поле', trap)),
      h('label', { class: 'check' }, consent,
        h('span', null, 'Согласен на обработку персональных данных (', h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'политика'), ')')),
      err,
      h('button', { type: 'submit', class: 'primary' }, 'Зарегистрироваться'));
    bind(form, err, function () {
      if (pass.input.value !== pass2.input.value) { err.textContent = 'Пароли не совпадают.'; return null; }
      return api.post('/api/register', {
        login: login.input.value.trim(),
        email: email.input.value,
        password: pass.input.value,
        consent: consent.checked,
        website: trap.value,
      }).then(function () { showCheckMail(email.input.value.trim()); });
    });
    return form;
  }

  // ---------- mail states ----------

  function showCheckMail(email) {
    var info = h('p', { class: 'ok', role: 'status' });
    var btn = h('button', { type: 'button' }, 'Выслать письмо ещё раз');
    var wait = 0;
    function tick() {
      if (wait > 0) { btn.disabled = true; btn.textContent = 'Выслать ещё раз (' + wait + ' с)'; wait--; setTimeout(tick, 1000); }
      else { btn.disabled = false; btn.textContent = 'Выслать письмо ещё раз'; }
    }
    btn.addEventListener('click', function () {
      btn.disabled = true;
      api.post('/api/resend-verification', { email: email }).then(function () {
        info.textContent = 'Письмо отправлено повторно.';
        wait = 60; tick();
      }, function (ex) { info.textContent = errorText(ex); btn.disabled = false; });
    });
    wait = 60; tick();
    show(h('h1', null, 'Проверьте почту'),
      h('p', null, 'Мы отправили письмо со ссылкой на ', h('strong', null, email), '. Перейдите по ссылке, чтобы подтвердить адрес. Ссылка действует 24 часа.'),
      h('p', { class: 'muted' }, 'Не пришло? Проверьте «Спам».'),
      info, btn);
  }

  function showResend(prefill) {
    var email = field('Почта, указанная при регистрации', { name: 'email', type: 'email', autocomplete: 'email', required: true, value: prefill && prefill.indexOf('@') > 0 ? prefill : '' });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null, email.el, err, h('button', { type: 'submit', class: 'primary' }, 'Выслать письмо'));
    bind(form, err, function () {
      return api.post('/api/resend-verification', { email: email.input.value }).then(function () { showCheckMail(email.input.value.trim()); });
    });
    show(h('h1', null, 'Почта не подтверждена'), h('p', null, 'Войти можно только после подтверждения почты. Мы вышлем письмо ещё раз.'), form);
  }

  function showForgot() {
    var email = field('Почта', { name: 'email', type: 'email', autocomplete: 'email', required: true });
    var err = h('p', { class: 'err', role: 'alert' });
    var ok = h('p', { class: 'ok', role: 'status' });
    var form = h('form', null, email.el, err, ok, h('button', { type: 'submit', class: 'primary' }, 'Выслать ссылку'),
      h('div', { class: 'links' }, h('button', { type: 'button', onclick: function () { showGuest('login'); } }, '← Ко входу')));
    bind(form, err, function () {
      return api.post('/api/forgot-password', { email: email.input.value }).then(function () {
        ok.textContent = 'Если такой адрес зарегистрирован, мы отправили на него ссылку для сброса пароля.';
      });
    });
    show(h('h1', null, 'Сброс пароля'), form);
  }

  function showVerify(token) {
    show(h('h1', null, 'Подтверждение почты'), h('p', { class: 'muted' }, 'Проверяем ссылку…'));
    api.post('/api/verify-email', { token: token }).then(function (me) {
      afterLogin(me);
    }, function (ex) {
      var box = h('div', null, h('h1', null, 'Ссылка не сработала'), h('p', { class: 'err' }, errorText(ex)),
        h('div', { class: 'row' }, h('button', { type: 'button', class: 'primary', onclick: function () { showResend(''); } }, 'Выслать новую ссылку')));
      show(box);
    });
  }

  function showReset(token) {
    var pass = field('Новый пароль (минимум 8 символов)', { name: 'password', type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 128 });
    var pass2 = field('Новый пароль ещё раз', { name: 'password2', type: 'password', autocomplete: 'new-password', required: true });
    var err = h('p', { class: 'err', role: 'alert' });
    var form = h('form', null, pass.el, pass2.el, err, h('button', { type: 'submit', class: 'primary' }, 'Сохранить пароль'));
    bind(form, err, function () {
      if (pass.input.value !== pass2.input.value) { err.textContent = 'Пароли не совпадают.'; return null; }
      return api.post('/api/reset-password', { token: token, password: pass.input.value }).then(function () {
        show(h('h1', null, 'Пароль изменён'), h('p', { class: 'ok' }, 'Теперь войдите с новым паролем.'), loginForm());
      });
    });
    show(h('h1', null, 'Новый пароль'), form);
  }

  // ---------- profile ----------

  function fmt(ms) {
    return ms ? new Date(ms).toLocaleString('ru-RU') : '—';
  }

  function shortAgent(ua) {
    if (!ua) return 'Неизвестное устройство';
    var m = /(Firefox|Edg|OPR|Chrome|Safari)\/[\d.]+/.exec(ua);
    var os = /(Windows|Android|iPhone|iPad|Mac OS X|Linux)/.exec(ua);
    return (m ? m[1].replace('Edg', 'Edge').replace('OPR', 'Opera') : 'Браузер') + (os ? ' · ' + os[1] : '');
  }

  function showProfile(me) {
    var user = me.user;
    var list = h('ul', { class: 'sessions' }, h('li', { class: 'muted' }, 'Загрузка…'));

    function loadSessions() {
      api.get('/api/sessions').then(function (data) {
        list.textContent = '';
        data.sessions.forEach(function (s) {
          var row = h('li', null,
            h('div', { class: 'what' },
              h('div', null, shortAgent(s.userAgent), ' ', s.current ? h('span', { class: 'badge' }, 'эта') : null),
              h('div', { class: 'when' }, (s.ip || '—') + ' · вход ' + fmt(s.createdAt) + ' · активность ' + fmt(s.lastSeenAt || s.createdAt))));
          if (!s.current) {
            row.appendChild(h('button', { type: 'button', onclick: function () {
              api.del('/api/sessions/' + s.id).then(loadSessions);
            } }, 'Завершить'));
          }
          list.appendChild(row);
        });
      }, function () { list.textContent = 'Не удалось загрузить сессии.'; });
    }

    var cur = field('Текущий пароль', { name: 'current', type: 'password', autocomplete: 'current-password', required: true });
    var nw = field('Новый пароль', { name: 'next', type: 'password', autocomplete: 'new-password', required: true, minLength: 8, maxLength: 128 });
    var nw2 = field('Новый пароль ещё раз', { name: 'next2', type: 'password', autocomplete: 'new-password', required: true });
    var pwErr = h('p', { class: 'err', role: 'alert' });
    var pwOk = h('p', { class: 'ok', role: 'status' });
    var pwForm = h('form', null, cur.el, nw.el, nw2.el, pwErr, pwOk, h('button', { type: 'submit' }, 'Сменить пароль'));
    bind(pwForm, pwErr, function () {
      pwOk.textContent = '';
      if (nw.input.value !== nw2.input.value) { pwErr.textContent = 'Пароли не совпадают.'; return null; }
      return api.post('/api/change-password', { current: cur.input.value, next: nw.input.value }).then(function () {
        pwForm.reset();
        pwOk.textContent = 'Пароль изменён. Остальные устройства разлогинены.';
        loadSessions();
      });
    });

    var revoke = h('button', { type: 'button', onclick: function () {
      api.post('/api/sessions/revoke-others', {}).then(loadSessions);
    } }, 'Выйти на всех остальных устройствах');

    var logout = h('button', { type: 'button', class: 'primary', onclick: function () {
      api.post('/api/logout', {}).then(function () { showGuest('login'); });
    } }, 'Выйти');

    show(
      h('h1', null, user.login),
      h('p', { class: 'muted' }, user.email ? 'Почта: ' + user.email : 'Почта не указана'),
      user.role === 'admin' ? h('p', null, h('a', { href: '/map' }, 'Открыть карту (редактор)')) : h('p', null, h('a', { href: '/map' }, 'Открыть карту')),
      h('h2', null, 'Смена пароля'), pwForm,
      h('h2', null, 'Где выполнен вход'), list, h('div', { class: 'row' }, revoke),
      h('div', { class: 'row' }, logout));
    loadSessions();
  }

  // ---------- start ----------

  function start() {
    var m = /^#(verify|reset)=([0-9a-f]{64})$/.exec(location.hash);
    if (m) {
      // The token must not stay in the address bar, history or Referer.
      history.replaceState(null, '', location.pathname + location.search);
      if (m[1] === 'verify') showVerify(m[2]);
      else showReset(m[2]);
      return;
    }
    api.get('/api/me').then(function (me) {
      if (me && me.user) showProfile(me);
      else showGuest('login');
    }, function () { showGuest('login'); });
  }

  start();
})();
```

- [ ] **Step 4: `privacy.html`**

```html
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Политика обработки данных — ANOMA WIKI</title>
<link rel="icon" href="/favicon.jpg" type="image/jpeg">
<link rel="stylesheet" href="/account.css">
</head>
<body>
<header class="bar"><a class="brand" href="/">&larr; ANOMA WIKI</a></header>
<main class="card">
  <h1>Политика обработки персональных данных</h1>
  <p class="muted">Черновик. Текст нужно проверить и доработать владельцу сайта.</p>
  <h2>Какие данные мы храним</h2>
  <p>Логин, адрес электронной почты, хеш пароля (сам пароль не хранится), дату регистрации. Для каждого входа —
  IP-адрес, название браузера и время активности (чтобы вы могли видеть и завершать свои сессии).</p>
  <h2>Зачем</h2>
  <p>Чтобы вы могли войти на сайт, подтвердить почту, восстановить пароль и пользоваться функциями карты,
  доступными зарегистрированным пользователям. Данные не передаются третьим лицам, кроме почтового сервиса,
  который отправляет вам письма.</p>
  <h2>Cookie</h2>
  <p>Для входа используется один технический cookie сессии. Сайт также использует Яндекс.Метрику.</p>
  <h2>Как удалить данные</h2>
  <p>Напишите администратору сайта, и аккаунт будет удалён вместе с привязанными к нему личными данными.
  Неподтверждённые аккаунты удаляются автоматически через сутки.</p>
  <p><a href="/account">&larr; К аккаунту</a></p>
</main>
</body>
</html>
```

- [ ] **Step 5: Проверка в браузере (ручная)**

Запустить локально (см. «Локальная разработка» в `RELEASE.md`, добавив `MAIL_MODE=log`):

```bash
export ANOMA_DB=.dev/db/anoma.db ANOMA_UPLOADS=.dev/uploads COOKIE_SECURE=0 DEV_STATIC=. MAIL_MODE=log PUBLIC_URL=http://localhost:3000
ANOMA_PASSWORD=dev-password-1 node server/cli.js create-admin admin   # один раз, если БД новая
node server/index.js
```

Открыть `http://localhost:3000/account` и пройти:
1. Регистрация → страница «Проверьте почту»; в консоли сервера появилось письмо, ссылка вида `http://localhost:3000/account#verify=…`.
2. Открыть ссылку → вход выполнен, профиль виден, адрес очищен от `#verify=`.
3. «Выйти» → вход по логину и по почте работает; неверный пароль даёт «Неверный логин или пароль».
4. «Забыли пароль?» → письмо со ссылкой `#reset=…` → новый пароль → вход.
5. Открыть `/account?next=//evil.example` и `/account?next=/%5Cevil`, войти: должен остаться на странице профиля (редиректа нет). `/account?next=/map` после входа ведёт на `/map`.
6. Страница на ширине 375 px: без горизонтальной прокрутки, поля на всю ширину.

- [ ] **Step 6: Commit**

```bash
git add account.html account.css account.js privacy.html
git commit -m "feat(accounts): /account page and privacy policy draft"
```

---

### Task 11: Интеграция с сайтом (`index.html`, `map.html`)

**Files:**
- Create: `account-nav.js`
- Modify: `index.html`
- Modify: `map.html`
- Modify: `map-app.js` (функция `setupAuth`, ~строки 336–360)
- Modify: `map-app.css`

**Interfaces:**
- Consumes: `GET /api/me`.
- Produces: на `index.html` в навигации ссылки «Карта» и «Войти»/логин; на `map.html` кнопка `#auth-btn` ведёт на `/account` (с `?next=` для гостя), диалог входа удалён, кнопка видна и на телефоне.

- [ ] **Step 1: `account-nav.js`**

```js
(function () {
  'use strict';

  var links = document.querySelectorAll('[data-account-link]');
  if (!links.length || !window.fetch) return;
  fetch('/api/me', { credentials: 'same-origin' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (me) {
      if (!me || !me.user) return;
      Array.prototype.forEach.call(links, function (a) {
        a.textContent = me.user.login;
        a.title = 'Аккаунт';
      });
    })
    .catch(function () { /* stay with "Войти" */ });
})();
```

- [ ] **Step 2: `index.html`**

В `<nav class="site-nav">` перед строкой `<a class="cta" href="/art-calc">…` вставить:

```html
    <a href="/map">Карта</a>
    <a href="/account" data-account-link>Войти</a>
```

Перед закрывающим `</body>` добавить `<script src="/account-nav.js" defer></script>`.

- [ ] **Step 3: `map.html`**

Удалить весь блок `<dialog id="login-dlg" class="dlg">…</dialog>` (строки 51–62). В комментарии Метрики заменить «this page holds the editor and the login form» на «this page holds the editor».

- [ ] **Step 4: `map-app.js`**

Заменить функцию `setupAuth` целиком:

```js
  function setupAuth() {
    var btn = $('auth-btn');
    var user = state.me.user;
    btn.hidden = false;
    btn.textContent = user ? user.login : 'Войти';
    btn.title = user ? 'Аккаунт' : 'Вход и регистрация';
    btn.addEventListener('click', function () {
      location.href = user
        ? '/account'
        : '/account?next=' + encodeURIComponent(location.pathname + location.search);
    });
  }
```

- [ ] **Step 5: `map-app.css`**

Удалить правило `@media (max-width: 899px) { .auth-btn { display: none; } }` (строка ~128): кнопка входа теперь нужна и на телефоне, редактор по-прежнему грузится только на ПК (проверка `wantsEditor()`).

Если после удаления в `map-app.css` остались другие правила внутри того же `@media` — удалять только строку с `.auth-btn`.

- [ ] **Step 6: Проверка в браузере (ручная)**

С запущенным локальным сервером (см. Task 10):
1. `/` — в шапке «Карта» и «Войти»; после входа вместо «Войти» виден логин и ссылка ведёт на `/account`.
2. `/map` гостем — кнопка «Войти» ведёт на `/account?next=%2Fmap…`; после входа возвращает на карту с теми же параметрами `m` и `f`.
3. `/map` админом на ПК — редактор запускается как раньше; кнопка показывает логин `admin`.
4. `/map` на ширине 375 px — кнопка «Войти» видна, горизонтальной прокрутки нет.
5. В консоли браузера нет ошибок (`$('login-cancel')` и прочие ссылки на удалённый диалог в `map-app.js` отсутствуют).

- [ ] **Step 7: Запустить тесты и закоммитить**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

```bash
git add account-nav.js index.html map.html map-app.js map-app.css
git commit -m "feat(accounts): site integration — nav links, map login button"
```

---

### Task 12: Деплой-файлы, документация и статус проекта

**Files:**
- Modify: `server/deploy/nginx-map.conf`
- Modify: `server/deploy/nginx-limits.conf`
- Modify: `server/deploy/anoma-api.service`
- Modify: `RELEASE.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-10-11-user-accounts-design.md`

**Interfaces:**
- Produces: готовые конфиги и инструкция; ничего не применяется на VPS автоматически (`server/deploy/*` rsync-ом не выкладывается).

- [ ] **Step 1: `server/deploy/nginx-limits.conf`**

Добавить строку:

```nginx
# Registration / password-reset / resend endpoints: mail-sending abuse protection (the app limits too).
limit_req_zone $binary_remote_addr zone=anoma_register:10m rate=10r/m;
```

- [ ] **Step 2: `server/deploy/nginx-map.conf`**

Перед `location /api/ {` вставить:

```nginx
    location = /account {
        try_files /account.html =404;
    }

    location = /privacy {
        try_files /privacy.html =404;
    }

    location ~ ^/api/(register|forgot-password|resend-verification)$ {
        limit_req zone=anoma_register burst=5 nodelay;
        client_max_body_size 8m;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
```

Примечание: regex-`location` проверяется после точных и `^~`, но раньше обычного префикса `location /api/`, так что порядок в файле здесь безопасен.

- [ ] **Step 3: `server/deploy/anoma-api.service`**

В секцию `[Service]` после строк `Environment=…` добавить:

```ini
# SMTP and MAIL_MODE live here (root:root 0600). The "-" makes the file optional.
EnvironmentFile=-/etc/anoma/api.env
Environment=PUBLIC_URL=https://anoma-wiki.ru
```

- [ ] **Step 4: `RELEASE.md`**

Добавить раздел (после «Карта-редактор», перед «Откат»):

```markdown
## Аккаунты пользователей и почта

Спек: `docs/superpowers/specs/2026-10-11-user-accounts-design.md`.

**Что нужно подготовить один раз (владелец сайта):**
1. Почтовый ящик `noreply@anoma-wiki.ru` у провайдера с SMTP (Яндекс 360 для домена, Mail.ru для бизнеса и т.п.).
2. В DNS домена: SPF, DKIM (ключ даёт провайдер) и желательно DMARC. Без них письма уйдут в спам.
3. На VPS создать `/etc/anoma/api.env` (владелец `root`, права `0600`):

       MAIL_MODE=smtp
       SMTP_HOST=smtp.example.com
       SMTP_PORT=465
       SMTP_USER=noreply@anoma-wiki.ru
       SMTP_PASS=<пароль ящика>
       MAIL_FROM=noreply@anoma-wiki.ru

4. Обновить на VPS `anoma-api.service` (из `server/deploy/`), nginx (`nginx-map.conf`, `nginx-limits.conf`),
   затем `sudo systemctl daemon-reload && sudo nginx -t && sudo systemctl reload nginx && sudo systemctl restart anoma-api`.
5. Перед первым деплоем с миграцией снять бэкап БД (`sudo /usr/local/bin/anoma-backup.sh`).

**Проверка на проде:** зарегистрироваться тестовым аккаунтом, убедиться, что письмо пришло во «Входящие»
(не в «Спам»), перейти по ссылке, войти, выйти, пройти «Забыли пароль?».

**Пока почта не настроена:** `MAIL_MODE` не задан, регистрация и сброс пароля отвечают 503, вход админа
и карта работают как раньше.

**Смена пароля админа:** `ANOMA_PASSWORD=<новый> node /opt/anoma-api/cli.js set-password admin`
(закрывает все сессии этого пользователя).

**Локально:** добавить `MAIL_MODE=log PUBLIC_URL=http://localhost:3000` — письма печатаются в консоль сервера.

**Откат:** убрать `MAIL_MODE` из `/etc/anoma/api.env` и перезапустить сервис — регистрация отключится.
Миграция БД обратима только из бэкапа; новые колонки старый код игнорирует.
```

В блок «Локальная разработка» добавить в `export …` переменные `MAIL_MODE=log PUBLIC_URL=http://localhost:3000`.

- [ ] **Step 5: `CLAUDE.md`**

В «Статус проекта» (дата 2026-10-11): в «Сделано» добавить пункт «Аккаунты обычных пользователей (этап A): регистрация, подтверждение почты, вход по логину или почте, сброс и смена пароля, список сессий, страница `/account`; спек и план — `docs/superpowers/specs|plans/2026-10-11-user-accounts*`»; в «Не сделано» убрать пункт про команду смены пароля админа и про ссылку на `/map` на `index.html`, заменить пункт про аккаунты на «Этап C: личные метки; этап B: предложения точек с модерацией; смена почты, самоудаление аккаунта, соцсети, 2FA»; добавить «Настроить SMTP и DNS (SPF/DKIM) на проде, см. `RELEASE.md`». В списке «Files» добавить `account.html`, `account.js`, `account.css`, `account-nav.js`, `privacy.html`, и в описание `server/` — `mailer.js`, `tokens.js`, `routes/account.js`.

- [ ] **Step 6: Привести спек к реализации**

В `docs/superpowers/specs/2026-10-11-user-accounts-design.md`:
- таблица `POST /api/register`: тело `login, email, password, consent, website`; `consent` должно быть `true`, иначе 400 `consent_required`;
- «Остальной сайт»: `account-nav.js` подключён только в `index.html`; на `map.html` кнопка `#auth-btn` использует уже полученный `/api/me`; добавить «на телефоне кнопка входа на карте теперь видна»;
- «Вне объёма»: убрать «смена пароля админа» из упоминаний, добавить `cli.js set-password`;
- строка в «Правила» про вход: «неподтверждённому — `email_not_verified` только при верном пароле».

- [ ] **Step 7: Полная проверка и commit**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS (все тесты).

```bash
git add server/deploy RELEASE.md CLAUDE.md docs/superpowers/specs/2026-10-11-user-accounts-design.md
git commit -m "docs(accounts): deploy configs, release notes, project status, spec sync"
```

- [ ] **Step 8: Выкладка на VPS (только по явной команде владельца)**

Эти действия трогают прод и требуют подтверждения. Исполнитель останавливается и спрашивает владельца: готов ли ящик и DNS, можно ли обновить unit и nginx, можно ли слить `map-editor-spec` → `master` (деплой по пушу в `master` выкатит и карту, и аккаунты). До подтверждения ничего не пушить и по SSH не ходить.

---

## Самопроверка плана по спеку

- **Данные и миграция** — Task 1 (колонки, индексы, `auth_tokens`, версия схемы, миграция админа как подтверждённого), очистка — Task 3, расписание очистки — Task 5.
- **API** — регистрация/подтверждение/повтор: Task 7; сброс/смена пароля/сессии: Task 8; вход по почте и лимитер аккаунта: Task 6. Единые ответы, одинаковое время (scrypt всегда считается), правила логина/пароля/почты, резерв имён: Task 2 и 7.
- **Почта** — Task 4 (интерфейс, SMTP-клиент, log/memory, шаблоны, таймауты, защита от инъекции), конфиг и 503 без почты: Task 5 и 7, сбой отправки не ломает регистрацию: Task 7.
- **Безопасность** — атомарные одноразовые токены (Task 3), лимиты (Task 5–8), токен во фрагменте и очистка адреса (Task 10), `textContent` через `h()` (Task 10), IP из nginx (Task 12, уже в конфиге).
- **152-ФЗ** — чекбокс и `/privacy` (Task 10).
- **Интерфейс** — Task 10–11.
- **Тесты** — перечень из спека покрыт Tasks 1–9; страница проверяется вручную (Task 10–11).
- **Деплой** — Task 12.
- **Отклонения от спека, внесённые сознательно:** поле `consent` в API (серверная проверка согласия); `account-nav.js` только на `index.html`; команда `set-password` добавлена, так как закрывает пункт «не сделано»; кнопка входа на карте видна на телефоне. Все четыре синхронизируются в спек на шаге 6 задачи 12.
