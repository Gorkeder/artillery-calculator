# Тактическая карта кланов (этап 2: планы, опрос, карандаш и ластик) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Участники клана открывают на `/map` режим «Тактика», видят активный план клана и обновления раз в 15 с; те, у кого есть право, рисуют карандашом и стирают ластиком рисунки своих отрядов.

**Architecture:** Миграция 7 добавляет `tactic_plans` и `tactic_items`. SQL — `server/tactic-repo.js`, проверка ввода — `server/tactic-validate.js`, маршруты — `server/routes/tactics.js`; права берутся из `server/clan-permissions.js` (`memberContext`, `has`, `drawScopeAllowed`), общие хелперы — из `server/clan-http.js`. Версия плана растёт в той же транзакции, что и любая правка; `GET /api/plans/:publicId` отдаёт `ETag: "v<version>"` и отвечает `304` без выборки рисунков. Фронтенд — два файла в стиле `map-marks*.js`: `map-tactics.js` (слой, опрос, панель плана, фильтр отрядов; грузится всем, у кого есть `tactics_view`) и `map-tactics-editor.js` (карандаш и ластик, грузится только на ПК при праве рисовать). Упрощение штриха (Дуглас–Пекер) — чистая функция в `map-geo.js`.

**Tech Stack:** Node 22+ (`node:http`, `node:sqlite`, `node:test`), без npm-зависимостей; фронтенд — ES5 без сборки, Leaflet, `window.MapApi`/`window.h`.

**Spec:** `docs/superpowers/specs/2026-10-13-clans-tactics-design.md` (разделы «Данные», «Права», «API», «Режим Тактика», «Синхронизация», «Ошибки»). Этап 1 — `docs/superpowers/plans/2026-10-13-clans.md` (уже на проде). Этап 3 (стрелка, зона, метка, текст, админский интерфейс) — `2026-10-13-clans-tactics-stage3.md`.

## Global Constraints

- Node 22+, без npm-зависимостей; тесты: `node --test server/test/*.test.js tools/*.test.js`. Сборки и линтера нет.
- Права — только через `server/clan-permissions.js`: `memberContext(db, userId)`, `has(ctx, 'tactics_view'|'tactics_draw'|'plans_manage')`, `drawScopeAllowed(ctx, drawAll, squadIds)`. Контекст считается на каждый запрос, снятая роль действует сразу.
- Лимиты: 25 планов на клан, 500 рисунков на план, 2000 точек на штрих карандаша, 60 правок в минуту на пользователя (`429`).
- Координаты — доли 0..1 от картинки карты; на сервере округляются до 5 знаков.
- `kind` в этапе 2 принимает только `pencil`; `arrow|zone|marker|text` приходят этапом 3 (CHECK в таблице уже допускает все пять, валидатор — нет).
- `width` 1..3; `squad_id` NULL = общий рисунок; `ON DELETE SET NULL` у отряда, `ON DELETE CASCADE` у плана и клана.
- Любое изменение плана или его рисунков увеличивает `tactic_plans.version` в той же транзакции. Активный план — не больше одного на (`clan_id`, `map_id`).
- `public_id` — 12 символов base62 из `crypto.randomBytes`.
- Чужой клан, чужой план и чужой рисунок отвечают `404` (ничего не подсказываем). Нет права — `403`.
- Админ сайта: читает любой план любого клана и удаляет план или рисунок; создавать, править, активировать, очищать не может (`403`).
- Параметры маршрутов — только строчные буквы (`:id`, `:pid`, `:iid`): роутер ловит ключ регексом `:([a-z]+)`.
- Планы привязаны только к **опубликованным** картам.
- Рисование — только на ПК (`min-width: 900px`, как `wantsEditor()`); на телефоне только просмотр, фильтр и выбор плана.
- Русский текст интерфейса; ширина 375 px без горизонтальной прокрутки. Версию `?v=` в `map.html` менять при правках (`window.MAP_V` и все `?v=`).

## Review Focus

1. **Штрих с лишними или кривыми точками** (`NaN`, строки, 1 точка, 2001 точка, координаты вне 0..1, не массив пар): `400`, в БД ничего не пишется. Тест — Task 2.
2. **Параллельные правки одного плана** (две вкладки/два рисующих): обе записи проходят, `version` растёт ровно на 2, ни одна не теряется. Тест — Task 4.
3. **Командир отряда А стирает/правит рисунок отряда Б или общий рисунок**: `403`; свой рисунок автор может удалить, даже если право `tactics_draw` отозвали. Тест — Task 4.
4. **Игрока исключили или сняли `tactics_view`, пока у него открыт план**: следующий опрос даёт `404/403`, фронтенд закрывает режим без исключения. Тесты — Task 3 (сервер) и Task 7 (ручная проверка).
5. **Удалённый отряд**: рисунки становятся общими, `version` плана растёт (иначе клиенты не увидят смену цвета). Тест — Task 5.

---

## Файлы

| Файл | Ответственность |
|------|-----------------|
| `server/db.js` (изменить) | миграция 7: `tactic_plans`, `tactic_items` |
| `server/http-util.js` (изменить) | `sendJson` для `304` без тела |
| `server/tactic-validate.js` (новый) | проверка ввода плана и рисунка, округление, `newPublicId` |
| `server/tactic-repo.js` (новый) | SQL планов и рисунков, `bump`, лимиты, `planBody` |
| `server/routes/tactics.js` (новый) | 8 маршрутов тактики |
| `server/routes/clan-roles.js` (изменить) | при удалении отряда поднять `version` затронутых планов |
| `server/app.js` (изменить) | регистрация маршрутов, лимитер `tacticsWrite` |
| `server/test/tactics.test.js`, `server/test/tactic-validate.test.js` (новые) | тесты |
| `map-geo.js`, `tools/map-geo.test.js` (изменить) | `simplify` (Дуглас–Пекер) |
| `map-common.js` (изменить) | `MapApi.getConditional` |
| `map-tactics.js` (новый) | режим «Тактика»: слой, опрос 15 с, панель планов, фильтр отрядов |
| `map-tactics-editor.js` (новый) | карандаш, ластик, выбор отряда, клавиши |
| `map-marks.js`, `map-marks-editor.js` (изменить) | `MapMarks.setSuspended`, `MapMarksEditor.pause` |
| `map-app.js` (изменить) | кнопка «Тактика», загрузка модулей, `?tactics=1&plan=` |
| `map.html`, `map-app.css` (изменить) | панель тактики, стили, версия `?v=` |
| `RELEASE.md`, `CLAUDE.md` (изменить) | заметки по выкатке, статус |

---

### Task 1: Миграция 7 и 304 без тела

**Files:**
- Modify: `server/db.js` (добавить запись в `MIGRATIONS` после версии 6)
- Modify: `server/http-util.js` (`sendJson`)
- Test: `server/test/tactics.test.js` (создаётся здесь, дополняется в следующих задачах)

**Interfaces:**
- Produces: таблицы `tactic_plans(id, public_id UNIQUE, clan_id, map_id, title, is_active, version, updated_at, updated_by)` и `tactic_items(id, plan_id, squad_id, kind, geometry, width, icon, label, author_id, created_at, updated_at)`; `sendJson(res, 304, …)` отправляет заголовки без тела.

- [ ] **Step 1: Написать падающий тест миграции и каскадов**

Создать `server/test/tactics.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { SCHEMA, MIGRATIONS, migrate } = require('../db');
const { clanSetup } = require('./clan-helpers');
const repo = require('../repo');

test('migration 7 adds tactic tables on top of version 6 and keeps data', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const m of MIGRATIONS.filter((x) => x.version <= 6)) db.exec(m.sql);
  db.exec('PRAGMA user_version = 6');
  db.exec("INSERT INTO users (login, password_hash, role) VALUES ('keeper', 'x', 'user')");
  migrate(db);
  assert.ok(db.prepare('PRAGMA user_version').get().user_version >= 7);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tactic_plans').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tactic_items').get().n, 0);
  db.close();
});

test('deleting a clan, a map or a squad cascades as the spec says', async (t) => {
  const { s, makeClan } = await clanSetup(t);
  const clanId = await makeClan();
  const mapId = repo.insertRow(s.db, 'maps', { slug: 'main', title: 'Main', published: 1 });
  const squadId = Number(s.db.prepare("INSERT INTO clan_squads (clan_id, name, color) VALUES (?, 'A', '#ff0000')").run(clanId).lastInsertRowid);
  const planId = Number(s.db.prepare(
    "INSERT INTO tactic_plans (public_id, clan_id, map_id, title) VALUES ('abcdefghijkl', ?, ?, 'P')",
  ).run(clanId, mapId).lastInsertRowid);
  s.db.prepare(
    "INSERT INTO tactic_items (plan_id, squad_id, kind, geometry) VALUES (?, ?, 'pencil', '[[0,0],[1,1]]')",
  ).run(planId, squadId);
  s.db.prepare('DELETE FROM clan_squads WHERE id = ?').run(squadId);
  assert.equal(s.db.prepare('SELECT squad_id FROM tactic_items').get().squad_id, null, 'squad delete → общий рисунок');
  s.db.prepare('DELETE FROM clans WHERE id = ?').run(clanId);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tactic_plans').get().n, 0);
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tactic_items').get().n, 0);
});

test('only one active plan per clan and map is allowed by the schema', async (t) => {
  const { s, makeClan } = await clanSetup(t);
  const clanId = await makeClan();
  const mapId = repo.insertRow(s.db, 'maps', { slug: 'main', title: 'Main', published: 1 });
  const ins = s.db.prepare(
    'INSERT INTO tactic_plans (public_id, clan_id, map_id, title, is_active) VALUES (?, ?, ?, ?, 1)',
  );
  ins.run('aaaaaaaaaaaa', clanId, mapId, 'One');
  assert.throws(() => ins.run('bbbbbbbbbbbb', clanId, mapId, 'Two'), /UNIQUE/);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/tactics.test.js`
Expected: FAIL (`no such table: tactic_plans`).

- [ ] **Step 3: Добавить миграцию 7**

В `server/db.js` в массив `MIGRATIONS` после записи версии 6:

```js
  {
    // Tactics: plans per clan and map, drawings per plan (stage 2 of clans and tactics).
    // `version` grows on every change so pollers can use ETag/304. The partial unique index keeps
    // one active plan per clan and map.
    version: 7,
    sql: `
