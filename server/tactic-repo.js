'use strict';

const { tx } = require('./clan-repo');
const { newPublicId, LIMITS } = require('./tactic-validate');

const getPlanByPublicId = (db, publicId) =>
  db.prepare('SELECT * FROM tactic_plans WHERE public_id = ?').get(String(publicId)) || null;

function planOut(r) {
  return {
    id: r.public_id,
    clan_id: r.clan_id,
    map_id: r.map_id,
    title: r.title,
    active: Boolean(r.is_active),
    version: r.version,
    updated_at: r.updated_at,
  };
}

function itemOut(r) {
  return {
    id: r.id,
    squad_id: r.squad_id,
    kind: r.kind,
    geometry: JSON.parse(r.geometry),
    width: r.width,
    icon: r.icon,
    label: r.label,
    author_id: r.author_id,
  };
}

function listPlans(db, clanId, mapId) {
  const rows = mapId
    ? db.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM tactic_items i WHERE i.plan_id = p.id) AS items
       FROM tactic_plans p WHERE p.clan_id = ? AND p.map_id = ? ORDER BY p.is_active DESC, p.updated_at DESC, p.id DESC`,
    ).all(clanId, mapId)
    : db.prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM tactic_items i WHERE i.plan_id = p.id) AS items
       FROM tactic_plans p WHERE p.clan_id = ? ORDER BY p.is_active DESC, p.updated_at DESC, p.id DESC`,
    ).all(clanId);
  return rows.map((r) => ({ ...planOut(r), items: r.items }));
}

function planBody(db, plan) {
  const items = db.prepare('SELECT * FROM tactic_items WHERE plan_id = ? ORDER BY id').all(plan.id).map(itemOut);
  return { plan: planOut(plan), items };
}

const countPlans = (db, clanId) => db.prepare('SELECT COUNT(*) AS n FROM tactic_plans WHERE clan_id = ?').get(clanId).n;
const countItems = (db, planId) => db.prepare('SELECT COUNT(*) AS n FROM tactic_items WHERE plan_id = ?').get(planId).n;

// Every change of a plan or its drawings goes through here; the caller already holds a transaction
// or runs synchronously, so the version and the change cannot be observed apart.
function bump(db, planId, userId) {
  db.prepare("UPDATE tactic_plans SET version = version + 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?")
    .run(userId || null, planId);
  return db.prepare('SELECT version FROM tactic_plans WHERE id = ?').get(planId).version;
}

function insertPlan(db, { clanId, mapId, title, userId, active }) {
  return tx(db, () => {
    if (active) db.prepare('UPDATE tactic_plans SET is_active = 0 WHERE clan_id = ? AND map_id = ?').run(clanId, mapId);
    const publicId = newPublicId();
    db.prepare(
      'INSERT INTO tactic_plans (public_id, clan_id, map_id, title, is_active, updated_by) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(publicId, clanId, mapId, title, active ? 1 : 0, userId || null);
    return getPlanByPublicId(db, publicId);
  });
}

// The title change and the version bump are one transaction.
function rename(db, plan, title, userId) {
  return tx(db, () => {
    db.prepare('UPDATE tactic_plans SET title = ? WHERE id = ?').run(title, plan.id);
    return bump(db, plan.id, userId);
  });
}

function activate(db, plan, userId) {
  return tx(db, () => {
    db.prepare('UPDATE tactic_plans SET is_active = 0 WHERE clan_id = ? AND map_id = ? AND id != ?')
      .run(plan.clan_id, plan.map_id, plan.id);
    db.prepare('UPDATE tactic_plans SET is_active = 1 WHERE id = ?').run(plan.id);
    bump(db, plan.id, userId);
    // The previous active plan changed too (its star), so its pollers must refresh.
    db.prepare(
      'UPDATE tactic_plans SET version = version + 1 WHERE clan_id = ? AND map_id = ? AND id != ?',
    ).run(plan.clan_id, plan.map_id, plan.id);
  });
}

// The item is returned with the plan's new version.
const getItem = (db, id) => db.prepare(
  `SELECT i.*, p.public_id, p.clan_id FROM tactic_items i JOIN tactic_plans p ON p.id = i.plan_id WHERE i.id = ?`,
).get(id) || null;

function insertItem(db, plan, f, userId) {
  return tx(db, () => {
    const id = Number(db.prepare(
      `INSERT INTO tactic_items (plan_id, squad_id, kind, geometry, width, icon, label, author_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(plan.id, f.squad_id, f.kind, JSON.stringify(f.geometry), f.width, f.icon || null, f.label || null, userId).lastInsertRowid);
    const version = bump(db, plan.id, userId);
    return { item: itemOut(db.prepare('SELECT * FROM tactic_items WHERE id = ?').get(id)), version };
  });
}

function updateItem(db, item, f, userId) {
  return tx(db, () => {
    const set = {};
    if ('geometry' in f) set.geometry = JSON.stringify(f.geometry);
    if ('width' in f) set.width = f.width;
    if ('squad_id' in f) set.squad_id = f.squad_id;
    if ('label' in f) set.label = f.label;
    if ('icon' in f) set.icon = f.icon;
    const keys = Object.keys(set);
    if (keys.length) {
      db.prepare(`UPDATE tactic_items SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`)
        .run(...keys.map((k) => set[k]), item.id);
    }
    const version = bump(db, item.plan_id, userId);
    return { item: itemOut(db.prepare('SELECT * FROM tactic_items WHERE id = ?').get(item.id)), version };
  });
}

function deleteItem(db, item, userId) {
  return tx(db, () => {
    db.prepare('DELETE FROM tactic_items WHERE id = ?').run(item.id);
    return bump(db, item.plan_id, userId);
  });
}

// squadId: undefined = whole plan, null = only общие, number = one squad.
function clearItems(db, plan, squadId, userId) {
  return tx(db, () => {
    if (squadId === undefined) db.prepare('DELETE FROM tactic_items WHERE plan_id = ?').run(plan.id);
    else if (squadId === null) db.prepare('DELETE FROM tactic_items WHERE plan_id = ? AND squad_id IS NULL').run(plan.id);
    else db.prepare('DELETE FROM tactic_items WHERE plan_id = ? AND squad_id = ?').run(plan.id, squadId);
    return bump(db, plan.id, userId);
  });
}

module.exports = {
  LIMITS,
  getPlanByPublicId,
  planOut,
  itemOut,
  listPlans,
  planBody,
  countPlans,
  countItems,
  bump,
  insertPlan,
  rename,
  activate,
  getItem,
  insertItem,
  updateItem,
  deleteItem,
  clearItems,
};
