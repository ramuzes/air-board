// src/bootstrap.ts
import type { DB } from './store/db.js'
import { countUsers, createUser, createToken } from './store/users.js'

export function bootstrapIfEmpty(db: DB, providedToken?: string): { token: string; generated: boolean } | null {
  if (countUsers(db) > 0) return null
  const admin = createUser(db, { username: 'admin', displayName: 'Administrator' })
  const provided = providedToken && providedToken.length > 0 ? providedToken : undefined
  const { token } = createToken(db, admin.id, 'bootstrap', provided)
  return { token, generated: provided === undefined }
}
