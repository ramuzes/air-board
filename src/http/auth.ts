// src/http/auth.ts
import type { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify'
import type { DB } from '../store/db.js'
import { verifyToken, type UserRow } from '../store/users.js'
import { httpError } from './errors.js'

declare module 'fastify' {
  interface FastifyRequest { user: UserRow }
  interface FastifyInstance { requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void> }
}

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return null
  return h.slice(7)
}

export function makeRequireAuth(db: DB) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = bearerToken(req)
    const user = token ? verifyToken(db, token) : null
    if (!user) throw httpError(401, 'UNAUTHORIZED', 'missing or invalid bearer token')
    req.user = user
  }
}

export function webUser(db: DB, req: FastifyRequest): UserRow | null {
  const bearer = bearerToken(req)
  if (bearer) return verifyToken(db, bearer)
  const cookie = req.headers.cookie
  if (!cookie) return null
  const m = /(?:^|;\s*)ab_token=([^;]+)/.exec(cookie)
  return m ? verifyToken(db, m[1]) : null
}
