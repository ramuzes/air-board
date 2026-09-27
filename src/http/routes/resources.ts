// src/http/routes/resources.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { getProjectByKey } from '../../store/projects.js'
import { createResource, listResources, getResourceInternal, listRevisions, getRevision, searchAll, updateResource } from '../../store/resources.js'
import { addBinding, listBindings } from '../../store/bindings.js'
import { httpError } from '../errors.js'
import { canAccessProject } from '../auth.js'
import { commitUrlFor } from '../../plugins/registry.js'
import type { FastifyRequest } from 'fastify'

export function projectOr404(db: DB, key: string, req?: FastifyRequest) {
  const p = getProjectByKey(db, key)
  if (!p) throw httpError(404, 'NOT_FOUND', 'project ' + key + ' not found')
  if (req && !canAccessProject(req.scope, p.id)) throw httpError(403, 'FORBIDDEN', 'token not bound to this project')
  return p
}

export function registerResourceRoutes(app: FastifyInstance, db: DB) {
  app.post('/api/projects/:key/resources', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', required: ['kind', 'title', 'markdown'], properties: {
      kind: { type: 'string', enum: ['ADR', 'PRD', 'SPEC', 'PLAN', 'ISSUE'] },
      title: { type: 'string', minLength: 1 }, markdown: { type: 'string' } } } }
  }, async (req, reply) => {
    const { key } = req.params as any
    const p = projectOr404(db, key, req)
    const b = req.body as any
    reply.code(201)
    return createResource(db, { projectId: p.id, kind: b.kind, title: b.title, contentMarkdown: b.markdown, userId: req.user.id })
  })

  app.get('/api/projects/:key/resources', { preHandler: [app.requireAuth] }, async (req) => {
    const { key } = req.params as any
    const p = projectOr404(db, key, req)
    const q = req.query as any
    return listResources(db, { projectId: p.id, kind: q.kind, status: q.status, q: q.q })
  })

  app.patch('/api/projects/:key/resources/:id', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', properties: {
      title: { type: 'string', minLength: 1 }, content_markdown: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'active', 'done', 'cancelled'] } } } }
  }, async (req) => {
    const { key, id } = req.params as any
    const p = projectOr404(db, key, req)
    return updateResource(db, { projectId: p.id, publicId: id, patch: req.body as any, userId: (req as any).user.id })
  })

  app.get('/api/search', { preHandler: [app.requireAuth] }, async (req) => {
    const q = (req.query as any).q
    if (!q) return []
    const hits = searchAll(db, String(q))
    if (req.scope.isGlobal) return hits
    const allowed = new Set(req.scope.projectIds)
    return hits.filter((r: any) => {
      const pid = (db.prepare('SELECT project_id AS pid FROM resources WHERE kind = ? AND number = ?').get(r.kind, r.number) as any)?.pid
      return pid !== undefined && allowed.has(pid)
    })
  })

  app.get('/api/projects/:key/resources/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const { key, id } = req.params as any
    const p = projectOr404(db, key, req)
    const r = getResourceInternal(db, p.id, id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
    return r.view
  })

  app.get('/api/projects/:key/resources/:id/revisions', { preHandler: [app.requireAuth] }, async (req) => {
    const { key, id } = req.params as any
    const p = projectOr404(db, key, req)
    const r = getResourceInternal(db, p.id, id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
    return listRevisions(db, r.row.id)
  })

  app.post('/api/projects/:key/resources/:id/bindings', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', required: ['repo_url', 'sha'], properties: { repo_url: { type: 'string' }, sha: { type: 'string', minLength: 6 } } } }
  }, async (req, reply) => {
    const { key, id } = req.params as any
    const p = projectOr404(db, key, req)
    const r = getResourceInternal(db, p.id, id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
    const b = req.body as any
    const result = addBinding(db, { projectId: p.id, resourceRowId: r.row.id, repoUrl: b.repo_url, sha: b.sha, ref: id, pushedAt: null })
    reply.code(result.duplicate ? 200 : 201)
    return result
  })

  app.get('/api/projects/:key/resources/:id/bindings', { preHandler: [app.requireAuth] }, async (req) => {
    const { key, id } = req.params as any
    const p = projectOr404(db, key, req)
    const r = getResourceInternal(db, p.id, id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
    return listBindings(db, r.row.id).map((b) => ({ ...b, commit_url: commitUrlFor(b.repo_url, b.sha) }))
  })

  app.get('/api/projects/:key/resources/:id/revisions/:rev', { preHandler: [app.requireAuth] }, async (req) => {
    const { key, id, rev } = req.params as any
    const p = projectOr404(db, key, req)
    const r = getResourceInternal(db, p.id, id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
    const v = getRevision(db, r.row.id, Number(rev))
    if (!v) throw httpError(404, 'NOT_FOUND', 'revision ' + rev + ' not found')
    return v
  })
}
