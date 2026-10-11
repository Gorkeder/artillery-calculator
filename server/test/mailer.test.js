'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const {
  buildMessage,
  createSmtpMailer,
  createMemoryMailer,
  createMailer,
} = require('../mailer');
const { verifyEmailMessage, resetPasswordMessage } = require('../mail-templates');

function decodeBody(message) {
  const body = message.split('\r\n\r\n')[1];
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

test('buildMessage encodes subject and body, uses CRLF and a unique Message-ID', () => {
  const m = buildMessage({ from: 'noreply@anoma-wiki.ru', to: 'a@b.cc', subject: 'Проверка', text: 'Привет\nссылка', nowMs: 0 });
  assert.match(m, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <noreply@anoma-wiki\.ru>\r\n/);
  assert.match(m, /\r\nTo: <a@b\.cc>\r\n/);
  assert.match(m, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(m, /\r\nContent-Transfer-Encoding: base64\r\n/);
  assert.match(m, /\r\nMessage-ID: <[0-9a-f]+@anoma-wiki\.ru>\r\n/);
  assert.equal(decodeBody(m), 'Привет\nссылка');
  const subj = /Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/.exec(m)[1];
  assert.equal(Buffer.from(subj, 'base64').toString('utf8'), 'Проверка');
});

test('buildMessage refuses addresses that could inject headers', () => {
  const base = { from: 'noreply@anoma-wiki.ru', subject: 's', text: 't', nowMs: 0 };
  assert.throws(() => buildMessage({ ...base, to: 'a@b.cc\r\nBcc: x@y.zz' }));
  assert.throws(() => buildMessage({ ...base, to: 'a b@c.dd' }));
  assert.throws(() => buildMessage({ ...base, to: '<a@b.cc>' }));
  assert.throws(() => buildMessage({ ...base, to: 'a@b.cc', from: 'x@y.zz\nBcc: q@w.ee' }));
  assert.throws(() => buildMessage({ ...base, to: 'a\u0000@b.cc' }));
  assert.throws(() => buildMessage({ ...base, to: 'a\u007f@b.cc' }));
  assert.throws(() => buildMessage({ ...base, to: 'a@b.cc\u0085' }));
});

// A tiny scripted SMTP server (plain TCP: the mailer takes an injectable `connect`).
function fakeSmtp({ failAuth = false, silent = false, advertiseAuth = true } = {}) {
  const received = [];
  const lines = [];
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    const cur = {};
    let buf = '';
    let inData = false;
    const say = (s) => sock.write(s + '\r\n');
    if (!silent) say('220 fake ESMTP');
    sock.on('error', () => {});
    sock.on('data', (chunk) => {
      buf += chunk;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          cur.data = buf.slice(0, end + 2);
          buf = buf.slice(end + 5);
          inData = false;
          received.push({ ...cur });
          say('250 queued');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        lines.push(line);
        if (/^EHLO /.test(line)) say(advertiseAuth ? '250-fake\r\n250 AUTH PLAIN' : '250-fake\r\n250 8BITMIME');
        else if (/^AUTH PLAIN /.test(line)) {
          cur.auth = line.slice('AUTH PLAIN '.length);
          say(failAuth ? '535 bad credentials' : '235 ok');
        } else if (/^MAIL FROM:/.test(line)) { cur.from = line.slice(10); say('250 ok'); }
        else if (/^RCPT TO:/.test(line)) { cur.to = line.slice(8); say('250 ok'); }
        else if (line === 'DATA') { inData = true; say('354 go'); }
        else if (line === 'QUIT') { say('221 bye'); sock.end(); }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, lines, port: server.address().port }));
  });
}

function mailerFor(port, extra = {}) {
  return createSmtpMailer({
    host: 'smtp.test', port, user: 'noreply@anoma-wiki.ru', pass: 'p@ss', from: 'noreply@anoma-wiki.ru',
    connect: () => net.connect(port, '127.0.0.1'),
    ...extra,
  });
}

