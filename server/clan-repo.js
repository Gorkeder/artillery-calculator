'use strict';

const { EVERYONE_DEFAULT, permsToNames, memberContext } = require('./clan-permissions');
const { clanKey } = require('./clan-validate');

const LIMITS = { members: 50, squads: 10, roles: 10, activeInvites: 20, pendingInvitations: 50 };
const uploadUrl = (p) => (p ? '/uploads/' + p : null);

function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function clanOut(r) {
  return {
    id: r.id,
    tag: r.tag,
    name: r.name,
    description: r.description,
    emblem_url: uploadUrl(r.emblem_path),
    created_at: r.created_at,
  };
}

const getClan = (db, id) => db.prepare('SELECT * FROM clans WHERE id = ?').get(id) || null;
const getClanByTag = (db, tag) => db.prepare('SELECT * FROM clans WHERE tag_key = ?').get(clanKey(tag)) || null;

// `column` is 'tag_key' or 'name_key', always from code.
function keyTaken(db, column, key, exceptId) {
  return Boolean(db.prepare(`SELECT 1 FROM clans WHERE ${column} = ? AND id != ?`).get(key, exceptId || 0));
}

const countMembers = (db, clanId) =>
  db.prepare('SELECT COUNT(*) AS n FROM clan_members WHERE clan_id = ?').get(clanId).n;

// Joining any clan voids every pending invitation of the player (one clan per player).
function addMember(db, clanId, userId) {
  db.prepare('DELETE FROM clan_invitations WHERE user_id = ?').run(userId);
  db.prepare('INSERT INTO clan_members (clan_id, user_id) VALUES (?, ?)').run(clanId, userId);
}

// Roles and squad places of the member go with the row (ON DELETE CASCADE).
function removeMember(db, userId) {
  db.prepare('DELETE FROM clan_members WHERE user_id = ?').run(userId);
}

function createClan(db, { tag, name, description, ownerId }) {
  return tx(db, () => {
    const id = Number(db.prepare(
      'INSERT INTO clans (tag, tag_key, name, name_key, description, owner_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(tag, clanKey(tag), name, clanKey(name), description || '', ownerId).lastInsertRowid);
    db.prepare(
      "INSERT INTO clan_roles (clan_id, name, color, position, perms, is_everyone) VALUES (?, '@everyone', '#9a9a86', 0, ?, 1)",
    ).run(id, EVERYONE_DEFAULT);
    addMember(db, id, ownerId);
    return id;
  });
}

function listClans(db, q) {
  const like = '%' + clanKey(q || '').replace(/[\\%_]/g, (ch) => '\\' + ch) + '%';
  return db
    .prepare(
      `SELECT c.*, (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id) AS members
       FROM clans c WHERE c.tag_key LIKE ? ESCAPE '\\' OR c.name_key LIKE ? ESCAPE '\\'
       ORDER BY members DESC, c.name_key LIMIT 100`,
    )
    .all(like, like)
    .map((r) => ({ tag: r.tag, name: r.name, emblem_url: uploadUrl(r.emblem_path), members: r.members }));
}

// Public: logins and role names only, no user ids.
function publicProfile(db, clan) {
  const owner = db.prepare('SELECT login FROM users WHERE id = ?').get(clan.owner_id);
  const members = db
    .prepare('SELECT u.id, u.login FROM clan_members m JOIN users u ON u.id = m.user_id WHERE m.clan_id = ? ORDER BY lower(u.login)')
    .all(clan.id);
  const roles = db
    .prepare(
      `SELECT mr.user_id, r.name, r.color FROM clan_member_roles mr JOIN clan_roles r ON r.id = mr.role_id
       WHERE r.clan_id = ? ORDER BY r.position DESC`,
    )
    .all(clan.id);
  const { id, ...pub } = clanOut(clan);
  void id;
  return {
    ...pub,
    owner: owner ? owner.login : null,
    members: members.map((m) => ({
      login: m.login,
      owner: m.id === clan.owner_id,
      roles: roles.filter((r) => r.user_id === m.id).map((r) => ({ name: r.name, color: r.color })),
    })),
  };
}

function invitationsForUser(db, userId) {
  return db
    .prepare(
      `SELECT i.id, c.tag, c.name, c.emblem_path, u.login AS invited_by, i.created_at
       FROM clan_invitations i JOIN clans c ON c.id = i.clan_id LEFT JOIN users u ON u.id = i.invited_by
       WHERE i.user_id = ? ORDER BY i.id DESC`,
    )
    .all(userId)
    .map((r) => ({ id: r.id, tag: r.tag, name: r.name, emblem_url: uploadUrl(r.emblem_path), invited_by: r.invited_by, created_at: r.created_at }));
}

// Everything the /clan page needs in one response; every clan write returns it too.
function myClanBody(db, userId) {
  const ctx = memberContext(db, userId);
  if (!ctx) return { clan: null, invitations: invitationsForUser(db, userId) };
  const clan = getClan(db, ctx.clanId);
  const roles = db.prepare('SELECT * FROM clan_roles WHERE clan_id = ? ORDER BY position DESC, id').all(clan.id);
  const roleSquads = db
    .prepare('SELECT rs.role_id, rs.squad_id FROM clan_role_squads rs JOIN clan_roles r ON r.id = rs.role_id WHERE r.clan_id = ?')
    .all(clan.id);
  const squads = db
    .prepare('SELECT id, name, color, position FROM clan_squads WHERE clan_id = ? ORDER BY position, id')
    .all(clan.id);
  const members = db
    .prepare(
      `SELECT m.user_id, u.login, m.joined_at FROM clan_members m JOIN users u ON u.id = m.user_id
       WHERE m.clan_id = ? ORDER BY lower(u.login)`,
    )
    .all(clan.id);
  const memberRoles = db
    .prepare('SELECT mr.user_id, mr.role_id, r.position FROM clan_member_roles mr JOIN clan_roles r ON r.id = mr.role_id WHERE r.clan_id = ?')
    .all(clan.id);
  const memberSquads = db
    .prepare('SELECT sm.user_id, sm.squad_id FROM clan_squad_members sm JOIN clan_squads s ON s.id = sm.squad_id WHERE s.clan_id = ?')
    .all(clan.id);
  return {
    clan: clanOut(clan),
    me: {
      id: userId,
      isOwner: ctx.isOwner,
      perms: permsToNames(ctx.perms),
      top: ctx.isOwner ? null : ctx.top,
      drawSquads: ctx.drawSquads,
    },
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      position: r.position,
      perms: permsToNames(r.perms),
      draw_all_squads: Boolean(r.draw_all_squads),
      everyone: Boolean(r.is_everyone),
      squads: roleSquads.filter((x) => x.role_id === r.id).map((x) => x.squad_id),
    })),
    squads,
    members: members.map((m) => {
      const mine = memberRoles.filter((x) => x.user_id === m.user_id);
      return {
        id: m.user_id,
        login: m.login,
        joined_at: m.joined_at,
        owner: m.user_id === clan.owner_id,
        top: mine.reduce((t, x) => Math.max(t, x.position), 0),
        roles: mine.map((x) => x.role_id),
        squads: memberSquads.filter((x) => x.user_id === m.user_id).map((x) => x.squad_id),
      };
    }),
    limits: LIMITS,
  };
}

module.exports = {
  LIMITS,
  tx,
  clanOut,
  getClan,
  getClanByTag,
  keyTaken,
  countMembers,
  addMember,
  removeMember,
  createClan,
  listClans,
  publicProfile,
  invitationsForUser,
  myClanBody,
};
