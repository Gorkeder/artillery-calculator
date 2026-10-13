'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../db');
const P = require('../clan-permissions');

const { PERMS } = P;

function fixture() {
  const db = openDb(':memory:');
  const user = (login) => Number(db.prepare("INSERT INTO users (login, password_hash) VALUES (?, 'x')").run(login).lastInsertRowid);
  const owner = user('owner');
  const lead = user('lead');
  const lead2 = user('lead2');
  const cmd = user('cmd');
  const grunt = user('grunt');
  const outsider = user('outsider');
  const clanId = Number(db.prepare(
    "INSERT INTO clans (tag, tag_key, name, name_key, owner_id) VALUES ('ALF', 'alf', 'Alpha', 'alpha', ?)",
  ).run(owner).lastInsertRowid);
  for (const u of [owner, lead, lead2, cmd, grunt]) {
    db.prepare('INSERT INTO clan_members (clan_id, user_id) VALUES (?, ?)').run(clanId, u);
  }
  const role = (name, position, perms, drawAll = 0, everyone = 0) => Number(db.prepare(
    'INSERT INTO clan_roles (clan_id, name, position, perms, draw_all_squads, is_everyone) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(clanId, name, position, perms, drawAll, everyone).lastInsertRowid);
  const squad = (name) => Number(db.prepare(
    "INSERT INTO clan_squads (clan_id, name, color) VALUES (?, ?, '#ffffff')",
  ).run(clanId, name).lastInsertRowid);
  role('@everyone', 0, PERMS.tactics_view, 0, 1);
  const alpha = squad('Alpha');
  const bravo = squad('Bravo');
  const officer = role('Officer', 2, PERMS.tactics_draw | PERMS.kick | PERMS.roles_manage, 1);
  const alphaCmd = role('Alpha cmd', 1, PERMS.tactics_draw);
  db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(alphaCmd, alpha);
  const give = (u, r) => db.prepare('INSERT INTO clan_member_roles (user_id, role_id) VALUES (?, ?)').run(u, r);
  give(lead, officer);
  give(lead, alphaCmd);
  give(lead2, officer);
  give(cmd, alphaCmd);
  const ctx = (u) => P.memberContext(db, u);
  return { db, clanId, owner, lead, lead2, cmd, grunt, outsider, officer, alphaCmd, alpha, bravo, ctx };
}

test('perm names round-trip and unknown names are rejected', () => {
  assert.deepEqual(P.permsToNames(PERMS.kick | PERMS.invite), ['invite', 'kick']);
  assert.equal(P.namesToPerms(['invite', 'kick']), PERMS.kick | PERMS.invite);
  assert.equal(P.namesToPerms([]), 0);
  assert.equal(P.namesToPerms(['fly']), null);
  assert.equal(P.namesToPerms('kick'), null);
  assert.equal(P.ALL_PERMS, 255);
});

test('memberContext unions roles, includes @everyone and resolves draw squads', () => {
  const f = fixture();
  const o = f.ctx(f.owner);
  assert.deepEqual([o.isOwner, o.perms, o.top, o.drawSquads], [true, 255, Infinity, 'all']);
  const l = f.ctx(f.lead);
  assert.equal(l.isOwner, false);
  assert.equal(l.perms, PERMS.tactics_view | PERMS.tactics_draw | PERMS.kick | PERMS.roles_manage);
  assert.equal(l.top, 2);
  assert.equal(l.drawSquads, 'all', 'one role with draw_all_squads is enough');
  const c = f.ctx(f.cmd);
  assert.equal(c.top, 1);
  assert.deepEqual(c.drawSquads, [f.alpha]);
  const g = f.ctx(f.grunt);
  assert.deepEqual([g.perms, g.top, g.drawSquads], [PERMS.tactics_view, 0, []]);
  assert.equal(f.ctx(f.outsider), null);
  assert.equal(g.clanId, f.clanId);
});

test('draw squads stay empty when the role with squads has no draw permission', () => {
  const f = fixture();
  const viewer = Number(f.db.prepare(
    "INSERT INTO clan_roles (clan_id, name, position, perms) VALUES (?, 'Viewer', 3, 0)",
  ).run(f.clanId).lastInsertRowid);
  f.db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(viewer, f.bravo);
  f.db.prepare('INSERT INTO clan_member_roles (user_id, role_id) VALUES (?, ?)').run(f.grunt, viewer);
  assert.deepEqual(f.ctx(f.grunt).drawSquads, []);
});

test('hierarchy: owner outranks all, equal rank does not outrank, nobody outranks the owner', () => {
  const f = fixture();
  assert.equal(P.outranks(f.ctx(f.owner), f.ctx(f.lead)), true);
  assert.equal(P.outranks(f.ctx(f.lead), f.ctx(f.cmd)), true);
  assert.equal(P.outranks(f.ctx(f.cmd), f.ctx(f.lead)), false);
  assert.equal(P.outranks(f.ctx(f.lead), f.ctx(f.lead2)), false);
  assert.equal(P.outranks(f.ctx(f.lead), f.ctx(f.owner)), false);
  assert.equal(P.roleBelow(f.ctx(f.lead), { position: 1 }), true);
  assert.equal(P.roleBelow(f.ctx(f.lead), { position: 2 }), false);
  assert.equal(P.roleBelow(f.ctx(f.owner), { position: 99 }), true);
});

test('only bits the actor holds may change', () => {
  const f = fixture();
  const lead = f.ctx(f.lead);
  assert.equal(P.permChangeAllowed(lead, 0, PERMS.kick), true);
  assert.equal(P.permChangeAllowed(lead, 0, PERMS.invite), false);
  assert.equal(P.permChangeAllowed(lead, PERMS.invite, PERMS.invite | PERMS.kick), true, 'untouched foreign bits are fine');
  assert.equal(P.permChangeAllowed(lead, PERMS.invite, 0), false, 'cannot remove a bit you lack either');
  assert.equal(P.permChangeAllowed(f.ctx(f.owner), 0, 255), true);
});

test('draw scope can be granted only within the actor scope', () => {
  const f = fixture();
  assert.equal(P.drawScopeAllowed(f.ctx(f.lead), true, []), true);
  const c = f.ctx(f.cmd);
  assert.equal(P.drawScopeAllowed(c, false, [f.alpha]), true);
  assert.equal(P.drawScopeAllowed(c, false, [f.bravo]), false);
  assert.equal(P.drawScopeAllowed(c, true, []), false);
  assert.equal(P.drawScopeAllowed(f.ctx(f.grunt), false, []), false, 'no draw permission at all');
  assert.equal(P.has(c, 'tactics_draw'), true);
  assert.equal(P.has(c, 'kick'), false);
  assert.equal(P.has(null, 'kick'), false);
});