CREATE TABLE tactic_plans (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_tactic_plans_clan ON tactic_plans(clan_id, map_id);
CREATE UNIQUE INDEX idx_tactic_plans_active ON tactic_plans(clan_id, map_id) WHERE is_active = 1;
CREATE TABLE tactic_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES tactic_plans(id) ON DELETE CASCADE,
  squad_id INTEGER REFERENCES clan_squads(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pencil', 'arrow', 'zone', 'marker', 'text')),
  geometry TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 2 CHECK (width BETWEEN 1 AND 3),
  icon TEXT,
  label TEXT,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tactic_items_plan ON tactic_items(plan_id);
CREATE INDEX idx_tactic_items_squad ON tactic_items(squad_id);
`,
  },
```

- [ ] **Step 4: Запустить тесты миграции**

Run: `node --test server/test/tactics.test.js`
Expected: PASS (3 теста). Затем `node --test server/test/*.test.js tools/*.test.js` — всё зелёное (старые миграционные тесты ждут `>= N`, не `=== N`; если какой-то сравнивает `user_version === 6` — поправить на `>= 6`).

- [ ] **Step 5: Научить sendJson отвечать 304 без тела**

В `server/http-util.js` заменить `sendJson`:

```js
function sendJson(res, status, body, headers = {}) {
  // A 304 has no body and must not announce one; the caller passes ETag in `headers`.
  if (status === 304) {
    res.writeHead(304, { 'Cache-Control': 'no-store', ...headers });
    res.end();
    return;
  }
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(data);
}
```

Важно: `app.js` передаёт `c.headers` четвёртым аргументом — ETag будет складываться туда (`c.headers.ETag = …`).

- [ ] **Step 6: Commit**

```bash
git add server/db.js server/http-util.js server/test/tactics.test.js
git commit -m "feat(tactics): migration 7 (plans, items) and bodyless 304"
```

---

### Task 2: Проверка ввода и репозиторий

**Files:**
- Create: `server/tactic-validate.js`, `server/tactic-repo.js`
- Test: `server/test/tactic-validate.test.js`

**Interfaces:**
- Consumes: `tx` из `server/clan-repo.js`.
- Produces:
  - `newPublicId(): string` (12 символов base62);
  - `validatePlan(input, { create }): {ok, value|error}` — `{ title }` (1..60 символов, не пустой после trim);
  - `validateItem(input, { create }): {ok, value|error}` — на создание: `{ kind:'pencil', geometry:[[x,y],…], width, squad: number|null }`; на правку: любое подмножество `geometry`, `width`, `squad`; нормализованное значение: `{ kind, geometry (округлён), width, squad_id }`;
  - `LIMITS = { plans: 25, items: 500, pencilPoints: 2000 }`;
  - `tactic-repo`: `getPlanByPublicId(db, publicId)`, `listPlans(db, clanId, mapId|null)`, `planBody(db, plan)`, `itemOut(row)`, `insertPlan(db, {clanId, mapId, title, userId, active})`, `bump(db, planId, userId)` → новая `version`, `countPlans(db, clanId)`, `countItems(db, planId)`, `activate(db, plan, userId)`, `getItem(db, id)`, `insertItem(db, plan, fields, userId)`, `updateItem(db, item, fields, userId)`, `deleteItem(db, item, userId)`, `clearItems(db, plan, squadId|undefined, userId)`.

- [ ] **Step 1: Написать падающие тесты валидатора**

`server/test/tactic-validate.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateItem, validatePlan, newPublicId } = require('../tactic-validate');

const line = [[0, 0], [0.5, 0.5], [1, 1]];

test('a pencil stroke is accepted and rounded to 5 decimals', () => {
  const r = validateItem({ kind: 'pencil', geometry: [[0.123456789, 0.1], [0.2, 0.3]], width: 3, squad: 4 }, { create: true });
  assert.deepEqual(r, { ok: true, value: { kind: 'pencil', geometry: [[0.12346, 0.1], [0.2, 0.3]], width: 3, squad_id: 4 } });
});

test('defaults: width 2 and squad null (общий)', () => {
  const r = validateItem({ kind: 'pencil', geometry: line }, { create: true });
  assert.equal(r.value.width, 2);
  assert.equal(r.value.squad_id, null);
});

test('bad strokes are rejected', () => {
  const bad = [
    [],
    [[0.1, 0.1]],
    'abc',
    [[0.1, 'x'], [0.2, 0.2]],
    [[0.1, 0.1], [0.2]],
    [[0.1, 0.1], [NaN, 0.2]],
    [[0.1, 0.1], [1.2, 0.2]],
    [[0.1, 0.1], [-0.1, 0.2]],
    [[0.1, 0.1], [0.2, 0.2, 0.3]],
    Array.from({ length: 2001 }, () => [0.5, 0.5]),
  ];
  for (const geometry of bad) {
    assert.equal(validateItem({ kind: 'pencil', geometry }, { create: true }).ok, false, JSON.stringify(geometry).slice(0, 40));
  }
  assert.equal(validateItem({ kind: 'pencil', geometry: Array.from({ length: 2000 }, () => [0.5, 0.5]) }, { create: true }).ok, true);
});

test('unknown kind, width and squad are rejected; arrow is not yet supported', () => {
  for (const input of [
    { kind: 'circle', geometry: line },
    { kind: 'arrow', geometry: line },
    { kind: 'pencil', geometry: line, width: 0 },
    { kind: 'pencil', geometry: line, width: 4 },
    { kind: 'pencil', geometry: line, width: 1.5 },
    { kind: 'pencil', geometry: line, squad: 'a' },
    { kind: 'pencil', geometry: line, squad: 0 },
  ]) assert.equal(validateItem(input, { create: true }).ok, false, JSON.stringify(input));
});

test('on update every field is optional but at least one is meaningful', () => {
  assert.deepEqual(validateItem({ width: 1 }, {}).value, { width: 1 });
  assert.deepEqual(validateItem({ squad: null }, {}).value, { squad_id: null });
  assert.equal(validateItem({ kind: 'zone' }, {}).ok, false, 'kind cannot be changed');
});

test('plan title: trimmed 1..60, no control characters', () => {
  assert.deepEqual(validatePlan({ title: '  Штурм  ' }, { create: true }), { ok: true, value: { title: 'Штурм' } });
  for (const title of ['', '   ', 'x'.repeat(61), 'a\nb', 5, undefined]) {
    assert.equal(validatePlan({ title }, { create: true }).ok, false);
  }
});

test('newPublicId is 12 base62 characters and different each time', () => {
  const a = newPublicId();
  assert.match(a, /^[0-9A-Za-z]{12}$/);
  assert.notEqual(a, newPublicId());
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/tactic-validate.test.js`
Expected: FAIL (`Cannot find module '../tactic-validate'`).

- [ ] **Step 3: Реализовать валидатор**

`server/tactic-validate.js`:

```js
'use strict';

const crypto = require('node:crypto');

const LIMITS = { plans: 25, items: 500, pencilPoints: 2000 };
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// 12 base62 characters; bytes >= 248 are skipped so every symbol is equally likely.
function newPublicId() {
  let out = '';
  while (out.length < 12) {
    for (const b of crypto.randomBytes(16)) {
      if (b < 248 && out.length < 12) out += BASE62[b % 62];
    }
  }
  return out;
}

function validatePlan(input, { create = false } = {}) {
  const out = {};
  if (create || 'title' in input) {
    if (typeof input.title !== 'string' || CONTROL_RE.test(input.title)) return fail('title_invalid');
    const t = input.title.trim().replace(/\s+/g, ' ');
    if (t.length < 1 || t.length > 60) return fail('title_invalid');
    out.title = t;
  }
  return ok(out);
}

function validatePoints(value, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const out = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [x, y] = p;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    out.push([round5(x), round5(y)]);
  }
  return out;
}

// Stage 2 knows only the pencil; later stages add their kinds to this table.
const KINDS = {
  pencil: (g) => validatePoints(g, 2, LIMITS.pencilPoints),
};

function validateItem(input, { create = false } = {}) {
  const out = {};
  if (create) {
    if (typeof input.kind !== 'string' || !Object.prototype.hasOwnProperty.call(KINDS, input.kind)) {
      return fail('kind_invalid');
    }
    out.kind = input.kind;
  } else if ('kind' in input) {
    return fail('kind_immutable');
  }
  if (create || 'geometry' in input) {
    // On update the kind is not in the body; the route re-validates geometry with the stored kind.
    const kind = create ? out.kind : (input.__kind || 'pencil');
    const g = KINDS[kind](input.geometry);
    if (g === null) return fail('geometry_invalid');
    out.geometry = g;
  }
  if ('width' in input || create) {
    const w = 'width' in input ? input.width : 2;
    if (!Number.isInteger(w) || w < 1 || w > 3) return fail('width_invalid');
    out.width = w;
  }
  if ('squad' in input || create) {
    const sq = 'squad' in input ? input.squad : null;
    if (sq !== null && (!Number.isInteger(sq) || sq < 1)) return fail('squad_invalid');
    out.squad_id = sq;
  }
  return ok(out);
}

module.exports = { LIMITS, newPublicId, validatePlan, validateItem };
```

Примечание: ключ `__kind` — внутренний способ для маршрута передать тип сохранённого рисунка при правке геометрии (`validateItem({ ...body, __kind: item.kind })`). Клиентский `__kind` в теле игнорируется маршрутом: он собирает объект сам.

- [ ] **Step 4: Запустить тесты валидатора**

Run: `node --test server/test/tactic-validate.test.js`
Expected: PASS.

- [ ] **Step 5: Реализовать репозиторий**

`server/tactic-repo.js`:

```js
'use strict';

const { tx } = require('./clan-repo');
const { newPublicId, LIMITS } = require('./tactic-validate');

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
void sqlTime;

const getPlanByPublicId = (db, publicId) =>
  db.prepare('SELECT * FROM tactic_plans WHERE public_id = ?').get(String(publicId)) || null;

function planOut(r) {
  return {
    id: r.public_id,
    clan_id: r.clan_id,
    map_id: r.map_id,
    title: r.title,
    active: Boolean(r.is_active),
    version: r.version,
    updated_at: r.updated_at,
  };
}

function itemOut(r) {
  return {
    id: r.id,
    squad_id: r.squad_id,
    kind: r.kind,
    geometry: JSON.parse(r.geometry),
    width: r.width,
    icon: r.icon,
    label: r.label,
    author_id: r.author_id,
  };
}

function listPlans(db, clanId, mapId) {
  const rows = mapId
    ? db.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM tactic_items i WHERE i.plan_id = p.id) AS items
       FROM tactic_plans p WHERE p.clan_id = ? AND p.map_id = ? ORDER BY p.is_active DESC, p.updated_at DESC, p.id DESC`,
    ).all(clanId, mapId)
    : db.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM tactic_items i WHERE i.plan_id = p.id) AS items
       FROM tactic_plans p WHERE p.clan_id = ? ORDER BY p.is_active DESC, p.updated_at DESC, p.id DESC`,
    ).all(clanId);
  return rows.map((r) => ({ ...planOut(r), items: r.items }));
}

function planBody(db, plan) {
  const items = db.prepare('SELECT * FROM tactic_items WHERE plan_id = ? ORDER BY id').all(plan.id).map(itemOut);
  return { plan: planOut(plan), items };
}

const countPlans = (db, clanId) => db.prepare('SELECT COUNT(*) AS n FROM tactic_plans WHERE clan_id = ?').get(clanId).n;
const countItems = (db, planId) => db.prepare('SELECT COUNT(*) AS n FROM tactic_items WHERE plan_id = ?').get(planId).n;

// Every change of a plan or its drawings goes through here; the caller already holds a transaction
// or runs synchronously, so the version and the change cannot be observed apart.
function bump(db, planId, userId) {
  db.prepare("UPDATE tactic_plans SET version = version + 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?")
    .run(userId || null, planId);
  return db.prepare('SELECT version FROM tactic_plans WHERE id = ?').get(planId).version;
}

function insertPlan(db, { clanId, mapId, title, userId, active }) {
  return tx(db, () => {
    if (active) db.prepare('UPDATE tactic_plans SET is_active = 0 WHERE clan_id = ? AND map_id = ?').run(clanId, mapId);
    const publicId = newPublicId();
    db.prepare(
      'INSERT INTO tactic_plans (public_id, clan_id, map_id, title, is_active, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(publicId, clanId, mapId, title, active ? 1 : 0, userId || null);
    return getPlanByPublicId(db, publicId);
  });
}

function activate(db, plan, userId) {
  return tx(db, () => {
    db.prepare('UPDATE tactic_plans SET is_active = 0 WHERE clan_id = ? AND map_id = ? AND id != ?')
      .run(plan.clan_id, plan.map_id, plan.id);
    db.prepare('UPDATE tactic_plans SET is_active = 1 WHERE id = ?').run(plan.id);
    bump(db, plan.id, userId);
    // The previous active plan changed too (its star), so its pollers must refresh.
    db.prepare(
      "UPDATE tactic_plans SET version = version + 1 WHERE clan_id = ? AND map_id = ? AND id != ?",
    ).run(plan.clan_id, plan.map_id, plan.id);
  });
}

// The item is returned with the plan's new version.
const getItem = (db, id) => db.prepare(
  `SELECT i.*, p.public_id, p.clan_id FROM tactic_items i JOIN tactic_plans p ON p.id = i.plan_id WHERE i.id = ?`,
).get(id) || null;

function insertItem(db, plan, f, userId) {
  return tx(db, () => {
    const id = Number(db.prepare(
      `INSERT INTO tactic_items (plan_id, squad_id, kind, geometry, width, icon, label, author_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(plan.id, f.squad_id, f.kind, JSON.stringify(f.geometry), f.width, f.icon || null, f.label || null, userId).lastInsertRowid);
    const version = bump(db, plan.id, userId);
    return { item: itemOut(db.prepare('SELECT * FROM tactic_items WHERE id = ?').get(id)), version };
  });
}

