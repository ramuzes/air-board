import { describe, it, expect } from 'bun:test'
import { openDb } from '../src/store/db.js'
import { bootstrapIfEmpty } from '../src/bootstrap.js'
import { verifyToken } from '../src/store/users.js'

describe('bootstrapIfEmpty with provided token', () => {
  it('uses the provided token, marks it not generated, and never creates another', () => {
    const db = openDb(':memory:')
    const provided = 'abt_fixed00000000000000000000000000'
    const boot = bootstrapIfEmpty(db, provided)
    expect(boot).not.toBeNull()
    expect(boot!.token).toBe(provided)
    expect(boot!.generated).toBe(false)
    expect(verifyToken(db, provided)?.username).toBe('admin')
  })
  it('generates and marks generated when nothing provided (or empty string)', () => {
    const db = openDb(':memory:')
    const boot = bootstrapIfEmpty(db)
    expect(boot?.token).toMatch(/^abt_[0-9a-f]{32}$/)
    expect(boot?.generated).toBe(true)
    const db2 = openDb(':memory:')
    expect(bootstrapIfEmpty(db2, '')?.generated).toBe(true)
  })
  it('still bootstraps only once', () => {
    const db = openDb(':memory:')
    bootstrapIfEmpty(db, 'abt_fixed00000000000000000000000000')
    expect(bootstrapIfEmpty(db, 'abt_other0000000000000000000000000')).toBeNull()
  })
})
