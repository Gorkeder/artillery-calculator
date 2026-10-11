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
  return {
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      email: row ? row.email : null,
      emailVerified: Boolean(row && row.email_verified_at),
      proposalsBlocked: blocked,
      blockReason: blocked ? (row.proposals_block_reason || '') : null,
    },
    can: capabilities(effective),
  };
}

module.exports = { meBody };
