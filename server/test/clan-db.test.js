'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { openDb, SCHEMA, MIGRATIONS, migrate } = require('../db');

function seed(db) {
  const user = (login) => Number(db.prepare("INSERT INTO users (login, password_hash) VALUES (?, 'x')").run(login).lastInsertRowid);
  const owner = user('owner');
  const bob = user('bob');
  const clanId = Number(db.prepare(
    "INSERT INTO clans (tag, tag_key, name, name_key, owner_id) VALUES ('ALF', 'alf', 'Alpha', 'alpha', ?)",
  ).run(owner).lastInsertRowid);
  db.prepare('INSERT INTO clan_members (clan_id, user_id) VALUES (?, ?)').run(clanId, owner);
  db.prepare('INSERT INTO clan_members (clan_id, user_id) VALUES (?, ?)').run(clanId, bob);
  const roleId = Number(db.prepare(
    "INSERT INTO clan_roles (clan_id, name, position, perms) VALUES (?, 'Officer', 1, 2)",
  ).run(clanId).lastInsertRowid);
  const squadId = Number(db.prepare(
    "INSERT INTO clan_squads (clan_id, name, color) VALUES (?, 'Alpha', '#ffffff')",
  ).run(clanId).lastInsertRowid);
  db.prepare('INSERT INTO clan_member_roles (user_id, role_id) VALUES (?, ?)').run(bob, roleId);
  db.prepare('INSERT INTO clan_squad_members (squad_id, user_id) VALUES (?, ?)').run(squadId, bob);
  db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(roleId, squadId);
  return { owner, bob, clanId, roleId, squadId };
}

const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

test('migration 6 upgrades a version 5 database and keeps users', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const m of MIGRATIONS.filter((x) => x.version <= 5)) db.exec(m.sql);
  db.exec('PRAGMA user_version = 5');
  db.exec("INSERT INTO users (login, password_hash) VALUES ('keeper', 'x')");
  migrate(db);
  assert.ok(db.prepare('PRAGMA user_version').get().user_version >= 6);
  assert.equal(db.prepare("SELECT clans_blocked FROM users WHERE login = 'keeper'").get().clans_blocked, 0);
  assert.equal(count(db, 'clans'), 0);
  db.close();
});

test('one clan per user is enforced by the schema', () => {
  const db = openDb(':memory:');
  const { bob } = seed(db);
  const other = Number(db.prepare(
    "INSERT INTO clans (tag, tag_key, name, name_key, owner_id) VALUES ('BRV', 'brv', 'Bravo', 'bravo', ?)",
  ).run(bob).lastInsertRowid);
  assert.throws(() => db.prepare('INSERT INTO clan_members (clan_id, user_id) VALUES (?, ?)').run(other, bob), /UNIQUE/);
});

test('removing a member drops their roles and squads; deleting a clan drops everything', () => {
  const db = openDb(':memory:');
  const { bob, clanId } = seed(db);
  db.prepare('DELETE FROM clan_members WHERE user_id = ?').run(bob);
  assert.equal(count(db, 'clan_member_roles'), 0);
  assert.equal(count(db, 'clan_squad_members'), 0);
  db.prepare('DELETE FROM clans WHERE id = ?').run(clanId);
  for (const t of ['clan_members', 'clan_roles', 'clan_squads', 'clan_role_squads', 'clan_invites', 'clan_invitations']) {
    assert.equal(count(db, t), 0, t);
  }
});

test('deleting a squad drops role and member links to it', () => {
  const db = openDb(':memory:');
  const { squadId } = seed(db);
  db.prepare('DELETE FROM clan_squads WHERE id = ?').run(squadId);
  assert.equal(count(db, 'clan_role_squads'), 0);
  assert.equal(count(db, 'clan_squad_members'), 0);
});
