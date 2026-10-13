'use strict';

const { namesToPerms } = require('./clan-permissions');

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TAG_RE = /^[0-9A-Za-zА-Яа-яЁё]{2,5}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

// Case- and ё-insensitive key for unique tags and names (SQLite lower() folds ASCII only).
function clanKey(s) {
  return String(s).trim().toLocaleLowerCase('ru').replace(/ё/g, 'е');
}

function shortText(value, min, max) {
  if (typeof value !== 'string' || CONTROL_RE.test(value)) return null;
  const t = value.trim().replace(/\s+/g, ' ');
  return t.length >= min && t.length <= max ? t : null;
}

function validateClan(input, { create = false } = {}) {
  const out = {};
  if (create || 'tag' in input) {
    if (typeof input.tag !== 'string' || !TAG_RE.test(input.tag.trim())) return fail('tag_invalid');
    out.tag = input.tag.trim();
  }
  if (create || 'name' in input) {
    const name = shortText(input.name, 3, 40);
    if (name === null) return fail('name_invalid');
    out.name = name;
  }
  if ('description' in input) {
    if (typeof input.description !== 'string' || input.description.length > 500) return fail('description_invalid');
    out.description = input.description.trim();
  }
  return ok(out);
}

function validateIdList(value, max) {
  if (!Array.isArray(value) || value.length > max
    || value.some((x) => !Number.isInteger(x) || x < 1) || new Set(value).size !== value.length) {
    return fail('ids must be a list of unique positive integers');
  }
  return ok(value.slice());
}

function validateColor(input, out) {
  if (!('color' in input)) return null;
  if (typeof input.color !== 'string' || !COLOR_RE.test(input.color)) return fail('color must be #rrggbb');
  out.color = input.color;
  return null;
}

function validateRole(input, { create = false } = {}) {
  const out = {};
  if (create || 'name' in input) {
    const name = shortText(input.name, 1, 30);
    if (name === null) return fail('name_invalid');
    out.name = name;
  }
  const colorErr = validateColor(input, out);
  if (colorErr) return colorErr;
  if ('perms' in input) {
    const mask = namesToPerms(input.perms);
    if (mask === null) return fail('unknown permission');
    out.perms = mask;
  }
  if ('draw_all_squads' in input) {
    if (typeof input.draw_all_squads !== 'boolean') return fail('draw_all_squads must be boolean');
    out.draw_all_squads = input.draw_all_squads ? 1 : 0;
  }
  if ('squads' in input) {
    const r = validateIdList(input.squads, 10);
    if (!r.ok) return r;
    out.squads = r.value;
  }
  return ok(out);
}

function validateSquad(input, { create = false } = {}) {
  const out = {};
  if (create || 'name' in input) {
    const name = shortText(input.name, 1, 30);
    if (name === null) return fail('name_invalid');
    out.name = name;
  }
  const colorErr = validateColor(input, out);
  if (colorErr) return colorErr;
  return ok(out);
}

function validateInviteOptions(input) {
  const ttl = 'ttl' in input ? input.ttl : '7d';
  if (ttl !== null && ttl !== '1d' && ttl !== '7d') return fail('ttl must be 1d, 7d or null');
  const maxUses = 'maxUses' in input ? input.maxUses : null;
  if (maxUses !== null && (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100)) {
    return fail('maxUses must be null or 1..100');
  }
  return ok({ ttl, maxUses });
}

module.exports = { clanKey, validateClan, validateRole, validateSquad, validateIdList, validateInviteOptions };
