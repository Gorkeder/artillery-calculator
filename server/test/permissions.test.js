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
  assert.deepEqual(capabilities(admin), { map: true, category: true, feature: true });
  assert.deepEqual(capabilities(null), { map: false, category: false, feature: false });
});

test('featureFilter: admin sees all, user sees approved + own, anonymous only approved', () => {
  assert.deepEqual(featureFilter(admin), { all: true, authorId: null });
  assert.deepEqual(featureFilter(user), { all: false, authorId: 2 });
  assert.deepEqual(featureFilter(null), { all: false, authorId: null });
});
