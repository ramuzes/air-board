// src/http/routes/users.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { createUser, listUsers, createToken, revokeToken, listTokens, bindTokenToProjects } from '../../store/users.js'
import { listProjects } from '../../store/projects.js'
import { httpError } from '../errors.js'

function projectIdsForKeys(db: DB, keys: string[]): number[] {
  const all = listProjects(db)
  const ids: number[] = []
  for (const k of keys) {
    const p = all.find((x) => x.key === k)
    if (!p) throw httpError(422, 'UNKNOWN_PROJECT', "project '" + k + "' does not exist")
    ids.push(p.id)
  }
  return ids
}

export function registerUserRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/users', { preHandler: [app.requireAuth, app.requireGlobal] }, async () => listUsers(db))

  app.post('/api/users', {
    preHandler: [app.requireAuth, app.requireGlobal],
    schema: { body: { type: 'object', required: ['username'], properties: { username: { type: 'string', minLength: 1 }, display_name: { type: 'string' } } } }
  }, async (req, reply) => {
    const b = req.body as any
    const u = createUser(db, { username: b.username, displayName: b.display_name ?? b.username })
    reply.code(201)
    return u
  })

  app.post('/api/users/:id/tokens', {
    preHandler: [app.requireAuth, app.requireGlobal],
    schema: { body: { type: 'object', properties: {
      label: { type: 'string' },
      global: { type: 'boolean' },
      project_keys: { type: 'array', items: { type: 'string' } } } } }
  }, async (req, reply) => {
    const { id } = req.params as any
    const b = (req.body ?? {}) as any
    // Access control: a token is either global or bound to explicit projects (default: none).
    const isGlobal = b.global === true
    const projectIds = isGlobal ? [] : projectIdsForKeys(db, b.project_keys ?? [])
    const t = createToken(db, Number(id), b.label ?? '', undefined, isGlobal, projectIds)
    reply.code(201)
    return t
  })

  app.put('/api/tokens/:id/projects', {
    preHandler: [app.requireAuth, app.requireGlobal],
    schema: { body: { type: 'object', required: ['project_keys'], properties: { project_keys: { type: 'array', items: { type: 'string' } } } } }
  }, async (req) => {
    const { id } = req.params as any
    bindTokenToProjects(db, Number(id), projectIdsForKeys(db, (req.body as any).project_keys))
    return { ok: true }
  })

  app.delete('/api/tokens/:id', { preHandler: [app.requireAuth, app.requireGlobal] }, async (req, reply) => {
    const { id } = req.params as any
    if (!revokeToken(db, Number(id))) throw httpError(404, 'NOT_FOUND', 'token not found or already revoked')
    reply.code(204)
  })

  app.get('/api/me/tokens', { preHandler: [app.requireAuth] }, async (req) => listTokens(db, req.user.id))
}
