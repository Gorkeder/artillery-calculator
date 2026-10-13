# Тактическая карта кланов (этап 3: стрелка, зона, метка, текст, интерфейс админа) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Командиры рисуют на плане стрелки, зоны, метки с иконками и текст; админ сайта открывает тактику любого клана (чтение и удаление) и управляет кланами из интерфейса; в `/privacy` описана тактика.

**Architecture:** Валидатор этапа 2 (`server/tactic-validate.js`) становится таблицей видов: у каждого вида своя проверка геометрии, `label` и `icon`; маршруты и репозиторий уже умеют `label`/`icon`. Два админских маршрута (`server/routes/admin-clans.js`) отдают список кланов и состав клана с id. На клиенте `map-tactics.js` получает отрисовку четырёх видов (стрелка = линия + повёрнутый наконечник-маркер, зона = полигон с подписью, метка и текст = `L.marker` с `divIcon`), `map-tactics-editor.js` — инструменты и поля подписи; админ входит в режим через выбор клана и получает только ластик.

**Tech Stack:** Node 22+ (`node:http`, `node:sqlite`, `node:test`), без npm-зависимостей; фронтенд — ES5 без сборки, Leaflet, `window.MapApi`/`window.h`.

**Spec:** `docs/superpowers/specs/2026-10-13-clans-tactics-design.md` (таблица «Геометрия рисунков», «Права → Админ сайта», «Режим Тактика → Админ», этап 3). Предыдущий этап — `docs/superpowers/plans/2026-10-13-clans-tactics-stage2.md` (должен быть выполнен: этот план правит его файлы).

## Global Constraints

- Node 22+, без npm-зависимостей; тесты: `node --test server/test/*.test.js tools/*.test.js`. Сборки и линтера нет.
- Геометрия по видам (из спека, точно): `pencil` 2..2000 точек; `arrow` 2..50 точек, стрелка на последней; `zone` 3..200 точек (замкнутый контур, первая точка не повторяется); `marker` `[x,y]`, `icon` из набора, `label` ≤ 60; `text` `[x,y]`, `label` 1..120. У `zone` `label` необязателен (≤ 60).
- Иконки меток (8): `gather` сбор, `attack` атака, `defend` оборона, `enemy` враг, `artillery` артиллерия, `sniper` снайпер, `danger` опасность, `question` вопрос.
- Права рисования те же, что у карандаша: `tactics_draw` + отряд из `drawSquads` (общий рисунок — только при «все отряды»). Лимиты прежние: 500 рисунков на план, 60 правок в минуту.
- Координаты — доли 0..1, округление до 5 знаков (уже в валидаторе).
- Пользовательский текст (`label`, названия) на клиенте выводится только через `textContent`/`h()` — никогда `innerHTML`.
- Админ сайта: читает любой клан, удаляет план и рисунки; рисовать не может (в интерфейсе — только ластик); клановые настройки (название, тег, описание, эмблема, удаление, `clans_blocked`) уже есть в API этапа 1, здесь добавляется интерфейс.
- Параметры маршрутов — только строчные буквы (`:id`): роутер ловит ключ регексом `:([a-z]+)`.
- Рисование — только на ПК (`min-width: 900px`); на телефоне новые виды только отображаются.
- Русский текст интерфейса; ширина 375 px без горизонтальной прокрутки. Версию `?v=` и `window.MAP_V` в `map.html` и `clan.html` менять при правках.

## Review Focus

1. **Метка/текст с HTML-разметкой в подписи** (`<img src=x onerror=…>`, `</div>`): на странице показывается как текст, ничего не исполняется. Тест — Task 3 (ручной) + Task 1 (сервер хранит как есть, без изменений).
2. **Подпись из пробелов, управляющих символов, 121 символ; текст без подписи**: `400`, в БД ничего. Тест — Task 1.
3. **`icon` не из набора, `icon` у стрелки/текста, `label` у карандаша/стрелки**: `400`, а не молча проигнорировано. Тест — Task 1.
4. **Зона с самопересечением и стрелка из 50/51 точек**: 50 — принимается, 51 — `400`; самопересечение допустимо. Тест — Task 1.
5. **Не-админ дёргает админские маршруты** (гость `401`, игрок/лидер клана `403`); админ без клана видит составы и удаляет рисунки, но `POST items` → `403`. Тест — Task 2.

---

## Файлы

| Файл | Ответственность |
|------|-----------------|
| `server/tactic-validate.js` (изменить) | таблица видов, `label`, `icon`, `TACTIC_ICONS` |
| `server/routes/admin-clans.js` (новый) | `GET /api/admin/clans`, `GET /api/admin/clans/:id` |
| `server/app.js` (изменить) | регистрация `admin-clans` |
| `server/test/tactic-validate.test.js`, `server/test/tactics.test.js` (изменить), `server/test/admin-clans.test.js` (новый) | тесты |
| `map-tactics.js` (изменить) | отрисовка 4 видов, иконки, админ-режим (выбор клана) |
| `map-tactics-editor.js` (изменить) | инструменты Стрелка, Зона, Метка, Текст; админ — только ластик |
| `map-app.js` (изменить) | кнопка «Тактика» для админа, вход по `?tactics=1&plan=` без клана |
| `map-app.css`, `map.html` (изменить) | стили подписей, версия `?v=` |
| `clan.js`, `clan.css`, `clan.html` (изменить) | админский блок на `/clans/<TAG>` |
| `privacy.html` (изменить) | абзац про тактику |
| `RELEASE.md`, `CLAUDE.md`, спек (изменить) | заметки, статус |

---

### Task 1: Новые виды рисунков на сервере

**Files:**
- Modify: `server/tactic-validate.js` (`KINDS`, `validateItem`, экспорт)
- Test: `server/test/tactic-validate.test.js`, `server/test/tactics.test.js`

**Interfaces:**
- Consumes: из этапа 2 — `validatePoints(value, min, max)` (внутри файла), `LIMITS`, маршруты `POST /api/plans/:pid/items`, `PATCH /api/items/:iid` (уже передают `label`/`icon` в `tactic-repo`).
- Produces: `TACTIC_ICONS` (массив из 8 id); `validateItem(input, { create })` принимает виды `pencil|arrow|zone|marker|text`, возвращает `{ kind?, geometry, width, squad_id, label?, icon? }`. На правке вид берётся из `input.__kind` (его выставляет маршрут по сохранённому рисунку; клиентское значение перезаписывается).

- [ ] **Step 1: Поправить тесты этапа 2, которые перестают быть верными**

В `server/test/tactic-validate.test.js`:
- в тесте `unknown kind, width and squad are rejected; arrow is not yet supported` удалить строку `{ kind: 'arrow', geometry: line },` и переименовать тест в `unknown kind, width and squad are rejected`;
- в тесте `on update every field is optional…` передавать вид: `validateItem({ width: 1, __kind: 'pencil' }, {})`, `validateItem({ squad: null, __kind: 'pencil' }, {})`; строка `validateItem({ kind: 'zone' }, {})` остаётся (`kind_immutable`).

- [ ] **Step 2: Написать падающие тесты новых видов**

Дописать в `server/test/tactic-validate.test.js`:

