'use strict';

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    dbFile: env.ANOMA_DB || '/var/lib/anoma/db/anoma.db',
    uploadsDir: env.ANOMA_UPLOADS || '/var/lib/anoma/uploads',
    cookieSecure: env.COOKIE_SECURE !== '0',
    devStatic: env.DEV_STATIC || null,
  };
}

module.exports = { loadConfig };