test('smtp mailer speaks EHLO/AUTH/MAIL/RCPT/DATA and delivers an encoded message', async (t) => {
  const f = await fakeSmtp();
  t.after(() => f.server.close());
  await mailerFor(f.port).send({ to: 'user@example.com', subject: 'Тема', text: 'Тело письма\n.точка в начале строки' });
  assert.equal(f.received.length, 1);
  const r = f.received[0];
  assert.equal(r.from, '<noreply@anoma-wiki.ru>');
  assert.equal(r.to, '<user@example.com>');
  assert.equal(Buffer.from(r.auth, 'base64').toString(), '\0noreply@anoma-wiki.ru\0p@ss');
  assert.equal(decodeBody(r.data), 'Тело письма\n.точка в начале строки');
});

test('smtp mailer rejects on auth failure and on a silent server (timeout)', async (t) => {
  const bad = await fakeSmtp({ failAuth: true });
  const quiet = await fakeSmtp({ silent: true });
  t.after(() => { bad.server.close(); quiet.server.close(); });
  await assert.rejects(() => mailerFor(bad.port).send({ to: 'u@example.com', subject: 's', text: 't' }), /535|unexpected reply/);
  await assert.rejects(
    () => mailerFor(quiet.port, { timeoutMs: 150 }).send({ to: 'u@example.com', subject: 's', text: 't' }),
    /timeout/,
  );
});

// Writes each reply as several TCP chunks with pauses, splitting lines in awkward places.
function chunkyFakeSmtp() {
  const received = [];
  const pause = () => new Promise((r) => setTimeout(r, 15));
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    const sendChunks = async (chunks) => { for (const c of chunks) { sock.write(c); await pause(); } };
    let buf = '';
    let inData = false;
    const queue = [];
    let busy = false;
    const enqueue = (chunks) => { queue.push(chunks); if (!busy) drain(); };
    async function drain() {
      busy = true;
      while (queue.length) await sendChunks(queue.shift());
      busy = false;
    }
    enqueue(['22', '0 fake', ' ESMTP\r', '\n']);
    sock.on('data', (chunk) => {
      buf += chunk;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          buf = buf.slice(end + 5);
          inData = false;
          received.push(true);
          enqueue(['250', ' queued\r\n']);
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (/^EHLO /.test(line)) enqueue(['250-fake\r\n250-SI', 'ZE 1000\r\n250', '-8BITMIME\r\n250 AUTH PLAIN\r\n']);
        else if (/^AUTH PLAIN /.test(line)) enqueue(['235 ok\r\n']);
        else if (/^MAIL FROM:/.test(line)) enqueue(['250 ok\r\n']);
        else if (/^RCPT TO:/.test(line)) enqueue(['250 ok\r\n']);
        else if (line === 'DATA') { inData = true; enqueue(['354 go\r\n']); }
        else if (line === 'QUIT') sock.end('221 bye\r\n');
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }));
  });
}

test('smtp mailer copes with replies split across TCP chunks (mid-line and between code and separator)', async (t) => {
  const f = await chunkyFakeSmtp();
  t.after(() => f.server.close());
  await mailerFor(f.port, { timeoutMs: 3000 }).send({ to: 'user@example.com', subject: 's', text: 't' });
  assert.equal(f.received.length, 1);
});

