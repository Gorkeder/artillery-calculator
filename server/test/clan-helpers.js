'use strict';

const { startTestServer } = require('./helpers');
const { createUser, createSession } = require('../auth');

// Four verified users (alice, bob, carol, dave) and helpers to build clans quickly.
async function clanSetup(t, opts) {
  const s = await startTestServer(opts);
  t.after(() => s.cleanup());
  const users = {};
  for (const login of ['alice', 'bob', 'carol', 'dave']) {
    const id = createUser(s.db, { login, password: login + '-pass-1', role: 'user' });
    users[login] = { id, cookie: 'sid=' + createSession(s.db, id, Date.now()) };
  }
  users.admin = { id: s.adminId, cookie: s.adminCookie };
  const as = (who) => (method, url, body, extra = {}) =>
    s.api(method, url, { cookie: users[who].cookie, body, ...extra });
  async function makeClan(owner = 'alice', tag = 'ALF', name = 'Alpha Wolves') {
    const r = await as(owner)('POST', '/api/clans', { tag, name });
    if (r.status !== 201) throw new Error('create failed: ' + JSON.stringify(r.json));
    return r.json.clan.id;
  }
  function addMember(clanId, who) {
    s.db.prepare('INSERT INTO clan_members (clan_id, user_id) VALUES (?, ?)').run(clanId, users[who].id);
  }
  // Creates a role at `position` with the given flag mask and gives it to `who`; returns the role id.
  function grantRole(clanId, who, name, position, perms, drawAll = 0) {
    const roleId = Number(s.db.prepare(
      'INSERT INTO clan_roles (clan_id, name, position, perms, draw_all_squads) VALUES (?, ?, ?, ?, ?)',
    ).run(clanId, name, position, perms, drawAll).lastInsertRowid);
    if (who) s.db.prepare('INSERT INTO clan_member_roles (user_id, role_id) VALUES (?, ?)').run(users[who].id, roleId);
    return roleId;
  }
  return { s, users, as, makeClan, addMember, grantRole };
}

module.exports = { clanSetup };
