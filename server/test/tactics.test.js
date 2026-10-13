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