// Scripted server for AUTH negotiation. `ehlo` is the list of reply lines (without codes);
// `plain`/`login` are the final status codes for the credentials; `chunked` splits writes.
function authFakeSmtp({ ehlo, plain = 235, login = 235, loginStart = 334, chunked = false }) {
  const state = { commands: [], user: null, pass: null, auth: null, delivered: 0 };
  const pause = () => new Promise((r) => setTimeout(r, 10));
  const server = net.createServer((sock) => {
    sock.setEncoding('utf8');
    sock.on('error', () => {});
    let buf = '';
    let inData = false;
    let loginStep = 0;
    const out = [];
    let busy = false;
    const emit = (text) => { out.push(text); if (!busy) drain(); };
    async function drain() {
      busy = true;
      while (out.length) {
        const t = out.shift();
        if (chunked) { for (let i = 0; i < t.length; i += 5) { sock.write(t.slice(i, i + 5)); await pause(); } }
        else sock.write(t);
      }
      busy = false;
    }
    const say = (s) => emit(s + '\r\n');
    say('220 fake ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk;
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) return;
          buf = buf.slice(end + 5);
          inData = false;
          state.delivered += 1;
          say('250 queued');
          continue;
        }
        const i = buf.indexOf('\r\n');
        if (i < 0) return;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (loginStep === 1) { state.user = Buffer.from(line, 'base64').toString(); loginStep = 2; say('334 UGFzc3dvcmQ6'); continue; }
        if (loginStep === 2) {
          state.pass = Buffer.from(line, 'base64').toString(); loginStep = 0;
          say(login === 235 ? '235 ok' : login + ' nope');
          continue;
        }
        state.commands.push(line.split(' ').slice(0, 2).join(' '));
        if (/^EHLO /.test(line)) {
          say(ehlo.map((l, k) => '250' + (k === ehlo.length - 1 ? ' ' : '-') + l).join('\r\n'));
        } else if (/^AUTH PLAIN /.test(line)) {
          state.auth = line.slice('AUTH PLAIN '.length);
          say(plain === 235 ? '235 ok' : plain + ' nope');
        } else if (line === 'AUTH LOGIN') {
          if (loginStart === 334) { loginStep = 1; say('334 VXNlcm5hbWU6'); } else say(loginStart + ' nope');
        }
        else if (/^MAIL FROM:/.test(line)) say('250 ok');
        else if (/^RCPT TO:/.test(line)) say('250 ok');
        else if (line === 'DATA') { inData = true; say('354 go'); }
        else if (line === 'QUIT') { sock.end('221 bye\r\n'); }
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port }));
  });
}

const MSG = { to: 'user@example.com', subject: 's', text: 't' };

test('auth: PLAIN is preferred when the server advertises LOGIN and PLAIN', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH LOGIN PLAIN'] });
  t.after(() => f.server.close());
  await mailerFor(f.port).send(MSG);
  assert.equal(Buffer.from(f.state.auth, 'base64').toString(), '\0noreply@anoma-wiki.ru\0p@ss');
  assert.ok(!f.state.commands.includes('AUTH LOGIN'));
  assert.equal(f.state.delivered, 1);
});

test('auth: PLAIN is detected in the "AUTH=PLAIN" form, case-insensitively', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'auth=login plain'] });
  t.after(() => f.server.close());
  await mailerFor(f.port).send(MSG);
  assert.ok(f.state.auth);
  assert.equal(f.state.delivered, 1);
});

test('auth: LOGIN-only server is served with AUTH LOGIN and never sees AUTH PLAIN', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH LOGIN'], plain: 504 });
  t.after(() => f.server.close());
  await mailerFor(f.port).send(MSG);
  assert.equal(f.state.user, 'noreply@anoma-wiki.ru');
  assert.equal(f.state.pass, 'p@ss');
  assert.ok(!f.state.commands.includes('AUTH PLAIN'));
  assert.equal(f.state.delivered, 1);
});

test('auth: "AUTH=LOGIN" form is understood', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH=LOGIN'], plain: 504 });
  t.after(() => f.server.close());
  await mailerFor(f.port).send(MSG);
  assert.equal(f.state.pass, 'p@ss');
  assert.ok(!f.state.commands.includes('AUTH PLAIN'));
});

test('auth: no AUTH advertised, 504 to PLAIN falls back to LOGIN on the same connection', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'SIZE 1000'], plain: 504 });
  t.after(() => f.server.close());
  await mailerFor(f.port).send(MSG);
  assert.equal(f.state.user, 'noreply@anoma-wiki.ru');
  assert.equal(f.state.pass, 'p@ss');
  assert.equal(f.state.commands.filter((c) => c === 'AUTH PLAIN').length, 1);
  assert.equal(f.state.commands.filter((c) => c === 'EHLO anoma-wiki.ru').length, 1);
  assert.equal(f.state.delivered, 1);
});

