'use strict';

// Clan permissions are role flags (like Discord). The clan owner holds every flag and stands above
// every role. Everything here except memberContext is pure, so routes and tests share the same rules.
const PERMS = {
  tactics_view: 1,
  tactics_draw: 2,
  plans_manage: 4,
  squads_manage: 8,
  invite: 16,
  kick: 32,
  roles_manage: 64,
  clan_settings: 128,
};
const PERM_NAMES = Object.keys(PERMS);
const ALL_PERMS = 255;
const EVERYONE_DEFAULT = PERMS.tactics_view;

function permsToNames(mask) {
  return PERM_NAMES.filter((n) => (mask & PERMS[n]) !== 0);
}

function namesToPerms(names) {
  if (!Array.isArray(names)) return null;
  let mask = 0;
  for (const n of names) {
    if (typeof n !== 'string' || !Object.prototype.hasOwnProperty.call(PERMS, n)) return null;
    mask |= PERMS[n];
  }
  return mask;
}

// One clan per player, so the context is found by the user alone. Read on every request:
// a removed role stops working immediately.
function memberContext(db, userId) {
  const m = db
    .prepare('SELECT m.clan_id, c.owner_id FROM clan_members m JOIN clans c ON c.id = m.clan_id WHERE m.user_id = ?')
    .get(userId);
  if (!m) return null;
  if (m.owner_id === userId) {
    return { clanId: m.clan_id, userId, isOwner: true, perms: ALL_PERMS, top: Infinity, drawSquads: 'all' };
  }
  const roles = db
    .prepare(
      `SELECT id, position, perms, draw_all_squads FROM clan_roles
       WHERE clan_id = ? AND (is_everyone = 1 OR id IN (SELECT role_id FROM clan_member_roles WHERE user_id = ?))`,
    )
    .all(m.clan_id, userId);
  let perms = 0;
  let top = 0;
  let drawAll = false;
  const drawRoleIds = [];
  for (const r of roles) {
    perms |= r.perms;
    if (r.position > top) top = r.position;
    if (r.perms & PERMS.tactics_draw) {
      if (r.draw_all_squads) drawAll = true;
      else drawRoleIds.push(r.id);
    }
  }
  let drawSquads = 'all';
  if (!drawAll) {
    drawSquads = drawRoleIds.length
      ? db
        .prepare(
          `SELECT DISTINCT squad_id FROM clan_role_squads WHERE role_id IN (${drawRoleIds.map(() => '?').join(', ')})
           ORDER BY squad_id`,
        )
        .all(...drawRoleIds)
        .map((r) => r.squad_id)
      : [];
  }
  return { clanId: m.clan_id, userId, isOwner: false, perms, top, drawSquads };
}

const has = (ctx, name) => Boolean(ctx) && (ctx.perms & PERMS[name]) !== 0;

// A role is manageable when it sits strictly below the actor's highest role.
const roleBelow = (ctx, role) => ctx.isOwner || role.position < ctx.top;

// Nobody acts on the owner; others only on members whose highest role is lower than theirs.
function outranks(ctx, target) {
  if (target.isOwner) return false;
  return ctx.isOwner || target.top < ctx.top;
}

// Only flags the actor holds may be switched on or off, so nobody hands out (or strips) power they lack.
function permChangeAllowed(ctx, oldMask, newMask) {
  return ctx.isOwner || ((oldMask ^ newMask) & ~ctx.perms) === 0;
}

function drawScopeAllowed(ctx, drawAll, squadIds) {
  if (ctx.isOwner) return true;
  if (!has(ctx, 'tactics_draw')) return false;
  if (ctx.drawSquads === 'all') return true;
  if (drawAll) return false;
  return squadIds.every((id) => ctx.drawSquads.includes(id));
}

module.exports = {
  PERMS,
  PERM_NAMES,
  ALL_PERMS,
  EVERYONE_DEFAULT,
  permsToNames,
  namesToPerms,
  memberContext,
  has,
  roleBelow,
  outranks,
  permChangeAllowed,
  drawScopeAllowed,
};
