// src/store/resources.ts
import type { DB } from './db.js'
import { httpError } from '../http/errors.js'
import { formatId, parseId, type Kind } from '../domain/ids.js'
import { canTransition, type Status } from '../domain/lifecycle.js'

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

function resourceFilterSql(db: DB, f: { projectId: number; kind?: string; status?: string; q?: string }): { where: string; params: any[] } {
  let where = 'r.project_id = ?'
  const params: any[] = [f.projectId]
  if (f.kind) { where += ' AND r.kind = ?'; params.push(f.kind) }
  if (f.status) { where += ' AND r.status = ?'; params.push(f.status) }
  else { where += " AND r.status != 'cancelled'" }
  if (f.q) {
    const rids = searchFts(db, f.q).map((h) => h.rid)
    if (rids.length === 0) return { where: '1 = 0', params: [] }
    where += ' AND r.id IN (' + rids.map((n) => Number(n)).join(',') + ')'
  }
  return { where, params }
}

export function listResources(db: DB, f: { projectId: number; kind?: string; status?: string; q?: string; order?: 'kind' | 'created_desc'; limit?: number; offset?: number }): ResourceView[] {
  const { where, params } = resourceFilterSql(db, f)
  let sql = 'SELECT r.id AS rid FROM resources r WHERE ' + where
  if (f.order === 'created_desc') sql += ' ORDER BY r.id DESC'
  else sql += ' ORDER BY r.kind, r.number'
  if (f.limit !== undefined) { sql += ' LIMIT ?'; params.push(f.limit) }
  if (f.offset !== undefined) { sql += ' OFFSET ?'; params.push(f.offset) }
  return (db.prepare(sql).all(...params) as any[]).map((r) => viewByRowId(db, r.rid))
}

export function countResources(db: DB, f: { projectId: number; kind?: string; status?: string; q?: string }): number {
  const { where, params } = resourceFilterSql(db, f)
  return (db.prepare('SELECT COUNT(*) AS c FROM resources r WHERE ' + where).get(...params) as any).c
}

export function updateResource(db: DB, input: { projectId: number; publicId: string; patch: { title?: string; content_markdown?: string; status?: string }; userId: number }): ResourceView {
  return db.transaction(() => {
    const found = getResourceInternal(db, input.projectId, input.publicId)
    if (!found) throw httpError(404, 'NOT_FOUND', 'resource ' + input.publicId + ' not found')
    const hasContent = input.patch.title !== undefined || input.patch.content_markdown !== undefined
    if (input.patch.status !== undefined && !canTransition(found.row.status as Status, input.patch.status as Status)) {
      throw httpError(422, 'INVALID_TRANSITION', 'cannot transition ' + found.row.status + ' -> ' + input.patch.status)
    }
    if (hasContent) {
      const newTitle = input.patch.title ?? found.latest.title
      const newContent = input.patch.content_markdown ?? found.latest.content_markdown
      db.prepare('INSERT INTO revisions (resource_id, rev, title, content_markdown, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(found.row.id, found.latest.rev + 1, newTitle, newContent, input.userId)
    }
    if (input.patch.status !== undefined) {
      db.prepare('UPDATE resources SET status = ? WHERE id = ?').run(input.patch.status, found.row.id)
    }
    if (hasContent || input.patch.status !== undefined) {
      db.prepare("UPDATE resources SET updated_at = datetime('now') WHERE id = ?").run(found.row.id)
    }
    return getResourceInternal(db, input.projectId, input.publicId)!.view
  })()
}

export function listRevisions(db: DB, resourceId: number) {
  return db.prepare('SELECT rev, title, created_by, created_at FROM revisions WHERE resource_id = ? ORDER BY rev').all(resourceId)
}
export function getRevision(db: DB, resourceId: number, rev: number) {
  return (db.prepare('SELECT rev, title, content_markdown, created_by, created_at FROM revisions WHERE resource_id = ? AND rev = ?').get(resourceId, rev) as any) ?? null
}

export interface SearchHit {
  rid: number; score: number; snippet: string
}

/** Normalize -/_ to spaces outside quoted phrases so paper-trade ≡ paper trade. */
export function normalizeQuery(q: string): string {
  return q.split('"').map((seg, i) => (i % 2 === 1 ? seg : seg.replace(/[-_]+/g, ' '))).join('"')
}

export function searchFts(db: DB, rawQ: string): SearchHit[] {
  const q = normalizeQuery(rawQ.trim())
  // Trigram indexes need >= 3 chars; shorter queries (CJK pairs, 2-letter terms)
  // deliberately use substring matching instead.
  const bare = q.replace(/"/g, '').replace(/\b(AND|OR|NOT)\b/g, ' ').replace(/[*]/g, '').trim()
  if (bare.length > 0 && bare.length < 3) {
    const like = '%' + bare + '%'
    const rows = db.prepare('SELECT resource_row_id AS rid, title, content FROM resource_fts WHERE title LIKE ? OR content LIKE ?').all(like, like) as any[]
    return rows.map((r) => ({ rid: r.rid, score: 0, snippet: likeSnippet(String(r.title) + ' — ' + String(r.content), bare) }))
  }
  try {
    const rows = db.prepare(
      "SELECT resource_row_id AS rid, bm25(resource_fts) AS score, snippet(resource_fts, 1, '[', ']', '…', 16) AS snippet FROM resource_fts WHERE resource_fts MATCH ? ORDER BY score"
    ).all(q) as any[]
    return rows.map((r) => ({ rid: r.rid, score: r.score, snippet: r.snippet }))
  } catch (e: any) {
    throw httpError(400, 'INVALID_QUERY', 'invalid search syntax: ' + (e.message ?? String(e)) + ' — supported: terms, single-quoted-style "phrases" via double quotes, term OR term, prefix*')
  }
}

function likeSnippet(text: string, needle: string): string {
  const i = text.toLowerCase().indexOf(needle.toLowerCase())
  if (i < 0) return text.slice(0, 60)
  const start = Math.max(0, i - 24)
  return (start > 0 ? '…' : '') + text.slice(start, i + needle.length + 24)
}

export function searchAll(db: DB, q: string): Array<ResourceView & { project_id: number; score: number; snippet: string }> {
  return searchFts(db, q).map((h) => ({ ...viewByRowId(db, h.rid), project_id: h.rid ? (db.prepare('SELECT project_id AS pid FROM resources WHERE id = ?').get(h.rid) as any).pid : 0, score: h.score, snippet: h.snippet }))
}