test('auth: 535 to PLAIN fails immediately without trying LOGIN', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'SIZE 1000'], plain: 535 });
  t.after(() => f.server.close());
  await assert.rejects(() => mailerFor(f.port).send(MSG), /535|unexpected reply/);
  assert.ok(!f.state.commands.includes('AUTH LOGIN'));
  assert.equal(f.state.delivered, 0);
});

test('auth: 535 with AUTH LOGIN credentials rejects without any further attempt', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH LOGIN'], login: 535 });
  t.after(() => f.server.close());
  await assert.rejects(() => mailerFor(f.port).send(MSG), /unexpected reply 535/);
  assert.ok(!f.state.commands.includes('AUTH PLAIN'));
  assert.equal(f.state.commands.filter((c) => c === 'AUTH LOGIN').length, 1);
  assert.equal(f.state.delivered, 0);
});

test('auth: error text never leaks credentials or server text', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH LOGIN'], login: 535 });
  t.after(() => f.server.close());
  await assert.rejects(() => mailerFor(f.port).send(MSG), (err) => {
    assert.equal(err.message, 'smtp: unexpected reply 535 after AUTH LOGIN');
    return true;
  });
});

test('auth: 504 to PLAIN falls back to LOGIN even when EHLO advertised PLAIN', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH PLAIN LOGIN'], plain: 504 });
  t.after(() => f.server.close());
  await mailerFor(f.port).send(MSG);
  assert.equal(f.state.commands.filter((c) => c === 'AUTH PLAIN').length, 1);
  assert.equal(f.state.user, 'noreply@anoma-wiki.ru');
  assert.equal(f.state.pass, 'p@ss');
  assert.equal(f.state.delivered, 1);
});

test('auth: 504 to both PLAIN and LOGIN rejects with the 504, no third attempt', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH PLAIN LOGIN'], plain: 504, loginStart: 504 });
  t.after(() => f.server.close());
  await assert.rejects(() => mailerFor(f.port).send(MSG), (err) => {
    assert.equal(err.message, 'smtp: unexpected reply 504 after AUTH LOGIN');
    return true;
  });
  assert.equal(f.state.commands.filter((c) => c === 'AUTH PLAIN').length, 1);
  assert.equal(f.state.commands.filter((c) => c === 'AUTH LOGIN').length, 1);
  assert.equal(f.state.delivered, 0);
});

test('auth: 535 to PLAIN (PLAIN advertised) rejects and LOGIN is never attempted', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH PLAIN LOGIN'], plain: 535 });
  t.after(() => f.server.close());
  await assert.rejects(() => mailerFor(f.port).send(MSG), (err) => {
    assert.equal(err.message, 'smtp: unexpected reply 535 after AUTH PLAIN');
    return true;
  });
  assert.ok(!f.state.commands.includes('AUTH LOGIN'));
});

test('errors name the command the reply followed, never server text or secrets', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'AUTH PLAIN'], plain: 504, loginStart: 504 });
  t.after(() => f.server.close());
  await assert.rejects(() => mailerFor(f.port).send(MSG), /^Error: smtp: unexpected reply 504 after AUTH (PLAIN|LOGIN)$/);
});

test('auth: multi-line EHLO split across chunks works with a LOGIN-only server', async (t) => {
  const f = await authFakeSmtp({ ehlo: ['fake', 'SIZE 1000', '8BITMIME', 'AUTH LOGIN'], plain: 504, chunked: true });
  t.after(() => f.server.close());
  await mailerFor(f.port, { timeoutMs: 5000 }).send(MSG);
  assert.equal(f.state.user, 'noreply@anoma-wiki.ru');
  assert.equal(f.state.pass, 'p@ss');
  assert.ok(!f.state.commands.includes('AUTH PLAIN'));
  assert.equal(f.state.delivered, 1);
});

