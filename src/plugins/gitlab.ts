// src/plugins/gitlab.ts
import type { FastifyRequest } from 'fastify'
import type { Config } from '../config.js'
import type { DB } from '../store/db.js'
import type { ConnectorPlugin } from './types.js'
import { parseRefs } from '../domain/refs.js'
import { parseId } from '../domain/ids.js'
import { addBinding } from '../store/bindings.js'
import { httpError } from '../http/errors.js'

type Headers = Record<string, string | string[] | undefined>

function headerValue(headers: Headers | undefined, name: string): string | null {
  const v = headers?.[name]
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s.length > 0 ? s : null
}

export function handleGitlabPush(db: DB, payload: any, headers?: Headers): { bound: number; duplicates: number; deduplicated: boolean } {
  return db.transaction(() => {
    // Real GitLab sends the event UUID only in headers (X-Gitlab-Event-UUID; also webhook-id / Idempotency-Key).
    // The body field is kept as a backward-compatible fallback.
    const dedupKey: string | null =
      headerValue(headers, 'x-gitlab-event-uuid')
      ?? headerValue(headers, 'webhook-id')
      ?? headerValue(headers, 'idempotency-key')
      ?? (typeof payload.event_uuid === 'string' && payload.event_uuid.length > 0 ? payload.event_uuid : null)
    let eventId: number | null = null
    if (dedupKey) {
      const existing = db.prepare('SELECT id FROM webhook_events WHERE dedup_key = ?').get(dedupKey) as any
      if (existing) return { bound: 0, duplicates: 1, deduplicated: true }
      const info = db.prepare('INSERT INTO webhook_events (source, dedup_key, payload) VALUES (?, ?, ?)').run('gitlab', dedupKey, JSON.stringify(payload))
      eventId = Number(info.lastInsertRowid)
    }
    const repoUrl: string | undefined = payload.project?.git_http_url ?? payload.project?.web_url
    const project = repoUrl ? (db.prepare('SELECT * FROM projects WHERE gitlab_repo_url = ?').get(repoUrl) as any) : null
    if (!project) return { bound: 0, duplicates: 0, deduplicated: false }
    let bound = 0, duplicates = 0
    for (const c of (payload.commits ?? []) as any[]) {
      const sha = String(c.id ?? '')
      const pushedAt = c.timestamp ?? null
      for (const ref of parseRefs(String(c.message ?? ''))) {
        const parsed = parseId(ref)
        if (!parsed) continue
        const r = db.prepare('SELECT * FROM resources WHERE project_id = ? AND kind = ? AND number = ?')
          .get(project.id, parsed.kind, parsed.number) as any
        if (!r) continue
        const res = addBinding(db, { projectId: project.id, resourceRowId: r.id, repoUrl: repoUrl!, sha, ref, pushedAt, webhookEventId: eventId })
        if (res.duplicate) duplicates++
        else bound++
      }
    }
    return { bound, duplicates, deduplicated: duplicates > 0 }
  })()
}

export function createGitlabPlugin(config: Config): ConnectorPlugin {
  return {
    id: 'gitlab',
    displayName: 'GitLab',
    webhookPath: '/api/plugins/gitlab/webhook',
    verifyWebhook(req: FastifyRequest): void {
      if (!config.gitlabWebhookSecret) throw httpError(503, 'NOT_CONFIGURED', 'GITLAB_WEBHOOK_SECRET is not configured')
      if (req.headers['x-gitlab-token'] !== config.gitlabWebhookSecret) throw httpError(401, 'WEBHOOK_SECRET', 'invalid X-Gitlab-Token')
    },
    handleWebhook(db: DB, payload: any, headers?: Headers) {
      return handleGitlabPush(db, payload, headers)
    },
    commitUrl(repoUrl: string, sha: string): string {
      return repoUrl.replace(/\.git$/, '') + '/-/commit/' + sha
    }
  }
}