function updateItem(db, item, f, userId) {
  return tx(db, () => {
    const set = {};
    if ('geometry' in f) set.geometry = JSON.stringify(f.geometry);
    if ('width' in f) set.width = f.width;
    if ('squad_id' in f) set.squad_id = f.squad_id;
    if ('label' in f) set.label = f.label;
    if ('icon' in f) set.icon = f.icon;
    const keys = Object.keys(set);
    if (keys.length) {
      db.prepare(`UPDATE tactic_items SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((k) => set[k]), item.id);
    }
    const version = bump(db, item.plan_id, userId);
    return { item: itemOut(db.prepare('SELECT * FROM tactic_items WHERE id = ?').get(item.id)), version };
  });
}

function deleteItem(db, item, userId) {
  return tx(db, () => {
    db.prepare('DELETE FROM tactic_items WHERE id = ?').run(item.id);
    return bump(db, item.plan_id, userId);
  });
}

// squadId: undefined = whole plan, null = only общие, number = one squad.
function clearItems(db, plan, squadId, userId) {
  return tx(db, () => {
    if (squadId === undefined) db.prepare('DELETE FROM tactic_items WHERE plan_id = ?').run(plan.id);
    else if (squadId === null) db.prepare('DELETE FROM tactic_items WHERE plan_id = ? AND squad_id IS NULL').run(plan.id);
    else db.prepare('DELETE FROM tactic_items WHERE plan_id = ? AND squad_id = ?').run(plan.id, squadId);
    return bump(db, plan.id, userId);
  });
}

module.exports = {
  LIMITS,
  getPlanByPublicId,
  planOut,
  itemOut,
  listPlans,
  planBody,
  countPlans,
  countItems,
  bump,
  insertPlan,
  activate,
  getItem,
  insertItem,
  updateItem,
  deleteItem,
  clearItems,
};
```

Перед коммитом удалить неиспользуемую `sqlTime` и строку `void sqlTime;`.

- [ ] **Step 6: Прогнать все тесты и закоммитить**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

```bash
git add server/tactic-validate.js server/tactic-repo.js server/test/tactic-validate.test.js
git commit -m "feat(tactics): validators and repository"
```

---

### Task 3: Маршруты планов (список, создание, правка, активация, чтение с ETag)

**Files:**
- Create: `server/routes/tactics.js`
- Modify: `server/app.js` (маршруты, лимитер `tacticsWrite: createRateLimiter({ max: 60, windowMs: MIN })`)
- Test: `server/test/tactics.test.js` (дополнить)

**Interfaces:**
- Consumes: `memberContext`, `has`, `drawScopeAllowed` (`clan-permissions.js`); `need`, `checked`, `intParam`, `memberOf`, `requirePerm` (`clan-http.js`); `tactic-repo`, `tactic-validate`; `repo.getMapById`/`repo.getMapBySlug` (проверить имя в `server/repo.js`: `getMapBySlug` есть, для id использовать `c.db.prepare('SELECT * FROM maps WHERE id = ?')`).
- Produces (HTTP):
  - `GET /api/clans/:id/plans?map=<slug>` → `[{id, title, active, version, items, map_id, updated_at, clan_id}]`;
  - `POST /api/clans/:id/plans` `{mapId, title}` → `201 {plan, items: []}`;
  - `GET /api/plans/:pid` → `{plan, items}` + `ETag: "v<n>"`, `304`;
  - `PATCH /api/plans/:pid` `{title}` → `{plan, items}`;
  - `POST /api/plans/:pid/activate` → `{plan, items}`;
  - внутренние хелперы модуля: `planAccess(c, publicId, mode)` где `mode` — `'read'` (участник с `tactics_view` или админ сайта) или `'manage'` (участник с `plans_manage`); возвращает `{ plan, ctx, admin }`.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `server/test/tactics.test.js`:

```js
const { PERMS } = require('../clan-permissions');

// A clan with owner alice, members bob (no rights), carol (full tactics), published map "main".
async function tacticSetup(t) {
  const x = await clanSetup(t);
  const clanId = await x.makeClan();
  for (const who of ['bob', 'carol', 'dave']) x.addMember(clanId, who);
  const mapId = repo.insertRow(x.s.db, 'maps', { slug: 'main', title: 'Main', published: 1, width: 100, height: 100 });
  const draftId = repo.insertRow(x.s.db, 'maps', { slug: 'draft', title: 'Draft', published: 0 });
  x.grantRole(clanId, 'carol', 'Planner', 5, PERMS.tactics_view | PERMS.tactics_draw | PERMS.plans_manage, 1);
  return { ...x, clanId, mapId, draftId, base: `/api/clans/${clanId}` };
}

test('creating a plan needs plans_manage and a published map; the first plan of a map becomes active', async (t) => {
  const { as, base, mapId, draftId } = await tacticSetup(t);
  assert.equal((await as('bob')('POST', base + '/plans', { mapId, title: 'X' })).status, 403);
  assert.equal((await as('carol')('POST', base + '/plans', { mapId: draftId, title: 'X' })).status, 404);
  assert.equal((await as('carol')('POST', base + '/plans', { mapId, title: '' })).status, 400);
  const r = await as('carol')('POST', base + '/plans', { mapId, title: 'Штурм' });
  assert.equal(r.status, 201);
  assert.equal(r.json.plan.active, true);
  assert.match(r.json.plan.id, /^[0-9A-Za-z]{12}$/);
  const r2 = await as('carol')('POST', base + '/plans', { mapId, title: 'Запасной' });
  assert.equal(r2.json.plan.active, false);
});

test('plan limit is 25 per clan', async (t) => {
  const { as, base, mapId } = await tacticSetup(t);
  for (let i = 0; i < 25; i++) {
    assert.equal((await as('alice')('POST', base + '/plans', { mapId, title: 'P' + i })).status, 201);
  }
  const r = await as('alice')('POST', base + '/plans', { mapId, title: 'P25' });
  assert.deepEqual([r.status, r.json.error], [409, 'plans_limit']);
});

test('list: members with tactics_view see plans; strangers get 404; map filter works', async (t) => {
  const { as, base, mapId, clanId, s } = await tacticSetup(t);
  const other = repo.insertRow(s.db, 'maps', { slug: 'north', title: 'North', published: 1 });
  await as('alice')('POST', base + '/plans', { mapId, title: 'A' });
  await as('alice')('POST', base + '/plans', { mapId: other, title: 'B' });
  const all = await as('bob')('GET', base + '/plans');
  assert.equal(all.status, 200);
  assert.equal(all.json.length, 2);
  const one = await as('bob')('GET', base + '/plans?map=north');
  assert.deepEqual(one.json.map((p) => p.title), ['B']);
  assert.equal((await as('bob')('GET', `/api/clans/${clanId + 1}/plans`)).status, 404);
  assert.equal((await as('bob')('GET', base + '/plans?map=nope')).status, 404);
  // a viewer role without tactics_view
  s.db.prepare('UPDATE clan_roles SET perms = 0 WHERE clan_id = ? AND is_everyone = 1').run(clanId);
  assert.equal((await as('bob')('GET', base + '/plans')).status, 403);
});

test('GET plan sends ETag and answers 304 on a match; a stranger or a guest cannot read it', async (t) => {
  const { as, base, mapId, s } = await tacticSetup(t);
  const created = await as('alice')('POST', base + '/plans', { mapId, title: 'A' });
  const pid = created.json.plan.id;
  const first = await as('bob')('GET', '/api/plans/' + pid);
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.equal(etag, `"v${first.json.plan.version}"`);
  const again = await as('bob')('GET', '/api/plans/' + pid, undefined, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  assert.equal(again.json, null);
  assert.equal(again.headers.get('etag'), etag);
  const stale = await as('bob')('GET', '/api/plans/' + pid, undefined, { headers: { 'if-none-match': '"v0"' } });
  assert.equal(stale.status, 200);
  assert.equal((await s.api('GET', '/api/plans/' + pid)).status, 401);
  // a member of nobody
  const eve = require('../auth').createUser(s.db, { login: 'eve', password: 'eve-pass-123', role: 'user' });
  const evec = 'sid=' + require('../auth').createSession(s.db, eve, Date.now());
  assert.equal((await s.api('GET', '/api/plans/' + pid, { cookie: evec })).status, 404);
  assert.equal((await as('bob')('GET', '/api/plans/zzzzzzzzzzzz')).status, 404);
});

test('304 does not load the items (one plan lookup and the membership check)', async (t) => {
  const { as, base, mapId, s } = await tacticSetup(t);
  const pid = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan.id;
  const etag = '"v1"';
  const calls = [];
  const orig = s.db.prepare.bind(s.db);
  s.db.prepare = (sql) => { calls.push(sql); return orig(sql); };
  const r = await as('bob')('GET', '/api/plans/' + pid, undefined, { headers: { 'if-none-match': etag } });
  s.db.prepare = orig;
  assert.equal(r.status, 304);
  assert.equal(calls.some((q) => /FROM tactic_items/.test(q)), false);
});

test('rename and activate need plans_manage; activation moves the star and bumps both versions', async (t) => {
  const { as, base, mapId } = await tacticSetup(t);
  const a = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan;
  const b = (await as('alice')('POST', base + '/plans', { mapId, title: 'B' })).json.plan;
  assert.equal((await as('bob')('PATCH', '/api/plans/' + b.id, { title: 'Z' })).status, 403);
  const ren = await as('carol')('PATCH', '/api/plans/' + b.id, { title: 'Новый' });
  assert.equal(ren.json.plan.title, 'Новый');
  assert.ok(ren.json.plan.version > b.version);
  assert.equal((await as('bob')('POST', `/api/plans/${b.id}/activate`)).status, 403);
  const act = await as('carol')('POST', `/api/plans/${b.id}/activate`);
  assert.equal(act.json.plan.active, true);
  const old = await as('carol')('GET', '/api/plans/' + a.id);
  assert.equal(old.json.plan.active, false);
  assert.ok(old.json.plan.version > a.version, 'the old active plan is refreshed too');
});

test('a member who is kicked or loses tactics_view gets 404/403 on the next read', async (t) => {
  const { as, base, mapId, clanId, s, users } = await tacticSetup(t);
  const pid = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan.id;
  assert.equal((await as('bob')('GET', '/api/plans/' + pid)).status, 200);
  s.db.prepare('UPDATE clan_roles SET perms = 0 WHERE clan_id = ? AND is_everyone = 1').run(clanId);
  assert.equal((await as('bob')('GET', '/api/plans/' + pid)).status, 403);
  s.db.prepare('DELETE FROM clan_members WHERE user_id = ?').run(users.bob.id);
  assert.equal((await as('bob')('GET', '/api/plans/' + pid)).status, 404);
});

test('the site admin reads any clan plans but cannot create or change them', async (t) => {
  const { as, base, mapId } = await tacticSetup(t);
  const pid = (await as('alice')('POST', base + '/plans', { mapId, title: 'A' })).json.plan.id;
  assert.equal((await as('admin')('GET', base + '/plans')).status, 200);
  assert.equal((await as('admin')('GET', '/api/plans/' + pid)).status, 200);
  assert.equal((await as('admin')('POST', base + '/plans', { mapId, title: 'X' })).status, 404);
  assert.equal((await as('admin')('PATCH', '/api/plans/' + pid, { title: 'X' })).status, 403);
  assert.equal((await as('admin')('POST', `/api/plans/${pid}/activate`)).status, 403);
});
```

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/tactics.test.js`
Expected: FAIL (404 на новых маршрутах).

- [ ] **Step 3: Реализовать маршруты планов**

`server/routes/tactics.js`:

```js
'use strict';

const { HttpError, readJson } = require('../http-util');
const { memberContext, has } = require('../clan-permissions');
const { validatePlan } = require('../tactic-validate');
const { checked, need, intParam, memberOf, requirePerm } = require('../clan-http');
const clanRepo = require('../clan-repo');
const repo = require('../repo');
const tactics = require('../tactic-repo');

function limitWrites(c) {
  if (!c.limiters.tacticsWrite.allow('u:' + c.user.id, c.now())) {
    throw new HttpError(429, 'too many requests, try again later');
  }
}

// Reading: a member with tactics_view, or the site admin for any clan. Anyone else — 404, so ids and
// clans cannot be probed. Returns what the caller needs to decide further.
function readAccess(c, clanId) {
  need(c);
  const ctx = memberContext(c.db, c.user.id);
  const inClan = Boolean(ctx) && ctx.clanId === clanId;
  if (c.user.role === 'admin') return { ctx: inClan ? ctx : null, admin: true };
  if (!inClan) throw new HttpError(404, 'not found');
  requirePerm(ctx, 'tactics_view');
  return { ctx, admin: false };
}

// The plan named by the URL with read access to it.
function planFor(c) {
  need(c);
  const plan = tactics.getPlanByPublicId(c.db, c.params.pid);
  if (!plan) throw new HttpError(404, 'plan not found');
  const access = readAccess(c, plan.clan_id);
  return { plan, ...access };
}

// Writing a plan: a member with the flag; the site admin never writes (403 by design: they may read).
function planForManage(c) {
  const r = planFor(c);
  if (r.admin && !r.ctx) throw new HttpError(403, 'forbidden');
  requirePerm(r.ctx, 'plans_manage');
  return r;
}

const bodyOf = (c, plan) => tactics.planBody(c.db, plan);

function publishedMap(c, mapId) {
  const row = Number.isInteger(mapId) ? c.db.prepare('SELECT * FROM maps WHERE id = ?').get(mapId) : null;
  if (!row || !row.published) throw new HttpError(404, 'map not found');
  return row;
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/clans/:id/plans',
    handler: async (c) => {
      const clanId = intParam(c, 'id');
      if (!clanRepo.getClan(c.db, clanId)) {
        need(c);
        throw new HttpError(404, 'clan not found');
      }
      readAccess(c, clanId);
      let mapId = null;
      const slug = c.query.get('map');
      if (slug) {
        const map = repo.getMapBySlug(c.db, slug);
        if (!map) throw new HttpError(404, 'map not found');
        mapId = map.id;
      }
      return { body: tactics.listPlans(c.db, clanId, mapId) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans/:id/plans',
    handler: async (c) => {
      requirePerm(memberOf(c), 'plans_manage');
      limitWrites(c);
      const input = await readJson(c.req);
      const fields = checked(validatePlan(input, { create: true }));
      const ctx = memberOf(c); // re-read after the await
      requirePerm(ctx, 'plans_manage');
      const map = publishedMap(c, input.mapId);
      // Count and insert have no await between them, so parallel requests cannot overshoot.
      if (tactics.countPlans(c.db, ctx.clanId) >= tactics.LIMITS.plans) throw new HttpError(409, 'plans_limit');
      const hasActive = c.db.prepare('SELECT 1 FROM tactic_plans WHERE clan_id = ? AND map_id = ? AND is_active = 1')
        .get(ctx.clanId, map.id);
      const plan = tactics.insertPlan(c.db, {
        clanId: ctx.clanId, mapId: map.id, title: fields.title, userId: c.user.id, active: !hasActive,
      });
      return { status: 201, body: bodyOf(c, plan) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/plans/:pid',
    handler: async (c) => {
      const { plan } = planFor(c);
      const etag = `"v${plan.version}"`;
      c.headers.ETag = etag;
      if (c.req.headers['if-none-match'] === etag) return { status: 304, body: null };
      return { body: bodyOf(c, plan) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/plans/:pid',
    handler: async (c) => {
      planForManage(c);
      limitWrites(c);
      const fields = checked(validatePlan(await readJson(c.req)));
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      const { plan } = planForManage(c); // re-read after the await
      c.db.prepare('UPDATE tactic_plans SET title = ? WHERE id = ?').run(fields.title, plan.id);
      tactics.bump(c.db, plan.id, c.user.id);
      return { body: bodyOf(c, tactics.getPlanByPublicId(c.db, plan.public_id)) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/plans/:pid/activate',
    handler: async (c) => {
      const { plan } = planForManage(c);
      limitWrites(c);
      tactics.activate(c.db, plan, c.user.id);
      return { body: bodyOf(c, tactics.getPlanByPublicId(c.db, plan.public_id)) };
    },
  },
];

module.exports.helpers = { readAccess, planFor, planForManage, limitWrites, bodyOf };
```

Примечание для исполнителя: `module.exports` — массив; `helpers` — свойство массива (как `uniqueOrThrow` в `routes/clans.js`). `app.js` делает `ROUTE_MODULES.flat()`, свойство массива ему не мешает.

Для `403` админа в `planForManage`: `r.admin && !r.ctx` — админ, не состоящий в клане плана. Админ-участник этого клана ведёт себя как обычный участник (его права — роли, как у любого игрока; в тесте `admin` не в клане → 403).

- [ ] **Step 4: Подключить в `app.js`**

В `ROUTE_MODULES` добавить `require('./routes/tactics'),` после `routes/clan-roles`; в `limiters` — `tacticsWrite: createRateLimiter({ max: 60, windowMs: MIN }),`.

- [ ] **Step 5: Запустить тесты**

Run: `node --test server/test/tactics.test.js`
Expected: PASS. Если `admin POST /plans` вернул не 404 — `memberOf` кидает 404 для не-участника, это ожидаемо.

- [ ] **Step 6: Commit**

```bash
git add server/routes/tactics.js server/app.js server/test/tactics.test.js
git commit -m "feat(tactics): plan routes with ETag/304"
```

---

### Task 4: Маршруты рисунков и удаления плана/очистки

**Files:**
- Modify: `server/routes/tactics.js`
- Test: `server/test/tactics.test.js` (дополнить)

**Interfaces:**
- Consumes: `helpers.planFor/planForManage/limitWrites/readAccess` из Task 3, `validateItem`, `tactic-repo`.
- Produces (HTTP):
  - `POST /api/plans/:pid/items` `{kind:'pencil', geometry, width?, squad?}` → `201 {item, version}`;
  - `PATCH /api/items/:iid` `{geometry?, width?, squad?}` → `{item, version}`;
  - `DELETE /api/items/:iid` → `{version}`;
  - `DELETE /api/plans/:pid` → `{ok}` (членам с `plans_manage` и админу сайта);
  - `POST /api/plans/:pid/clear?squad=<id|none>` → `{version}` (весь план — `plans_manage`; `?squad=` — `plans_manage` или `drawScopeAllowed` для этого отряда).
- Правило рисунка: `canTouchItem(ctx, item)` = `isOwner` или `tactics_draw` и `drawScopeAllowed(ctx, item.squad_id === null, item.squad_id === null ? [] : [item.squad_id])`. Удаление: `canTouchItem` **или** автор (`item.author_id === ctx.userId`) — только удаление.

- [ ] **Step 1: Написать падающие тесты**

Дописать в `server/test/tactics.test.js`:

```js
const PENCIL = [[0.1, 0.1], [0.2, 0.2], [0.3, 0.1]];

async function withSquads(t) {
  const x = await tacticSetup(t);
  const { s, clanId, as, base, mapId } = x;
  const sq = (name) => Number(s.db.prepare(
    "INSERT INTO clan_squads (clan_id, name, color) VALUES (?, ?, '#ff0000')",
  ).run(clanId, name).lastInsertRowid);
  const alpha = sq('Alpha');
  const bravo = sq('Bravo');
  // bob commands Alpha only
  const role = x.grantRole(clanId, 'bob', 'AlphaCmd', 3, PERMS.tactics_view | PERMS.tactics_draw, 0);
  s.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(role, alpha);
  const pid = (await as('alice')('POST', base + '/plans', { mapId, title: 'Plan' })).json.plan.id;
  return { ...x, alpha, bravo, pid };
}

test('drawing for a squad needs tactics_draw and that squad; общий рисунок needs "all squads"', async (t) => {
  const { as, pid, alpha, bravo } = await withSquads(t);
  const ok1 = await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha });
  assert.equal(ok1.status, 201);
  assert.equal(ok1.json.item.squad_id, alpha);
  assert.equal(ok1.json.item.author_id !== null, true);
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: bravo })).status, 403);
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status, 403, 'общий');
  assert.equal((await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status, 201, 'all squads');
  assert.equal((await as('dave')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status, 403, 'no tactics_draw');
});

test('a foreign or missing squad id is rejected', async (t) => {
  const { as, pid, s } = await withSquads(t);
  const other = Number(s.db.prepare("INSERT INTO clans (tag, tag_key, name, name_key, owner_id) VALUES ('ZZ','zz','Other','other',?)")
    .run(s.adminId).lastInsertRowid);
  const foreign = Number(s.db.prepare("INSERT INTO clan_squads (clan_id, name, color) VALUES (?, 'X', '#000000')").run(other).lastInsertRowid);
  const r = await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: foreign });
  assert.equal(r.status, 404);
  assert.equal((await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: 99999 })).status, 404);
});

test('every change bumps the version; parallel strokes are all kept', async (t) => {
  const { as, pid, alpha } = await withSquads(t);
  const v0 = (await as('alice')('GET', '/api/plans/' + pid)).json.plan.version;
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha, width: (i % 3) + 1 })));
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 201, 201]);
  const body = (await as('alice')('GET', '/api/plans/' + pid)).json;
  assert.equal(body.items.length, 6);
  assert.equal(body.plan.version, v0 + 6);
  assert.equal(new Set(results.map((r) => r.json.version)).size, 6, 'each response carries its own version');
});

