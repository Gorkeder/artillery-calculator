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

const TACTIC_ICONS = ['gather', 'attack', 'defend', 'enemy', 'artillery', 'sniper', 'danger', 'question'];

function validatePoint(g) {
  const r = validatePoints([g], 1, 1);
  return r ? r[0] : null;
}

// geometry: returns the normalised value or null; label: null = not allowed, else {min, max} in characters;
// icon: whether the kind carries one.
const KINDS = {
  pencil: { geometry: (g) => validatePoints(g, 2, LIMITS.pencilPoints), label: null, icon: false },
  arrow: { geometry: (g) => validatePoints(g, 2, 50), label: null, icon: false },
  zone: { geometry: (g) => validatePoints(g, 3, 200), label: { min: 0, max: 60 }, icon: false },
  marker: { geometry: validatePoint, label: { min: 0, max: 60 }, icon: true },
  text: { geometry: validatePoint, label: { min: 1, max: 120 }, icon: false },
};
const hasKind = (k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(KINDS, k);

// Trimmed, single line; null for a non-string or control characters.
function normLabel(value) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return null;
  return value.trim().replace(/\s+/g, ' ');
}

function validateItem(input, { create = false } = {}) {
  if (!isObject(input)) return fail('body_invalid');
  const out = {};
  let kind;
  if (create) {
    kind = input.kind;
    if (!hasKind(kind)) return fail('kind_invalid');
    out.kind = kind;
  } else {
    if ('kind' in input) return fail('kind_immutable');
    // The route sets __kind from the stored drawing; the client cannot choose it.
    kind = input.__kind;
    if (!hasKind(kind)) return fail('kind_invalid');
  }
  const spec = KINDS[kind];
  if (create || 'geometry' in input) {
    const g = spec.geometry(input.geometry);
    if (g === null) return fail('geometry_invalid');
    out.geometry = g;
  }
  if (create || 'width' in input) {
    const w = 'width' in input ? input.width : 2;
    if (!Number.isInteger(w) || w < 1 || w > 3) return fail('width_invalid');
    out.width = w;
  }
  if (create || 'squad' in input) {
    const sq = 'squad' in input ? input.squad : null;
    if (sq !== null && (!Number.isInteger(sq) || sq < 1)) return fail('squad_invalid');
    out.squad_id = sq;
  }
  if ('label' in input || (create && spec.label && spec.label.min > 0)) {
    if (!spec.label) return fail('label_not_allowed');
    const t = normLabel(input.label);
    if (t === null || t.length < spec.label.min || t.length > spec.label.max) return fail('label_invalid');
    out.label = t === '' ? null : t;
  }
  if ('icon' in input || (create && spec.icon)) {
    if (!spec.icon) return fail('icon_not_allowed');
    const icon = 'icon' in input ? input.icon : 'question';
    if (typeof icon !== 'string' || !TACTIC_ICONS.includes(icon)) return fail('icon_invalid');
    out.icon = icon;
  }
  return ok(out);
}

module.exports = { LIMITS, TACTIC_ICONS, newPublicId, validatePlan, validateItem };