test('memory mailer collects messages; createMailer picks implementation by mode', async () => {
  const m = createMemoryMailer();
  await m.send({ to: 'a@b.cc', subject: 's', text: 't' });
  assert.deepEqual(m.sent, [{ to: 'a@b.cc', subject: 's', text: 't' }]);
  assert.equal(createMailer({}).configured, false);
  await assert.rejects(() => createMailer({}).send({ to: 'a@b.cc', subject: 's', text: 't' }));
  assert.equal(createMailer({ mailMode: 'log' }).configured, true);
  assert.throws(() => createMailer({ mailMode: 'smtp' }), /SMTP_HOST/);
  assert.equal(
    createMailer({ mailMode: 'smtp', smtpHost: 'h', smtpPort: 465, smtpUser: 'u', smtpPass: 'p', mailFrom: 'n@x.io' }).configured,
    true,
  );
});

test('templates mention the login, the link and the lifetime', () => {
  const v = verifyEmailMessage({ login: 'stalker', url: 'https://x.test/account#verify=abc' });
  assert.match(v.subject, /ANOMA WIKI/);
  assert.ok(v.text.includes('stalker') && v.text.includes('https://x.test/account#verify=abc') && v.text.includes('24'));
  const r = resetPasswordMessage({ login: 'stalker', url: 'https://x.test/account#reset=abc' });
  assert.ok(r.text.includes('https://x.test/account#reset=abc') && r.text.includes('1 час'));
});

// ---- local relay mode: plain TCP to a loopback Postfix, no AUTH ----

const LOCAL = { mailMode: 'smtp', smtpHost: '127.0.0.1', smtpPort: 25, smtpSecure: false, mailFrom: 'noreply@anoma-wiki.ru' };

test('relay: without a user the AUTH step is skipped entirely and the message is delivered', async (t) => {
  const f = await fakeSmtp();
  t.after(() => f.server.close());
  const m = createSmtpMailer({
    host: '127.0.0.1', port: f.port, secure: false, from: 'noreply@anoma-wiki.ru',
    connect: () => net.connect(f.port, '127.0.0.1'),
  });
  await m.send({ to: 'user@example.com', subject: 'Тема', text: 'Тело' });
  assert.equal(f.lines.some((l) => /^AUTH/i.test(l)), false);
  assert.deepEqual(f.lines.slice(0, 3).map((l) => l.split(/[ :]/)[0]), ['EHLO', 'MAIL', 'RCPT']);
  assert.equal(f.lines[0], 'EHLO anoma-wiki.ru');
  assert.equal(f.received.length, 1);
  assert.equal(f.received[0].auth, undefined);
  assert.equal(f.received[0].from, '<noreply@anoma-wiki.ru>');
  assert.equal(f.received[0].to, '<user@example.com>');
  assert.equal(decodeBody(f.received[0].data), 'Тело');
});

test('relay: default (non-injected) plain connect reaches a real loopback server', async (t) => {
  const f = await fakeSmtp();
  t.after(() => f.server.close());
  const m = createMailer({ ...LOCAL, smtpPort: f.port });
  assert.equal(m.configured, true);
  await m.send({ to: 'user@example.com', subject: 's', text: 'через net.connect' });
  assert.equal(f.received.length, 1);
  assert.equal(decodeBody(f.received[0].data), 'через net.connect');
  assert.equal(f.lines.some((l) => /^AUTH/i.test(l)), false);
});

test('relay: with SMTP_USER set in loopback plain mode AUTH still runs', async (t) => {
  const f = await fakeSmtp();
  t.after(() => f.server.close());
  const m = createMailer({ ...LOCAL, smtpPort: f.port, smtpUser: 'u', smtpPass: 'p' });
  await m.send({ to: 'user@example.com', subject: 's', text: 't' });
  assert.equal(Buffer.from(f.received[0].auth, 'base64').toString(), '\0u\0p');
});

test('relay: createMailer accepts loopback hosts without user/pass', () => {
  for (const smtpHost of ['127.0.0.1', 'localhost', '::1']) {
    const m = createMailer({ ...LOCAL, smtpHost });
    assert.equal(m.configured, true);
  }
});

