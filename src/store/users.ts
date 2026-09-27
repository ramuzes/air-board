// src/store/users.ts
import { createHash, randomBytes } from 'node:crypto'
import type { DB } from './db.js'
import { httpError } from '../http/errors.js'

export interface UserRow { id: number; username: string; display_name: string; created_at: string }
export function hashToken(t: string): string { return createHash('sha256').update(t).digest('hex') }
export function newTokenString(): string { return 'abt_' + randomBytes(16).toString('hex') }

export function createUser(db: DB, input: { username: string; displayName: string }): UserRow {
  try {
    const info = db.prepare('INSERT INTO users (username, display_name) VALUES (?, ?)').run(input.username, input.displayName)
    return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) throw httpError(409, 'CONFLICT', "username '" + input.username + "' already exists")
    throw e
  }
}
export function getUser(db: DB, id: number): UserRow | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow) ?? null
}
export function listUsers(db: DB): UserRow[] {
  return db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]
}
export function countUsers(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c
}
export interface TokenScope { tokenId: number; isGlobal: boolean; projectIds: number[] }
export function createToken(db: DB, userId: number, label: string, tokenValue?: string, isGlobal = true, projectIds: number[] = []): { token: string; id: number } {
  const token = tokenValue ?? newTokenString()
  const info = db.prepare('INSERT INTO tokens (user_id, token_hash, label, is_global) VALUES (?, ?, ?, ?)').run(userId, hashToken(token), label, isGlobal ? 1 : 0)
  const id = Number(info.lastInsertRowid)
  bindTokenToProjects(db, id, projectIds)
  return { token, id }
}
export function bindTokenToProjects(db: DB, tokenId: number, projectIds: number[]): void {
  db.prepare('DELETE FROM token_projects WHERE token_id = ?').run(tokenId)
  const ins = db.prepare('INSERT OR IGNORE INTO token_projects (token_id, project_id) VALUES (?, ?)')
  for (const pid of projectIds) ins.run(tokenId, pid)
}
export function verifyToken(db: DB, token: string): UserRow | null {
  const row = db.prepare(
    'SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.revoked_at IS NULL'
  ).get(hashToken(token)) as UserRow | undefined
  return row ?? null
}
export function tokenScopeByValue(db: DB, token: string): TokenScope | null {
  const row = db.prepare('SELECT id FROM tokens WHERE token_hash = ? AND revoked_at IS NULL').get(hashToken(token)) as any
  if (!row) return null
  return tokenScopeById(db, row.id)
}
export function tokenScopeById(db: DB, tokenId: number): TokenScope {
  const t = db.prepare('SELECT is_global FROM tokens WHERE id = ?').get(tokenId) as any
  const projectIds = (db.prepare('SELECT project_id FROM token_projects WHERE token_id = ?').all(tokenId) as any[]).map((r) => r.project_id)
  return { tokenId, isGlobal: Boolean(t?.is_global), projectIds }
}
export function revokeToken(db: DB, tokenId: number): boolean {
  return db.prepare("UPDATE tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(tokenId).changes > 0
}
export function listTokens(db: DB, userId: number): Array<{ id: number; label: string; created_at: string; revoked_at: string | null; is_global: number; project_keys: string[] }> {
  const rows = db.prepare('SELECT id, label, created_at, revoked_at, is_global FROM tokens WHERE user_id = ? ORDER BY id').all(userId) as any[]
  return rows.map((r) => ({
    ...r,
    project_keys: (db.prepare('SELECT p.key FROM token_projects tp JOIN projects p ON p.id = tp.project_id WHERE tp.token_id = ? ORDER BY p.key').all(r.id) as any[]).map((x) => x.key)
  }))
}
