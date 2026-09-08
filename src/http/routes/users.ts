// src/http/routes/users.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { createUser, listUsers, createToken, revokeToken, listTokens } from '../../store/users.js'
import { httpError } from '../errors.js'

export function registerUserRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/users', { preHandler: [app.requireAuth] }, async () => listUsers(db))

  app.post('/api/users', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', required: ['username'], properties: { username: { type: 'string', minLength: 1 }, display_name: { type: 'string' } } } }
  }, async (req, reply) => {
    const b = req.body as any
    const u = createUser(db, { username: b.username, displayName: b.display_name ?? b.username })
    reply.code(201)
    return u
  })

  app.post('/api/users/:id/tokens', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', properties: { label: { type: 'string' } } } }
  }, async (req, reply) => {
    const { id } = req.params as any
    const t = createToken(db, Number(id), (req.body as any)?.label ?? '')
    reply.code(201)
    return t
  })

  app.delete('/api/tokens/:id', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as any
    if (!revokeToken(db, Number(id))) throw httpError(404, 'NOT_FOUND', 'token not found or already revoked')
    reply.code(204)
  })

  app.get('/api/me/tokens', { preHandler: [app.requireAuth] }, async (req) => listTokens(db, req.user.id))
}