```js
const { TACTIC_ICONS } = require('../tactic-validate');

const pts = (n) => Array.from({ length: n }, (_, i) => [(i % 10) / 10, 0.5]);

test('arrow: 2..50 points, no label or icon', () => {
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(2) }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(50) }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(51) }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(1) }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(2), label: 'x' }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'arrow', geometry: pts(2), icon: 'enemy' }, { create: true }).ok, false);
});

test('zone: 3..200 points, optional label up to 60, self-intersection is fine', () => {
  const bow = [[0, 0], [1, 1], [1, 0], [0, 1]];
  assert.equal(validateItem({ kind: 'zone', geometry: bow }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(2) }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(200) }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(201) }, { create: true }).ok, false);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(3), label: 'Точка сбора' }, { create: true }).value.label, 'Точка сбора');
  assert.equal(validateItem({ kind: 'zone', geometry: pts(3), label: '   ' }, { create: true }).value.label, null);
  assert.equal(validateItem({ kind: 'zone', geometry: pts(3), label: 'x'.repeat(61) }, { create: true }).ok, false);
});

test('marker: a single point, icon from the set (default question), label up to 60', () => {
  const m = validateItem({ kind: 'marker', geometry: [0.123456, 0.5], icon: 'sniper', label: ' Снайпер ' }, { create: true });
  assert.deepEqual(m.value, { kind: 'marker', geometry: [0.12346, 0.5], width: 2, squad_id: null, icon: 'sniper', label: 'Снайпер' });
  assert.equal(validateItem({ kind: 'marker', geometry: [0.5, 0.5] }, { create: true }).value.icon, 'question');
  for (const icon of TACTIC_ICONS) assert.equal(validateItem({ kind: 'marker', geometry: [0, 0], icon }, { create: true }).ok, true);
  assert.equal(TACTIC_ICONS.length, 8);
  for (const bad of [{ icon: 'skull' }, { icon: 5 }, { geometry: [0.5] }, { geometry: [[0.5, 0.5]] }, { geometry: [2, 0] }, { label: 'x'.repeat(61) }]) {
    assert.equal(validateItem({ kind: 'marker', geometry: [0.5, 0.5], ...bad }, { create: true }).ok, false, JSON.stringify(bad));
  }
});

test('text: a point and a label of 1..120 characters is required', () => {
  assert.equal(validateItem({ kind: 'text', geometry: [0.2, 0.3], label: 'Идём сюда' }, { create: true }).ok, true);
  for (const label of [undefined, '', '   ', 'x'.repeat(121), 'a\u0000b', 'line\nbreak', 5]) {
    assert.equal(validateItem({ kind: 'text', geometry: [0.2, 0.3], label }, { create: true }).ok, false, String(label));
  }
  assert.equal(validateItem({ kind: 'text', geometry: [0.2, 0.3], label: 'x'.repeat(120) }, { create: true }).ok, true);
  assert.equal(validateItem({ kind: 'text', geometry: [0.2, 0.3], label: 'ok', icon: 'enemy' }, { create: true }).ok, false);
});

test('pencil still takes neither label nor icon; HTML in a label is kept as plain text', () => {
  assert.equal(validateItem({ kind: 'pencil', geometry: pts(2), label: 'x' }, { create: true }).ok, false);
  const html = '<img src=x onerror=alert(1)>';
  assert.equal(validateItem({ kind: 'text', geometry: [0.1, 0.1], label: html }, { create: true }).value.label, html);
});

test('update checks fields against the stored kind', () => {
  assert.deepEqual(validateItem({ label: 'Новый', __kind: 'text' }, {}).value, { label: 'Новый' });
  assert.deepEqual(validateItem({ geometry: [0.4, 0.4], __kind: 'marker' }, {}).value, { geometry: [0.4, 0.4] });
  assert.equal(validateItem({ geometry: [0.4, 0.4], __kind: 'pencil' }, {}).ok, false);
  assert.equal(validateItem({ label: '', __kind: 'text' }, {}).ok, false);
  assert.equal(validateItem({ icon: 'enemy', __kind: 'text' }, {}).ok, false);
});
```

- [ ] **Step 3: Запустить — падает**

Run: `node --test server/test/tactic-validate.test.js`
Expected: FAIL (`TACTIC_ICONS` не определён, `arrow` не принимается).

- [ ] **Step 4: Заменить `KINDS` и `validateItem`**

В `server/tactic-validate.js` заменить блок `const KINDS = {…}` и функцию `validateItem` на:

```js
const TACTIC_ICONS = ['gather', 'attack', 'defend', 'enemy', 'artillery', 'sniper', 'danger', 'question'];

function validatePoint(g) {
  const r = validatePoints([g], 1, 1);
  return r ? r[0] : null;
}

// geometry: returns the normalised value or null; label: null = not allowed, else {min, max} in characters;
// icon: whether the kind carries one.
const KINDS = {
  pencil: { geometry: (g) => validatePoints(g, 2, LIMITS.pencilPoints), label: null, icon: false },
  arrow: { geometry: (g) => validatePoints(g, 2, 50), label: null, icon: false },
  zone: { geometry: (g) => validatePoints(g, 3, 200), label: { min: 0, max: 60 }, icon: false },
  marker: { geometry: validatePoint, label: { min: 0, max: 60 }, icon: true },
  text: { geometry: validatePoint, label: { min: 1, max: 120 }, icon: false },
};
const hasKind = (k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(KINDS, k);

// Trimmed, single line; null for a non-string or control characters.
function normLabel(value) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return null;
  return value.trim().replace(/\s+/g, ' ');
}

function validateItem(input, { create = false } = {}) {
  const out = {};
  let kind;
  if (create) {
    kind = input.kind;
    if (!hasKind(kind)) return fail('kind_invalid');
    out.kind = kind;
  } else {
    if ('kind' in input) return fail('kind_immutable');
    // The route sets __kind from the stored drawing; the client cannot choose it.
    kind = input.__kind;
    if (!hasKind(kind)) return fail('kind_invalid');
  }
  const spec = KINDS[kind];
  if (create || 'geometry' in input) {
    const g = spec.geometry(input.geometry);
    if (g === null) return fail('geometry_invalid');
    out.geometry = g;
  }
  if (create || 'width' in input) {
    const w = 'width' in input ? input.width : 2;
    if (!Number.isInteger(w) || w < 1 || w > 3) return fail('width_invalid');
    out.width = w;
  }
  if (create || 'squad' in input) {
    const sq = 'squad' in input ? input.squad : null;
    if (sq !== null && (!Number.isInteger(sq) || sq < 1)) return fail('squad_invalid');
    out.squad_id = sq;
  }
  if ('label' in input || (create && spec.label && spec.label.min > 0)) {
    if (!spec.label) return fail('label_not_allowed');
    const t = normLabel(input.label);
    if (t === null || t.length < spec.label.min || t.length > spec.label.max) return fail('label_invalid');
    out.label = t === '' ? null : t;
  }
  if ('icon' in input || (create && spec.icon)) {
    if (!spec.icon) return fail('icon_not_allowed');
    const icon = 'icon' in input ? input.icon : 'question';
    if (typeof icon !== 'string' || !TACTIC_ICONS.includes(icon)) return fail('icon_invalid');
    out.icon = icon;
  }
  return ok(out);
}
```

В `module.exports` добавить `TACTIC_ICONS`. Старый комментарий «Stage 2 knows only the pencil» удалить.

Проверка порядка ключей в тесте `marker`: `assert.deepEqual` не зависит от порядка ключей.

- [ ] **Step 5: Запустить тесты валидатора**

Run: `node --test server/test/tactic-validate.test.js`
Expected: PASS.

- [ ] **Step 6: Тесты маршрутов (права и хранение)**

В `server/test/tactics.test.js` (хелперы `withSquads`, `PENCIL` из этапа 2):

