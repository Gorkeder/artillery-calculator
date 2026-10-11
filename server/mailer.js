'use strict';

const crypto = require('node:crypto');
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

// One message per connection. `connect()` must return a connected duplex socket
// (tls.connect in production, plain net in tests).
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
      const lines = buf.split('\r\n');
      const end = lines.findIndex((l) => /^\d{3}( |$)/.test(l));
      if (end < 0) return;
      buf = lines.slice(end + 1).join('\r\n');
      const w = waiter;
      waiter = null;
      w({ code: Number(lines[end].slice(0, 3)) });
    }

    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { buf += chunk; deliver(); });
    socket.on('error', finish);
    socket.on('close', () => finish(new Error('smtp connection closed')));

    const read = () => new Promise((res) => { waiter = res; deliver(); });
    const say = (line) => socket.write(line + '\r\n');
    const expect = async (codes) => {
      const r = await read();
      if (!codes.includes(r.code)) throw new Error('smtp: unexpected reply ' + r.code);
    };

    (async () => {
      try {
        await expect([220]);
        say('EHLO ' + helo);
        await expect([250]);
        say('AUTH PLAIN ' + Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64'));
        await expect([235]);
        say(`MAIL FROM:<${from}>`);
        await expect([250]);
        say(`RCPT TO:<${to}>`);
        await expect([250, 251]);
        say('DATA');
        await expect([354]);
        const stuffed = data.replace(/^\./gm, '..');
        socket.write(stuffed + (stuffed.endsWith('\r\n') ? '' : '\r\n') + '.\r\n');
        await expect([250]);
        say('QUIT');
        finish();
      } catch (err) {
        finish(err);
      }
    })();
  });
}

function createSmtpMailer({ host, port, user, pass, from, connect, timeoutMs = 20000, now = Date.now }) {
  const open = connect || (() => tls.connect({ host, port, servername: host }));
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
    const missing = [
      ['SMTP_HOST', cfg.smtpHost],
      ['SMTP_USER', cfg.smtpUser],
      ['SMTP_PASS', cfg.smtpPass],
      ['MAIL_FROM', cfg.mailFrom],
    ].filter(([, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error('MAIL_MODE=smtp requires ' + missing.join(', '));
    return createSmtpMailer({
      host: cfg.smtpHost, port: cfg.smtpPort || 465, user: cfg.smtpUser, pass: cfg.smtpPass, from: cfg.mailFrom,
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
