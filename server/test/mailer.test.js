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
function fakeSmtp({ failAuth = false, silent = false } = {}) {
  const received = [];
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
        if (/^EHLO /.test(line)) say('250-fake\r\n250 AUTH PLAIN');
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
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }));
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
