// src/domain/refs.ts
const REF_RE = /\b(?:ADR|PRD|SPEC|PLAN|ISSUE)-\d+\b/g
export function parseRefs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(REF_RE)) if (!out.includes(m[0])) out.push(m[0])
  return out
}
