'use strict';

function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT || 3000),
    dbFile: env.ANOMA_DB || '/var/lib/anoma/db/anoma.db',
    uploadsDir: env.ANOMA_UPLOADS || '/var/lib/anoma/uploads',
    cookieSecure: env.COOKIE_SECURE !== '0',
    devStatic: env.DEV_STATIC || null,
    mailMode: env.MAIL_MODE || null,
    smtpHost: env.SMTP_HOST || null,
    // SMTP_SECURE=0: plain TCP, loopback relay only (enforced in mailer.js). Default: implicit TLS.
    smtpSecure: env.SMTP_SECURE !== '0',
    smtpPort: Number(env.SMTP_PORT || (env.SMTP_SECURE === '0' ? 25 : 465)),
    smtpUser: env.SMTP_USER || null,
    smtpPass: env.SMTP_PASS || null,
    mailFrom: env.MAIL_FROM || null,
    publicUrl: (env.PUBLIC_URL || 'https://anoma-wiki.ru').replace(/\/+$/, ''),
  };
}

module.exports = { loadConfig };
