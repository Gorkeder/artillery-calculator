'use strict';

const { featureFilter } = require('./permissions');

const uploadUrl = (p) => '/uploads/' + p;

function mapOut(r) {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    width: r.width,
    height: r.height,
    image_url: r.image_path ? uploadUrl(r.image_path) : null,
    sort: r.sort,
    published: !!r.published,
  };
}

function categoryOut(r) {
  return {
    id: r.id,
    map_id: r.map_id,
    name: r.name,
    color: r.color,
    icon: r.icon,
    shape: r.shape,
    visible_default: !!r.visible_default,
    sort: r.sort,
  };
}

function featureOut(r, images) {
  return {
    id: r.id,
    map_id: r.map_id,
    category_id: r.category_id,
    geometry: JSON.parse(r.geometry),
    title: r.title,
    description: r.description,
    color: r.color,
    opacity: r.opacity,
    status: r.status,
    author_id: r.author_id,
    images: images || [],
  };
}

function listMaps(db, { includeUnpublished = false } = {}) {
  const sql = 'SELECT * FROM maps' + (includeUnpublished ? '' : ' WHERE published = 1') + ' ORDER BY sort, id';
  return db.prepare(sql).all().map(mapOut);
}

function getMapBySlug(db, slug) {
  const r = db.prepare('SELECT * FROM maps WHERE slug = ?').get(slug);
  return r ? mapOut(r) : null;
}

function getMapById(db, id) {
  const r = db.prepare('SELECT * FROM maps WHERE id = ?').get(id);
  return r ? mapOut(r) : null;
}

function rawMapImagePath(db, id) {
  const r = db.prepare('SELECT image_path FROM maps WHERE id = ?').get(id);
  return r ? r.image_path : null;
}

function listCategories(db, mapId) {
  return db.prepare('SELECT * FROM categories WHERE map_id = ? ORDER BY sort, id').all(mapId).map(categoryOut);
}

function getCategory(db, id) {
  const r = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  return r ? categoryOut(r) : null;
}

function groupImages(rows) {
  const byFeature = new Map();
  for (const r of rows) {
    if (!byFeature.has(r.feature_id)) byFeature.set(r.feature_id, []);
    byFeature.get(r.feature_id).push({ id: r.id, url: uploadUrl(r.path) });
  }
  return byFeature;
}

function listFeatures(db, mapId, viewer) {
  const filter = featureFilter(viewer);
  let sql = 'SELECT * FROM features WHERE map_id = ?';
  const params = [mapId];
  if (!filter.all) {
    sql += " AND (status = 'approved'";
    if (filter.authorId !== null) {
      sql += ' OR author_id = ?';
      params.push(filter.authorId);
    }
    sql += ')';
  }
  sql += ' ORDER BY id';
  const rows = db.prepare(sql).all(...params);
  const imgs = groupImages(
    db
      .prepare(
        'SELECT fi.id, fi.feature_id, fi.path FROM feature_images fi JOIN features f ON f.id = fi.feature_id WHERE f.map_id = ? ORDER BY fi.sort, fi.id',
      )
      .all(mapId),
  );
  return rows.map((r) => featureOut(r, imgs.get(r.id)));
}

function rawFeature(db, id) {
  return db.prepare('SELECT * FROM features WHERE id = ?').get(id) || null;
}

function getFeature(db, id) {
  const r = rawFeature(db, id);
  if (!r) return null;
  const imgs = groupImages(
    db.prepare('SELECT id, feature_id, path FROM feature_images WHERE feature_id = ? ORDER BY sort, id').all(id),
  );
  return featureOut(r, imgs.get(id));
}

function countFeaturesInCategory(db, id) {
  return db.prepare('SELECT COUNT(*) AS n FROM features WHERE category_id = ?').get(id).n;
}

// `table` and the keys of `fields` always come from code / validators, never from request input.
function insertRow(db, table, fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  return Number(db.prepare(sql).run(...keys.map((k) => fields[k])).lastInsertRowid);
}

function updateRow(db, table, id, fields) {
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`;
  db.prepare(sql).run(...keys.map((k) => fields[k]), id);
}

function deleteRow(db, table, id) {
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

function imagePathsFor(db, kind, id) {
  const sql = {
    feature: 'SELECT path FROM feature_images WHERE feature_id = ?',
    category:
      'SELECT fi.path FROM feature_images fi JOIN features f ON f.id = fi.feature_id WHERE f.category_id = ?',
    map: 'SELECT fi.path FROM feature_images fi JOIN features f ON f.id = fi.feature_id WHERE f.map_id = ?',
  }[kind];
  return db.prepare(sql).all(id).map((r) => r.path);
}

function countFeatureImages(db, featureId) {
  return db.prepare('SELECT COUNT(*) AS n FROM feature_images WHERE feature_id = ?').get(featureId).n;
}

function addFeatureImage(db, featureId, path) {
  const id = insertRow(db, 'feature_images', { feature_id: featureId, path, sort: countFeatureImages(db, featureId) });
  return { id, url: uploadUrl(path) };
}

function getFeatureImage(db, id) {
  return db.prepare('SELECT id, feature_id, path FROM feature_images WHERE id = ?').get(id) || null;
}

const MARK_SELECT =
  'SELECT m.*, mp.slug AS map_slug FROM user_marks m JOIN maps mp ON mp.id = m.map_id';

// user_id is deliberately absent: a mark is only ever shown to its owner.
function markOut(r) {
  return {
    id: r.id,
    map: r.map_slug,
    shape: r.shape,
    geometry: JSON.parse(r.geometry),
    title: r.title,
    description: r.description,
    color: r.color,
    icon: r.icon,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function listMarks(db, userId, mapId) {
  return db.prepare(MARK_SELECT + ' WHERE m.user_id = ? AND m.map_id = ? ORDER BY m.id').all(userId, mapId).map(markOut);
}

function getMark(db, id) {
  const r = db.prepare(MARK_SELECT + ' WHERE m.id = ?').get(id);
  return r ? markOut(r) : null;
}

function getMarkRaw(db, id) {
  return db.prepare('SELECT * FROM user_marks WHERE id = ?').get(id) || null;
}

function countMarks(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM user_marks WHERE user_id = ?').get(userId).n;
}

module.exports = {
  listMaps,
  getMapBySlug,
  getMapById,
  rawMapImagePath,
  listCategories,
  getCategory,
  listFeatures,
  getFeature,
  rawFeature,
  countFeaturesInCategory,
  insertRow,
  updateRow,
  deleteRow,
  imagePathsFor,
  countFeatureImages,
  addFeatureImage,
  getFeatureImage,
  listMarks,
  getMark,
  getMarkRaw,
  countMarks,
};
