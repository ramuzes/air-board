// src/http/routes/agents.ts
import type { FastifyInstance } from 'fastify'
import type { Config } from '../../config.js'

export function agentInstructions(baseUrl: string) {
  return {
    service: 'airboard',
    base_url: baseUrl,
    auth: {
      scheme: 'bearer', header: 'Authorization', token_prefix: 'abt_',
      how_to_get: ['Ask your sponsoring user to mint a token: POST /api/users/{id}/tokens', 'Or use the web UI token page at /tokens'],
      scope: 'Tokens are either global or bound to specific projects. Scoped tokens: body { label, global: false, project_keys: ["KEY"] }; they get 403 FORBIDDEN on unbound projects, see only bound projects in GET /api/projects and /api/search, and cannot manage users/tokens/projects (global-only). Rebind with PUT /api/tokens/{id}/projects body { project_keys }'
    },
    resource_kinds: ['ADR', 'PRD', 'SPEC', 'PLAN', 'ISSUE'],
    id_format: 'KIND-number (e.g. ADR-42); allocated by AirBoard at creation, monotonic per project+kind, gaps possible, never reused',
    lifecycle: {
      states: ['draft', 'active', 'done', 'cancelled'],
      transitions: { draft: ['active', 'cancelled'], active: ['done', 'cancelled'], done: [], cancelled: [] },
      note: 'PATCH { status } to transition; cancelled is soft-retained for history'
    },
    conventions: {
      create: 'POST /api/projects/{key}/resources  body: { kind, title, markdown } -> returns resource in draft with its id',
      read: 'GET /api/projects/{key}/resources/{id} (latest) or /revisions/{rev} (any revision)',
      update: 'PATCH /api/projects/{key}/resources/{id} body: { title?, content_markdown?, status? } - content change appends a revision',
      commit_refs: 'write KIND-number tokens in git commit messages; pushes via GitLab webhook bind commits automatically',
      search: 'GET /api/search?q=<terms> for full-text search across all projects (FTS5 over title+content); or ?q= on the project resource list'
    },
    endpoints: {
      health: '/api/health', users: '/api/users', tokens: '/api/users/{id}/tokens',
      projects: '/api/projects', resources: '/api/projects/{key}/resources', search: '/api/search?q=',
      revisions: '/api/projects/{key}/resources/{id}/revisions',
      bindings: '/api/projects/{key}/resources/{id}/bindings',
      webhook: '/api/plugins/gitlab/webhook', plugins: '/api/plugins', openapi: '/openapi.json', agents_md: '/AGENTS.md'
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
    '- Search: \`GET /api/search?q=terms\` full-text search across all projects (FTS5 over titles and latest content).',
    '',
    '## Rules',
    '- IDs are allocated by the server only; never invent one.',
    '- Tokens are global or project-scoped; if you get 403 FORBIDDEN, your token is not bound to that project — ask for a rebinding.',
    '- Revision history is append-only; revert by posting old content forward.',
    '- Write clear titles and markdown bodies — humans read these too.',
    ''
  ].join('\n')
}

export function registerAgentRoutes(app: FastifyInstance, config: Config) {
  app.get('/api/agents/instructions', async () => agentInstructions(config.baseUrl))
  app.get('/AGENTS.md', async (_req, reply) => {
    reply.header('content-type', 'text/markdown; charset=utf-8')
    return agentsMd()
  })
}
