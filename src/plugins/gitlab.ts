// src/plugins/gitlab.ts
import type { FastifyRequest } from 'fastify'
import type { Config } from '../config.js'
import type { DB } from '../store/db.js'
import type { ConnectorPlugin } from './types.js'
import { parseRefs } from '../domain/refs.js'
import { parseId } from '../domain/ids.js'
import { addBinding } from '../store/bindings.js'
import { httpError } from '../http/errors.js'

export function handleGitlabPush(db: DB, payload: any): { bound: number; duplicates: number } {
  return db.transaction(() => {
    const dedupKey: string | null = payload.event_uuid ?? null
    let eventId: number | null = null
    if (dedupKey) {
      const existing = db.prepare('SELECT id FROM webhook_events WHERE dedup_key = ?').get(dedupKey) as any
      if (existing) return { bound: 0, duplicates: 1 }
      const info = db.prepare('INSERT INTO webhook_events (source, dedup_key, payload) VALUES (?, ?, ?)').run('gitlab', dedupKey, JSON.stringify(payload))
      eventId = Number(info.lastInsertRowid)
    }
    const repoUrl: string | undefined = payload.project?.git_http_url ?? payload.project?.web_url
    const project = repoUrl ? (db.prepare('SELECT * FROM projects WHERE gitlab_repo_url = ?').get(repoUrl) as any) : null
    if (!project) return { bound: 0, duplicates: 0 }
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
    return { bound, duplicates }
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
    handleWebhook(db: DB, payload: any) {
      return handleGitlabPush(db, payload)
    },
    commitUrl(repoUrl: string, sha: string): string {
      return repoUrl.replace(/\.git$/, '') + '/-/commit/' + sha
    }
  }
}
