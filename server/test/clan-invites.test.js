'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { clanSetup } = require('./clan-helpers');
const { createUser, createSession } = require('../auth');
const { PERMS } = require('../clan-permissions');

const tokenOf = (url) => url.split('/clan/join/')[1];

test('invite link: create, preview, join, use limit and revoke', async (t) => {
  const { s, as, makeClan } = await clanSetup(t);
  const clanId = await makeClan();
  const base = `/api/clans/${clanId}`;
  assert.equal((await as('bob')('POST', base + '/invites', {})).status, 404, 'outsider');
  const r = await as('alice')('POST', base + '/invites', { ttl: '1d', maxUses: 1 });
  assert.equal(r.status, 201);
  assert.match(r.json.url, /^https:\/\/test\.local\/clan\/join\/[0-9a-f]{64}$/);
  const token = tokenOf(r.json.url);
  const preview = await s.api('GET', '/api/clans/join/' + token);
  assert.deepEqual(preview.json, { tag: 'ALF', name: 'Alpha Wolves', emblem_url: null, members: 1 });
  assert.equal((await s.api('POST', '/api/clans/join/' + token, { body: {} })).status, 401);
  const joined = await as('bob')('POST', '/api/clans/join/' + token, {});
  assert.equal(joined.status, 200);
  assert.equal(joined.json.clan.id, clanId);
  const used = await as('carol')('POST', '/api/clans/join/' + token, {});
  assert.deepEqual([used.status, used.json.error], [404, 'invite_invalid'], 'max uses reached');
  const r2 = await as('alice')('POST', base + '/invites', { ttl: null });
  assert.equal((await as('alice')('GET', base + '/invites')).json.invites.length, 1, 'only active links are listed');
  await as('alice')('DELETE', `${base}/invites/${r2.json.id}`);
  assert.equal((await as('carol')('POST', '/api/clans/join/' + tokenOf(r2.json.url), {})).json.error, 'invite_invalid');
  assert.equal((await s.api('GET', '/api/clans/join/nothex')).status, 404);
});

test('invite link expires', async (t) => {
  const { s, as, makeClan } = await clanSetup(t);
  const now = Date.now();
  s.setNow(now);
  const clanId = await makeClan();
  const r = await as('alice')('POST', `/api/clans/${clanId}/invites`, { ttl: '1d' });
  s.setNow(now + 24 * 60 * 60 * 1000 + 1);
  assert.equal((await as('bob')('POST', '/api/clans/join/' + tokenOf(r.json.url), {})).json.error, 'invite_invalid');
});

test('joining: already in a clan, full clan, parallel joins of one player', async (t) => {
  const { s, as, makeClan } = await clanSetup(t);
  const clanId = await makeClan();
  await makeClan('carol', 'BRV', 'Bravo team');
  const r = await as('alice')('POST', `/api/clans/${clanId}/invites`, { ttl: null });
  const token = tokenOf(r.json.url);
  assert.equal((await as('carol')('POST', '/api/clans/join/' + token, {})).json.error, 'already_in_clan');
  const both = await Promise.all([as('bob')('POST', '/api/clans/join/' + token, {}), as('bob')('POST', '/api/clans/join/' + token, {})]);
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 409]);
  for (let i = 0; i < 48; i++) {
    // Direct inserts: 48 scrypt hashes would slow the suite down for nothing.
    const uid = Number(s.db.prepare("INSERT INTO users (login, password_hash) VALUES (?, 'x')").run('filler' + i).lastInsertRowid);
    s.db.prepare('INSERT INTO clan_members (clan_id, user_id) VALUES (?, ?)').run(clanId, uid);
  }
  assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ?').get(clanId).n, 50);
  const late = createUser(s.db, { login: 'late', password: 'late-pass-12', role: 'user' });
  const lateCookie = 'sid=' + createSession(s.db, late, Date.now());
  const full = await s.api('POST', '/api/clans/join/' + token, { cookie: lateCookie, body: {} });
  assert.deepEqual([full.status, full.json.error], [409, 'clan_full']);
});

test('invitation by login: invite, accept voids other invitations, decline, revoke', async (t) => {
  const { as, makeClan, addMember, grantRole } = await clanSetup(t);
  const a = await makeClan();
  const b = await makeClan('carol', 'BRV', 'Bravo team');
  addMember(a, 'bob');
  assert.equal((await as('bob')('POST', `/api/clans/${a}/invitations`, { login: 'dave' })).status, 403, 'no invite flag');
  grantRole(a, 'bob', 'Recruiter', 1, PERMS.invite);
  const r = await as('bob')('POST', `/api/clans/${a}/invitations`, { login: 'DAVE' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.invitations.map((i) => [i.login, i.invited_by]), [['dave', 'bob']]);
  assert.equal((await as('bob')('POST', `/api/clans/${a}/invitations`, { login: 'dave' })).json.error, 'already_invited');
  assert.equal((await as('bob')('POST', `/api/clans/${a}/invitations`, { login: 'carol' })).json.error, 'already_in_clan');
  assert.equal((await as('bob')('POST', `/api/clans/${a}/invitations`, { login: 'ghost' })).json.error, 'user_not_found');
  await as('carol')('POST', `/api/clans/${b}/invitations`, { login: 'dave' });
  const mine = (await as('dave')('GET', '/api/my/clan')).json.invitations;
  assert.equal(mine.length, 2);
  const fromA = mine.find((i) => i.tag === 'ALF');
  assert.equal((await as('bob')('POST', `/api/invitations/${fromA.id}/accept`, {})).status, 404, 'not your invitation');
  const acc = await as('dave')('POST', `/api/invitations/${fromA.id}/accept`, {});
  assert.equal(acc.json.clan.id, a);
  assert.deepEqual((await as('carol')('GET', `/api/clans/${b}/invitations`)).json.invitations, [], 'the other invitation is gone');
});

test('declining and revoking invitations', async (t) => {
  const { as, makeClan } = await clanSetup(t);
  const a = await makeClan();
  const r = await as('alice')('POST', `/api/clans/${a}/invitations`, { login: 'bob' });
  const invId = r.json.invitations[0].id;
  const dec = await as('bob')('POST', `/api/invitations/${invId}/decline`, {});
  assert.deepEqual([dec.status, dec.json.clan, dec.json.invitations], [200, null, []]);
  const r2 = await as('alice')('POST', `/api/clans/${a}/invitations`, { login: 'bob' });
  const rev = await as('alice')('DELETE', `/api/clans/${a}/invitations/${r2.json.invitations[0].id}`);
  assert.deepEqual(rev.json.invitations, []);
  assert.equal((await as('bob')('GET', '/api/me')).json.user.clanInvitations, 0);
});