test('500 drawings per plan', async (t) => {
  const { as, pid, s } = await withSquads(t);
  const planId = s.db.prepare('SELECT id FROM tactic_plans WHERE public_id = ?').get(pid).id;
  const ins = s.db.prepare("INSERT INTO tactic_items (plan_id, kind, geometry) VALUES (?, 'pencil', '[[0,0],[1,1]]')");
  for (let i = 0; i < 500; i++) ins.run(planId);
  const r = await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL });
  assert.deepEqual([r.status, r.json.error], [409, 'items_limit']);
});

test('bad strokes give 400 and write nothing', async (t) => {
  const { as, pid, s } = await withSquads(t);
  for (const geometry of [[], [[0.1, 0.1]], [[0.1, 2], [0.2, 0.2]], 'x']) {
    assert.equal((await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry })).status, 400);
  }
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM tactic_items').get().n, 0);
  assert.equal((await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: Array.from({ length: 2001 }, () => [0.5, 0.5]) })).status, 400);
});

test('the eraser: a squad commander removes only their squad, the author can always remove their own', async (t) => {
  const { as, pid, alpha, bravo, s, clanId, users } = await withSquads(t);
  const a = (await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha })).json.item;
  const b = (await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: bravo })).json.item;
  const g = (await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).json.item;
  assert.equal((await as('bob')('DELETE', '/api/items/' + b.id)).status, 403);
  assert.equal((await as('bob')('DELETE', '/api/items/' + g.id)).status, 403);
  const del = await as('bob')('DELETE', '/api/items/' + a.id);
  assert.equal(del.status, 200);
  assert.equal(typeof del.json.version, 'number');
  // own drawing survives losing tactics_draw
  const mine = (await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha })).json.item;
  s.db.prepare('DELETE FROM clan_member_roles WHERE user_id = ?').run(users.bob.id);
  assert.equal((await as('bob')('DELETE', '/api/items/' + mine.id)).status, 200);
  assert.equal(clanId > 0, true);
});

test('PATCH moves a stroke only when both squads are allowed; geometry is revalidated', async (t) => {
  const { as, pid, alpha, bravo } = await withSquads(t);
  const it = (await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha })).json.item;
  assert.equal((await as('bob')('PATCH', '/api/items/' + it.id, { squad: bravo })).status, 403);
  assert.equal((await as('bob')('PATCH', '/api/items/' + it.id, { geometry: [[0, 0]] })).status, 400);
  const r = await as('bob')('PATCH', '/api/items/' + it.id, { width: 3, geometry: [[0.5, 0.5], [0.6, 0.6]] });
  assert.equal(r.status, 200);
  assert.equal(r.json.item.width, 3);
  assert.deepEqual(r.json.item.geometry, [[0.5, 0.5], [0.6, 0.6]]);
});

test('another clan cannot touch items: 404', async (t) => {
  const { as, pid, s } = await withSquads(t);
  const it = (await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).json.item;
  const { createUser, createSession } = require('../auth');
  const eve = createUser(s.db, { login: 'eve', password: 'eve-pass-123', role: 'user' });
  const cookie = 'sid=' + createSession(s.db, eve, Date.now());
  assert.equal((await s.api('DELETE', '/api/items/' + it.id, { cookie })).status, 404);
  assert.equal((await s.api('POST', `/api/plans/${pid}/items`, { cookie, body: { kind: 'pencil', geometry: PENCIL } })).status, 404);
});

test('clear: whole plan needs plans_manage, one squad needs plans_manage or drawing for that squad', async (t) => {
  const { as, pid, alpha, bravo } = await withSquads(t);
  for (const sq of [alpha, bravo, alpha]) {
    await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: sq });
  }
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/clear`)).status, 403);
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/clear?squad=${bravo}`)).status, 403);
  assert.equal((await as('bob')('POST', `/api/plans/${pid}/clear?squad=${alpha}`)).status, 200);
  let body = (await as('alice')('GET', '/api/plans/' + pid)).json;
  assert.equal(body.items.length, 1);
  assert.equal((await as('carol')('POST', `/api/plans/${pid}/clear`)).status, 200);
  body = (await as('alice')('GET', '/api/plans/' + pid)).json;
  assert.equal(body.items.length, 0);
});

test('delete plan: plans_manage or the site admin; drawings go with it; active slot is free again', async (t) => {
  const { as, pid, base, mapId } = await withSquads(t);
  await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL });
  assert.equal((await as('dave')('DELETE', '/api/plans/' + pid)).status, 403);
  assert.equal((await as('admin')('DELETE', '/api/plans/' + pid)).status, 200);
  assert.equal((await as('alice')('GET', '/api/plans/' + pid)).status, 404);
  const fresh = await as('alice')('POST', base + '/plans', { mapId, title: 'Again' });
  assert.equal(fresh.json.plan.active, true);
});

test('the site admin may delete a drawing but not create one', async (t) => {
  const { as, pid } = await withSquads(t);
  const it = (await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).json.item;
  assert.equal((await as('admin')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status, 403);
  assert.equal((await as('admin')('DELETE', '/api/items/' + it.id)).status, 200);
});

test('write limit: 61st edit within a minute gets 429', async (t) => {
  const { as, pid } = await withSquads(t);
  let last = 0;
  for (let i = 0; i < 61; i++) {
    last = (await as('alice')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL })).status;
    if (last === 429) break;
  }
  assert.equal(last, 429);
});
```

Заметка: тест лимита упрётся и в лимит `500` рисунков — он не достигается (61 < 500). Тест лимитера использует общий лимитер `tacticsWrite`; тесты каждый на своём сервере, поэтому не мешают друг другу.

- [ ] **Step 2: Запустить, убедиться, что падает**

Run: `node --test server/test/tactics.test.js`
Expected: FAIL (новые маршруты отсутствуют → 404 вместо ожидаемых кодов).

- [ ] **Step 3: Реализовать маршруты рисунков**

В `server/routes/tactics.js`: добавить вверху `const { drawScopeAllowed } = require('../clan-permissions');` и `const { validateItem } = require('../tactic-validate');`, перед `module.exports` — хелперы:

```js
// Scope check for one stored or incoming drawing: the member must hold tactics_draw and the squad.
function mayDraw(ctx, squadId) {
  return drawScopeAllowed(ctx, squadId === null, squadId === null ? [] : [squadId]);
}

