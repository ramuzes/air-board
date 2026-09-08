// src/store/resources.ts
import type { DB } from './db.js'
import { httpError } from '../http/errors.js'
import { formatId, parseId, type Kind } from '../domain/ids.js'

export interface ResourceView {
  id: string; kind: string; number: number; project_key: string; title: string; status: string
  content_markdown: string; rev: number; created_by: number; created_at: string; updated_at: string
}

export function createResource(db: DB, input: { projectId: number; kind: Kind; title: string; contentMarkdown: string; userId: number }): ResourceView {
  return db.transaction(() => {
    const next = (db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM resources WHERE project_id = ? AND kind = ?').get(input.projectId, input.kind) as any).n
    const info = db.prepare('INSERT INTO resources (project_id, kind, number, title, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(input.projectId, input.kind, next, input.title, input.userId)
    const rid = Number(info.lastInsertRowid)
    db.prepare('INSERT INTO revisions (resource_id, rev, title, content_markdown, created_by) VALUES (?, 1, ?, ?, ?)')
      .run(rid, input.title, input.contentMarkdown, input.userId)
    return viewByRowId(db, rid)
  })()
}

export function getResourceInternal(db: DB, projectId: number, publicId: string): { row: any; latest: any; view: ResourceView } | null {
  const parsed = parseId(publicId)
  if (!parsed) return null
  const row = db.prepare('SELECT * FROM resources WHERE project_id = ? AND kind = ? AND number = ?').get(projectId, parsed.kind, parsed.number) as any
  if (!row) return null
  const latest = db.prepare('SELECT * FROM revisions WHERE resource_id = ? ORDER BY rev DESC LIMIT 1').get(row.id) as any
  return { row, latest, view: viewByRowId(db, row.id) }
}

function viewByRowId(db: DB, rowId: number): ResourceView {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(rowId) as any
  const latest = db.prepare('SELECT * FROM revisions WHERE resource_id = ? ORDER BY rev DESC LIMIT 1').get(rowId) as any
  const project_key = (db.prepare('SELECT key FROM projects WHERE id = ?').get(row.project_id) as any).key
  return {
    id: formatId(row.kind, row.number), kind: row.kind, number: row.number, project_key,
    title: latest.title, status: row.status, content_markdown: latest.content_markdown,
    rev: latest.rev, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at
  }
}

export function listResources(db: DB, f: { projectId: number; kind?: string; status?: string; q?: string }): ResourceView[] {
  let sql = 'SELECT r.id AS rid FROM resources r WHERE r.project_id = ?'
  const params: any[] = [f.projectId]
  if (f.kind) { sql += ' AND r.kind = ?'; params.push(f.kind) }
  if (f.status) { sql += ' AND r.status = ?'; params.push(f.status) }
  else { sql += " AND r.status != 'cancelled'" }
  if (f.q) {
    const rids = searchFts(db, f.q)
    if (rids.length === 0) return []
    sql += ' AND r.id IN (' + rids.map((n) => Number(n)).join(',') + ')'
  }
  sql += ' ORDER BY r.kind, r.number'
  return (db.prepare(sql).all(...params) as any[]).map((r) => viewByRowId(db, r.rid))
}

export function updateResourceContent(db: DB, projectId: number, publicId: string, patch: { title?: string; content_markdown?: string }, userId: number): ResourceView {
  return db.transaction(() => {
    const r = getResourceInternal(db, projectId, publicId)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + publicId + ' not found')
    const title = patch.title !== undefined ? patch.title : r.latest.title
    const content = patch.content_markdown !== undefined ? patch.content_markdown : r.latest.content_markdown
    db.prepare('INSERT INTO revisions (resource_id, rev, title, content_markdown, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(r.row.id, r.latest.rev + 1, title, content, userId)
    db.prepare("UPDATE resources SET updated_at = datetime('now') WHERE id = ?").run(r.row.id)
    return viewByRowId(db, r.row.id)
  })()
}

export function listRevisions(db: DB, resourceId: number) {
  return db.prepare('SELECT rev, title, created_by, created_at FROM revisions WHERE resource_id = ? ORDER BY rev').all(resourceId)
}
export function getRevision(db: DB, resourceId: number, rev: number) {
  return (db.prepare('SELECT rev, title, content_markdown, created_by, created_at FROM revisions WHERE resource_id = ? AND rev = ?').get(resourceId, rev) as any) ?? null
}

export function searchFts(db: DB, q: string): number[] {
  try {
    return (db.prepare('SELECT resource_row_id AS rid FROM resource_fts WHERE resource_fts MATCH ?').all(q) as any[]).map((r) => r.rid)
  } catch {
    // invalid FTS5 query syntax (unbalanced quotes, bare operators) -> substring fallback
    return (db.prepare('SELECT resource_row_id AS rid FROM resource_fts WHERE title LIKE ? OR content LIKE ?').all('%' + q + '%', '%' + q + '%') as any[]).map((r) => r.rid)
  }
}
export function searchAll(db: DB, q: string): ResourceView[] {
  return searchFts(db, q).map((rid) => viewByRowId(db, rid))
}
