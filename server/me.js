'use strict';

const { capabilities } = require('./permissions');

function meBody(db, user) {
  if (!user) return { user: null, can: capabilities(null) };
  const row = db.prepare('SELECT email, email_verified_at FROM users WHERE id = ?').get(user.id);
  return {
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      email: row ? row.email : null,
      emailVerified: Boolean(row && row.email_verified_at),
    },
    can: capabilities(user),
  };
}

module.exports = { meBody };
