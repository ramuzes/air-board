// tests/bootstrap.test.ts
import { describe, it, expect } from 'bun:test'
import { openDb } from '../src/store/db.js'
import { bootstrapIfEmpty } from '../src/bootstrap.js'
import { verifyToken } from '../src/store/users.js'

describe('bootstrapIfEmpty', () => {
  it('creates admin + token on empty db, once', () => {
    const db = openDb(':memory:')
    const first = bootstrapIfEmpty(db)
    expect(first?.token).toMatch(/^abt_[0-9a-f]{32}$/)
    expect(verifyToken(db, first!.token)?.username).toBe('admin')
    expect(bootstrapIfEmpty(db)).toBeNull()
  })
})
