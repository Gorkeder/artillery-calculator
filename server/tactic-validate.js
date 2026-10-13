'use strict';

const crypto = require('node:crypto');

const LIMITS = { plans: 25, items: 500, pencilPoints: 2000 };
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// 12 base62 characters; bytes >= 248 are skipped so every symbol is equally likely.
function newPublicId() {
  let out = '';
  while (out.length < 12) {
    for (const b of crypto.randomBytes(16)) {
      if (b < 248 && out.length < 12) out += BASE62[b % 62];
    }
  }
  return out;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validatePlan(input, { create = false } = {}) {
  if (!isObject(input)) return fail('body_invalid');
  const out = {};
  if (create || 'title' in input) {
    if (typeof input.title !== 'string' || CONTROL_RE.test(input.title)) return fail('title_invalid');
    const t = input.title.trim().replace(/\s+/g, ' ');
    if (t.length < 1 || t.length > 60) return fail('title_invalid');
    out.title = t;
  }
  return ok(out);
}

function validatePoints(value, min, max) {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null;
  const out = [];
  for (const p of value) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [x, y] = p;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    out.push([round5(x), round5(y)]);
  }
  return out;
}

// Stage 2 knows only the pencil; later stages add their kinds to this table.
const KINDS = {
  pencil: (g) => validatePoints(g, 2, LIMITS.pencilPoints),
};

function validateItem(input, { create = false } = {}) {
  if (!isObject(input)) return fail('body_invalid');
  const out = {};
  if (create) {
    if (typeof input.kind !== 'string' || !Object.prototype.hasOwnProperty.call(KINDS, input.kind)) {
      return fail('kind_invalid');
    }
    out.kind = input.kind;
  } else if ('kind' in input) {
    return fail('kind_immutable');
  }
  if (create || 'geometry' in input) {
    // On update the kind is not in the body; the route re-validates geometry with the stored kind.
    const kind = create ? out.kind : (input.__kind || 'pencil');
    if (typeof kind !== 'string' || !Object.prototype.hasOwnProperty.call(KINDS, kind)) return fail('kind_invalid');
    const g = KINDS[kind](input.geometry);
    if (g === null) return fail('geometry_invalid');
    out.geometry = g;
  }
  if ('width' in input || create) {
    const w = 'width' in input ? input.width : 2;
    if (!Number.isInteger(w) || w < 1 || w > 3) return fail('width_invalid');
    out.width = w;
  }
  if ('squad' in input || create) {
    const sq = 'squad' in input ? input.squad : null;
    if (sq !== null && (!Number.isInteger(sq) || sq < 1)) return fail('squad_invalid');
    out.squad_id = sq;
  }
  return ok(out);
}

module.exports = { LIMITS, newPublicId, validatePlan, validateItem };