```js
test('every kind is stored with its label and icon and follows the squad rules', async (t) => {
  const { as, pid, alpha, bravo } = await withSquads(t);
  const post = (who, body) => as(who)('POST', `/api/plans/${pid}/items`, body);
  const cases = [
    { kind: 'arrow', geometry: PENCIL, squad: alpha },
    { kind: 'zone', geometry: PENCIL, squad: alpha, label: 'Склад' },
    { kind: 'marker', geometry: [0.4, 0.4], squad: alpha, icon: 'attack', label: 'Атака' },
    { kind: 'text', geometry: [0.5, 0.5], squad: alpha, label: 'Держим мост' },
  ];
  for (const body of cases) {
    const r = await post('bob', body);
    assert.equal(r.status, 201, body.kind);
    assert.equal(r.json.item.kind, body.kind);
    assert.equal(r.json.item.label, body.label || null);
    assert.equal(r.json.item.icon, body.icon || null);
    assert.deepEqual(r.json.item.geometry, body.geometry);
    assert.equal((await post('bob', { ...body, squad: bravo })).status, 403, body.kind + ' for a foreign squad');
    assert.equal((await post('bob', { ...body, squad: null })).status, 403, body.kind + ' общий');
  }
  const body = (await as('alice')('GET', '/api/plans/' + pid)).json;
  assert.deepEqual(body.items.map((i) => i.kind), ['arrow', 'zone', 'marker', 'text']);
});

test('PATCH edits label, icon and a point geometry of a marker; a bad label is 400', async (t) => {
  const { as, pid, alpha } = await withSquads(t);
  const m = (await as('bob')('POST', `/api/plans/${pid}/items`,
    { kind: 'marker', geometry: [0.4, 0.4], squad: alpha, icon: 'attack' })).json.item;
  const r = await as('bob')('PATCH', '/api/items/' + m.id, { label: 'Вперёд', icon: 'enemy', geometry: [0.6, 0.6] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.item.label, r.json.item.icon, r.json.item.geometry], ['Вперёд', 'enemy', [0.6, 0.6]]);
  assert.equal((await as('bob')('PATCH', '/api/items/' + m.id, { icon: 'skull' })).status, 400);
  assert.equal((await as('bob')('PATCH', '/api/items/' + m.id, { geometry: PENCIL })).status, 400);
  assert.equal((await as('bob')('PATCH', '/api/items/' + m.id, { kind: 'text' })).status, 400);
});

test('a client-sent __kind is ignored on update', async (t) => {
  const { as, pid, alpha } = await withSquads(t);
  const p = (await as('bob')('POST', `/api/plans/${pid}/items`, { kind: 'pencil', geometry: PENCIL, squad: alpha })).json.item;
  const r = await as('bob')('PATCH', '/api/items/' + p.id, { __kind: 'text', label: 'sneaky' });
  assert.equal(r.status, 400, 'label is not allowed on a pencil');
});
```

- [ ] **Step 7: Запустить весь набор**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS. Если упал тест «PATCH moves a stroke…» этапа 2 — проверить, что маршрут PATCH передаёт `{ ...input, __kind: item.kind }` (так в плане этапа 2): порядок спреда важен.

- [ ] **Step 8: Commit**

```bash
git add server/tactic-validate.js server/test/tactic-validate.test.js server/test/tactics.test.js
git commit -m "feat(tactics): arrow, zone, marker and text kinds on the server"
```

---

### Task 2: Админские маршруты кланов

**Files:**
- Create: `server/routes/admin-clans.js`, `server/test/admin-clans.test.js`
- Modify: `server/app.js`

**Interfaces:**
- Consumes: `need` из `server/clan-http.js`, `clanRepo.getClan`, `clanRepo.clanOut`.
- Produces:
  - `GET /api/admin/clans` → `[{ id, tag, name, members, plans }]` по `lower(name)`; гость `401`, не админ `403`;
  - `GET /api/admin/clans/:id` → `{ clan: {id, tag, name, description, emblem_url}, squads: [{id, name, color, position}], members: [{id, login, owner, clans_blocked}] }`; неизвестный клан `404`.

- [ ] **Step 1: Написать падающие тесты**

`server/test/admin-clans.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clanSetup } = require('./clan-helpers');

async function setup(t) {
  const x = await clanSetup(t);
  const clanId = await x.makeClan();
  x.addMember(clanId, 'bob');
  x.s.db.prepare("INSERT INTO clan_squads (clan_id, name, color, position) VALUES (?, 'Alpha', '#ff0000', 0)").run(clanId);
  x.s.db.prepare('UPDATE users SET clans_blocked = 1 WHERE id = ?').run(x.users.bob.id);
  return { ...x, clanId };
}

test('guests get 401, players and clan owners get 403', async (t) => {
  const { s, as, clanId } = await setup(t);
  assert.equal((await s.api('GET', '/api/admin/clans')).status, 401);
  assert.equal((await as('alice')('GET', '/api/admin/clans')).status, 403, 'owner of a clan');
  assert.equal((await as('carol')('GET', '/api/admin/clans')).status, 403);
  assert.equal((await as('alice')('GET', `/api/admin/clans/${clanId}`)).status, 403);
});

test('the admin lists clans with counts and reads a clan with ids and block flags', async (t) => {
  const { as, clanId, users } = await setup(t);
  const list = await as('admin')('GET', '/api/admin/clans');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json, [{ id: clanId, tag: 'ALF', name: 'Alpha Wolves', members: 2, plans: 0 }]);
  const one = await as('admin')('GET', `/api/admin/clans/${clanId}`);
  assert.equal(one.status, 200);
  assert.equal(one.json.clan.tag, 'ALF');
  assert.deepEqual(one.json.squads.map((q) => q.name), ['Alpha']);
  const bob = one.json.members.find((m) => m.login === 'bob');
  assert.deepEqual([bob.id, bob.owner, bob.clans_blocked], [users.bob.id, false, true]);
  assert.equal(one.json.members.find((m) => m.login === 'alice').owner, true);
  assert.equal((await as('admin')('GET', `/api/admin/clans/${clanId + 5}`)).status, 404);
  assert.equal((await as('admin')('GET', '/api/admin/clans/abc')).status, 404);
});

test('the admin without a clan reads tactics, deletes a drawing, but cannot draw', async (t) => {
  const { as, clanId, s } = await setup(t);
  const mapId = Number(s.db.prepare("INSERT INTO maps (slug, title, published) VALUES ('main', 'Main', 1)").run().lastInsertRowid);
  const plan = (await as('alice')('POST', `/api/clans/${clanId}/plans`, { mapId, title: 'P' })).json.plan;
  const item = (await as('alice')('POST', `/api/plans/${plan.id}/items`,
    { kind: 'text', geometry: [0.5, 0.5], label: 'Привет' })).json.item;
  assert.equal((await as('admin')('GET', `/api/clans/${clanId}/plans`)).json.length, 1);
  assert.equal((await as('admin')('GET', `/api/plans/${plan.id}`)).json.items.length, 1);
  assert.equal((await as('admin')('POST', `/api/plans/${plan.id}/items`,
    { kind: 'text', geometry: [0.1, 0.1], label: 'x' })).status, 403);
  assert.equal((await as('admin')('DELETE', `/api/items/${item.id}`)).status, 200);
  assert.equal((await as('admin')('DELETE', `/api/plans/${plan.id}`)).status, 200);
});
```

- [ ] **Step 2: Запустить — падает**

