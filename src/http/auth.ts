// src/http/auth.ts
import type { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify'
import type { DB } from '../store/db.js'
import { verifyToken, tokenScopeByValue, type UserRow, type TokenScope } from '../store/users.js'
import { httpError } from './errors.js'

declare module 'fastify' {
  interface FastifyRequest { user: UserRow; scope: TokenScope }
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireGlobal: (req: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return null
  return h.slice(7)
}

function rawToken(req: FastifyRequest): string | null {
  const bearer = bearerToken(req)
  if (bearer) return bearer
  const cookie = req.headers.cookie
  if (!cookie) return null
  const m = /(?:^|;\s*)ab_token=([^;]+)/.exec(cookie)
  return m ? m[1] : null
}

export function makeRequireAuth(db: DB) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = bearerToken(req)
    const user = token ? verifyToken(db, token) : null
    if (!user) throw httpError(401, 'UNAUTHORIZED', 'missing or invalid bearer token')
    req.user = user
    req.scope = tokenScopeByValue(db, token!) ?? { tokenId: 0, isGlobal: true, projectIds: [] }
  }
}

export function makeRequireGlobal() {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.scope.isGlobal) throw httpError(403, 'FORBIDDEN', 'this endpoint requires a global token')
  }
}

export function canAccessProject(scope: TokenScope, projectId: number): boolean {
  return scope.isGlobal || scope.projectIds.includes(projectId)
}

/** Web-session variant: resolves from cookie or bearer, returns user + scope or null. */
export function webSession(db: DB, req: FastifyRequest): { user: UserRow; scope: TokenScope } | null {
  const token = rawToken(req)
  if (!token) return null
  const user = verifyToken(db, token)
  if (!user) return null
  return { user, scope: tokenScopeByValue(db, token) ?? { tokenId: 0, isGlobal: true, projectIds: [] } }
}

/** Backwards-compatible helper (used by older call sites). */
export function webUser(db: DB, req: FastifyRequest): UserRow | null {
  return webSession(db, req)?.user ?? null
}
