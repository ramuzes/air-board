// src/store/db.ts
import { Database } from 'bun:sqlite'
export type DB = Database
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  is_global INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS token_projects (
  token_id INTEGER NOT NULL REFERENCES tokens(id),
  project_id INTEGER NOT NULL REFERENCES projects(id),
  UNIQUE (token_id, project_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gitlab_repo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, number)
);
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  rev INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (resource_id, rev)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  dedup_key TEXT UNIQUE,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commit_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  repo_url TEXT NOT NULL,
  sha TEXT NOT NULL,
  commit_message_ref TEXT NOT NULL,
  pushed_at TEXT,
  webhook_event_id INTEGER REFERENCES webhook_events(id),
  UNIQUE (resource_id, repo_url, sha)
);
CREATE VIRTUAL TABLE IF NOT EXISTS resource_fts USING fts5(title, content, resource_row_id UNINDEXED);
CREATE TRIGGER IF NOT EXISTS revisions_fts_ins AFTER INSERT ON revisions BEGIN
  DELETE FROM resource_fts WHERE resource_row_id = NEW.resource_id;
  INSERT INTO resource_fts(resource_row_id, title, content) VALUES (NEW.resource_id, NEW.title, NEW.content_markdown);
END;
`
export function openDb(path: string): DB {
  const db = new Database(path)
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")
  db.exec(SCHEMA)
  // Migration for databases created before token scoping: the tokens table there
  // lacks is_global. Pre-existing tokens become global so nothing breaks.
  const cols = db.prepare("PRAGMA table_info(tokens)").all() as any[]
  if (!cols.some((c) => c.name === 'is_global')) {
    db.exec('ALTER TABLE tokens ADD COLUMN is_global INTEGER NOT NULL DEFAULT 1')
  }
  return db
}
