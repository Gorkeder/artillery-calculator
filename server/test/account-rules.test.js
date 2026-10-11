'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, checkLogin, checkPassword } = require('../account-rules');

test('normalizeEmail trims, lower-cases and rejects junk', () => {
  assert.equal(normalizeEmail('  User@Example.COM '), 'user@example.com');
  assert.equal(normalizeEmail('a.b+tag@sub.example.org'), 'a.b+tag@sub.example.org');
  for (const bad of ['', 'nope', 'a@b', 'a b@c.de', 'a@b.c', '<x>@y.zz', 'a@@b.cc', null, 42, {}]) {
    assert.equal(normalizeEmail(bad), null, String(bad));
  }
  assert.equal(normalizeEmail('a'.repeat(250) + '@x.io'), null);
});

test('checkLogin enforces the pattern and reserved names (any case)', () => {
  assert.equal(checkLogin('good_name-1'), null);
  assert.equal(checkLogin('ab'), 'login_invalid');
  assert.equal(checkLogin('has space'), 'login_invalid');
  assert.equal(checkLogin('юзер'), 'login_invalid');
  assert.equal(checkLogin(undefined), 'login_invalid');
  for (const name of ['admin', 'Admin', 'ROOT', 'Support', 'anoma']) assert.equal(checkLogin(name), 'login_reserved', name);
});

test('checkPassword enforces 8..128 and rejects the login itself', () => {
  assert.equal(checkPassword('longenough', 'user1'), null);
  assert.equal(checkPassword('short', 'user1'), 'password_short');
  assert.equal(checkPassword(undefined, 'user1'), 'password_short');
  assert.equal(checkPassword('x'.repeat(129), 'user1'), 'password_long');
  assert.equal(checkPassword('x'.repeat(128), 'user1'), null);
  assert.equal(checkPassword('SameAsLogin', 'sameaslogin'), 'password_equals_login');
});
