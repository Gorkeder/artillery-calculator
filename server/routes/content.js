'use strict';

const { HttpError, readJson } = require('../http-util');
const { can } = require('../permissions');
const v = require('../validate');
const repo = require('../repo');
const { unlinkAll } = require('../files');

function need(c, action, resource) {
  if (!c.user) throw new HttpError(401, 'login required');
  if (!can(c.user, action, resource)) throw new HttpError(403, 'forbidden');
}

function idParam(c) {
  const n = Number(c.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'not found');
  return n;
}

function intField(value, name) {
  if (!Number.isInteger(value) || value < 1) throw new HttpError(400, name + ' must be a positive integer');
  return value;
}

function checked(result) {
  if (!result.ok) throw new HttpError(400, result.error);
  return result.value;
}

const isUnique = (err) => /UNIQUE/i.test(String((err && err.message) || ''));
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function mapOr404(c, id) {
  const map = repo.getMapById(c.db, id);
  if (!map) throw new HttpError(404, 'map not found');
  return map;
}

module.exports = [
  // ---- public reads ----
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

  // ---- maps ----
  {
    method: 'POST',
    pattern: '/api/maps',
    handler: async (c) => {
      need(c, 'map:write');
      const fields = checked(v.validateMap(await readJson(c.req), { create: true }));
      try {
        const id = repo.insertRow(c.db, 'maps', fields);
        return { status: 201, body: repo.getMapById(c.db, id) };
      } catch (err) {
        if (isUnique(err)) throw new HttpError(409, 'slug already exists');
        throw err;
      }
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/maps/:id',
    handler: async (c) => {
      need(c, 'map:write');
      const id = idParam(c);
      mapOr404(c, id);
      const fields = checked(v.validateMap(await readJson(c.req)));
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      try {
        repo.updateRow(c.db, 'maps', id, fields);
      } catch (err) {
        if (isUnique(err)) throw new HttpError(409, 'slug already exists');
        throw err;
      }
      return { body: repo.getMapById(c.db, id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/maps/:id',
    handler: async (c) => {
      need(c, 'map:write');
      const id = idParam(c);
      mapOr404(c, id);
      const files = [...repo.imagePathsFor(c.db, 'map', id), repo.rawMapImagePath(c.db, id)];
      repo.deleteRow(c.db, 'maps', id);
      unlinkAll(c.uploadsDir, files);
      return { body: { ok: true } };
    },
  },

  // ---- categories ----
  {
    method: 'POST',
    pattern: '/api/categories',
    handler: async (c) => {
      need(c, 'category:write');
      const body = await readJson(c.req);
      const mapId = intField(body.map_id, 'map_id');
      mapOr404(c, mapId);
      const fields = checked(v.validateCategory(body, { create: true }));
      const id = repo.insertRow(c.db, 'categories', { map_id: mapId, ...fields });
      return { status: 201, body: repo.getCategory(c.db, id) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/categories/:id',
    handler: async (c) => {
      need(c, 'category:write');
      const id = idParam(c);
      const cat = repo.getCategory(c.db, id);
      if (!cat) throw new HttpError(404, 'category not found');
      const fields = checked(v.validateCategory(await readJson(c.req)));
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      if (fields.shape && fields.shape !== cat.shape && repo.countFeaturesInCategory(c.db, id) > 0) {
        throw new HttpError(409, 'cannot change shape of a category that has features');
      }
      repo.updateRow(c.db, 'categories', id, fields);
      return { body: repo.getCategory(c.db, id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/categories/:id',
    handler: async (c) => {
      need(c, 'category:write');
      const id = idParam(c);
      if (!repo.getCategory(c.db, id)) throw new HttpError(404, 'category not found');
      const files = repo.imagePathsFor(c.db, 'category', id);
      repo.deleteRow(c.db, 'categories', id);
      unlinkAll(c.uploadsDir, files);
      return { body: { ok: true } };
    },
  },

  // ---- features ----
  {
    method: 'POST',
    pattern: '/api/features',
    handler: async (c) => {
      need(c, 'feature:create');
      const body = await readJson(c.req);
      const mapId = intField(body.map_id, 'map_id');
      const categoryId = intField(body.category_id, 'category_id');
      mapOr404(c, mapId);
      const cat = repo.getCategory(c.db, categoryId);
      if (!cat || cat.map_id !== mapId) throw new HttpError(400, 'category does not belong to this map');
      const geometry = checked(v.validateGeometry(cat.shape, body.geometry));
      const fields = checked(v.validateFeature(body, { create: true }));
      const id = repo.insertRow(c.db, 'features', {
        ...fields,
        map_id: mapId,
        category_id: categoryId,
        geometry: JSON.stringify(geometry),
        author_id: c.user.id,
        status: 'approved',
        updated_by: c.user.id,
        updated_at: sqlTime(c.now()),
      });
      return { status: 201, body: repo.getFeature(c.db, id) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/features/:id',
    handler: async (c) => {
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      need(c, 'feature:update', row);
      const body = await readJson(c.req);
      const categoryId = 'category_id' in body ? intField(body.category_id, 'category_id') : row.category_id;
      const cat = repo.getCategory(c.db, categoryId);
      if (!cat || cat.map_id !== row.map_id) throw new HttpError(400, 'category does not belong to this map');
      const geometryIn = 'geometry' in body ? body.geometry : JSON.parse(row.geometry);
      const geometry = checked(v.validateGeometry(cat.shape, geometryIn));
      const fields = checked(v.validateFeature(body));
      repo.updateRow(c.db, 'features', id, {
        ...fields,
        category_id: categoryId,
        geometry: JSON.stringify(geometry),
        updated_by: c.user.id,
        updated_at: sqlTime(c.now()),
      });
      return { body: repo.getFeature(c.db, id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/features/:id',
    handler: async (c) => {
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      need(c, 'feature:delete', row);
      const files = repo.imagePathsFor(c.db, 'feature', id);
      repo.deleteRow(c.db, 'features', id);
      unlinkAll(c.uploadsDir, files);
      return { body: { ok: true } };
    },
  },
];
