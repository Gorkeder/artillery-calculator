'use strict';

const ACTIONS = new Set([
  'map:write',
  'category:write',
  'feature:create',
  'feature:update',
  'feature:delete',
  'image:write',
  'mark:create',
  'mark:update',
  'mark:delete',
  'feature:propose',
  'report:create',
  'feature:submit',
  'feature:withdraw',
  'moderation:read',
  'moderation:write',
  'clan:create',
]);

// The only place that decides who may do what. Direct publishing, maps, categories and photos: admins only.
// Users propose features (status 'pending') and manage only their own proposals.
function can(user, action, resource) {
  if (!ACTIONS.has(action)) throw new Error('unknown action: ' + action);
  if (!user) return false;
  const admin = user.role === 'admin';
  switch (action) {
    case 'mark:create':
      return true;
    case 'mark:update':
    case 'mark:delete':
      return Boolean(resource) && resource.user_id === user.id;
    case 'feature:propose':
    case 'report:create':
      return !user.proposalsBlocked;
    case 'feature:update':
      // A user edits only a draft: once sent, the proposal is frozen (withdraw it to edit again).
      return admin || (Boolean(resource) && resource.author_id === user.id
        && resource.status === 'pending' && !resource.reject_reason && !resource.submitted_at);
    case 'feature:submit':
      return Boolean(resource) && resource.author_id === user.id
        && resource.status === 'pending' && !resource.reject_reason && !resource.submitted_at;
    case 'feature:withdraw':
      return Boolean(resource) && resource.author_id === user.id
        && resource.status === 'pending' && !resource.reject_reason && Boolean(resource.submitted_at);
    case 'feature:delete':
      return admin || (Boolean(resource) && resource.author_id === user.id && resource.status === 'pending');
    case 'clan:create':
      // The route passes what it read from the users row: e-mail state and the admin's clan block.
      return Boolean(resource) && resource.emailVerified === true && !resource.clansBlocked;
    default:
      return admin;
  }
}

function capabilities(user) {
  return {
    map: can(user, 'map:write'),
    category: can(user, 'category:write'),
    feature: can(user, 'feature:create'),
    marks: can(user, 'mark:create'),
    propose: can(user, 'feature:propose'),
  };
}

// Which features a viewer may read: everything, or approved + their own.
function featureFilter(user) {
  if (user && user.role === 'admin') return { all: true, authorId: null };
  return { all: false, authorId: user ? user.id : null };
}

module.exports = { can, capabilities, featureFilter };
