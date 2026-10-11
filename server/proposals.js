'use strict';

// Automatic classification of a proposal at the moment its author sends it to moderation.
// Flagged proposals go to a separate queue so that empty objects and click-spam do not bury real ones.

const DUPLICATE_RADIUS = 0.003; // fraction of the map size: 0.3%
const FREQUENCY_WINDOW_MS = 10 * 60 * 1000;
const FREQUENCY_LIMIT = 5; // this many sends in the window make the next one "frequent"

// One representative point of a geometry: the point itself, or the centre of a polygon/line's vertices.
function anchor(geometry) {
  if (geometry && typeof geometry.x === 'number' && typeof geometry.y === 'number') {
    return { x: geometry.x, y: geometry.y };
  }
  const points = (geometry && geometry.points) || [];
  if (!points.length) return null;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p[0];
    sy += p[1];
  }
  return { x: sx / points.length, y: sy / points.length };
}

const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// Returns 'empty' | 'duplicate' | 'frequency' | null (checked in this order).
function classifySubmission(db, row, nowMs) {
  if (!String(row.title || '').trim() && !String(row.description || '').trim()) return 'empty';

  const mine = anchor(JSON.parse(row.geometry));
  if (mine) {
    // Candidates: published objects and other proposals still waiting, in the same category of the same map.
    const others = db
      .prepare(
        `SELECT geometry FROM features
         WHERE map_id = ? AND category_id = ? AND id != ?
           AND (status = 'approved' OR (status = 'pending' AND submitted_at IS NOT NULL AND reject_reason IS NULL))`,
      )
      .all(row.map_id, row.category_id, row.id);
    for (const other of others) {
      const a = anchor(JSON.parse(other.geometry));
      if (a && Math.hypot(a.x - mine.x, a.y - mine.y) <= DUPLICATE_RADIUS) return 'duplicate';
    }
  }

  const since = sqlTime(nowMs - FREQUENCY_WINDOW_MS);
  const recent = db
    .prepare('SELECT COUNT(*) AS n FROM features WHERE author_id = ? AND id != ? AND submitted_at >= ?')
    .get(row.author_id, row.id, since).n;
  if (recent >= FREQUENCY_LIMIT) return 'frequency';
  return null;
}

module.exports = { classifySubmission, anchor, DUPLICATE_RADIUS, FREQUENCY_LIMIT, FREQUENCY_WINDOW_MS };
