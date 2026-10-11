'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../config');

test('SMTP_SECURE defaults to true (implicit TLS) and is false only for "0"', () => {
  assert.equal(loadConfig({}).smtpSecure, true);
  assert.equal(loadConfig({ SMTP_SECURE: '1' }).smtpSecure, true);
  assert.equal(loadConfig({ SMTP_SECURE: '0' }).smtpSecure, false);
});

test('SMTP_PORT defaults to 465 for TLS and 25 for plain; an explicit value wins', () => {
  assert.equal(loadConfig({}).smtpPort, 465);
  assert.equal(loadConfig({ SMTP_SECURE: '0' }).smtpPort, 25);
  assert.equal(loadConfig({ SMTP_SECURE: '0', SMTP_PORT: '2525' }).smtpPort, 2525);
  assert.equal(loadConfig({ SMTP_PORT: '587' }).smtpPort, 587);
});