// A squad id from the client must belong to the plan's clan; anything else reads as "not found".
function squadOfClan(c, clanId, squadId) {
  if (squadId === null) return null;
  const row = c.db.prepare('SELECT id FROM clan_squads WHERE id = ? AND clan_id = ?').get(squadId, clanId);
  if (!row) throw new HttpError(404, 'squad not found');
  return squadId;
}

// The drawing named by the URL, with read access to its plan.
function itemFor(c) {
  need(c);
  const item = tactics.getItem(c.db, intParam(c, 'iid'));
  if (!item) throw new HttpError(404, 'item not found');
  const access = readAccess(c, item.clan_id);
  return { item, ...access };
}
```

Добавить в массив маршрутов:

```js
  {
    method: 'POST',
    pattern: '/api/plans/:pid/items',
    handler: async (c) => {
      planFor(c);
      limitWrites(c);
      const f = checked(validateItem(await readJson(c.req), { create: true }));
      // Everything below runs after the last await: permissions are fresh, count and insert are atomic.
      const { plan, ctx, admin } = planFor(c);
      if (!ctx) throw new HttpError(admin ? 403 : 404, admin ? 'forbidden' : 'not found');
      requirePerm(ctx, 'tactics_draw');
      squadOfClan(c, plan.clan_id, f.squad_id);
      if (!mayDraw(ctx, f.squad_id)) throw new HttpError(403, 'forbidden');
      if (tactics.countItems(c.db, plan.id) >= tactics.LIMITS.items) throw new HttpError(409, 'items_limit');
      return { status: 201, body: tactics.insertItem(c.db, plan, f, c.user.id) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/items/:iid',
    handler: async (c) => {
      itemFor(c);
      limitWrites(c);
      const input = await readJson(c.req);
      const { item, ctx } = itemFor(c);
      if (!ctx) throw new HttpError(403, 'forbidden');
      requirePerm(ctx, 'tactics_draw');
      // The stored kind decides how geometry is checked; a client cannot choose it.
      const f = checked(validateItem({ ...input, __kind: item.kind }));
      if (!Object.keys(f).length) throw new HttpError(400, 'nothing to update');
      if (!mayDraw(ctx, item.squad_id)) throw new HttpError(403, 'forbidden');
      if ('squad_id' in f) {
        squadOfClan(c, item.clan_id, f.squad_id);
        if (!mayDraw(ctx, f.squad_id)) throw new HttpError(403, 'forbidden');
      }
      return { body: tactics.updateItem(c.db, item, f, c.user.id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/items/:iid',
    handler: async (c) => {
      itemFor(c);
      limitWrites(c);
      const { item, ctx, admin } = itemFor(c);
      const own = Boolean(ctx) && item.author_id === ctx.userId;
      const allowed = admin || own || (Boolean(ctx) && has(ctx, 'tactics_draw') && mayDraw(ctx, item.squad_id));
      if (!allowed) throw new HttpError(403, 'forbidden');
      return { body: { version: tactics.deleteItem(c.db, item, c.user.id) } };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/plans/:pid',
    handler: async (c) => {
      const { plan, ctx, admin } = planFor(c);
      limitWrites(c);
      if (!admin) requirePerm(ctx, 'plans_manage');
      c.db.prepare('DELETE FROM tactic_plans WHERE id = ?').run(plan.id);
      return { body: { ok: true } };
    },
  },
  {
    method: 'POST',
    pattern: '/api/plans/:pid/clear',
    handler: async (c) => {
      const { plan, ctx } = planFor(c);
      limitWrites(c);
      if (!ctx) throw new HttpError(403, 'forbidden');
      const q = c.query.get('squad');
      let squadId;
      if (q === null) {
        requirePerm(ctx, 'plans_manage');
        squadId = undefined;
      } else {
        squadId = q === 'none' ? null : Number(q);
        if (squadId !== null && (!Number.isInteger(squadId) || squadId < 1)) throw new HttpError(400, 'bad squad');
        squadOfClan(c, plan.clan_id, squadId);
        if (!has(ctx, 'plans_manage') && !(has(ctx, 'tactics_draw') && mayDraw(ctx, squadId))) {
          throw new HttpError(403, 'forbidden');
        }
      }
      return { body: { version: tactics.clearItems(c.db, plan, squadId, c.user.id) } };
    },
  },
```

Замечание про `DELETE /plans/:pid` для админа: версия плана и каскад — в БД; клиенты получат `404` на следующем опросе (спек: «План удалён»).

Замечание про `__kind`: `validateItem` из Task 2 читает `input.__kind` только на правке; для клиента это безопасно, потому что маршрут перезаписывает `__kind` значением из БД **после** распаковки тела (`{ ...input, __kind: item.kind }`).

- [ ] **Step 4: Запустить тесты**

Run: `node --test server/test/tactics.test.js`
Expected: PASS. Затем весь набор: `node --test server/test/*.test.js tools/*.test.js`.

- [ ] **Step 5: Commit**

```bash
git add server/routes/tactics.js server/test/tactics.test.js
git commit -m "feat(tactics): item routes, eraser rules, clear and delete"
```

---

### Task 5: Удаление отряда обновляет планы

**Files:**
- Modify: `server/routes/clan-roles.js` (обработчик `DELETE /api/clans/:id/squads/:sid`, строки ~205–215)
- Test: `server/test/tactics.test.js` (дополнить)

**Interfaces:**
- Consumes: таблицы `tactic_items`, `tactic_plans`.
- Produces: перед `DELETE FROM clan_squads` версии затронутых планов растут (рисунки отряда станут общими через `ON DELETE SET NULL`, но `version` сам не поменяется).

- [ ] **Step 1: Написать падающий тест**

```js
test('deleting a squad turns its drawings общими and refreshes the plans that held them', async (t) => {
  const { as, pid, alpha, base } = await withSquads(t);
  await as('carol')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha });
  const before = (await as('alice')('GET', '/api/plans/' + pid)).json.plan.version;
  assert.equal((await as('alice')('DELETE', `${base}/squads/${alpha}`)).status, 200);
  const after = (await as('alice')('GET', '/api/plans/' + pid)).json;
  assert.equal(after.items[0].squad_id, null);
  assert.ok(after.plan.version > before);
});
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test server/test/tactics.test.js`
Expected: FAIL (`version` не вырос).

- [ ] **Step 3: Поправить обработчик**

В `DELETE /api/clans/:id/squads/:sid` заменить `c.db.prepare('DELETE FROM clan_squads WHERE id = ?').run(squad.id);` на:

```js
      clanRepo.tx(c.db, () => {
        // Drawings of the squad become общие (ON DELETE SET NULL); pollers must see that.
        c.db.prepare(
          `UPDATE tactic_plans SET version = version + 1, updated_at = datetime('now')
           WHERE id IN (SELECT DISTINCT plan_id FROM tactic_items WHERE squad_id = ?)`,
        ).run(squad.id);
        c.db.prepare('DELETE FROM clan_squads WHERE id = ?').run(squad.id);
      });
```

(`clanRepo` уже импортирован в этом файле; проверить `grep -n "clanRepo" server/routes/clan-roles.js`, иначе добавить `const clanRepo = require('../clan-repo');`.)

Исключение участника из клана/снятие роли версию плана не меняют — рисунки не меняются.

- [ ] **Step 4: Запустить тесты и закоммитить**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

```bash
git add server/routes/clan-roles.js server/test/tactics.test.js
git commit -m "fix(tactics): squad deletion refreshes plan versions"
```

---

### Task 6: Упрощение штриха и условный запрос на клиенте

**Files:**
- Modify: `map-geo.js` (функция `simplify`), `tools/map-geo.test.js`, `map-common.js` (`MapApi.getConditional`)

**Interfaces:**
- Produces:
  - `MapGeo.simplify(points, epsilon): number[][]` — Дуглас–Пекер для массива `[x, y]` (доли 0..1), первая и последняя точки сохраняются, `epsilon` в тех же долях (по умолчанию в UI 0.0005 ≈ 0,05% карты);
  - `MapApi.getConditional(url, etag): Promise<{ status: 200|304, etag: string|null, data: any|null }>`; другие статусы — `Error` с `.status`, как у остальных методов.

- [ ] **Step 1: Написать падающие тесты `simplify`**

В `tools/map-geo.test.js`:

```js
test('simplify keeps the ends and drops points on a straight line', () => {
  const line = Array.from({ length: 11 }, (_, i) => [i / 10, 0.5]);
  assert.deepEqual(Geo.simplify(line, 0.001), [[0, 0.5], [1, 0.5]]);
});

test('simplify keeps a real corner and never returns fewer than 2 points', () => {
  const corner = [[0, 0], [0.5, 0.5], [1, 0]];
  assert.deepEqual(Geo.simplify(corner, 0.01), corner);
  assert.deepEqual(Geo.simplify([[0.1, 0.1], [0.1, 0.1], [0.1, 0.1]], 0.01).length, 2);
  assert.deepEqual(Geo.simplify([[0.3, 0.3]], 0.01), [[0.3, 0.3]]);
});

test('simplify shrinks a dense wiggly stroke below the server limit', () => {
  const stroke = Array.from({ length: 5000 }, (_, i) => [i / 5000, 0.5 + 0.001 * Math.sin(i / 3)]);
  const out = Geo.simplify(stroke, 0.0005);
  assert.ok(out.length < 2000 && out.length >= 2);
  assert.deepEqual(out[0], stroke[0]);
  assert.deepEqual(out[out.length - 1], stroke[stroke.length - 1]);
});
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test tools/map-geo.test.js`
Expected: FAIL (`Geo.simplify is not a function`).

- [ ] **Step 3: Реализовать `simplify`**

В `map-geo.js` перед `return {…}`:

```js
  function distToSegment(p, a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    var len2 = dx * dx + dy * dy;
    var t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var ex = a[0] + t * dx - p[0];
    var ey = a[1] + t * dy - p[1];
    return Math.sqrt(ex * ex + ey * ey);
  }

  // Douglas–Peucker over [x, y] pairs, iterative so a 5000-point stroke cannot overflow the stack.
  function simplify(points, epsilon) {
    var n = points.length;
    if (n <= 2) return points.slice();
    var keep = new Array(n);
    keep[0] = true;
    keep[n - 1] = true;
    var stack = [[0, n - 1]];
    while (stack.length) {
      var seg = stack.pop();
      var first = seg[0];
      var last = seg[1];
      var maxD = 0;
      var idx = -1;
      for (var i = first + 1; i < last; i++) {
        var d = distToSegment(points[i], points[first], points[last]);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (idx !== -1 && maxD > epsilon) {
        keep[idx] = true;
        stack.push([first, idx], [idx, last]);
      }
    }
    return points.filter(function (_, i) { return keep[i]; });
  }
```

и добавить `simplify: simplify,` в возвращаемый объект.

- [ ] **Step 4: Реализовать `MapApi.getConditional`**

В `map-common.js` внутри IIFE после `request`:

```js
  // GET with If-None-Match. A 304 is not an error here: the plan did not change.
  function getConditional(url, etag) {
    var headers = { 'X-Requested-With': 'anoma' };
    if (etag) headers['If-None-Match'] = etag;
    return fetch(url, { method: 'GET', headers: headers, credentials: 'same-origin' }).then(function (res) {
      if (res.status === 304) return { status: 304, etag: res.headers.get('ETag') || etag, data: null };
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { /* not json */ }
        if (!res.ok) {
          var err = new Error((data && data.error) || 'HTTP ' + res.status);
          err.status = res.status;
          throw err;
        }
        return { status: res.status, etag: res.headers.get('ETag'), data: data };
      });
    });
  }
