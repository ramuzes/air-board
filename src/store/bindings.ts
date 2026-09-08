// src/store/bindings.ts
import type { DB } from './db.js'

export interface BindingView { id: number; repo_url: string; sha: string; commit_message_ref: string; pushed_at: string | null }

export function addBinding(db: DB, input: { projectId: number; resourceRowId: number; repoUrl: string; sha: string; ref: string; pushedAt?: string | null; webhookEventId?: number | null }): { id: number; duplicate: boolean } {
  const existing = db.prepare('SELECT id FROM commit_bindings WHERE resource_id = ? AND repo_url = ? AND sha = ?')
    .get(input.resourceRowId, input.repoUrl, input.sha) as any
  if (existing) return { id: existing.id, duplicate: true }
  const info = db.prepare('INSERT INTO commit_bindings (project_id, resource_id, repo_url, sha, commit_message_ref, pushed_at, webhook_event_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(input.projectId, input.resourceRowId, input.repoUrl, input.sha, input.ref, input.pushedAt ?? null, input.webhookEventId ?? null)
  return { id: Number(info.lastInsertRowid), duplicate: false }
}

export function listBindings(db: DB, resourceRowId: number): BindingView[] {
  return db.prepare('SELECT id, repo_url, sha, commit_message_ref, pushed_at FROM commit_bindings WHERE resource_id = ? ORDER BY id').all(resourceRowId) as BindingView[]
}
