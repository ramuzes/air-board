// src/http/routes/agents.ts
import type { FastifyInstance } from 'fastify'
import type { Config } from '../../config.js'
import { createHash } from 'node:crypto'

// Bump (date.sequence) whenever the content of these instructions changes.
const CONTRACT_VERSION = '2026-09-27.1'

const PROFILES: Record<string, string> = {
  authoring: 'resource CRUD, lifecycle, revisions, ID allocation, commit refs',
  discovery: 'search syntax, filters, field projection, read semantics',
  ops: 'health, tokens, projects, the contract itself'
}

const USAGE: Record<string, string[]> = {
  authoring: [
    'POST {base}/api/projects/{key}/resources {kind,title,markdown} -> 201, allocated id, draft',
    'PATCH .../resources/{id} {title?|content_markdown?|status?}: content appends revision; bad transition 422',
    'KIND-N in commit messages -> webhook binds the commit'
  ],
  discovery: [
    'GET {base}/api/search?q= -> slim hits {id,kind,project_key,title,status,snippet,score}; &fields=full adds content_markdown',
    'single-resource GET .../resources/{id} returns full content_markdown; unknown query params ignored',
    'syntax: terms, "phrases", OR, prefix*; -/_ = space; substring incl. CJK; <3 chars = scan; invalid -> 400',
    'filters: kind, status, project_key, limit, offset'
  ],
  ops: [
    'GET {base}/api/health -> ok (no auth)',
    'Authorization: Bearer abt_...; mint POST /api/users/{id}/tokens; revoke DELETE /api/tokens/{id}',
    'GET /api/projects (token-visible); POST creates (global token)',
    '/openapi.json full contract; this endpoint is unauthenticated'
  ]
}

export function agentInstructions(baseUrl: string) {
  return {
    service: 'airboard',
    base_url: baseUrl,
    contract_version: CONTRACT_VERSION,
    profile: null as string | null,
    profiles: { ...PROFILES },
    auth: {
      scheme: 'bearer', header: 'Authorization', token_prefix: 'abt_',
      how_to_get: ['POST /api/users/{id}/tokens (a sponsoring user)'],
      scope: 'global or project-scoped ({global:false,project_keys:[KEY]}); scoped: 403 outside bound projects, no admin; rebind: PUT /api/tokens/{id}/projects'
    },
    resource_kinds: ['ADR', 'PRD', 'SPEC', 'PLAN', 'ISSUE'],
    id_format: 'KIND-number (ADR-42); server-allocated at creation, monotonic per project+kind, never reused',
    lifecycle: {
      states: ['draft', 'active', 'done', 'cancelled'],
      transitions: { draft: ['active', 'cancelled'], active: ['done', 'cancelled'], done: [], cancelled: [] },
      note: 'PATCH {status} to transition; cancelled is soft-retained'
    },
    conventions: {
      create: 'POST /api/projects/{key}/resources {kind,title,markdown} -> 201, draft',
      read: 'GET .../resources/{id} full content_markdown (slim is search-only); unknown query params ignored; /revisions/{rev} for history',
      update: 'PATCH .../resources/{id} {title?,content_markdown?,status?}: content appends revision',
      commit_refs: 'KIND-N in commit messages -> webhook binds commits',
      search: 'GET /api/search?q=<query>&kind=&status=&project_key=&limit=&offset=&fields= — full-text search across all projects (trigram FTS5 over title+latest content: substring matching works for CJK and latin, e.g. 龙虎 finds 龙虎榜). Syntax in q: bare terms (implicit AND), "quoted phrases" (adjacency), term OR term, prefix* — hyphens/underscores are treated as spaces. Queries of 1-2 characters fall back to plain substring scan. Invalid syntax returns 400 INVALID_QUERY. Default response is slim: {id, kind, project_key, title, status, snippet, score} ordered by relevance (lower score = better); ?fields=full adds content_markdown and other fields. Same ?q= works on the project resource list'
    },
    endpoints: {
      health: '/api/health', users: '/api/users', tokens: '/api/users/{id}/tokens',
      projects: '/api/projects', resources: '/api/projects/{key}/resources', search: '/api/search?q=',
      revisions: '/api/projects/{key}/resources/{id}/revisions',
      bindings: '/api/projects/{key}/resources/{id}/bindings',
      webhook: '/api/plugins/gitlab/webhook', plugins: '/api/plugins', openapi: '/openapi.json', agents_md: '/AGENTS.md', instructions: '/api/agents/instructions'
    },
    openapi_url: '/openapi.json',
    agents_md_url: '/AGENTS.md'
  }
}