```

и в объект `window.MapApi` — `getConditional: getConditional,`.

- [ ] **Step 5: Тесты и коммит**

Run: `node --test tools/*.test.js`
Expected: PASS.

```bash
git add map-geo.js tools/map-geo.test.js map-common.js
git commit -m "feat(tactics): stroke simplification and conditional GET client"
```

---

### Task 7: Режим «Тактика» — просмотр, опрос, панель плана, фильтр

**Files:**
- Create: `map-tactics.js`
- Modify: `map-app.js`, `map.html`, `map-app.css`

**Interfaces:**
- Consumes: `window.MapViewer` (`state()`, `leaflet()`, `size()`, `notice()`, `onMapLoaded()`, `loadMap()`, `setMode()`, `mode()`, `showCard`), `window.MapApi`, `window.MapGeo`, `window.h`; серверные маршруты Task 3–4; `GET /api/my/clan` (поля `clan`, `me.perms`, `me.isOwner`, `me.drawSquads`, `squads[]`, `roles`, `members`).
- Produces: `window.MapTactics = { start(viewer, opts), stop(), available(), state(), setItem(item, version), dropItem(id, version), applyVersion(version), planPublicId(), canDraw(), squads(), refresh(), onChange(fn) }`; DOM: `#tac-panel` (панель в `.mapwrap`), кнопка `#mob-tactics` в `.mob-tools`.

Правила работы модуля (реализовать буквально):
1. **Кнопка «Тактика»** (`#mob-tactics`) показывается, если у пользователя есть клан и `tactics_view` (иначе скрыта). `map-app.js` в `setupMobileUser()` читает `GET /api/my/clan` для `state.me.user.clan` (запрос только если `user.clan`), кладёт результат в `state.clan` и показывает кнопку. Админ сайта в этапе 2 кнопку не видит (интерфейс админа — этап 3).
2. **Вход в режим:** `V.setMode('tactics')`, `body.tactics`; CSS скрывает `#side` (фильтры категорий и личные метки), полосу `.mbar` и кнопки поиска/меток/фильтров. Слои категорий снимаются с карты (`state.groups[k].remove()`), слой личных меток — новым методом `MapMarks.setSuspended(true)`, редакторы общих объектов и меток ставятся на паузу (`MapEditor.setActive(false)`, `MapMarksEditor.pause()`). Выход возвращает всё: `setSuspended(false)`, `syncVisibility()`, `MapEditor.setActive(true)` для админа в режиме «Общие».
3. **Загрузка:** `GET /api/clans/:id/plans?map=<slug текущей карты>` → выбор плана: `?plan=<publicId>` из URL, иначе активный (`active`), иначе первый, иначе пустое состояние «Нет планов» (кнопка создания — в этапе 2 только для `plans_manage`, в панели).
4. **Опрос:** `setInterval` 15 с, при `document.hidden` пропуск; событие `visibilitychange` при возврате делает немедленный запрос. Запрос — `MapApi.getConditional('/api/plans/' + id, etag)`. `304` → только обновить индикатор «обновлено N с назад». `200` → заменить `items`, перерисовать слой целиком, сохранить `etag`. Ошибки: `404/403` → `stop()` + notice «Доступ к тактике закрыт или план удалён», перечитать `/api/my/clan`, перейти на активный план или закрыть режим; сетевая ошибка → индикатор «нет связи» (опрос продолжается).
5. **Слой:** по одному `L.polyline` на `pencil`: цвет — цвет отряда (`squads` из `/api/my/clan`), общий — `#e9e6d8`; `weight` = 2 + 2·(width−1) = 2/4/6 → CSS-пикселей; `interactive` только в режиме ластика (редактор включает через `setInteractive`).
6. **Фильтр отрядов:** чекбоксы с цветами для каждого отряда + «Общие» + «Только мои отряды» (мои = отряды, где состоит текущий пользователь, из `members[].squads`). Скрытые отряды не рисуются; состояние хранится в памяти (без localStorage).
7. **Индикатор** «обновлено N с назад» — обновляется раз в секунду.
8. **Телефон:** модуль читает всё и рисует без интерактивности; `map-tactics-editor.js` не грузится.

- [ ] **Step 1: Создать `map-tactics.js`**

```js
(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;

  var POLL_MS = 15000;
  var SHARED_COLOR = '#e9e6d8';
  var V = null;
  var S = {
    on: false, clan: null, plans: [], plan: null, items: [], etag: null,
    hiddenSquads: {}, onlyMine: false, updatedAt: 0, online: true,
  };
  var layers = {};
  var group = null;
  var timer = null;
  var clock = null;
  var interactive = false;
  var listeners = [];
  var els = {};

  function squadById(id) {
    return S.clan && S.clan.squads.find(function (s) { return s.id === id; }) || null;
  }
  function mySquadIds() {
    var me = S.clan && S.clan.members.find(function (m) { return m.id === S.clan.me.id; });
    return me ? me.squads : [];
  }
  function colorOf(item) {
    var sq = item.squad_id === null ? null : squadById(item.squad_id);
    return sq ? sq.color : SHARED_COLOR;
  }
  function hasPerm(name) { return !!S.clan && (S.clan.me.isOwner || S.clan.me.perms.indexOf(name) >= 0); }
  function emit() { listeners.forEach(function (fn) { fn(); }); }

  // ---------- drawing layer ----------

  function visible(item) {
    var key = item.squad_id === null ? 'shared' : String(item.squad_id);
    if (S.hiddenSquads[key]) return false;
    if (S.onlyMine && item.squad_id !== null && mySquadIds().indexOf(item.squad_id) < 0) return false;
    return true;
  }

  function weightOf(width) { return 2 + 2 * (width - 1); }

  function makeLayer(item) {
    var size = V.size();
    if (!size) return null;
    // Stage 3 adds the other kinds here; an unknown kind from a newer server is skipped, not fatal.
    if (item.kind !== 'pencil') return null;
    var layer = L.polyline(Geo.pointsToLatLngs(item.geometry, size), {
      color: colorOf(item), weight: weightOf(item.width), opacity: 0.9, lineCap: 'round', lineJoin: 'round',
      interactive: interactive, bubblingMouseEvents: false,
    });
    layer.itemId = item.id;
    return layer;
  }

  function render() {
    if (group) group.remove();
    group = null;
    layers = {};
    if (!S.on || !V.size()) return;
    group = L.layerGroup();
    S.items.forEach(function (it) {
      if (!visible(it)) return;
      var layer = makeLayer(it);
      if (!layer) return;
      layers[it.id] = layer;
      group.addLayer(layer);
    });
    group.addTo(V.leaflet());
    emit();
  }

  function setInteractive(on) {
    interactive = !!on;
    render();
  }

  // ---------- network ----------

  function planUrl() { return '/api/plans/' + encodeURIComponent(S.plan.id); }

  function applyPlanBody(body, etag) {
    S.plan = body.plan;
    S.items = body.items;
    S.etag = etag || '"v' + body.plan.version + '"';
    S.updatedAt = Date.now();
    S.online = true;
    render();
    updatePanel();
  }

  function lostAccess(message) {
    stop(true);
    V.notice(message);
    document.body.dispatchEvent(new CustomEvent('tactics:closed'));
  }

  function poll() {
    if (!S.on || !S.plan || document.hidden) return Promise.resolve();
    var id = S.plan.id;
    return api.getConditional(planUrl(), S.etag).then(function (r) {
      if (!S.on || !S.plan || S.plan.id !== id) return;
      S.online = true;
      S.updatedAt = Date.now();
      if (r.status === 200) applyPlanBody(r.data, r.etag);
      else updatePanel();
    }, function (err) {
      if (err.status === 404 || err.status === 403) {
        // The plan was deleted, or the member lost access: re-read what the clan still offers.
        return reloadClan().then(function () {
          if (!S.clan || !hasPerm('tactics_view')) return lostAccess('Доступ к тактике закрыт.');
          V.notice('План удалён.');
          return loadPlans();
        });
      }
      S.online = false;
      updatePanel();
    });
  }

  function reloadClan() {
    return api.get('/api/my/clan').then(function (body) { S.clan = body.clan ? body : null; }, function () { S.clan = null; });
  }

  function loadPlans(wantedPlan) {
    var map = V.state().map;
    if (!map || !map.published) {
      S.plans = [];
      S.plan = null;
      S.items = [];
      render();
      updatePanel();
      return Promise.resolve();
    }
    return api.get('/api/clans/' + S.clan.clan.id + '/plans?map=' + encodeURIComponent(map.slug)).then(function (plans) {
      S.plans = plans;
      var pick = (wantedPlan && plans.find(function (p) { return p.id === wantedPlan; })) ||
        plans.find(function (p) { return p.active; }) || plans[0] || null;
      if (!pick) {
        S.plan = null;
        S.items = [];
        S.etag = null;
        render();
        updatePanel();
        return null;
      }
      return openPlan(pick.id);
    });
  }

  function openPlan(publicId) {
    return api.get('/api/plans/' + encodeURIComponent(publicId)).then(function (body) {
      applyPlanBody(body, '"v' + body.plan.version + '"');
      updateUrl();
    }, function (err) {
      if (err.status === 404 || err.status === 403) return loadPlans();
      V.notice('Не удалось загрузить план.');
      return null;
    });
  }

  function updateUrl() {
    var q = new URLSearchParams(location.search);
    if (S.on) {
      q.set('tactics', '1');
      if (S.plan) q.set('plan', S.plan.id); else q.delete('plan');
    } else {
      q.delete('tactics');
      q.delete('plan');
    }
    var s = q.toString();
    history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
  }

  // ---------- panel ----------

  function buildPanel() {
    els.title = h('select', { 'aria-label': 'План', onchange: function () { openPlan(els.title.value); } });
    els.state = h('span', { class: 'tac-state' });
    els.squads = h('ul', { class: 'tac-squads' });
    els.empty = h('p', { class: 'hint', hidden: true }, 'Для этой карты у клана нет планов.');
    els.create = h('button', { type: 'button', class: 'primary', hidden: true, onclick: createPlan }, 'Создать план');
    els.rename = h('button', { type: 'button', hidden: true, onclick: renamePlan }, 'Переименовать');
    els.activate = h('button', { type: 'button', hidden: true, onclick: activatePlan }, 'Сделать активным');
    els.del = h('button', { type: 'button', class: 'danger', hidden: true, onclick: deletePlan }, 'Удалить');
    els.panel = h('aside', { id: 'tac-panel', class: 'tac-panel', hidden: true },
      h('div', { class: 'tac-head' }, h('strong', null, 'Тактика'), h('span', { class: 'grow' }), els.state),
      els.title, els.empty,
      h('div', { class: 'tac-plan-btns' }, els.create, els.rename, els.activate, els.del),
      els.squads,
      h('div', { id: 'tac-tools-slot' }));
    document.querySelector('.mapwrap').appendChild(els.panel);
  }

  function updateState() {
    if (!els.state) return;
    if (!S.online) { els.state.textContent = 'нет связи'; els.state.className = 'tac-state bad'; return; }
    var sec = Math.max(0, Math.round((Date.now() - S.updatedAt) / 1000));
    els.state.textContent = S.plan ? 'обновлено ' + sec + ' с назад' : '';
    els.state.className = 'tac-state';
  }

  function updatePanel() {
    if (!els.panel) return;
    els.panel.hidden = !S.on;
    els.title.textContent = '';
    S.plans.forEach(function (p) {
      els.title.appendChild(h('option', { value: p.id, selected: !!S.plan && S.plan.id === p.id },
        (p.active ? '★ ' : '') + p.title));
    });
    els.title.hidden = S.plans.length === 0;
    els.empty.hidden = S.plans.length !== 0;
    var manage = hasPerm('plans_manage');
    els.create.hidden = !manage;
    els.rename.hidden = !manage || !S.plan;
    els.activate.hidden = !manage || !S.plan || S.plan.active;
    els.del.hidden = !manage || !S.plan;
    renderSquadFilter();
    updateState();
  }

  function renderSquadFilter() {
    els.squads.textContent = '';
    if (!S.clan) return;
    function row(key, name, color) {
      var cb = h('input', {
        type: 'checkbox', checked: !S.hiddenSquads[key],
        onchange: function () { S.hiddenSquads[key] = !cb.checked; render(); },
      });
      els.squads.appendChild(h('li', null, h('label', { class: 'tac-row' },
        cb, h('span', { class: 'tac-dot', style: 'background:' + color }), h('span', { class: 'cat-name' }, name))));
    }
    S.clan.squads.forEach(function (sq) { row(String(sq.id), sq.name, sq.color); });
    row('shared', 'Общие', SHARED_COLOR);
    var mine = h('input', {
      type: 'checkbox', checked: S.onlyMine,
      onchange: function () { S.onlyMine = mine.checked; render(); },
    });
    els.squads.appendChild(h('li', null, h('label', { class: 'tac-row' }, mine, h('span', { class: 'cat-name' }, 'Только мои отряды'))));
  }

  function createPlan() {
    var title = window.prompt('Название плана');
    if (!title) return;
    var map = V.state().map;
    api.post('/api/clans/' + S.clan.clan.id + '/plans', { mapId: map.id, title: title }).then(function (body) {
      return loadPlans(body.plan.id);
    }, planError);
  }

  function renamePlan() {
    var title = window.prompt('Новое название', S.plan.title);
    if (!title) return;
    api.patch(planUrl(), { title: title }).then(function () { return loadPlans(S.plan.id); }, planError);
  }

  function activatePlan() {
    api.post(planUrl() + '/activate').then(function () { return loadPlans(S.plan.id); }, planError);
  }

  function deletePlan() {
    if (!window.confirm('Удалить план «' + S.plan.title + '» вместе со всеми рисунками?')) return;
    api.del(planUrl()).then(function () { return loadPlans(); }, planError);
  }

  function planError(err) {
    var text = {
      plans_limit: 'Достигнут лимит: 25 планов.',
      title_invalid: 'Название: от 1 до 60 символов.',
    }[err.message];
    V.notice(text || (err.status === 429 ? 'Слишком часто, подождите минуту.' : 'Ошибка: ' + err.message));
  }

  // ---------- start / stop ----------

  function start(viewer, clanBody, opts) {
    V = viewer;
    S.clan = clanBody;
    S.on = true;
    S.hiddenSquads = {};
    S.onlyMine = false;
    document.body.classList.add('tactics');
    if (!els.panel) {
      buildPanel();
      document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
      V.onMapLoaded(function () { if (S.on) loadPlans(); });
    }
    clearInterval(timer);
    clearInterval(clock);
    timer = setInterval(poll, POLL_MS);
    clock = setInterval(updateState, 1000);
    updatePanel();
    return loadPlans(opts && opts.plan).then(updateUrl);
  }

  function stop(silent) {
    S.on = false;
    clearInterval(timer);
    clearInterval(clock);
    document.body.classList.remove('tactics');
    if (group) group.remove();
    group = null;
    layers = {};
    if (els.panel) els.panel.hidden = true;
    if (!silent) updateUrl();
  }

  // ---------- edits made by the editor ----------

  // The server answered with the new version; our own write must not look like a foreign change on the next poll.
  function applyVersion(version) {
    if (S.plan) { S.plan.version = version; S.etag = '"v' + version + '"'; }
  }

  function setItem(item, version) {
    var i = S.items.findIndex(function (x) { return x.id === item.id; });
    if (i < 0) S.items.push(item); else S.items[i] = item;
    applyVersion(version);
    render();
  }

  function dropItem(id, version) {
    S.items = S.items.filter(function (x) { return x.id !== id; });
    applyVersion(version);
    render();
  }

  window.MapTactics = {
    start: start,
    stop: stop,
    active: function () { return S.on; },
    plan: function () { return S.plan; },
    clan: function () { return S.clan; },
    planPublicId: function () { return S.plan ? S.plan.id : null; },
    canDraw: function () { return hasPerm('tactics_draw'); },
    canManage: function () { return hasPerm('plans_manage'); },
    squads: function () { return S.clan ? S.clan.squads : []; },
    drawSquads: function () { return S.clan ? S.clan.me.drawSquads : []; },
    colorOf: colorOf,
    layers: function () { return layers; },
    itemById: function (id) { return S.items.find(function (x) { return x.id === id; }) || null; },
    setInteractive: setInteractive,
    setItem: setItem,
    dropItem: dropItem,
    applyVersion: applyVersion,
    refresh: poll,
    reloadPlans: function () { return loadPlans(S.plan && S.plan.id); },
    onChange: function (fn) { listeners.push(fn); },
  };
})();
```

Замечания исполнителю: (а) `window.prompt`/`confirm` использованы так же, как `confirm` в `map-marks-editor.js`; (б) `CustomEvent('tactics:closed')` слушает `map-app.js` для выхода из режима.

- [ ] **Step 2: Подключить в `map-app.js`**

Изменения:

1. В `state` добавить `clan: null`.
2. В `setupMobileUser()` после блока админа:

```js
    var tacBtn = $('mob-tactics');
    if (tacBtn && state.me.user && state.me.user.clan) {
      api.get('/api/my/clan').then(function (body) {
        if (!body.clan) return;
        state.clan = body;
        var can = body.me.isOwner || body.me.perms.indexOf('tactics_view') >= 0;
        tacBtn.hidden = !can;
        if (can && new URLSearchParams(location.search).get('tactics') === '1') enterTactics();
      }, function () { /* the button simply stays hidden */ });
    }