Run: `node --test server/test/admin-clans.test.js`
Expected: FAIL (404 вместо 401/403/200).

- [ ] **Step 3: Реализовать маршруты**

`server/routes/admin-clans.js`:

```js
'use strict';

const { HttpError } = require('../http-util');
const { need, intParam } = require('../clan-http');
const clanRepo = require('../clan-repo');

function adminOnly(c) {
  need(c);
  if (c.user.role !== 'admin') throw new HttpError(403, 'forbidden');
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/admin/clans',
    handler: async (c) => {
      adminOnly(c);
      const rows = c.db.prepare(
        `SELECT c.id, c.tag, c.name,
           (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS members,
           (SELECT COUNT(*) FROM tactic_plans p WHERE p.clan_id = c.id) AS plans
         FROM clans c ORDER BY c.name_key, c.id`,
      ).all();
      return { body: rows.map((r) => ({ id: r.id, tag: r.tag, name: r.name, members: r.members, plans: r.plans })) };
    },
  },
  {
    method: 'GET',
    pattern: '/api/admin/clans/:id',
    handler: async (c) => {
      adminOnly(c);
      const clan = clanRepo.getClan(c.db, intParam(c, 'id'));
      if (!clan) throw new HttpError(404, 'clan not found');
      const squads = c.db
        .prepare('SELECT id, name, color, position FROM clan_squads WHERE clan_id = ? ORDER BY position, id')
        .all(clan.id);
      const members = c.db
        .prepare(
          `SELECT u.id, u.login, u.clans_blocked FROM clan_members m JOIN users u ON u.id = m.user_id
           WHERE m.clan_id = ? ORDER BY lower(u.login)`,
        )
        .all(clan.id)
        .map((m) => ({ id: m.id, login: m.login, owner: m.id === clan.owner_id, clans_blocked: Boolean(m.clans_blocked) }));
      return { body: { clan: clanRepo.clanOut(clan), squads, members } };
    },
  },
];
```

В `server/app.js` — `require('./routes/admin-clans'),` в `ROUTE_MODULES`.

- [ ] **Step 4: Запустить тесты, закоммитить**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

```bash
git add server/routes/admin-clans.js server/app.js server/test/admin-clans.test.js
git commit -m "feat(clans): admin clan list and detail endpoints"
```

---

### Task 3: Отрисовка четырёх видов (просмотр)

**Files:**
- Modify: `map-tactics.js`, `map-app.css`, `map.html`

**Interfaces:**
- Consumes: `makeLayer(item)` и `S.items`/`render()` из этапа 2; `MapGeo.toLatLng`, `MapGeo.pointsToLatLngs`; `h()`.
- Produces: `MapTactics.TACTIC_ICONS` — `{ id: { label, svg } }` для 8 иконок (нужен редактору); `makeLayer` возвращает слой для каждого из 5 видов; у всех слоёв `layer.itemId`; стрелка — `L.featureGroup`, поэтому `e.target.itemId` в ластике работает и для неё.

- [ ] **Step 1: Иконки и отрисовка**

В `map-tactics.js` над `function visible(item)`:

```js
  // Own set: the category icons in map-icons.js feed the category editor and must not grow tactical ones.
  var TACTIC_ICONS = {
    gather: { label: 'Сбор', svg: '<circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>' },
    attack: { label: 'Атака', svg: '<path d="M4 20 20 4M14 4h6v6"/>' },
    defend: { label: 'Оборона', svg: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/>' },
    enemy: { label: 'Враг', svg: '<circle cx="12" cy="12" r="9"/><path d="m8 8 8 8M16 8l-8 8"/>' },
    artillery: { label: 'Артиллерия', svg: '<circle cx="8" cy="17" r="3"/><path d="M10 15 20 5M16 4l4 4"/>' },
    sniper: { label: 'Снайпер', svg: '<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>' },
    danger: { label: 'Опасность', svg: '<path d="M12 3l10 18H2z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6"/>' },
    question: { label: 'Вопрос', svg: '<circle cx="12" cy="12" r="10"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7"/><circle cx="12" cy="17" r=".6"/>' },
  };

  function iconNode(id) {
    var def = TACTIC_ICONS[id] || TACTIC_ICONS.question;
    var wrap = document.createElement('span');
    wrap.className = 'ico';
    // def.svg is static markup from the table above, never user input
    wrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + def.svg + '</svg>';
    return wrap;
  }

  function permanentLabel(layer, text, direction) {
    if (!text) return;
    // bindTooltip takes a string as HTML: pass a text node holder instead
    layer.bindTooltip(h('span', null, text), { permanent: true, direction: direction, className: 'tac-label', offset: [0, direction === 'bottom' ? 4 : 0] });
  }

  // CRS.Simple is linear, so the screen angle of the last segment does not depend on the zoom.
  function arrowHead(points, size, color, width) {
    var a = Geo.toLatLng({ x: points[points.length - 2][0], y: points[points.length - 2][1] }, size);
    var b = Geo.toLatLng({ x: points[points.length - 1][0], y: points[points.length - 1][1] }, size);
    var deg = Math.atan2(-(b[0] - a[0]), b[1] - a[1]) * 180 / Math.PI;
    var px = 14 + 3 * width;
    var el = h('div', { class: 'tac-head', style: 'width:' + px + 'px;height:' + px + 'px;transform:rotate(' + deg + 'deg)' });
    // static markup, color validated on the server as a squad color (#rrggbb) or the shared constant
    el.innerHTML = '<svg viewBox="0 0 20 20"><path d="M1 2 19 10 1 18 5 10z" fill="' + color + '"/></svg>';
    return L.marker(b, {
      icon: L.divIcon({ html: el, className: 'tac-head-wrap', iconSize: [px, px], iconAnchor: [px / 2, px / 2] }),
      interactive: interactive, keyboard: false,
    });
  }
```

Заменить `makeLayer`:

```js
  function makeLayer(item) {
    var size = V.size();
    if (!size) return null;
    var color = colorOf(item);
    var weight = weightOf(item.width);
    var layer = null;
    if (item.kind === 'pencil') {
      layer = L.polyline(Geo.pointsToLatLngs(item.geometry, size), {
        color: color, weight: weight, opacity: 0.9, lineCap: 'round', lineJoin: 'round',
        interactive: interactive, bubblingMouseEvents: false,
      });
    } else if (item.kind === 'arrow') {
      var line = L.polyline(Geo.pointsToLatLngs(item.geometry, size), {
        color: color, weight: weight, opacity: 0.95, lineCap: 'round', lineJoin: 'round',
        dashArray: '8 6', interactive: interactive, bubblingMouseEvents: false,
      });
      layer = L.featureGroup([line, arrowHead(item.geometry, size, color, item.width)]);
    } else if (item.kind === 'zone') {
      layer = L.polygon(Geo.pointsToLatLngs(item.geometry, size), {
        color: color, fillColor: color, fillOpacity: 0.2, weight: Math.max(2, weight - 1),
        interactive: interactive, bubblingMouseEvents: false,
      });
      permanentLabel(layer, item.label, 'center');
    } else if (item.kind === 'marker') {
      var mk = h('div', { class: 'mk tac-mk' }, iconNode(item.icon));
      mk.style.setProperty('--c', color);
      layer = L.marker(Geo.toLatLng({ x: item.geometry[0], y: item.geometry[1] }, size), {
        icon: L.divIcon({ html: mk, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] }),
        interactive: interactive, keyboard: false,
      });
      permanentLabel(layer, item.label, 'bottom');
    } else if (item.kind === 'text') {
      var txt = h('div', { class: 'tac-text' }, item.label || '');
      txt.style.color = color;
      layer = L.marker(Geo.toLatLng({ x: item.geometry[0], y: item.geometry[1] }, size), {
        icon: L.divIcon({ html: txt, className: 'tac-text-wrap', iconSize: null }),
        interactive: interactive, keyboard: false,
      });
    }
    // An unknown kind from a newer server is skipped, not fatal.
    if (layer) layer.itemId = item.id;
    return layer;
  }
```

В экспорт `window.MapTactics` добавить `TACTIC_ICONS: TACTIC_ICONS, iconNode: iconNode,`.

Замечание про безопасность: `innerHTML` в `arrowHead` получает только `color`, а он — либо `#rrggbb` отряда (проверено сервером: `COLOR_RE` в `clan-validate.js`), либо константа `SHARED_COLOR`. Подписи (`label`) идут только через `h()` и `textContent`.

- [ ] **Step 2: Стили**

В `map-app.css`:

```css
.tac-mk { border-width: 2px; }
.tac-text-wrap { background: none; border: 0; }
.tac-text {
  display: inline-block; max-width: 220px; padding: 2px 6px; font-weight: 600; font-size: 13px; line-height: 1.25;
  background: rgba(10, 10, 9, .72); border-radius: 4px; white-space: pre-wrap; transform: translate(-50%, -50%);
  text-shadow: 0 1px 2px #000;
}
.tac-head-wrap { background: none; border: 0; }
.tac-head svg { width: 100%; height: 100%; display: block; filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .7)); }
.leaflet-tooltip.tac-label {
  background: rgba(10, 10, 9, .78); color: var(--text); border: 0; box-shadow: none; padding: 1px 6px; font-size: 12px;
}
.leaflet-tooltip.tac-label::before { display: none; }
```

В `map.html` поднять версию `?v=` и `MAP_V` (`20261014a` → `20261015a`).

- [ ] **Step 3: Ручная проверка отрисовки (браузер)**

Создать через консоль/`curl` под лидером по одному рисунку каждого вида (см. тесты Task 1 как образец тел). Проверить:
- стрелка: пунктирная линия цвета отряда, наконечник на последней точке, повёрнут по последнему отрезку, при масштабировании не отрывается от конца;
- зона: полупрозрачная заливка, подпись по центру; без подписи — без тултипа;
- метка: круглая иконка цвета отряда, подпись под ней; все 8 иконок различимы;
- текст: подпись цветом отряда на тёмной плашке; подпись `<img src=x onerror=alert(1)>` показана буквально, `alert` не срабатывает;
- фильтр отрядов скрывает новые виды вместе с карандашом; общие — под «Общие»;
- на 375 px длинная подпись не раздувает страницу (плашка ≤ 220 px).

- [ ] **Step 4: Commit**

```bash
git add map-tactics.js map-app.css map.html
git commit -m "feat(tactics): render arrows, zones, markers and text"
```

---

### Task 4: Инструменты «Стрелка», «Зона», «Метка», «Текст»

**Files:**
- Modify: `map-tactics-editor.js`, `map-app.css`

**Interfaces:**
- Consumes: из этапа 2 — `ed`, `els`, `send(body, temp)`, `cancelStroke()`, `setTool(tool)`, `allowedSquads()`, `color()`, `say()`, `onKey`, `start/stop`; из Task 3 — `T.TACTIC_ICONS`, `T.iconNode`.
- Produces: инструменты `arrow`, `zone`, `marker`, `text`; клавиши `A` стрелка, `Z` зона, `M` метка, `T` текст (и русские `Ф`, `Я`, `Ь`, `Е`); поля панели: «Подпись», «Иконка».

Поведение:
- **Стрелка / зона:** клик — вершина (временная ломаная/полигон + «резинка» до курсора); двойной клик или `Enter` — завершить (двойной клик добавляет дубликат последней вершины, его надо убрать); `Esc` — отмена; стрелка завершается сама на 50-й точке, зона — на 200-й; минимум 2 / 3 точки, иначе сообщение. Для зоны подпись берётся из поля «Подпись» (необязательная). Перетаскивание карты работает как обычно (карандаш отключал `dragging`, эти инструменты — нет), `doubleClickZoom` отключается на время инструмента.
- **Метка:** клик ставит метку с выбранной иконкой и подписью из панели (необязательная).
- **Текст:** клик ставит текст из поля «Подпись»; пустое — сообщение «Введите текст в поле «Подпись»» и ничего не отправляется.
- Все четыре отправляются тем же `send()`; тело — `{ kind, geometry, width, squad, label?, icon? }`. На отправке после успеха временный слой снимается, настоящий приходит из `T.setItem`.

- [ ] **Step 1: Расширить редактор**

В `map-tactics-editor.js`:

1. Состояние: `var ed = { tool: 'pencil', squad: null, width: 2, drawing: false, points: [], temp: null, spaceDown: false, verts: [], rubber: null };`.
2. В `buildPanel()` список инструментов:

```js
    [['pencil', 'Карандаш (P)'], ['arrow', 'Стрелка (A)'], ['zone', 'Зона (Z)'], ['marker', 'Метка (M)'],
      ['text', 'Текст (T)'], ['eraser', 'Ластик (E)']].forEach(function (t) {
```

и поля (до `els.hint`):

```js
    els.label = h('input', { type: 'text', maxLength: 120, placeholder: 'Подпись' });
    els.icon = h('select', { 'aria-label': 'Иконка' });
    Object.keys(T.TACTIC_ICONS).forEach(function (id) {
      els.icon.appendChild(h('option', { value: id }, T.TACTIC_ICONS[id].label));
    });
    els.fields = h('div', null, h('label', null, 'Подпись'), els.label, h('label', null, 'Иконка'), els.icon);
```

добавить `els.fields` в `els.box` после блока толщины; поле ввода не должно запускать горячие клавиши (в `onKey` уже есть проверка `input/textarea/select`).
3. В `updateTools()` — показывать поля по инструменту: `els.fields.hidden = ['zone', 'marker', 'text'].indexOf(ed.tool) < 0; els.icon.parentNode…` — проще: `els.icon.hidden = els.icon.previousSibling.hidden = ed.tool !== 'marker';`.
4. `setTool(tool)` — расширить:

```js
  var VERTEX_TOOLS = { arrow: { min: 2, max: 50 }, zone: { min: 3, max: 200 } };

  function setTool(tool) {
    cancelStroke();
    cancelVertices();
    ed.tool = tool;
    map.getContainer().classList.toggle('tac-pencil', tool === 'pencil' || tool in VERTEX_TOOLS || tool === 'marker' || tool === 'text');
    if (tool === 'pencil') map.dragging.disable(); else map.dragging.enable();
    if (tool in VERTEX_TOOLS) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
    T.setInteractive(tool === 'eraser');
    updateTools();
  }
```

5. Вершины:

```js
  function cancelVertices() {
    ed.verts = [];
    if (ed.temp && ed.tool in VERTEX_TOOLS) { ed.temp.remove(); ed.temp = null; }
    if (ed.rubber) { ed.rubber.remove(); ed.rubber = null; }
  }

  function styleFor() {
    return { color: color(), weight: 2 + 2 * (ed.width - 1), opacity: 0.9, interactive: false };
  }

  function addVertex(latlng) {
    var rule = VERTEX_TOOLS[ed.tool];
    ed.verts.push(latlng);
    if (!ed.temp) {
      ed.temp = (ed.tool === 'zone' ? L.polygon : L.polyline)([latlng], styleFor()).addTo(map);
    } else {
      ed.temp.setLatLngs(ed.verts);
    }
    if (ed.verts.length >= rule.max) finishVertices();
  }

  function finishVertices() {
    var rule = VERTEX_TOOLS[ed.tool];
    if (ed.verts.length < rule.min) {
      say(ed.tool === 'zone' ? 'Зоне нужно минимум 3 точки.' : 'Стрелке нужно минимум 2 точки.');
      return;
    }
    var size = V.size();
    var pts = ed.verts.map(function (ll) {
      var p = Geo.fromLatLng(ll, size);
      return [p.x, p.y];
    });
    var temp = ed.temp;
    ed.verts = [];
    ed.temp = null;
    if (ed.rubber) { ed.rubber.remove(); ed.rubber = null; }
    var body = { kind: ed.tool, geometry: pts, width: ed.width, squad: ed.squad };
    var label = els.label.value.trim();
    if (ed.tool === 'zone' && label) body.label = label;
    send(body, temp);
  }

  function onClick(e) {
    if (!active()) return;
    if (ed.tool in VERTEX_TOOLS) {
      if (ed.spaceDown) return;
      addVertex(e.latlng);
    } else if (ed.tool === 'marker' || ed.tool === 'text') {
      placePoint(e.latlng);
    }
  }

  function onDblClick() {
    if (!active() || !(ed.tool in VERTEX_TOOLS)) return;
    // the two clicks of the double click each added a vertex at the same place: keep one
    if (ed.verts.length >= 2) ed.verts.pop();
    if (ed.temp) ed.temp.setLatLngs(ed.verts);
    finishVertices();
  }

  function onHover(e) {
    if (!ed.verts.length || !(ed.tool in VERTEX_TOOLS)) return;
    var last = ed.verts[ed.verts.length - 1];
    if (!ed.rubber) {
      ed.rubber = L.polyline([last, e.latlng], { color: color(), weight: 2, dashArray: '4 6', opacity: 0.7, interactive: false }).addTo(map);
    } else {
      ed.rubber.setLatLngs([last, e.latlng]);
    }
  }

  function placePoint(latlng) {
    var p = Geo.fromLatLng(latlng, V.size());
    var label = els.label.value.trim();
    var body = { kind: ed.tool, geometry: [p.x, p.y], width: ed.width, squad: ed.squad };
    if (ed.tool === 'text') {
      if (!label) { say('Введите текст в поле «Подпись».'); els.label.focus(); return; }
      body.label = label;
    } else {
      body.icon = els.icon.value;
      if (label) body.label = label;
    }
    // The temp layer is a quick marker; the real layer replaces it when the server answers.
    var temp = L.circleMarker(latlng, { radius: 7, color: color(), fillColor: color(), fillOpacity: 0.5, interactive: false }).addTo(map);
    send(body, temp);
  }
```

6. `send()` из этапа 2 вызывает `temp.setStyle({ opacity: 0.5 })` — у `circleMarker` и полилиний `setStyle` есть; без изменений.
7. В `start()`: `map.on('click', onClick); map.on('dblclick', onDblClick); map.on('mousemove', onHover);` (рядом с `mousedown/mousemove/mouseup`, внутри блока `if (!bound)`).
8. В `onKey`:
   - `Enter` при `ed.tool in VERTEX_TOOLS` → `finishVertices()`;
   - `Esc` → если есть вершины — `cancelVertices()`, иначе `setTool('pencil')`;
   - буквы: `a/A/ф/Ф` → arrow, `z/Z/я/Я` → zone, `m/M/ь/Ь` → marker, `t/T/е/Е` → text (русская `е` — на клавише `T`; существующая `е` для ластика — это клавиша `E`, русская `у`; конфликта нет).
9. В `stop()` — `cancelVertices(); map.doubleClickZoom.enable();`.

- [ ] **Step 2: Стили**

```css
.tac-editor input[type=text] { margin-bottom: 2px; }
.tac-tools button { flex: 1 1 auto; }
```

- [ ] **Step 3: Ручная проверка (браузер, ПК ≥ 900 px)**

- Стрелка: 3 клика + двойной клик → ломаная с наконечником; лишней вершины в конце нет; `Enter` завершает; `Esc` отменяет; клики по уже нарисованным объектам не мешают;
- на 50-й вершине стрелка завершается сама; зона на 200-й;
- зона из 2 точек → сообщение, ничего не отправлено; с подписью «Склад» → подпись по центру;
- метка с иконкой «Враг» и подписью; без подписи — только иконка;
- текст без подписи → сообщение и фокус в поле; с подписью `<b>x</b>` → показан буквально;
- у командира с одним отрядом нельзя выбрать чужой; попытка «Общие» без «все отряды» — пункта нет;
- ввод в поле «Подпись» клавишами `P/E/A/Z` не переключает инструменты;
- двойной клик по карте инструментом «Карандаш» масштабирует (как раньше), инструментом «Стрелка» — нет;
- ластик стирает все пять видов, в том числе стрелку (по линии и по наконечнику).

- [ ] **Step 4: Commit**

```bash
git add map-tactics-editor.js map-app.css
git commit -m "feat(tactics): arrow, zone, marker and text tools"
```

---

### Task 5: Админ открывает тактику любого клана

**Files:**
- Modify: `map-tactics.js`, `map-tactics-editor.js`, `map-app.js`, `map-app.css`

**Interfaces:**
- Consumes: `GET /api/admin/clans`, `GET /api/admin/clans/:id` (Task 2), `GET /api/clans/:id/plans`, `GET /api/plans/:pid`, `DELETE /api/plans/:pid`, `DELETE /api/items/:iid`; `state.me.user.role === 'admin'`.
- Produces: `MapTactics.start(viewer, clanBody, { plan, admin: true })`; панель админа: «Клан: [▾]» и кнопка «Удалить план»; редактор `MapTacticsEditor.start(viewer, tactics, { eraserOnly: true })`.

Поведение:
- Кнопка «Тактика» видна админу всегда (даже без клана и на телефоне — просмотр).
- Вход: `GET /api/admin/clans` → выбор клана (по умолчанию: клан из `?plan=`, определённый чтением плана `GET /api/plans/:pid` → `plan.clan_id`; иначе первый). Выбор клана → `GET /api/admin/clans/:id` → составной `clanBody`: `{ clan: {id, tag, name}, me: {id: <id админа>, isOwner: false, perms: ['tactics_view'], drawSquads: []}, squads, members: [], roles: [] }` → `loadPlans()`.
- Админ-лидер собственного клана ведёт себя как админ в этом режиме (тактику своего клана он выбирает в том же селекторе; рисовать как участник можно, выйдя из админ-режима нельзя — режим один: «просмотр», и это сознательно: админ не рисует).
- Нет кнопок «Создать план», «Переименовать», «Сделать активным»; есть «Удалить план» (с подтверждением); в редакторе только ластик; фильтр отрядов работает.
- Опрос и ошибки — как у участника; `404` на план → «План удалён», перечитывание списка планов выбранного клана.

- [ ] **Step 1: `map-tactics.js` — админ-режим**

1. В состояние `S` добавить `admin: false, adminClans: []`.
2. В `start(viewer, clanBody, opts)`: `S.admin = !!(opts && opts.admin);`; после `buildPanel` — если `S.admin`, строить селектор клана (см. ниже).
3. Селектор клана (в `buildPanel`):

```js
    els.clanSel = h('select', { 'aria-label': 'Клан', hidden: true, onchange: function () { pickClan(Number(els.clanSel.value)); } });
```

и вставить `els.clanSel` в панель сразу после `.tac-head`. Метка рядом: `h('label', { class: 'tac-lbl' }, 'Клан')` — по месту.

4. Функции:

```js
  function adminBody(detail, adminId) {
    return {
      clan: detail.clan,
      me: { id: adminId, isOwner: false, perms: ['tactics_view'], drawSquads: [] },
      roles: [], squads: detail.squads, members: [],
    };
  }

  function pickClan(clanId, wantedPlan) {
    return api.get('/api/admin/clans/' + clanId).then(function (detail) {
      S.clan = adminBody(detail, V.state().me.user.id);
      els.clanSel.value = String(clanId);
      return loadPlans(wantedPlan);
    }, function () { V.notice('Не удалось открыть клан.'); });
  }

  // For an admin the clan list comes from the admin API; a ?plan= link names the clan through the plan.
  function startAdmin(opts) {
    return api.get('/api/admin/clans').then(function (clans) {
      S.adminClans = clans;
      els.clanSel.textContent = '';
      clans.forEach(function (c) {
        els.clanSel.appendChild(h('option', { value: String(c.id) }, '[' + c.tag + '] ' + c.name));
      });
      els.clanSel.hidden = clans.length === 0;
      if (!clans.length) { S.clan = null; S.plans = []; S.plan = null; updatePanel(); return null; }
      var wanted = opts && opts.plan;
      var first = wanted
        ? api.get('/api/plans/' + encodeURIComponent(wanted)).then(function (b) { return b.plan.clan_id; }, function () { return clans[0].id; })
        : Promise.resolve(clans[0].id);
      return first.then(function (clanId) { return pickClan(clanId, wanted); });
    });
  }
```

В `start()` вместо безусловного `return loadPlans(opts && opts.plan).then(updateUrl);`:

```js
    var ready = S.admin ? startAdmin(opts) : loadPlans(opts && opts.plan);
    return ready.then(updateUrl);
```

5. В `updatePanel()`:
   - `var manage = !S.admin && hasPerm('plans_manage');`
   - кнопка удаления: `els.del.hidden = !(manage || S.admin) || !S.plan;`
6. `reloadClan()` (используется опросом при 403/404): для админа не вызывать `/api/my/clan`; в `poll()` ветка ошибки: `if (S.admin) { V.notice('План удалён.'); return loadPlans(); }` перед обращением к `reloadClan()`.
7. `canDraw()` для админа возвращает `false` (`hasPerm('tactics_draw')` уже `false`, так как `perms: ['tactics_view']`); добавить экспорт `isAdmin: function () { return S.admin; }`.

- [ ] **Step 2: `map-app.js`**

В `setupMobileUser()` расширить блок кнопки «Тактика»:

```js
    var tacBtn = $('mob-tactics');
    if (tacBtn && state.me.user && state.me.user.role === 'admin') {
      tacBtn.hidden = false;
      state.tacticsAdmin = true;
      if (new URLSearchParams(location.search).get('tactics') === '1') enterTactics();
    } else if (tacBtn && state.me.user && state.me.user.clan) {
      /* блок этапа 2 без изменений */
    }
```

В `enterTactics()`: условие входа `if ((!state.clan && !state.tacticsAdmin) || state.mode === 'tactics') return;`; вызов старта:

```js
      return window.MapTactics.start(window.MapViewer, state.clan, { plan: q.get('plan'), admin: !!state.tacticsAdmin });
```

Редактор:

```js
      var desktop = window.matchMedia('(min-width: 900px)').matches;
      var mayDraw = state.tacticsAdmin || window.MapTactics.canDraw();
      if (desktop && mayDraw) {
        return loadScript('/map-tactics-editor.js').then(function () {
          window.MapTacticsEditor.start(window.MapViewer, window.MapTactics, { eraserOnly: !!state.tacticsAdmin });
        });
      }
```

(для админа, состоящего в клане, `state.tacticsAdmin` перекрывает `state.clan` — режим «просмотр»).

- [ ] **Step 3: `map-tactics-editor.js` — режим только ластика**

`start(viewer, tactics, opts)`: `ed.eraserOnly = !!(opts && opts.eraserOnly);`; в `buildPanel()` показывать только кнопку ластика (`['eraser', 'Стереть рисунок']`), прятать `els.squad`, ширину, поля и подсказку про пробел; `ed.tool = 'eraser'` по умолчанию; `setTool` по умолчанию вызывать `setTool(ed.eraserOnly ? 'eraser' : 'pencil')`; в `onKey` при `ed.eraserOnly` обрабатывать только `Esc` (ничего) — остальное игнорировать.

- [ ] **Step 4: Стили**

```css
.tac-panel select { margin-bottom: 6px; }
```

- [ ] **Step 5: Ручная проверка (браузер)**

- Админ без клана: на `/map` есть «Тактика» → панель «Клан: …» со списком; смена клана подгружает его планы и цвета отрядов;
- `/map?tactics=1&plan=<id чужого клана>` открывает тот клан и план;
- рисовать нельзя (в панели только «Стереть рисунок»); клик по любому рисунку удаляет (ответ `200`), у лидера клана в течение 15 с рисунок исчезает;
- «Удалить план» с подтверждением; после — переход на другой план клана или «Нет планов»;
- обычный участник клана админского селектора не видит, `GET /api/admin/clans` из его консоли — `403`;
- телефон: админ видит план и фильтр, редактор не грузится.

- [ ] **Step 6: Commit**

```bash
git add map-tactics.js map-tactics-editor.js map-app.js map-app.css
git commit -m "feat(tactics): admin view of any clan's tactics with eraser only"
```

---

### Task 6: Админский блок на странице клана

**Files:**
- Modify: `clan.js`, `clan.css`, `clan.html` (версия `?v=`)

**Interfaces:**
- Consumes: `GET /api/me` (`user.role`), `GET /api/admin/clans`, `GET /api/admin/clans/:id`, `PATCH /api/clans/:id`, `DELETE /api/clans/:id/emblem`, `DELETE /api/clans/:id`, `POST /api/users/:id/block-clans`; `Clan.api`, `Clan.act`, `Clan.field`, `Clan.errorText`, `h` (из `clan.js`).
- Produces: на `/clans/<TAG>` для админа — раздел «Администрирование»: поля «Тег», «Название», кнопки «Сохранить», «Сбросить описание», «Сбросить эмблему», «Удалить клан» (с подтверждением), у каждого участника — переключатель «Закрыть создание кланов».

- [ ] **Step 1: Реализовать блок**

В `clan.js` в `showProfile(tag)` после `show(...)` дописать загрузку админских данных (профиль публичный и должен отрисоваться без неё):

```js
      api.get('/api/me').then(function (me) {
        if (!me.user || me.user.role !== 'admin') return null;
        return api.get('/api/admin/clans').then(function (list) {
          var row = list.filter(function (x) { return x.tag.toLowerCase() === c.tag.toLowerCase(); })[0];
          return row ? api.get('/api/admin/clans/' + row.id) : null;
        });
      }).then(function (detail) {
        if (detail) app.appendChild(adminBlock(detail));
      }).catch(function () { /* the public profile stays as it is */ });
```

(`app` — контейнер, который уже используется функцией `show`; если в `clan.js` он называется иначе — использовать то же имя, что в `show()`.)

Функция:

```js
  // Site-admin tools. Everything goes through the stage-1 API; the server checks the role again.
  function adminBlock(d) {
    var err = h('p', { class: 'err' });
    var tag = h('input', { type: 'text', value: d.clan.tag, maxLength: 5 });
    var name = h('input', { type: 'text', value: d.clan.name, maxLength: 40 });
    var save = h('button', { type: 'button', class: 'primary' }, 'Сохранить');
    var resetDesc = h('button', { type: 'button' }, 'Сбросить описание');
    var resetEmblem = h('button', { type: 'button' }, 'Сбросить эмблему');
    var del = h('button', { type: 'button', class: 'danger' }, 'Удалить клан');
    var base = '/api/clans/' + d.clan.id;
    var NAMES = { tag_taken: 'Такой тег уже занят.', name_taken: 'Такое название уже занято.',
      tag_invalid: 'Тег: 2–5 букв или цифр.', name_invalid: 'Название: 3–40 символов.' };
    function fail(ex) { err.textContent = NAMES[ex && ex.message] || errorText(ex); }

    save.addEventListener('click', function () {
      act(save, err, function () {
        return api.patch(base, { tag: tag.value, name: name.value }).then(function (b) {
          void b;
          location.href = '/clans/' + encodeURIComponent(tag.value.trim());
        }, function (ex) { fail(ex); throw ex; });
      });
    });
    resetDesc.addEventListener('click', function () {
      act(resetDesc, err, function () { return api.patch(base, { description: '' }).then(function () { location.reload(); }); });
    });
    resetEmblem.addEventListener('click', function () {
      act(resetEmblem, err, function () { return api.del(base + '/emblem').then(function () { location.reload(); }); });
    });
    del.addEventListener('click', function () {
      if (!window.confirm('Удалить клан «' + d.clan.name + '» вместе с планами и рисунками? Это необратимо.')) return;
      act(del, err, function () { return api.del(base).then(function () { location.href = '/clans'; }); });
    });

    var members = h('ul', { class: 'list' }, d.members.map(function (m) {
      var cb = h('input', { type: 'checkbox', checked: m.clans_blocked });
      cb.addEventListener('change', function () {
        cb.disabled = true;
        api.post('/api/users/' + m.id + '/block-clans', { blocked: cb.checked }).then(function () {
          cb.disabled = false;
        }, function (ex) {
          cb.checked = !cb.checked;
          cb.disabled = false;
          fail(ex);
        });
      });
      return h('li', null, h('span', { class: 'grow' }, m.owner ? '★ ' : '', m.login),
        h('label', { class: 'muted' }, cb, ' закрыть создание кланов'));
    }));

    return h('section', { class: 'admin-block' },
      h('h2', null, 'Администрирование'),
      h('div', { class: 'row' }, tag, name, save),
      h('div', { class: 'row' }, resetDesc, resetEmblem, del),
      err,
      h('h3', null, 'Участники'),
      members);
  }
```

Замечание: `PATCH /api/clans/:id` у админа проходит через `memberOrAdmin(c, 'clan_settings')`; блокировка админа самого себя сервер отклоняет (`cannot block an admin`) — показать как есть через `fail`.

- [ ] **Step 2: Стили**

В `clan.css`:

```css
.admin-block { margin-top: 24px; padding-top: 12px; border-top: 1px solid var(--border, #2c2b25); }
.admin-block .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
.admin-block .row input { flex: 1 1 140px; min-width: 0; }
```

Поднять версию `?v=` в `clan.html`.

- [ ] **Step 3: Ручная проверка (браузер)**

- Гость и обычный игрок: профиль без блока «Администрирование»;
- админ: блок виден; смена названия и тега → редирект на новый `/clans/<ТЕГ>`; занятый тег → «Такой тег уже занят.»;
- «Сбросить описание/эмблему» → после перезагрузки пусто; «Удалить клан» → подтверждение → `/clans`;
- переключатель «закрыть создание кланов» меняет флаг (проверить: этот пользователь получает `403 clans_blocked` при `POST /api/clans`); на себе — ошибка «cannot block an admin»;
- 375 px без горизонтальной прокрутки.

- [ ] **Step 4: Commit**

```bash
git add clan.js clan.css clan.html
git commit -m "feat(clans): site-admin block on the clan profile"
```

---

### Task 7: Приватность, документация, выкатка

**Files:**
- Modify: `privacy.html` (абзац после клановского, строки ~57–62), `RELEASE.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-13-clans-tactics-design.md`

- [ ] **Step 1: `privacy.html`**

После абзаца про кланы добавить:

```html
  <p>Если ваш клан использует тактическую карту, мы храним планы клана и рисунки на них: линии, стрелки, зоны,
  метки и подписи, их координаты на карте, отряд, к которому рисунок относится, автора и время правки. Планы и
  рисунки видят участники клана с правом просмотра тактики и администратор сайта; публичный профиль клана их не
  показывает. Администратор может удалить рисунок или план при нарушении правил. Если вы выходите из клана, ваши
  рисунки остаются в планах клана без привязки к вам; удаление аккаунта убирает ваше авторство. Не размещайте
  в подписях личные данные других людей.</p>
```

Если у `privacy.html` есть дата «обновлено» — обновить на 2026-10-13.

- [ ] **Step 2: `RELEASE.md`**

В раздел «Кланы» добавить подраздел «Тактика (этапы 2–3)»: миграция 7 применяется сама; новых nginx-блоков нет; проверка `304` (`curl -i -H 'If-None-Match: "v1"' -b 'sid=…' https://anoma-wiki.ru/api/plans/<id>` → `304`, заголовок `ETag` на месте; если перед приложением стоит кэш или `proxy_buffering` с подменой заголовков — `ETag` теряется, смотреть `nginx -T | grep -n etag`); админский интерфейс клана — `/clans/<ТЕГ>` под админом, тактика всех кланов — `/map` → «Тактика» → «Клан: …»; заменить фразу «Отдельного интерфейса для админа пока нет (этап 3)» на ссылку на этот интерфейс.

- [ ] **Step 3: `CLAUDE.md`**

В «Сделано» — пункт «Тактика кланов (этапы 2–3)»: режим «Тактика» на `/map`, планы, опрос 15 с с `ETag`/`304`, карандаш, ластик, стрелка, зона, метка, текст, админский просмотр; перечислить файлы `map-tactics*.js`, `server/routes/tactics.js`, `server/routes/admin-clans.js`, `server/tactic-*.js`. В «Не сделано» удалить пункт про этапы 2 и 3 кланов; добавить: «Перед анонсом тактики руками пройти чек-листы планов `2026-10-13-clans-tactics-stage2.md` (Tasks 7–8) и `…-stage3.md` (Tasks 3–6) на ПК и 375 px; показать абзац «Тактика» в `/privacy` владельцу/юристу». В «Известные недочёты» добавить: нет отмены/повтора рисунков и редактирования подписи (только удалить и поставить заново).

- [ ] **Step 4: Спек**

В шапке спека заменить статус на «этапы 1–3 реализованы»; в разделе «Этапы реализации» отметить этапы 2 и 3.

- [ ] **Step 5: Полный прогон и коммит**

Run: `node --test server/test/*.test.js tools/*.test.js`
Expected: PASS.

```bash
git add privacy.html RELEASE.md CLAUDE.md docs/superpowers/specs/2026-10-13-clans-tactics-design.md
git commit -m "docs(tactics): privacy paragraph, release notes and status for stages 2-3"
```
