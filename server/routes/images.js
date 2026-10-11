'use strict';

const { HttpError, readBody } = require('../http-util');
const { can } = require('../permissions');
const { sniffImageType, imageSize } = require('../validate');
const { EXT, storeFile, unlinkAll } = require('../files');
const repo = require('../repo');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 16384;
const MAX_PHOTOS = 10;

function need(c, action, resource) {
  if (!c.user) throw new HttpError(401, 'login required');
  if (!can(c.user, action, resource)) throw new HttpError(403, 'forbidden');
}

function idParam(c) {
  const n = Number(c.params.id);
  if (!Number.isInteger(n) || n < 1) throw new HttpError(404, 'not found');
  return n;
}

// The declared Content-Type is ignored on purpose: only the file signature counts.
async function readImage(c) {
  const buf = await readBody(c.req, MAX_IMAGE_BYTES);
  if (buf.length === 0) throw new HttpError(400, 'empty body');
  const type = sniffImageType(buf);
  if (!type) throw new HttpError(400, 'unsupported image type (png, jpeg or webp only)');
  return { buf, type };
}

module.exports = [
  {
    method: 'PUT',
    pattern: '/api/maps/:id/image',
    handler: async (c) => {
      need(c, 'image:write');
      const id = idParam(c);
      if (!repo.getMapById(c.db, id)) throw new HttpError(404, 'map not found');
      const { buf, type } = await readImage(c);
      const size = imageSize(buf);
      if (!size || size.width < 1 || size.height < 1) throw new HttpError(400, 'cannot read image dimensions');
      if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
        throw new HttpError(400, `image sides must not exceed ${MAX_DIMENSION}px`);
      }
      const old = repo.rawMapImagePath(c.db, id);
      const rel = storeFile(c.uploadsDir, 'maps', buf, EXT[type]);
      repo.updateRow(c.db, 'maps', id, { image_path: rel, width: size.width, height: size.height });
      unlinkAll(c.uploadsDir, [old]);
      return { body: repo.getMapById(c.db, id) };
    },
  },
  {
    method: 'PUT',
    pattern: '/api/features/:id/images',
    handler: async (c) => {
      const id = idParam(c);
      const row = repo.rawFeature(c.db, id);
      if (!row) throw new HttpError(404, 'feature not found');
      need(c, 'image:write', row);
      if (repo.countFeatureImages(c.db, id) >= MAX_PHOTOS) throw new HttpError(409, `at most ${MAX_PHOTOS} photos per object`);
      const { buf, type } = await readImage(c);
      if (!imageSize(buf)) throw new HttpError(400, 'cannot read image dimensions');
      const rel = storeFile(c.uploadsDir, 'features', buf, EXT[type]);
      return { status: 201, body: repo.addFeatureImage(c.db, id, rel) };
    },
  },
  {
    method: 'DELETE',
    pattern: '/api/feature-images/:id',
    handler: async (c) => {
      need(c, 'image:write');
      const img = repo.getFeatureImage(c.db, idParam(c));
      if (!img) throw new HttpError(404, 'image not found');
      repo.deleteRow(c.db, 'feature_images', img.id);
      unlinkAll(c.uploadsDir, [img.path]);
      return { body: { ok: true } };
    },
  },
];