export function agentsMd(): string {
  return [
    '# AirBoard Agent Guide',
    '',
    "AirBoard is the team's project tracker. You manage ADRs, PRDs, SPECs, PLANs, and ISSUEs through its HTTP API.",
    '',
    '## Setup',
    '1. Base URL: the host serving this file (e.g. http://localhost:3000).',
    '2. Auth: every /api call needs a personal access token: header \`Authorization: Bearer abt_...\`.',
    '   Ask your sponsoring user to mint one (\`POST /api/users/{id}/tokens\`) or use the web UI token page.',
    '3. Machine-readable contract: \`GET /openapi.json\`. Full instructions JSON: \`GET /api/agents/instructions\`.',
    '',
    '## Core workflow',
    '- Create: \`POST /api/projects/{key}/resources\` with \`{ "kind": "ADR", "title": "...", "markdown": "..." }\` — the response contains the allocated id (e.g. \`ADR-42\`) in \`draft\`.',
    '- Read: \`GET /api/projects/{key}/resources/{id}\`; history via \`/revisions\` and \`/revisions/{rev}\`.',
    '- Update: \`PATCH /api/projects/{key}/resources/{id}\` — content/title changes append a revision; \`status\` transitions lifecycle (draft->active->done, or ->cancelled).',
    '- Cancel unneeded work: \`PATCH\` with \`{ "status": "cancelled" }\`. Cancelled resources are kept for history.',
    '- Commits: reference ids in commit messages (\`fix ADR-42\`); the GitLab webhook records the binding automatically.',
    '- Search: \`GET /api/search?q=terms\` full-text search across all projects (trigram FTS5 over titles and latest content — substring matching works for CJK and latin). Query syntax: bare terms (AND), \"quoted phrases\", \`term OR term\`, \`prefix*\`; hyphens/underscores = spaces; 1-2 char queries use substring scan; bad syntax = 400. Filters: kind, status, project_key, limit/offset. Slim hits {id, kind, project_key, title, status, snippet, score} by relevance; \`&fields=full\` adds content.',
    '',
    '## Rules',
    '- IDs are allocated by the server only; never invent one.',
    '- Tokens are global or project-scoped; if you get 403 FORBIDDEN, your token is not bound to that project — ask for a rebinding.',
    '- Revision history is append-only; revert by posting old content forward.',
    '- Write clear titles and markdown bodies — humans read these too.',
    ''
  ].join('\n')
}

/** Project the full document onto a behavior-group subset (same source, section selection). */
export function projectInstructions(full: ReturnType<typeof agentInstructions>, profile: string): Record<string, unknown> {
  const common = {
    service: full.service, base_url: full.base_url, contract_version: full.contract_version,
    profile, profiles: full.profiles, openapi_url: full.openapi_url, agents_md_url: full.agents_md_url,
    auth: full.auth
  }
  const c = full.conventions as any
  const e = full.endpoints as any
  if (profile === 'authoring') {
    return {
      ...common,
      resource_kinds: full.resource_kinds, id_format: full.id_format, lifecycle: full.lifecycle,
      conventions: { create: c.create, read: c.read, update: c.update, commit_refs: c.commit_refs },
      endpoints: { resources: e.resources, revisions: e.revisions, bindings: e.bindings, webhook: e.webhook },
      usage: USAGE.authoring
    }
  }
  if (profile === 'discovery') {
    return {
      ...common,
      resource_kinds: full.resource_kinds,
      conventions: { read: c.read, search: c.search },
      endpoints: { resources: e.resources, search: e.search, revisions: e.revisions },
      usage: USAGE.discovery
    }
  }
  return {
    ...common,
    endpoints: {
      health: e.health, users: e.users, tokens: e.tokens, projects: e.projects,
      plugins: e.plugins, agents_md: e.agents_md, instructions: e.instructions, openapi: e.openapi
    },
    usage: USAGE.ops
  }
}

export function registerAgentRoutes(app: FastifyInstance, config: Config) {
  app.get('/api/agents/instructions', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          profile: { type: 'string', description: 'behavior group: authoring | discovery | ops — unknown values fall back to full document' }
        }
      }
    }
  }, async (req, reply) => {
    const p = String((req.query as any).profile ?? '')
    const doc = PROFILES[p] ? projectInstructions(agentInstructions(config.baseUrl), p) : agentInstructions(config.baseUrl)
    const body = JSON.stringify(doc)
    const etag = '"' + createHash('sha256').update(body).digest('hex').slice(0, 32) + '"'
    reply.header('etag', etag)
    if (req.headers['if-none-match'] === etag) {
      reply.code(304)
      return null
    }
    reply.header('content-type', 'application/json; charset=utf-8')
    return body
  })
  app.get('/AGENTS.md', async (_req, reply) => {
    reply.header('content-type', 'text/markdown; charset=utf-8')
    return agentsMd()
  })
}
