'use strict';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const ICON_RE = /^[a-z0-9-]{1,32}$/;
const SHAPES = ['point', 'polygon', 'line'];
const MAX_POINTS = 2000;

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

function inUnit(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
}

function validateGeometry(shape, g) {
  if (!g || typeof g !== 'object') return fail('geometry must be an object');
  if (shape === 'point') {
    if (!inUnit(g.x) || !inUnit(g.y)) return fail('point x and y must be numbers in 0..1');
    return ok({ x: g.x, y: g.y });
  }
  if (shape === 'polygon' || shape === 'line') {
    const min = shape === 'polygon' ? 3 : 2;
    if (!Array.isArray(g.points) || g.points.length < min || g.points.length > MAX_POINTS) {
      return fail(`${shape} needs ${min}..${MAX_POINTS} points`);
    }
    const points = [];
    for (const p of g.points) {
      if (!Array.isArray(p) || p.length !== 2 || !inUnit(p[0]) || !inUnit(p[1])) {
        return fail('every point must be [x, y] with numbers in 0..1');
      }
      points.push([p[0], p[1]]);
    }
    return ok({ points });
  }
  return fail('unknown shape');
}

function validateCategory(input, { create = false } = {}) {
  const out = {};
  if (create || 'name' in input) {
    if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 60) {
      return fail('name must be 1..60 characters');
    }
    out.name = input.name.trim();
  }
  if ('color' in input) {
    if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) return fail('color must be #rrggbb');
    out.color = input.color;
  }
  if ('icon' in input) {
    if (typeof input.icon !== 'string' || !ICON_RE.test(input.icon)) return fail('icon must match [a-z0-9-]{1,32}');
    out.icon = input.icon;
  }
  if ('shape' in input) {
    if (!SHAPES.includes(input.shape)) return fail('shape must be point, polygon or line');
    out.shape = input.shape;
  }
  if ('visible_default' in input) {
    if (typeof input.visible_default !== 'boolean') return fail('visible_default must be boolean');
    out.visible_default = input.visible_default ? 1 : 0;
  }
  if ('sort' in input) {
    if (!Number.isInteger(input.sort)) return fail('sort must be an integer');
    out.sort = input.sort;
  }
  return ok(out);
}

function validateFeature(input, { create = false } = {}) {
  void create;
  const out = {};
  if ('title' in input) {
    if (typeof input.title !== 'string' || input.title.length > 120) return fail('title must be a string up to 120 characters');
    out.title = input.title;
  }
  if ('description' in input) {
    if (typeof input.description !== 'string' || input.description.length > 4000) {
      return fail('description must be a string up to 4000 characters');
    }
    out.description = input.description;
  }
  if ('color' in input) {
    if (input.color !== null && (typeof input.color !== 'string' || !COLOR_RE.test(input.color))) {
      return fail('color must be null or #rrggbb');
    }
    out.color = input.color;
  }
  if ('opacity' in input) {
    if (input.opacity !== null && !inUnit(input.opacity)) return fail('opacity must be null or a number in 0..1');
    out.opacity = input.opacity;
  }
  return ok(out);
}

function validateMap(input, { create = false } = {}) {
  const out = {};
  if (create || 'slug' in input) {
    if (typeof input.slug !== 'string' || !SLUG_RE.test(input.slug)) return fail('slug must match [a-z0-9-]{1,40}');
    out.slug = input.slug;
  }
  if (create || 'title' in input) {
    if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80) {
      return fail('title must be 1..80 characters');
    }
    out.title = input.title.trim();
  }
  if ('sort' in input) {
    if (!Number.isInteger(input.sort)) return fail('sort must be an integer');
    out.sort = input.sort;
  }
  if ('published' in input) {
    if (typeof input.published !== 'boolean') return fail('published must be boolean');
    out.published = input.published ? 1 : 0;
  }
  return ok(out);
}

const MAX_MARK_POINTS = 100;

function validateMark(input, { create = false } = {}) {
  const out = {};
  if (create) {
    if (!SHAPES.includes(input.shape)) return fail('shape must be point, polygon or line');
    out.shape = input.shape;
  }
  if ('title' in input) {
    if (typeof input.title !== 'string' || input.title.length > 80) return fail('title must be a string up to 80 characters');
    out.title = input.title;
  }
  if ('description' in input) {
    if (typeof input.description !== 'string' || input.description.length > 1000) {
      return fail('description must be a string up to 1000 characters');
    }
    out.description = input.description;
  }
  if ('color' in input) {
    if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) return fail('color must be #rrggbb');
    out.color = input.color;
  }
  if ('icon' in input) {
    if (typeof input.icon !== 'string' || !ICON_RE.test(input.icon)) return fail('icon must match [a-z0-9-]{1,32}');
    out.icon = input.icon;
  }
  return ok(out);
}

function validateMarkGeometry(shape, g) {
  const r = validateGeometry(shape, g);
  if (r.ok && r.value.points && r.value.points.length > MAX_MARK_POINTS) {
    return fail(`${shape} may have at most ${MAX_MARK_POINTS} points`);
  }
  return r;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sniffImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

function imageSize(buf) {
  const type = sniffImageType(buf);
  if (type === 'png') {
    if (buf.length < 24 || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (type === 'jpeg') {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  }
  if (type === 'webp') {
    const fourcc = buf.toString('latin1', 12, 16);
    if (fourcc === 'VP8X' && buf.length >= 30) {
      return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (fourcc === 'VP8 ' && buf.length >= 30) {
      return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L' && buf.length >= 25) {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  return null;
}

module.exports = {
  validateGeometry,
  validateCategory,
  validateFeature,
  validateMap,
  validateMark,
  validateMarkGeometry,
  sniffImageType,
  imageSize,
};
