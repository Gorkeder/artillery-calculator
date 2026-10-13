'use strict';

const { HttpError, readJson } = require('../http-util');
const { PERMS, roleBelow, outranks, permChangeAllowed, drawScopeAllowed } = require('../clan-permissions');
const { validateRole, validateSquad, validateIdList } = require('../clan-validate');
const clanRepo = require('../clan-repo');
const { limitWrites, checked, intParam, memberOf, requirePerm, memberTarget } = require('../clan-http');

const SQUAD_COLORS = ['#4f8ad4', '#d4874f', '#7fb069', '#c8553d', '#a36fd4', '#4fc7d4', '#d4c24f', '#d44f9a', '#8a8a7a', '#e9e6d8'];

const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

function roleIn(c, ctx) {
  const role = c.db.prepare('SELECT * FROM clan_roles WHERE id = ? AND clan_id = ?').get(intParam(c, 'rid'), ctx.clanId);
  if (!role) throw new HttpError(404, 'role not found');
  return role;
}

function squadIn(c, ctx) {
  const squad = c.db.prepare('SELECT * FROM clan_squads WHERE id = ? AND clan_id = ?').get(intParam(c, 'sid'), ctx.clanId);
  if (!squad) throw new HttpError(404, 'squad not found');
  return squad;
}

function assertSquadsInClan(db, clanId, ids) {
  if (!ids.length) return;
  const n = db
    .prepare(`SELECT COUNT(*) AS n FROM clan_squads WHERE clan_id = ? AND id IN (${ids.map(() => '?').join(', ')})`)
    .get(clanId, ...ids).n;
  if (n !== ids.length) throw new HttpError(400, 'unknown squad');
}

function roleSquadIds(db, roleId) {
  return db.prepare('SELECT squad_id FROM clan_role_squads WHERE role_id = ?').all(roleId).map((r) => r.squad_id);
}

function setRoleSquads(db, roleId, ids) {
  db.prepare('DELETE FROM clan_role_squads WHERE role_id = ?').run(roleId);
  for (const sid of ids) db.prepare('INSERT INTO clan_role_squads (role_id, squad_id) VALUES (?, ?)').run(roleId, sid);
}

function checkDrawScope(ctx, drawAll, squads) {
  if (!drawScopeAllowed(ctx, drawAll, squads)) throw new HttpError(403, 'squad_not_held');
}

const body = (c) => ({ body: clanRepo.myClanBody(c.db, c.user.id) });

