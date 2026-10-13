'use strict';

const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  image_path TEXT,
  width INTEGER,
  height INTEGER,
  sort INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#d4c24f',
  icon TEXT NOT NULL DEFAULT 'question',
  shape TEXT NOT NULL DEFAULT 'point' CHECK (shape IN ('point', 'polygon', 'line')),
  visible_default INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS features (
  id INTEGER PRIMARY KEY,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  geometry TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT,
  opacity REAL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'pending')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_features_map ON features(map_id);
CREATE INDEX IF NOT EXISTS idx_features_category ON features(category_id);
CREATE TABLE IF NOT EXISTS feature_images (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sort INTEGER NOT NULL DEFAULT 0
);
`;

// Version 1 is the SCHEMA above (the schema as it was in production before accounts).
// Each entry runs once, inside a transaction, when user_version is lower than its version.
const MIGRATIONS = [
  {
    version: 2,
    sql: `
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN email_verified_at TEXT;
ALTER TABLE users ADD COLUMN password_changed_at TEXT;
UPDATE users SET email_verified_at = created_at;
CREATE UNIQUE INDEX idx_users_login_lower ON users(lower(login));
CREATE UNIQUE INDEX idx_users_email_lower ON users(lower(email)) WHERE email IS NOT NULL;
ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN ip TEXT;
ALTER TABLE sessions ADD COLUMN user_agent TEXT;
CREATE TABLE auth_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('verify_email', 'reset_password')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id, kind);
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE user_marks (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  shape TEXT NOT NULL CHECK (shape IN ('point', 'polygon', 'line')),
  geometry TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#d4c24f',
  icon TEXT NOT NULL DEFAULT 'question',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_user_marks_user_map ON user_marks(user_id, map_id);
`,
  },
  {
    version: 4,
    sql: `
ALTER TABLE features ADD COLUMN reject_reason TEXT;
ALTER TABLE features ADD COLUMN reviewed_at TEXT;
ALTER TABLE features ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN proposals_blocked_at TEXT;
ALTER TABLE users ADD COLUMN proposals_block_reason TEXT;
CREATE TABLE reports (
  id INTEGER PRIMARY KEY,
  feature_id INTEGER NOT NULL REFERENCES features(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_reports_open ON reports(resolved_at, feature_id);
CREATE UNIQUE INDEX idx_reports_one_open ON reports(feature_id, user_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_features_status ON features(status, reviewed_at);
`,
  },
  {
    // A proposal now starts as a draft (submitted_at NULL) and is sent to moderation explicitly.
    // Proposals that were already waiting stay in the queue: they count as sent.
    version: 5,
    sql: `
ALTER TABLE features ADD COLUMN submitted_at TEXT;
ALTER TABLE features ADD COLUMN flag TEXT;
UPDATE features SET submitted_at = COALESCE(updated_at, datetime('now')) WHERE status = 'pending';
`,
  },
  {
    // Clans, roles, squads and invitations (stage 1 of clans and tactics).
    // Tags and names are unique by a key folded in JS: SQLite lower() does not fold Cyrillic.
    version: 6,
    sql: `
ALTER TABLE users ADD COLUMN clans_blocked INTEGER NOT NULL DEFAULT 0;
CREATE TABLE clans (
  id INTEGER PRIMARY KEY,
  tag TEXT NOT NULL,
  tag_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  emblem_path TEXT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE clan_members (
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  joined_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_clan_members_clan ON clan_members(clan_id);
CREATE TABLE clan_roles (
  id INTEGER PRIMARY KEY,
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#9a9a86',
  position INTEGER NOT NULL,
  perms INTEGER NOT NULL DEFAULT 0,
  draw_all_squads INTEGER NOT NULL DEFAULT 0,
  is_everyone INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_clan_roles_clan ON clan_roles(clan_id, position);
CREATE TABLE clan_squads (
  id INTEGER PRIMARY KEY,
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_clan_squads_clan ON clan_squads(clan_id);
CREATE TABLE clan_role_squads (
  role_id INTEGER NOT NULL REFERENCES clan_roles(id) ON DELETE CASCADE,
  squad_id INTEGER NOT NULL REFERENCES clan_squads(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, squad_id)
);
CREATE TABLE clan_member_roles (
  user_id INTEGER NOT NULL REFERENCES clan_members(user_id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES clan_roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
CREATE TABLE clan_squad_members (
  squad_id INTEGER NOT NULL REFERENCES clan_squads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES clan_members(user_id) ON DELETE CASCADE,
  PRIMARY KEY (squad_id, user_id)
);
CREATE INDEX idx_clan_squad_members_user ON clan_squad_members(user_id);
CREATE TABLE clan_invites (
  id INTEGER PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_clan_invites_clan ON clan_invites(clan_id);
CREATE TABLE clan_invitations (
  id INTEGER PRIMARY KEY,
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (clan_id, user_id)
);
CREATE INDEX idx_clan_invitations_user ON clan_invitations(user_id);
`,
  },
  {
    // Tactics: plans per clan and map, drawings per plan (stage 2 of clans and tactics).
    // `version` grows on every change so pollers can use ETag/304. The partial unique index keeps
    // one active plan per clan and map.
    version: 7,
    sql: `
CREATE TABLE tactic_plans (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  clan_id INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_tactic_plans_clan ON tactic_plans(clan_id, map_id);
CREATE UNIQUE INDEX idx_tactic_plans_active ON tactic_plans(clan_id, map_id) WHERE is_active = 1;
CREATE TABLE tactic_items (
  id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES tactic_plans(id) ON DELETE CASCADE,
  squad_id INTEGER REFERENCES clan_squads(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('pencil', 'arrow', 'zone', 'marker', 'text')),
  geometry TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 2 CHECK (width BETWEEN 1 AND 3),
  icon TEXT,
  label TEXT,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tactic_items_plan ON tactic_items(plan_id);
CREATE INDEX idx_tactic_items_squad ON tactic_items(squad_id);
`,
  },
];

function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function openDb(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

module.exports = { openDb, migrate, SCHEMA, MIGRATIONS };
