// tests/domain/domain.test.ts
import { describe, it, expect } from 'bun:test'
import { canTransition } from '../../src/domain/lifecycle.js'
import { formatId, parseId, KINDS } from '../../src/domain/ids.js'
import { parseRefs } from '../../src/domain/refs.js'

describe('lifecycle', () => {
  it('allows draft->active, active->done, draft/active->cancelled', () => {
    expect(canTransition('draft', 'active')).toBe(true)
    expect(canTransition('active', 'done')).toBe(true)
    expect(canTransition('draft', 'cancelled')).toBe(true)
    expect(canTransition('active', 'cancelled')).toBe(true)
  })
  it('rejects everything else', () => {
    expect(canTransition('done', 'active')).toBe(false)
    expect(canTransition('cancelled', 'draft')).toBe(false)
    expect(canTransition('done', 'cancelled')).toBe(false)
    expect(canTransition('draft', 'done')).toBe(false)
    expect(canTransition('active', 'draft')).toBe(false)
  })
})

describe('ids', () => {
  it('formats and parses round-trip for all kinds', () => {
    for (const k of KINDS) expect(parseId(formatId(k, 42))).toEqual({ kind: k, number: 42 })
  })
  it('rejects junk', () => {
    expect(parseId('adr-1')).toBeNull()
    expect(parseId('ADR-x')).toBeNull()
    expect(parseId('FOO-1')).toBeNull()
    expect(parseId('ADR-1-2')).toBeNull()
  })
})

describe('parseRefs', () => {
  it('extracts unique refs in order of first appearance', () => {
    expect(parseRefs('fix ADR-42 and ISSUE-3, refs ADR-42 again')).toEqual(['ADR-42', 'ISSUE-3'])
  })
  it('finds all five kinds', () => {
    expect(parseRefs('a PRD-1 b SPEC-2 c PLAN-3 d ADR-4 e ISSUE-5')).toEqual(['PRD-1','SPEC-2','PLAN-3','ADR-4','ISSUE-5'])
  })
  it('returns empty for no refs', () => {
    expect(parseRefs('no refs here')).toEqual([])
  })
})
