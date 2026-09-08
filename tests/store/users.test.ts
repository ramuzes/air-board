// tests/store/users.test.ts
import { describe, it, expect } from 'bun:test'
import { openDb } from '../../src/store/db.js'
import { createUser, verifyToken, createToken, revokeToken, listTokens } from '../../src/store/users.js'

describe('users & tokens store', () => {
  it('creates a user and round-trips a token', () => {
    const db = openDb(':memory:')
    const u = createUser(db, { username: 'alice', displayName: 'Alice' })
    expect(u.username).toBe('alice')
    const { token } = createToken(db, u.id, 'cli')
    expect(token).toMatch(/^abt_[0-9a-f]{32}$/)
    expect(verifyToken(db, token)?.id).toBe(u.id)
    expect(verifyToken(db, 'abt_deadbeef')).toBeNull()
  })
  it('rejects duplicate username', () => {
    const db = openDb(':memory:')
    createUser(db, { username: 'bob', displayName: 'Bob' })
    expect(() => createUser(db, { username: 'bob', displayName: 'Bob' })).toThrowError(/exists/)
  })
  it('revoked tokens no longer verify', () => {
    const db = openDb(':memory:')
    const u = createUser(db, { username: 'carol', displayName: 'Carol' })
    const t = createToken(db, u.id, 'x')
    expect(revokeToken(db, t.id)).toBe(true)
    expect(verifyToken(db, t.token)).toBeNull()
    expect(listTokens(db, u.id)[0].revoked_at).not.toBeNull()
  })
})
