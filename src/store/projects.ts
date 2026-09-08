// src/store/projects.ts
import type { DB } from './db.js'
import { httpError } from '../http/errors.js'

export interface ProjectRow { id: number; key: string; name: string; gitlab_repo_url: string | null; created_at: string }
const KEY_RE = /^[A-Z][A-Z0-9-]{1,9}$/

export function createProject(db: DB, input: { key: string; name: string; gitlabRepoUrl?: string | null }): ProjectRow {
  if (!KEY_RE.test(input.key)) throw httpError(400, 'BAD_KEY', 'project key must match ^[A-Z][A-Z0-9-]{1,9}$')
  try {
    const info = db.prepare('INSERT INTO projects (key, name, gitlab_repo_url) VALUES (?, ?, ?)').run(input.key, input.name, input.gitlabRepoUrl ?? null)
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid) as ProjectRow
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) throw httpError(409, 'CONFLICT', "project key '" + input.key + "' already exists")
    throw e
  }
}
export function listProjects(db: DB): ProjectRow[] { return db.prepare('SELECT * FROM projects ORDER BY id').all() as ProjectRow[] }
export function getProjectByKey(db: DB, key: string): ProjectRow | null {
  return (db.prepare('SELECT * FROM projects WHERE key = ?').get(key) as ProjectRow) ?? null
}
export function updateProject(db: DB, key: string, patch: { name?: string; gitlab_repo_url?: string | null }): ProjectRow {
  const p = getProjectByKey(db, key)
  if (!p) throw httpError(404, 'NOT_FOUND', 'project ' + key + ' not found')
  const name = patch.name ?? p.name
  const repo = patch.gitlab_repo_url !== undefined ? patch.gitlab_repo_url : p.gitlab_repo_url
  db.prepare('UPDATE projects SET name = ?, gitlab_repo_url = ? WHERE id = ?').run(name, repo, p.id)
  return getProjectByKey(db, key)!
}
