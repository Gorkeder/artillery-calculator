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
  assert.deepEqual(capabilities(admin), { map: true, category: true, feature: true, marks: true, propose: true });
  assert.deepEqual(capabilities(user), { map: false, category: false, feature: false, marks: true, propose: true });
  assert.deepEqual(capabilities({ ...user, proposalsBlocked: true }),
    { map: false, category: false, feature: false, marks: true, propose: false });
  assert.deepEqual(capabilities(null), { map: false, category: false, feature: false, marks: false, propose: false });
});

test('proposals: signed-in unblocked users propose and report; moderation is admin only', () => {
  const blocked = { ...user, proposalsBlocked: true };
  for (const action of ['feature:propose', 'report:create']) {
    assert.equal(can(user, action), true, action);
    assert.equal(can(blocked, action), false, action + ' blocked');
    assert.equal(can(null, action), false, action + ' guest');
  }
  for (const action of ['moderation:read', 'moderation:write']) {
    assert.equal(can(admin, action), true, action);
    assert.equal(can(user, action), false, action);
    assert.equal(can(null, action), false, action);
  }
});

test('an author edits only an open pending proposal and deletes any pending one, never a published one', () => {
  const open = { id: 1, author_id: 2, status: 'pending', reject_reason: null };
  const rejected = { id: 2, author_id: 2, status: 'pending', reject_reason: 'dup' };
  const published = { id: 3, author_id: 2, status: 'approved', reject_reason: null };
  const foreign = { id: 4, author_id: 9, status: 'pending', reject_reason: null };
  assert.equal(can(user, 'feature:update', open), true);
  assert.equal(can(user, 'feature:update', rejected), false);
  assert.equal(can(user, 'feature:update', published), false);
  assert.equal(can(user, 'feature:update', foreign), false);
  assert.equal(can(user, 'feature:delete', open), true);
  assert.equal(can(user, 'feature:delete', rejected), true);
  assert.equal(can(user, 'feature:delete', published), false);
  assert.equal(can(user, 'feature:delete', foreign), false);
  assert.equal(can(admin, 'feature:update', foreign), true);
  assert.equal(can(admin, 'feature:delete', published), true);
  assert.equal(can(null, 'feature:update', open), false);
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

test('drafts: only the author edits a draft; sending and withdrawing follow the state', () => {
  const draft = { id: 1, author_id: 2, status: 'pending', reject_reason: null, submitted_at: null };
  const sent = { id: 2, author_id: 2, status: 'pending', reject_reason: null, submitted_at: '2026-10-11 10:00:00' };
  const rejected = { id: 3, author_id: 2, status: 'pending', reject_reason: 'dup', submitted_at: '2026-10-11 10:00:00' };
  const foreign = { id: 4, author_id: 9, status: 'pending', reject_reason: null, submitted_at: null };
  assert.equal(can(user, 'feature:update', draft), true);
  assert.equal(can(user, 'feature:update', sent), false, 'locked once sent');
  assert.equal(can(user, 'feature:update', rejected), false);
  assert.equal(can(admin, 'feature:update', sent), true);
  assert.equal(can(user, 'feature:submit', draft), true);
  assert.equal(can(user, 'feature:submit', sent), false);
  assert.equal(can(user, 'feature:submit', rejected), false);
  assert.equal(can(user, 'feature:submit', foreign), false);
  assert.equal(can(user, 'feature:withdraw', sent), true);
  assert.equal(can(user, 'feature:withdraw', draft), false);
  assert.equal(can(user, 'feature:withdraw', rejected), false);
  assert.equal(can(user, 'feature:withdraw', foreign), false);
  assert.equal(can(user, 'feature:delete', sent), true, 'a sent proposal can still be deleted');
  assert.equal(can(null, 'feature:submit', draft), false);
});

test('clan:create needs a verified e-mail and no clan block', () => {
  assert.equal(can(user, 'clan:create', { emailVerified: true, clansBlocked: false }), true);
  assert.equal(can(user, 'clan:create', { emailVerified: false, clansBlocked: false }), false);
  assert.equal(can(user, 'clan:create', { emailVerified: true, clansBlocked: true }), false);
  assert.equal(can(user, 'clan:create'), false);
  assert.equal(can(null, 'clan:create', { emailVerified: true, clansBlocked: false }), false);
});
