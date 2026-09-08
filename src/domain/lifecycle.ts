// src/domain/lifecycle.ts
export type Status = 'draft' | 'active' | 'done' | 'cancelled'
const ALLOWED: Record<Status, Status[]> = {
  draft: ['active', 'cancelled'],
  active: ['done', 'cancelled'],
  done: [],
  cancelled: []
}
export function canTransition(from: Status, to: Status): boolean {
  return (ALLOWED[from] ?? []).includes(to)
}
