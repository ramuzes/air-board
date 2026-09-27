// src/http/routes/projects.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { createProject, listProjects, getProjectByKey, updateProject } from '../../store/projects.js'
import { httpError } from '../errors.js'
import { canAccessProject } from '../auth.js'

export function registerProjectRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/projects', { preHandler: [app.requireAuth] }, async (req) =>
    listProjects(db).filter((p) => canAccessProject(req.scope, p.id)))

  app.post('/api/projects', {
    preHandler: [app.requireAuth, app.requireGlobal],
    schema: { body: { type: 'object', required: ['key', 'name'], properties: { key: { type: 'string' }, name: { type: 'string' }, gitlab_repo_url: { type: ['string', 'null'] } } } }
  }, async (req, reply) => {
    const b = req.body as any
    reply.code(201)
    return createProject(db, { key: b.key, name: b.name, gitlabRepoUrl: b.gitlab_repo_url })
  })

  app.get('/api/projects/:key', { preHandler: [app.requireAuth] }, async (req) => {
    const p = getProjectByKey(db, (req.params as any).key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    if (!canAccessProject(req.scope, p.id)) throw httpError(403, 'FORBIDDEN', 'token not bound to this project')
    return p
  })

  app.patch('/api/projects/:key', {
    preHandler: [app.requireAuth, app.requireGlobal],
    schema: { body: { type: 'object', properties: { name: { type: 'string' }, gitlab_repo_url: { type: ['string', 'null'] } } } }
  }, async (req) => updateProject(db, (req.params as any).key, req.body as any))
}
