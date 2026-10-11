'use strict';

const { HttpError, readJson } = require('../http-util');
const { can } = require('../permissions');
const v = require('../validate');
const repo = require('../repo');

const MAX_MARKS_PER_USER = 300;

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

function checked(result) {
  if (!result.ok) throw new HttpError(400, result.error);
  return result.value;
}

// Every route here is for a signed-in user; the per-user write limit is shared by POST/PATCH/DELETE.
function need(c) {
  if (!c.user) throw new HttpError(401, 'login required');
}

function limitWrites(c) {
  if (!c.limiters.marksWrite.allow('u:' + c.user.id, c.now())) {
    throw new HttpError(429, 'too many requests, try again later');
  }
}

function publishedMap(c, slug) {
  const map = typeof slug === 'string' ? repo.getMapBySlug(c.db, slug) : null;
  if (!map || !map.published) throw new HttpError(404, 'map not found');
  return map;
}

// A foreign mark and a missing one are indistinguishable on purpose: ids cannot be probed.
function ownMark(c, action) {
  const n = Number(c.params.id);
  const row = Number.isInteger(n) && n > 0 ? repo.getMarkRaw(c.db, n) : null;
  if (!row || !can(c.user, action, row)) throw new HttpError(404, 'mark not found');
  return row;
}

module.exports = [
  {
    method: 'GET',
    pattern: '/api/my/marks',
    handler: async (c) => {
      need(c);
      const map = publishedMap(c, c.query.get('map'));
      return { body: repo.listMarks(c.db, c.user.id, map.id) };
    },
  },
  {
    method: 'POST',
    pattern: '/api/my/marks',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      if (!can(c.user, 'mark:create')) throw new HttpError(403, 'forbidden');
      const body = await readJson(c.req);
      const map = publishedMap(c, body.map);
      const fields = checked(v.validateMark(body, { create: true }));
      const geometry = checked(v.validateMarkGeometry(fields.shape, body.geometry));
      // Count and insert run with no await in between, so parallel requests cannot overshoot.
      if (repo.countMarks(c.db, c.user.id) >= MAX_MARKS_PER_USER) throw new HttpError(409, 'marks_limit');
      const now = sqlTime(c.now());
      const id = repo.insertRow(c.db, 'user_marks', {
        ...fields,
        user_id: c.user.id,
        map_id: map.id,
        geometry: JSON.stringify(geometry),
        created_at: now,
        updated_at: now,
      });
      return { status: 201, body: repo.getMark(c.db, id) };
    },
  },
  {
    method: 'PATCH',
    pattern: '/api/my/marks/:id',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      const row = ownMark(c, 'mark:update');
      const body = await readJson(c.req);
      if ('shape' in body && body.shape !== row.shape) throw new HttpError(400, 'shape cannot be changed');
      const fields = checked(v.validateMark(body));
      if ('geometry' in body) {
        fields.geometry = JSON.stringify(checked(v.validateMarkGeometry(row.shape, body.geometry)));
      }
      if (!Object.keys(fields).length) throw new HttpError(400, 'nothing to update');
      fields.updated_at = sqlTime(c.now());
      repo.updateRow(c.db, 'user_marks', row.id, fields);
      return { body: repo.getMark(c.db, row.id) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/my/marks/:id',
    handler: async (c) => {
      need(c);
      limitWrites(c);
      const row = ownMark(c, 'mark:delete');
      repo.deleteRow(c.db, 'user_marks', row.id);
      return { body: { ok: true } };
    },
  },
];