test('relay: plain-text SMTP to a non-loopback host is refused', () => {
  assert.throws(
    () => createMailer({ ...LOCAL, smtpHost: 'smtp.beget.com', smtpUser: 'u', smtpPass: 'p' }),
    /SMTP_SECURE=0.*(loopback|127\.0\.0\.1)/,
  );
  assert.throws(() => createMailer({ ...LOCAL, smtpHost: '10.0.0.5' }), /loopback|127\.0\.0\.1/);
});

test('relay: no SMTP_USER (no AUTH) with a non-loopback host is refused, also in secure mode', () => {
  assert.throws(
    () => createMailer({ mailMode: 'smtp', smtpHost: 'smtp.beget.com', smtpPort: 465, smtpSecure: true, smtpPass: 'p', mailFrom: 'n@x.io' }),
    /SMTP_USER/,
  );
  assert.throws(
    () => createSmtpMailer({ host: 'smtp.beget.com', port: 465, from: 'n@x.io', connect: () => null }),
    /loopback|SMTP_USER/,
  );
});

test('relay: missing SMTP_HOST / MAIL_FROM are named; secure mode still requires user and password', () => {
  assert.throws(() => createMailer({ ...LOCAL, smtpHost: null }), /SMTP_HOST/);
  assert.throws(() => createMailer({ ...LOCAL, mailFrom: null }), /MAIL_FROM/);
  assert.throws(
    () => createMailer({ mailMode: 'smtp', smtpHost: 'h', smtpPort: 465, mailFrom: 'n@x.io' }),
    /MAIL_MODE=smtp requires SMTP_USER, SMTP_PASS/,
  );
  assert.throws(
    () => createMailer({ mailMode: 'smtp', smtpHost: 'h', smtpPort: 465, smtpSecure: true, smtpUser: 'u', mailFrom: 'n@x.io' }),
    /MAIL_MODE=smtp requires SMTP_PASS/,
  );
});

test('relay: delivery works when EHLO advertises no AUTH at all', async (t) => {
  const f = await fakeSmtp({ advertiseAuth: false });
  t.after(() => f.server.close());
  const m = createMailer({ ...LOCAL, smtpPort: f.port });
  await m.send({ to: 'user@example.com', subject: 's', text: 'без AUTH в EHLO' });
  assert.equal(f.received.length, 1);
  assert.equal(decodeBody(f.received[0].data), 'без AUTH в EHLO');
  assert.equal(f.lines.some((l) => /^AUTH/i.test(l)), false);
});

test('relay: loopback check fails closed (exact match, no lookalikes)', () => {
  const refused = [
    'localhost.', 'localhost.evil.example', '127.0.0.1.evil.example', '127.0.0.2',
    '[::1]', '::ffff:127.0.0.1', ' localhost',
  ];
  for (const smtpHost of refused) {
    assert.throws(() => createMailer({ ...LOCAL, smtpHost }), /loopback/, JSON.stringify(smtpHost));
  }
  for (const smtpHost of ['LOCALHOST', 'localhost', '127.0.0.1', '::1']) {
    assert.equal(createMailer({ ...LOCAL, smtpHost }).configured, true, smtpHost);
  }
});

test('relay: SMTP_PASS without SMTP_USER warns once, without the secret, and still creates the mailer', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const m = createMailer({ ...LOCAL, smtpPass: 'sup3r-secret' });
  assert.equal(m.configured, true);
  assert.equal(warn.mock.callCount(), 1);
  assert.equal(warn.mock.calls[0].arguments[0], 'anoma-api: SMTP_PASS is ignored because SMTP_USER is not set');
  createMailer({ ...LOCAL });
  assert.equal(warn.mock.callCount(), 1);
});

test('relay: SMTP_USER without SMTP_PASS in plain mode is refused', () => {
  assert.throws(() => createMailer({ ...LOCAL, smtpUser: 'u' }), /requires SMTP_PASS/);
});
