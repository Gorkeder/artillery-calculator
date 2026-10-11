'use strict';

const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');

const ADDR_RE = /^[^\s<>"@,;:\\\x00-\x1f\x7f-\x9f]+@[^\s<>"@,;:\\\x00-\x1f\x7f-\x9f]+$/;

function assertAddress(addr) {
  if (typeof addr !== 'string' || !ADDR_RE.test(addr)) throw new Error('bad mail address');
}

function encodeWord(s) {
  return '=?UTF-8?B?' + Buffer.from(String(s), 'utf8').toString('base64') + '?=';
}

function wrap76(b64) {
  return b64.replace(/.{1,76}/g, '$&\r\n');
}

function buildMessage({ from, to, subject, text, nowMs, fromName = 'ANOMA WIKI' }) {
  assertAddress(from);
  assertAddress(to);
  const domain = from.split('@')[1];
  return [
    `From: ${encodeWord(fromName)} <${from}>`,
    `To: <${to}>`,
    `Subject: ${encodeWord(subject)}`,
    `Date: ${new Date(nowMs).toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(Buffer.from(String(text), 'utf8').toString('base64')),
  ].join('\r\n');
}

// Supported AUTH mechanisms (upper-cased) from the lines of a multi-line EHLO reply:
// "250-AUTH LOGIN PLAIN" and the legacy "250 AUTH=PLAIN LOGIN" forms.
function authMechanisms(lines) {
  const set = new Set();
  for (const line of lines) {
    const m = /^\d{3}[- ]AUTH(?:[ =](.*))?$/i.exec(line);
    if (!m || !m[1]) continue;
    for (const w of m[1].split(/[\s=]+/)) if (w) set.add(w.toUpperCase());
  }
  return set;
}

// One message per connection. `connect()` must return a connected duplex socket
// (tls.connect for implicit TLS, plain net.connect for a loopback relay, or a test double).
function smtpSend({ user, pass, helo, connect, timeoutMs }, { from, to, data }) {
  return new Promise((resolve, reject) => {
    const socket = connect();
    let buf = '';
    let waiter = null;
    let done = false;
    const timer = setTimeout(() => finish(new Error('smtp timeout')), timeoutMs);

    function finish(err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve();
    }

    function deliver() {
      if (!waiter) return;
      // Only CRLF-terminated lines are complete; an unterminated tail stays in the buffer
      // (a reply may arrive split anywhere, even between the code and the "-"/" " separator).
      let pos = 0;
      for (;;) {
        const eol = buf.indexOf('\r\n', pos);
        if (eol < 0) return;
        const line = buf.slice(pos, eol);
        pos = eol + 2;
        if (/^\d{3}( |$)/.test(line)) {
          const lines = buf.slice(0, pos - 2).split('\r\n');
          buf = buf.slice(pos);
          const w = waiter;
          waiter = null;
          w({ code: Number(line.slice(0, 3)), lines });
          return;
        }
      }
    }

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { buf += chunk; deliver(); });
    socket.on('error', finish);
    socket.on('close', () => finish(new Error('smtp connection closed')));

    const read = () => new Promise((res) => { waiter = res; deliver(); });
    const say = (line) => socket.write(line + '\r\n');
    // Errors carry only the numeric reply code and the NAME of the command it followed:
    // never server text, credentials, addresses or message data.
    const unexpected = (r, what) => new Error('smtp: unexpected reply ' + r.code + ' after ' + what);
    const expect = async (codes, what) => {
      const r = await read();
      if (!codes.includes(r.code)) throw unexpected(r, what);
      return r;
    };
    const authPlain = () => {
      say('AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64'));
      return read();
    };
    const authLogin = async () => {
      say('AUTH LOGIN');
      await expect([334], 'AUTH LOGIN');
      say(Buffer.from(String(user), 'utf8').toString('base64'));
      await expect([334], 'AUTH LOGIN');
      say(Buffer.from(String(pass), 'utf8').toString('base64'));
      await expect([235], 'AUTH LOGIN');
    };

    (async () => {
      try {
        await expect([220], 'connect');
        say('EHLO ' + helo);
        const ehlo = await expect([250], 'EHLO');
        const mechs = authMechanisms(ehlo.lines);
        if (!user) {
          // Local relay (loopback Postfix): no authentication.
        } else if (mechs.has('LOGIN') && !mechs.has('PLAIN')) {
          await authLogin();
        } else {
          // Try PLAIN first. Whatever EHLO advertised (servers may advertise it and still refuse),
          // a refusal of the mechanism (5xx other than 535) falls back to LOGIN on this connection;
          // 535 means bad credentials and is final.
          const r = await authPlain();
          if (r.code === 235) { /* authenticated */ }
          else if (r.code >= 500 && r.code <= 599 && r.code !== 535) await authLogin();
          else throw unexpected(r, 'AUTH PLAIN');
        }
        say(`MAIL FROM:<${from}>`);
        await expect([250], 'MAIL FROM');
        say(`RCPT TO:<${to}>`);
        await expect([250, 251], 'RCPT TO');
        say('DATA');
        await expect([354], 'DATA');
        const stuffed = data.replace(/^\./gm, '..');
        socket.write(stuffed + (stuffed.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
        await expect([250], 'message body');
        say('QUIT');
        finish();
      } catch (err) {
        finish(err);
      }
    })();
  });
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);
const isLoopback = (host) => LOOPBACK_HOSTS.has(String(host).toLowerCase());

// `secure: true` (default) is implicit TLS; `secure: false` is plain TCP and is allowed only to a
// loopback host (otherwise login links would travel in clear text). An empty `user` means no AUTH,
// which is likewise allowed only to a loopback host (never an unauthenticated remote relay).
function createSmtpMailer({ host, port, user, pass, from, secure = true, connect, timeoutMs = 20000, now = Date.now }) {
  if (!secure && !isLoopback(host)) {
    throw new Error('SMTP_SECURE=0 (plain SMTP) is allowed only for a loopback SMTP_HOST (127.0.0.1, ::1, localhost)');
  }
  if (!user && !isLoopback(host)) {
    throw new Error('SMTP_USER is required unless SMTP_HOST is loopback (127.0.0.1, ::1, localhost)');
  }
  const open = connect || (secure
    ? () => tls.connect({ host, port, servername: host })
    : () => net.connect(port, host));
  const helo = from.split('@')[1];
  return {
    configured: true,
    async send({ to, subject, text }) {
      const data = buildMessage({ from, to, subject, text, nowMs: now() });
      await smtpSend({ user, pass, helo, connect: open, timeoutMs }, { from, to, data });
    },
  };
}

function createLogMailer() {
  return {
    configured: true,
    async send({ to, subject, text }) {
      console.log(`[mail] to=${to} subject=${subject}\n${text}`);
    },
  };
}

function createMemoryMailer() {
  const sent = [];
  return {
    configured: true,
    sent,
    async send(message) {
      sent.push({ to: message.to, subject: message.subject, text: message.text });
    },
  };
}

function createUnconfiguredMailer() {
  return {
    configured: false,
    async send() {
      throw new Error('mail is not configured');
    },
  };
}

function createMailer(cfg) {
  if (cfg.mailMode === 'log') return createLogMailer();
  if (cfg.mailMode === 'smtp') {
    const secure = cfg.smtpSecure !== false;
    // Secure mode: user and password are required. Local relay (SMTP_SECURE=0): they are optional,
    // but a user without a password is still an error.
    const needAuth = secure || Boolean(cfg.smtpUser);
    const missing = [
      ['SMTP_HOST', cfg.smtpHost, true],
      ['SMTP_USER', cfg.smtpUser, secure],
      ['SMTP_PASS', cfg.smtpPass, needAuth],
      ['MAIL_FROM', cfg.mailFrom, true],
    ].filter(([, v, req]) => req && !v).map(([k]) => k);
    if (missing.length) throw new Error('MAIL_MODE=smtp requires ' + missing.join(', '));
    if (!secure && !cfg.smtpUser && cfg.smtpPass) {
      console.warn('anoma-api: SMTP_PASS is ignored because SMTP_USER is not set');
    }
    return createSmtpMailer({
      host: cfg.smtpHost,
      port: cfg.smtpPort || (secure ? 465 : 25),
      user: cfg.smtpUser,
      pass: cfg.smtpPass,
      from: cfg.mailFrom,
      secure,
    });
  }
  return createUnconfiguredMailer();
}

module.exports = {
  buildMessage,
  createSmtpMailer,
  createLogMailer,
  createMemoryMailer,
  createUnconfiguredMailer,
  createMailer,
};
