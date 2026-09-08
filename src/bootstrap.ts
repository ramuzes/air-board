// src/bootstrap.ts
import type { DB } from './store/db.js'
import { countUsers, createUser, createToken } from './store/users.js'
export function bootstrapIfEmpty(db: DB): { token: string } | null {
  if (countUsers(db) > 0) return null
  const admin = createUser(db, { username: 'admin', displayName: 'Administrator' })
  return { token: createToken(db, admin.id, 'bootstrap').token }
}
