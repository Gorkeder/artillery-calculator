'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { can, capabilities, featureFilter } = require('../permissions');

const admin = { id: 1, login: 'a', role: 'admin' };
const user = { id: 2, login: 'u', role: 'user' };

test('v1: only admin can write', () => {
  for (const action of ['map:write', 'category:write', 'feature:create', 'feature:update', 'feature:delete', 'image:write']) {
    assert.equal(can(admin, action), true, action);
    assert.equal(can(user, action), false, action);
    assert.equal(can(null, action), false, action);
  }
});

test('unknown action throws so typos cannot silently deny/allow', () => {
  assert.throws(() => can(admin, 'feature:publish'));
});

test('capabilities reflect can()', () => {
  assert.deepEqual(capabilities(admin), { map: true, category: true, feature: true, marks: true });
  assert.deepEqual(capabilities(user), { map: false, category: false, feature: false, marks: true });
  assert.deepEqual(capabilities(null), { map: false, category: false, feature: false, marks: false });
});

test('marks: any signed-in user creates, only the owner updates or deletes (admin included)', () => {
  const mine = { id: 10, user_id: 2 };
  assert.equal(can(user, 'mark:create'), true);
  assert.equal(can(admin, 'mark:create'), true);
  assert.equal(can(null, 'mark:create'), false);
  for (const action of ['mark:update', 'mark:delete']) {
    assert.equal(can(user, action, mine), true, action + ' owner');
    assert.equal(can(admin, action, mine), false, action + ' admin is not the owner');
    assert.equal(can({ id: 3, login: 'x', role: 'user' }, action, mine), false, action + ' stranger');
    assert.equal(can(null, action, mine), false, action + ' guest');
    assert.equal(can(user, action), false, action + ' without a resource');
  }
});

test('featureFilter: admin sees all, user sees approved + own, anonymous only approved', () => {
  assert.deepEqual(featureFilter(admin), { all: true, authorId: null });
  assert.deepEqual(featureFilter(user), { all: false, authorId: 2 });
  assert.deepEqual(featureFilter(null), { all: false, authorId: null });
});