module.exports = [
  {
    method: 'POST',
    pattern: '/api/clans/:id/roles',
    handler: async (c) => {
      requirePerm(memberOf(c), 'roles_manage');
      limitWrites(c);
      const f = checked(validateRole(await readJson(c.req), { create: true }));
      const ctx = memberOf(c);
      requirePerm(ctx, 'roles_manage');
      // The new role lands at position 1, so the actor needs a role of their own above it.
      if (!ctx.isOwner && ctx.top < 1) throw new HttpError(403, 'role_above');
      const n = c.db.prepare('SELECT COUNT(*) AS n FROM clan_roles WHERE clan_id = ? AND is_everyone = 0').get(ctx.clanId).n;
      if (n >= clanRepo.LIMITS.roles) throw new HttpError(409, 'roles_limit');
      const perms = f.perms || 0;
      if (!permChangeAllowed(ctx, 0, perms)) throw new HttpError(403, 'perm_not_held');
      const squads = f.squads || [];
      if (f.draw_all_squads || squads.length) checkDrawScope(ctx, Boolean(f.draw_all_squads), squads);
      assertSquadsInClan(c.db, ctx.clanId, squads);
      clanRepo.tx(c.db, () => {
        c.db.prepare('UPDATE clan_roles SET position = position + 1 WHERE clan_id = ? AND is_everyone = 0').run(ctx.clanId);
        const roleId = Number(c.db.prepare(
          'INSERT INTO clan_roles (clan_id, name, color, position, perms, draw_all_squads) VALUES (?, ?, ?, 1, ?, ?)',
        ).run(ctx.clanId, f.name, f.color || '#9a9a86', perms, f.draw_all_squads || 0).lastInsertRowid);
        setRoleSquads(c.db, roleId, squads);
      });
      return { status: 201, body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    // Registered before PATCH/DELETE '/roles/:rid' only for readability: the methods differ anyway.
    method: 'PUT',
    pattern: '/api/clans/:id/roles/order',
    handler: async (c) => {
      requirePerm(memberOf(c), 'roles_manage');
      limitWrites(c);
      const ids = checked(validateIdList((await readJson(c.req)).ids, 20));
      const ctx = memberOf(c);
      requirePerm(ctx, 'roles_manage');
      const manageable = c.db
        .prepare('SELECT id, position FROM clan_roles WHERE clan_id = ? AND is_everyone = 0 ORDER BY position DESC')
        .all(ctx.clanId)
        .filter((r) => roleBelow(ctx, r));
      if (!sameSet(ids, manageable.map((r) => r.id))) throw new HttpError(400, 'order_mismatch');
      const positions = manageable.map((r) => r.position); // already highest first
      clanRepo.tx(c.db, () => {
        ids.forEach((roleId, i) => c.db.prepare('UPDATE clan_roles SET position = ? WHERE id = ?').run(positions[i], roleId));
      });
      return body(c);
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/clans/:id/roles/:rid',
    handler: async (c) => {
      requirePerm(memberOf(c), 'roles_manage');
      limitWrites(c);
      const f = checked(validateRole(await readJson(c.req)));
      const ctx = memberOf(c);
      requirePerm(ctx, 'roles_manage');
      const role = roleIn(c, ctx);
      if (!roleBelow(ctx, role)) throw new HttpError(403, 'role_above');
      if (role.is_everyone && f.name !== undefined) throw new HttpError(400, 'everyone_name_fixed');
      if (!Object.keys(f).length) throw new HttpError(400, 'nothing to update');
      if (f.perms !== undefined && !permChangeAllowed(ctx, role.perms, f.perms)) throw new HttpError(403, 'perm_not_held');
      const current = roleSquadIds(c.db, role.id);
      const drawAll = f.draw_all_squads !== undefined ? f.draw_all_squads : role.draw_all_squads;
      const squads = f.squads !== undefined ? f.squads : current;
      // Only a real change of the draw scope is checked, so editing the name of a wide role stays possible.
      const newPerms = f.perms !== undefined ? f.perms : role.perms;
      const gainsDraw = (newPerms & PERMS.tactics_draw) && !(role.perms & PERMS.tactics_draw);
      if (gainsDraw || drawAll !== role.draw_all_squads || !sameSet(squads, current)) {
        checkDrawScope(ctx, Boolean(drawAll), squads);
        assertSquadsInClan(c.db, ctx.clanId, squads);
      }
      clanRepo.tx(c.db, () => {
        const { squads: _ignored, ...cols } = f;
        void _ignored;
        const keys = Object.keys(cols);
        if (keys.length) {
          c.db.prepare(`UPDATE clan_roles SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`)
            .run(...keys.map((k) => cols[k]), role.id);
        }
        if (f.squads !== undefined) setRoleSquads(c.db, role.id, f.squads);
      });
      return body(c);
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/clans/:id/roles/:rid',
    handler: async (c) => {
      const ctx = memberOf(c);
      limitWrites(c);
      requirePerm(ctx, 'roles_manage');
      const role = roleIn(c, ctx);
      if (role.is_everyone) throw new HttpError(400, 'everyone_fixed');
      if (!roleBelow(ctx, role)) throw new HttpError(403, 'role_above');
      c.db.prepare('DELETE FROM clan_roles WHERE id = ?').run(role.id);
      return body(c);
    },
  },
  {
    method: 'POST',
    pattern: '/api/clans/:id/squads',
    handler: async (c) => {
      requirePerm(memberOf(c), 'squads_manage');
      limitWrites(c);
      const f = checked(validateSquad(await readJson(c.req), { create: true }));
      const ctx = memberOf(c);
      requirePerm(ctx, 'squads_manage');
      const stats = c.db
        .prepare('SELECT COUNT(*) AS n, COALESCE(MAX(position), -1) AS maxPos FROM clan_squads WHERE clan_id = ?')
        .get(ctx.clanId);
      if (stats.n >= clanRepo.LIMITS.squads) throw new HttpError(409, 'squads_limit');
      const used = c.db.prepare('SELECT color FROM clan_squads WHERE clan_id = ?').all(ctx.clanId).map((r) => r.color);
      const color = f.color || SQUAD_COLORS.find((x) => !used.includes(x)) || SQUAD_COLORS[0];
      c.db.prepare('INSERT INTO clan_squads (clan_id, name, color, position) VALUES (?, ?, ?, ?)')
        .run(ctx.clanId, f.name, color, stats.maxPos + 1);
      return { status: 201, body: clanRepo.myClanBody(c.db, c.user.id) };
    },
  },
  {
    method: 'PUT',
    pattern: '/api/clans/:id/squads/order',
    handler: async (c) => {
      requirePerm(memberOf(c), 'squads_manage');
      limitWrites(c);
      const ids = checked(validateIdList((await readJson(c.req)).ids, 20));
      const ctx = memberOf(c);
      requirePerm(ctx, 'squads_manage');
      const all = c.db.prepare('SELECT id FROM clan_squads WHERE clan_id = ?').all(ctx.clanId).map((r) => r.id);
      if (!sameSet(ids, all)) throw new HttpError(400, 'order_mismatch');
      clanRepo.tx(c.db, () => {
        ids.forEach((sid, i) => c.db.prepare('UPDATE clan_squads SET position = ? WHERE id = ?').run(i, sid));
      });
      return body(c);
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/clans/:id/squads/:sid',
    handler: async (c) => {
      requirePerm(memberOf(c), 'squads_manage');
      limitWrites(c);
      const f = checked(validateSquad(await readJson(c.req)));
      const ctx = memberOf(c);
      requirePerm(ctx, 'squads_manage');
      const squad = squadIn(c, ctx);
      const keys = Object.keys(f);
      if (!keys.length) throw new HttpError(400, 'nothing to update');
      c.db.prepare(`UPDATE clan_squads SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`)
        .run(...keys.map((k) => f[k]), squad.id);
      return body(c);
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/clans/:id/squads/:sid',
    handler: async (c) => {
      const ctx = memberOf(c);
      limitWrites(c);
      requirePerm(ctx, 'squads_manage');
      const squad = squadIn(c, ctx);
      c.db.prepare('DELETE FROM clan_squads WHERE id = ?').run(squad.id);
      return body(c);
    },
  },
  {
    method: 'PUT',
    pattern: '/api/clans/:id/members/:uid',
    handler: async (c) => {
      memberOf(c);
      limitWrites(c);
      const input = await readJson(c.req);
      const ctx = memberOf(c);
      const target = memberTarget(c, ctx, 'uid');
      const self = target.userId === ctx.userId;
      if (!('roles' in input) && !('squads' in input)) throw new HttpError(400, 'nothing to update');
      clanRepo.tx(c.db, () => {
        if ('roles' in input) {
          requirePerm(ctx, 'roles_manage');
          if (!self && !outranks(ctx, target)) throw new HttpError(403, 'forbidden');
          const ids = checked(validateIdList(input.roles, 10));
          const byId = new Map(
            c.db.prepare('SELECT * FROM clan_roles WHERE clan_id = ? AND is_everyone = 0').all(ctx.clanId).map((r) => [r.id, r]),
          );
          if (ids.some((rid) => !byId.has(rid))) throw new HttpError(400, 'unknown role');
          const current = c.db.prepare('SELECT role_id FROM clan_member_roles WHERE user_id = ?').all(target.userId).map((r) => r.role_id);
          const changed = ids.filter((x) => !current.includes(x)).concat(current.filter((x) => !ids.includes(x)));
          for (const rid of changed) {
            const role = byId.get(rid);
            if (!roleBelow(ctx, role) || !permChangeAllowed(ctx, 0, role.perms)) throw new HttpError(403, 'role_above');
            // A lower role must not widen draw rights beyond the assigner's own squads.
            if (role.perms & PERMS.tactics_draw) {
              checkDrawScope(ctx, Boolean(role.draw_all_squads), roleSquadIds(c.db, role.id));
            }
          }
          c.db.prepare('DELETE FROM clan_member_roles WHERE user_id = ?').run(target.userId);
          for (const rid of ids) c.db.prepare('INSERT INTO clan_member_roles (user_id, role_id) VALUES (?, ?)').run(target.userId, rid);
        }
        if ('squads' in input) {
          requirePerm(ctx, 'squads_manage');
          if (!self && !outranks(ctx, target)) throw new HttpError(403, 'forbidden');
          const ids = checked(validateIdList(input.squads, 10));
          assertSquadsInClan(c.db, ctx.clanId, ids);
          c.db.prepare('DELETE FROM clan_squad_members WHERE user_id = ?').run(target.userId);
          for (const sid of ids) c.db.prepare('INSERT INTO clan_squad_members (squad_id, user_id) VALUES (?, ?)').run(sid, target.userId);
        }
      });
      return body(c);
    },
  },
];