```

3. Функции режима:

```js
  var tacticsReady = null;

  function loadTactics() {
    if (!tacticsReady) tacticsReady = loadScript('/map-tactics.js');
    return tacticsReady;
  }

  function enterTactics() {
    if (!state.clan || state.mode === 'tactics') return;
    state.prevMode = state.mode;
    state.mode = 'tactics';
    closeCard(true);
    Object.keys(state.groups).forEach(function (k) { state.groups[k].remove(); });
    // The shared and personal editors stop drawing; the personal marks layer is hidden for the mode.
    if (window.MapEditor) window.MapEditor.setActive(false);
    if (window.MapMarksEditor) window.MapMarksEditor.pause();
    if (window.MapMarks) window.MapMarks.setSuspended(true);
    state.drawTool = false;
    loadTactics().then(function () {
      var q = new URLSearchParams(location.search);
      return window.MapTactics.start(window.MapViewer, state.clan, { plan: q.get('plan') });
    }).then(function () {
      $('mob-tactics').classList.add('on');
      if (window.matchMedia('(min-width: 900px)').matches && window.MapTactics.canDraw()) {
        return loadScript('/map-tactics-editor.js').then(function () { window.MapTacticsEditor.start(window.MapViewer, window.MapTactics); });
      }
      return null;
    }).catch(function () { notice('Не удалось открыть тактику.'); leaveTactics(); });
  }

  function leaveTactics() {
    if (state.mode !== 'tactics') return;
    state.mode = state.prevMode || 'shared';
    if (window.MapTactics) window.MapTactics.stop();
    if (window.MapTacticsEditor) window.MapTacticsEditor.stop();
    $('mob-tactics').classList.remove('on');
    if (window.MapMarks) window.MapMarks.setSuspended(false);
    // Hand the toolbars back: the admin returns to the editor mode they left, others to their marks.
    if (window.MapEditor && state.mode === 'shared') window.MapEditor.setActive(true);
    syncVisibility();
    updateUrl();
  }
```

4. В `init()` после `createMap()`: `$('mob-tactics').addEventListener('click', function () { state.mode === 'tactics' ? leaveTactics() : enterTactics(); });` и `document.body.addEventListener('tactics:closed', leaveTactics);`.
5. `updateUrl()` не должен затирать `tactics`/`plan`: в начале — `if (state.mode === 'tactics') { q.set('tactics', '1'); var pid = window.MapTactics && window.MapTactics.planPublicId(); if (pid) q.set('plan', pid); }`.
6. В `loadMap` (вызывается при смене карты): режим остаётся, `MapTactics` сам перезагружает планы через `onMapLoaded`; но `renderAll()` вернёт слои категорий — поэтому в `renderAll()` в конце: `if (state.mode === 'tactics') Object.keys(state.groups).forEach(function (k) { state.groups[k].remove(); });`.
7. Экспортировать в `window.MapViewer`: `setMode`/`mode` уже есть; режимы теперь `'shared' | 'marks' | 'tactics'`.

- [ ] **Step 2b: Пауза чужих редакторов и слоя меток**

В `map-marks.js`: рядом с `var visible = true;` добавить `var suspended = false;`; в `syncVisibility()` заменить условие на `if (visible && !suspended) group.addTo(V.leaflet()); else group.remove();`; в экспорт `window.MapMarks` добавить:

```js
    // Tactics mode hides the layer without touching the user's checkbox.
    setSuspended: function (on) { suspended = !!on; syncVisibility(); },
```

В `map-marks-editor.js` перед `window.MapMarksEditor = …` добавить `function pause() { setTool('select'); deselect(); }` и экспортировать `pause: pause`. (`setTool('select')` отключает Geoman-рисование, `deselect()` выключает правку вершин.)

- [ ] **Step 3: Разметка и стили**

В `map.html` в `#mob-tools` добавить после `#mob-mod`:
`<button id="mob-tactics" class="mob-ico" type="button" aria-label="Тактика" title="Тактика клана" hidden></button>`;
в `map-app.js` `setupMobile()` — `$('mob-tactics').appendChild(mobIcon('tactics'))`, а в `MOB_ICONS` — `tactics: '<path d="M4 20 10 8l4 6 6-10"/><circle cx="4" cy="20" r="1.2"/><circle cx="20" cy="4" r="1.2"/>'`.
Подключить `<script src="/map-tactics.js">` **не нужно** (грузится лениво). Поднять версию `20261013a` → `20261014a` во всех `?v=` и `window.MAP_V` в `map.html`.

В `map-app.css`:

```css
/* tactics mode */
.mob-ico.on { background: var(--accent); color: #151510; }
body.tactics #side, body.tactics .mbar, body.tactics #mob-search, body.tactics #mob-marks,
body.tactics #mob-filters, body.tactics #mob-mod { display: none !important; }
.tac-panel {
  position: absolute; z-index: 1100; top: 124px; left: 10px; width: 320px; max-height: calc(100% - 140px); overflow: auto;
  padding: 10px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, .6);
}
.tac-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.tac-state { color: var(--muted); font-size: 12px; }
.tac-state.bad { color: var(--danger); }
.tac-plan-btns { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; }
.tac-squads { list-style: none; margin: 8px 0 0; padding: 0; }
.tac-row { display: flex; align-items: center; gap: 8px; padding: 4px 2px; cursor: pointer; }
.tac-dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
@media (max-width: 720px) {
  .tac-panel { right: 10px; width: auto; top: 124px; }
}
```

- [ ] **Step 4: Ручная проверка просмотра (браузер; фронтенд автотестами не покрыт)**

Локальный запуск — `RELEASE.md` → «Локальная разработка», страница `http://localhost:3000/map`. Подготовка: клан, роль с `tactics_view` у `@everyone`, два плана, штрих через `curl`/тесты в БД. Проверить:
- кнопка «Тактика» видна только участнику клана с `tactics_view`; у гостя и не-участника скрыта;
- вход в режим скрывает категории и метки, показывает панель; выход возвращает слои;
- на 375 px панель не даёт горизонтальной прокрутки, рисовать нельзя;
- вторая вкладка рисует штрих (через API) → в течение ≤15 с он появляется; во вкладке DevTools → Network идут `304` пустые;
- скрытая вкладка не опрашивает; при возврате — немедленный запрос;
- удаление плана во второй вкладке → «План удалён», переход на другой план;
- снять `tactics_view` у роли → следующий опрос закрывает режим с сообщением, без ошибок в консоли;
- `/map?tactics=1&plan=<id>` открывает нужный план.

- [ ] **Step 5: Commit**

```bash
git add map-tactics.js map-app.js map.html map-app.css
git commit -m "feat(tactics): tactics mode on /map — view, polling, plan panel, squad filter"
```

---

### Task 8: Карандаш и ластик (только ПК)

**Files:**
- Create: `map-tactics-editor.js`
- Modify: `map-app.css`

**Interfaces:**
- Consumes: `window.MapTactics` (Task 7: `canDraw`, `drawSquads`, `squads`, `planPublicId`, `colorOf`, `layers`, `itemById`, `setItem`, `dropItem`, `setInteractive`, `refresh`), `window.MapGeo.simplify/fromLatLng`, `window.MapApi`.
- Produces: `window.MapTacticsEditor = { start(viewer, tactics), stop() }`; панель инструментов в `#tac-tools-slot`.

Поведение:
- Инструменты: Карандаш (по умолчанию) и Ластик; выбор «рисую за: [отряд ▾]» — только отряды из `drawSquads` (при `drawSquads === 'all'` — все отряды и «Общие»); толщина 1/2/3; клавиши: `P` карандаш, `E` ластик, `1–9` отряд по порядку, `Esc` — отмена штриха/инструмента.
- Карандаш: при активном карандаше `map.dragging.disable()`, рисуем по `mousedown`(левая кнопка) → `mousemove` → `mouseup`; точки собираются из `e.latlng` → `Geo.fromLatLng(...)` → `[x, y]`; перетаскивание карты — правой кнопкой (`contextmenu` отключить на карте) **или** пробел + мышь (пока пробел зажат, `dragging.enable()`).
- По `mouseup`: `Geo.simplify(points, 0.0005)`, затем если точек < 2 — игнор; иначе `POST /api/plans/:pid/items`, временный полупрозрачный `L.polyline` показывается сразу; успех → `MapTactics.setItem(item, version)` и убрать временный; ошибка сети → временный остаётся с `opacity .4` и кнопкой «Повторить» в панели (список неотправленных штрихов); `403/404` → сообщение, штрих убран.
- Ластик: `MapTactics.setInteractive(true)`; клик по штриху → `DELETE /api/items/:id` → `dropItem(id, version)`; `403` → сообщение «Нет права стирать рисунки этого отряда».
- Если `MapTactics.planPublicId()` равен null (нет плана) — инструменты неактивны, подсказка «Создайте или выберите план».
- Выход из режима (`stop()`): вернуть `dragging.enable()`, убрать слушатели.

- [ ] **Step 1: Создать `map-tactics-editor.js`**

