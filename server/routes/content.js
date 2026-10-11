'use strict';

const { HttpError } = require('../http-util');
const { can } = require('../permissions');
const repo = require('../repo');

module.exports = [
  {
    method: 'GET',
    pattern: '/api/maps',
    handler: async (c) => ({
      body: repo.listMaps(c.db, { includeUnpublished: can(c.user, 'map:write') }),
    }),
  },
  {
    method: 'GET',
    pattern: '/api/maps/:slug',
    handler: async (c) => {
      const map = repo.getMapBySlug(c.db, c.params.slug);
      if (!map || (!map.published && !can(c.user, 'map:write'))) throw new HttpError(404, 'map not found');
      return {
        body: {
          map,
          categories: repo.listCategories(c.db, map.id),
          features: repo.listFeatures(c.db, map.id, c.user),
        },
      };
    },
  },
];
