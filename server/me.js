'use strict';

const { capabilities } = require('./permissions');

function meBody(db, user) {
  if (!user) return { user: null, can: capabilities(null) };
  const row = db
    .prepare('SELECT email, email_verified_at, proposals_blocked_at, proposals_block_reason FROM users WHERE id = ?')
    .get(user.id);
  const blocked = Boolean(row && row.proposals_blocked_at);
  // The caller may pass a row that does not carry the flag (login), so it is always re-read here.
  const effective = { ...user, proposalsBlocked: blocked };
  const clan = db
    .prepare('SELECT c.id, c.tag FROM clan_members m JOIN clans c ON c.id = m.clan_id WHERE m.user_id = ?')
    .get(user.id);
  const clanInvitations = clan
    ? 0
    : db.prepare('SELECT COUNT(*) AS n FROM clan_invitations WHERE user_id = ?').get(user.id).n;
  return {
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      email: row ? row.email : null,
      emailVerified: Boolean(row && row.email_verified_at),
      proposalsBlocked: blocked,
      blockReason: blocked ? (row.proposals_block_reason || '') : null,
      clan: clan ? { id: clan.id, tag: clan.tag } : null,
      clanInvitations,
    },
    can: capabilities(effective),
  };
}

module.exports = { meBody };
