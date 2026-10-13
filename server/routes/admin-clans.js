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
