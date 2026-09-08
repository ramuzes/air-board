// src/domain/ids.ts
export const KINDS = ['ADR', 'PRD', 'SPEC', 'PLAN', 'ISSUE'] as const
export type Kind = typeof KINDS[number]
const ID_RE = /^(ADR|PRD|SPEC|PLAN|ISSUE)-(\d+)$/
export function formatId(kind: Kind, number: number): string {
  return kind + '-' + number
}
export function parseId(s: string): { kind: Kind; number: number } | null {
  const m = ID_RE.exec(s)
  if (!m) return null
  return { kind: m[1] as Kind, number: Number(m[2]) }
}