```js
(function () {
  'use strict';

  var api = window.MapApi;
  var h = window.h;
  var Geo = window.MapGeo;

  var EPSILON = 0.0005;
  var V = null;
  var T = null;
  var map = null;
  var ed = { tool: 'pencil', squad: null, width: 2, drawing: false, points: [], temp: null, spaceDown: false };
  var pending = []; // strokes that could not be sent: { body, layer }
  var els = {};
  var bound = false;

  function active() { return V.mode() === 'tactics' && !!T.planPublicId(); }

  // ---------- panel ----------

  function allowedSquads() {
    var all = T.squads();
    var ds = T.drawSquads();
    var list = ds === 'all' ? all : all.filter(function (s) { return ds.indexOf(s.id) >= 0; });
    var out = list.map(function (s) { return { id: s.id, name: s.name, color: s.color }; });
    if (ds === 'all') out.push({ id: null, name: 'Общие', color: '#e9e6d8' });
    return out;
  }

  function buildPanel() {
    els.tool = {};
    var tools = h('div', { class: 'tac-tools' });
    [['pencil', 'Карандаш (P)'], ['eraser', 'Ластик (E)']].forEach(function (t) {
      els.tool[t[0]] = h('button', { type: 'button', onclick: function () { setTool(t[0]); } }, t[1]);
      tools.appendChild(els.tool[t[0]]);
    });
    els.squad = h('select', { 'aria-label': 'Рисую за отряд', onchange: function () {
      ed.squad = els.squad.value === '' ? null : Number(els.squad.value);
    } });
    els.widths = h('div', { class: 'tac-widths' });
    [1, 2, 3].forEach(function (w) {
      var b = h('button', { type: 'button', onclick: function () { ed.width = w; updateTools(); } }, String(w));
      els.widths.appendChild(b);
    });
    els.hint = h('p', { class: 'hint' }, 'Карту двигайте правой кнопкой или пробелом.');
    els.status = h('p', { class: 'hint tac-status' });
    els.retry = h('div', { class: 'tac-retry' });
    els.box = h('div', { class: 'tac-editor' },
      tools, h('label', null, 'Рисую за'), els.squad, h('label', null, 'Толщина'), els.widths,
      els.hint, els.status, els.retry);
    document.getElementById('tac-tools-slot').appendChild(els.box);
    fillSquads();
    updateTools();
  }

  function fillSquads() {
    els.squad.textContent = '';
    var list = allowedSquads();
    list.forEach(function (s) {
      els.squad.appendChild(h('option', { value: s.id === null ? '' : String(s.id) }, s.name));
    });
    if (list.length === 0) {
      els.squad.appendChild(h('option', { value: '' }, 'нет доступных отрядов'));
      ed.squad = null;
      return;
    }
    if (!list.some(function (s) { return s.id === ed.squad; })) ed.squad = list[0].id;
    els.squad.value = ed.squad === null ? '' : String(ed.squad);
  }

  function updateTools() {
    Object.keys(els.tool).forEach(function (k) { els.tool[k].classList.toggle('on', ed.tool === k); });
    Array.prototype.forEach.call(els.widths.children, function (b, i) { b.classList.toggle('on', ed.width === i + 1); });
    els.box.classList.toggle('disabled', !T.planPublicId());
    els.status.textContent = T.planPublicId() ? '' : 'Создайте или выберите план.';
  }

  function say(text) { els.status.textContent = text || ''; }

  // ---------- tools ----------

  function setTool(tool) {
    cancelStroke();
    ed.tool = tool;
    map.getContainer().classList.toggle('tac-pencil', tool === 'pencil');
    if (tool === 'pencil') map.dragging.disable(); else map.dragging.enable();
    T.setInteractive(tool === 'eraser');
    updateTools();
  }

  function color() {
    var sq = allowedSquads().find(function (s) { return s.id === ed.squad; });
    return sq ? sq.color : '#e9e6d8';
  }

  function cancelStroke() {
    ed.drawing = false;
    ed.points = [];
    if (ed.temp) { ed.temp.remove(); ed.temp = null; }
  }

  function onDown(e) {
    if (!active() || ed.tool !== 'pencil' || ed.spaceDown) return;
    if (e.originalEvent && e.originalEvent.button !== 0) return;
    ed.drawing = true;
    ed.points = [e.latlng];
    ed.temp = L.polyline([e.latlng], {
      color: color(), weight: 2 + 2 * (ed.width - 1), opacity: 0.9, interactive: false,
    }).addTo(map);
  }

  function onMove(e) {
    if (!ed.drawing) return;
    ed.points.push(e.latlng);
    ed.temp.addLatLng(e.latlng);
  }

  function onUp() {
    if (!ed.drawing) return;
    var size = V.size();
    var raw = ed.points.map(function (ll) {
      var p = Geo.fromLatLng(ll, size);
      return [p.x, p.y];
    });
    var temp = ed.temp;
    ed.drawing = false;
    ed.points = [];
    ed.temp = null;
    var pts = Geo.simplify(raw, EPSILON);
    if (pts.length < 2) { if (temp) temp.remove(); return; }
    if (pts.length > 2000) pts = Geo.simplify(raw, EPSILON * 4);
    send({ kind: 'pencil', geometry: pts, width: ed.width, squad: ed.squad }, temp);
  }

  // The stroke is already on the map (temp layer); the server answer replaces it with the real one.
  function send(body, temp) {
    temp.setStyle({ opacity: 0.5 });
    var pid = T.planPublicId();
    api.post('/api/plans/' + encodeURIComponent(pid) + '/items', body).then(function (r) {
      temp.remove();
      removePending(temp);
      if (T.planPublicId() === pid) T.setItem(r.item, r.version);
      say('Сохранено');
    }, function (err) {
      if (err.status === 403) {
        temp.remove();
        say('Нет права рисовать для этого отряда.');
      } else if (err.status === 404 || err.status === 401) {
        temp.remove();
        say('План недоступен.');
        T.refresh();
      } else if (err.status === 429) {
        keepForRetry(body, temp, 'Слишком часто, подождите минуту.');
      } else if (err.message === 'items_limit') {
        temp.remove();
        say('В плане уже 500 рисунков.');
      } else if (err.status === 400) {
        temp.remove();
        say('Штрих не принят сервером.');
      } else {
        keepForRetry(body, temp, 'Нет связи.');
      }
    });
  }

  function keepForRetry(body, temp, text) {
    say(text);
    pending.push({ body: body, layer: temp });
    renderRetry();
  }

  function removePending(layer) {
    pending = pending.filter(function (p) { return p.layer !== layer; });
    renderRetry();
  }

  function renderRetry() {
    els.retry.textContent = '';
    if (!pending.length) return;
    els.retry.appendChild(h('button', { type: 'button', onclick: function () {
      var list = pending.slice();
      pending = [];
      renderRetry();
      list.forEach(function (p) { send(p.body, p.layer); });
    } }, 'Повторить (' + pending.length + ')'));
    els.retry.appendChild(h('button', { type: 'button', class: 'danger', onclick: function () {
      pending.forEach(function (p) { p.layer.remove(); });
      pending = [];
      renderRetry();
    } }, 'Отбросить'));
  }

  // ---------- eraser ----------

  function onLayerClick(e) {
    if (!active() || ed.tool !== 'eraser') return;
    var target = e.target;
    if (!target || target.itemId === undefined) return;
    var id = target.itemId;
    api.del('/api/items/' + id).then(function (r) {
      T.dropItem(id, r.version);
      say('Стёрто');
    }, function (err) {
      if (err.status === 403) say('Нет права стирать рисунки этого отряда.');
      else if (err.status === 404) { say('Рисунок уже удалён.'); T.refresh(); }
      else say('Ошибка: ' + err.message);
    });
  }

  // ---------- keyboard ----------

  function onKey(e) {
    if (V.mode() !== 'tactics') return;
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.type === 'keyup') {
      if (e.code === 'Space') { ed.spaceDown = false; if (ed.tool === 'pencil') map.dragging.disable(); }
      return;
    }
    if (e.code === 'Space') {
      if (ed.tool === 'pencil' && !ed.spaceDown) { ed.spaceDown = true; cancelStroke(); map.dragging.enable(); }
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (ed.drawing) cancelStroke(); else setTool('pencil');
    } else if (e.key === 'p' || e.key === 'P' || e.key === 'з' || e.key === 'З') {
      setTool('pencil');
    } else if (e.key === 'e' || e.key === 'E' || e.key === 'у' || e.key === 'У') {
      setTool('eraser');
    } else if (/^[1-9]$/.test(e.key)) {
      var list = allowedSquads();
      var s = list[Number(e.key) - 1];
      if (s) { ed.squad = s.id; els.squad.value = s.id === null ? '' : String(s.id); }
    }
  }

  // ---------- start / stop ----------

  function start(viewer, tactics) {
    V = viewer;
    T = tactics;
    map = V.leaflet();
    if (!bound) {
      bound = true;
      map.on('mousedown', onDown);
      map.on('mousemove', onMove);
      map.on('mouseup', onUp);
      map.getContainer().addEventListener('contextmenu', function (ev) {
        if (V.mode() === 'tactics') ev.preventDefault();
      });
      document.addEventListener('keydown', onKey);
      document.addEventListener('keyup', onKey);
      // Eraser clicks arrive from the polylines; one delegated handler on the map container is not
      // possible for SVG paths in Leaflet, so every redraw re-binds through this hook.
      T.onChange(function () {
        Object.keys(T.layers()).forEach(function (id) {
          var layer = T.layers()[id];
          layer.off('click', onLayerClick);
          layer.on('click', onLayerClick);
        });
        fillSquads();
        updateTools();
      });
    }
    buildPanel();
    setTool('pencil');
  }

  function stop() {
    if (!map) return;
    cancelStroke();
    map.dragging.enable();
    map.getContainer().classList.remove('tac-pencil');
    pending.forEach(function (p) { p.layer.remove(); });
    pending = [];
    if (els.box && els.box.parentNode) els.box.parentNode.removeChild(els.box);
    T.setInteractive(false);
  }

  window.MapTacticsEditor = { start: start, stop: stop };
})();
```

Замечание: `start()` можно вызвать повторно (повторный вход в режим); обработчики карты вешаются один раз (`bound`), панель строится заново — старая удаляется в `stop()`.

- [ ] **Step 2: Стили**

В `map-app.css`:

```css
.map.tac-pencil, .map.tac-pencil .leaflet-interactive { cursor: crosshair; }
.tac-editor { margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border); }
.tac-editor label { display: block; margin: 8px 0 2px; color: var(--muted); font-size: 12px; }
.tac-editor.disabled { opacity: .5; pointer-events: none; }
.tac-tools, .tac-widths, .tac-retry { display: flex; gap: 6px; flex-wrap: wrap; }
.tac-status { min-height: 18px; }
```

- [ ] **Step 3: Ручная проверка (браузер, ПК ≥ 900 px)**

- Карандаш: зажать ЛКМ и вести — линия цвета выбранного отряда; отпустить — штрих остаётся, во второй вкладке (другой участник) появляется ≤15 с;
- перетаскивание карты ПКМ и пробелом работает, колесо — масштаб;
- в списке «Рисую за» только разрешённые отряды; у `draw_all_squads=0` без «Общие»;
- ластик: клик по штриху своего отряда — стирается; по чужому — сообщение, без ошибки в консоли;
- отключить сеть (DevTools → Offline), нарисовать штрих → он полупрозрачный, «Повторить» после включения сети отправляет; «Отбросить» убирает;
- сделать 2 быстрых штриха подряд — оба сохранены; в плане без выбранного плана инструменты серые;
- клавиши `P`, `E`, `1`, `Esc`; ввод в поле «Название плана» (`prompt`) не триггерит инструменты;
- на ширине < 900 px редактор не грузится, панель показывает только план и фильтр.

- [ ] **Step 4: Commit**

```bash
git add map-tactics-editor.js map-app.css
git commit -m "feat(tactics): pencil and eraser (desktop)"
```

---

### Task 9: Документация и выкатка

**Files:**
- Modify: `RELEASE.md` (раздел «Кланы» → «Тактика»), `CLAUDE.md` (статус и список файлов), `docs/superpowers/specs/2026-10-13-clans-tactics-design.md` (пометка «этап 2 реализован»)

- [ ] **Step 1: RELEASE.md**

Добавить раздел «Тактика (этап 2)»: миграция 7 применяется сама при старте `anoma-api`; новых nginx-блоков нет (`/api/` уже проксируется, `/map` отдаёт `map.html`); после выкатки проверить `curl -i -H 'X-Requested-With: x' https://anoma-wiki.ru/api/plans/xxxxxxxxxxxx` → `401` (гость) и что nginx не добавляет `Cache-Control` к `/api/` (иначе `ETag`/`304` ломаются), и пример проверки `304`: `curl -i -H 'If-None-Match: "v1"' -b 'sid=…' …/api/plans/<id>` → `HTTP/1.1 304`. Бэкап БД покрывает новые таблицы (одна SQLite-база).

- [ ] **Step 2: CLAUDE.md**

В «Сделано» добавить пункт «Тактика кланов (этап 2)…», в «Не сделано» оставить этап 3; в «Files» — `map-tactics.js`, `map-tactics-editor.js`, `server/routes/tactics.js`, `server/tactic-*.js`; в «Как продолжить» без изменений.

- [ ] **Step 3: Полный прогон и коммит**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS, число тестов выросло.

```bash
git add RELEASE.md CLAUDE.md docs/superpowers/specs/2026-10-13-clans-tactics-design.md
git commit -m "docs(tactics): stage 2 release notes and project status"
```
