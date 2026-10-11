'use strict';

const ACTIONS = new Set([
  'map:write',
  'category:write',
  'feature:create',
  'feature:update',
  'feature:delete',
  'image:write',
]);

// The only place that decides who may do what. v1: admins only.
// Later: let role 'user' create features (status 'pending') and update/delete their own
// pending ones by inspecting `resource` (a feature row with author_id/status).
function can(user, action, resource) {
  void resource;
  if (!ACTIONS.has(action)) throw new Error('unknown action: ' + action);
  if (!user) return false;
  return user.role === 'admin';
}

function capabilities(user) {
  return {
    map: can(user, 'map:write'),
    category: can(user, 'category:write'),
    feature: can(user, 'feature:create'),
  };
}

// Which features a viewer may read: everything, or approved + their own.
function featureFilter(user) {
  if (user && user.role === 'admin') return { all: true, authorId: null };
  return { all: false, authorId: user ? user.id : null };
}

module.exports = { can, capabilities, featureFilter };
