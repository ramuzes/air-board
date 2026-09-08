# AirBoard Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the AirBoard v1 service — CRUD for ADR/PRD/SPEC/PLAN/ISSUE resources with monotonic IDs, revision history, token auth, GitLab webhook commit binding, agent instructions, and a light web UI.

**Architecture:** Modular monolith per ADR 0001: pure `domain/` logic, transactional better-sqlite3 `store/`, Fastify `http/` API, server-rendered `web/` pages in the same process. One SQLite file is the system of record.

**Tech Stack:** TypeScript (ESM, Node 20+), Fastify 4, better-sqlite3, @fastify/swagger, @fastify/cookie, vitest.

## Global Constraints

- Node >= 20, TypeScript strict mode, ESM modules (`"type": "module"`).
- Runtime deps allowed: `fastify`, `better-sqlite3`, `@fastify/swagger`, `@fastify/cookie`. Dev deps: `typescript`, `vitest`, `tsx`, `@types/node`, `@types/better-sqlite3`. Nothing else without demonstrated need.
- All API routes mount under `/api`; web UI at `/`. Spec: `docs/specs/2026-09-08-airboard-foundation-design.md` — follow it verbatim where cited.
- Error envelope everywhere in `/api`: `{ error: { code, message, details? } }`; 404 unknown IDs; 422 invalid transitions/schemas; 401 bad/missing token.
- Token format `abt_` + 32 hex chars; store only SHA-256 hash; shown once.
- Lifecycle: `draft | active | done | cancelled`; kinds: `ADR | PRD | SPEC | PLAN | ISSUE`.
- Env: `GITLAB_WEBHOOK_SECRET` (checked against `X-Gitlab-Token`), `DB_PATH` (default `./airboard.db`), `PORT` (default 3000), `BASE_URL` (default `http://localhost:3000`).
- Commit commands run from repo root. Conventional commit style (`feat:`, `test:`, `chore:`).
- Test command: `npx vitest run`.

---

### Task 1: Scaffold + app skeleton + healthcheck

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/config.ts`, `src/http/app.ts`, `src/http/errors.ts`, `tests/api/health.test.ts`, `.gitignore`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `buildApp(opts: { config: Config }): Promise<FastifyInstance>` (async from the start — swagger registration in Task 10 requires it) in `src/http/app.ts`; `interface Config { dbPath: string; port: number; baseUrl: string; gitlabWebhookSecret: string }` and `loadConfig(env): Config` in `src/config.ts`; `httpError(status, code, message, details?): Error & { status; code; details? }` in `src/http/errors.ts`; app-wide error-envelope handler + /api-scoped 404 handler.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/health.test.ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../../src/http/app.js'

const OPTS = { config: { dbPath: ':memory:', port: 3000, baseUrl: 'http://x', gitlabWebhookSecret: 's' } }

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const app = await buildApp(OPTS)
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('uses the error envelope for unknown routes under /api', async () => {
    const app = await buildApp(OPTS)
    const res = await app.inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route GET:/api/nope not found' } })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/health.test.ts`
Expected: FAIL — cannot resolve `../../src/http/app.js`.

- [ ] **Step 3: Write scaffold and implementation**

```json
// package.json
{
  "name": "airboard",
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@fastify/cookie": "^9.3.1",
    "@fastify/swagger": "^8.14.0",
    "better-sqlite3": "^11.3.0",
    "fastify": "^4.28.1"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^20.14.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
    "strict": true, "outDir": "dist", "declaration": false, "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "tests"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['tests/**/*.test.ts'] } })
```

```
# .gitignore
node_modules/
dist/
airboard.db
*.db
```

```ts
// src/config.ts
export interface Config {
  dbPath: string; port: number; baseUrl: string; gitlabWebhookSecret: string
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dbPath: env.DB_PATH ?? './airboard.db',
    port: Number(env.PORT ?? 3000),
    baseUrl: env.BASE_URL ?? 'http://localhost:3000',
    gitlabWebhookSecret: env.GITLAB_WEBHOOK_SECRET ?? ''
  }
}
```

```ts
// src/http/errors.ts
export function httpError(status: number, code: string, message: string, details?: unknown) {
  return Object.assign(new Error(message), { status, code, details }) as Error & { status: number; code: string; details?: unknown }
}
```

```ts
// src/http/app.ts
import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { Config } from '../config.js'
import type { DB } from '../store/db.js'

export interface BuildOpts { config: Config; db?: DB }

export async function buildApp(opts: BuildOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cookie)
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url === '/openapi.json' || req.url === '/AGENTS.md') {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route ' + req.method + ':' + req.url + ' not found' } })
    } else {
      reply.status(404).send('Not found')
    }
  })
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as any).status ?? 500
    const code = (err as any).code ?? 'INTERNAL'
    const envelope: any = { error: { code, message: err.message } }
    if ((err as any).details !== undefined) envelope.error.details = (err as any).details
    reply.status(status).send(envelope)
  })
  app.get('/api/health', async () => ({ status: 'ok' }))
  return app
}
```

Note: `db` is optional in Task 1; Task 3+ makes it required. Then run `npm install`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/health.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: scaffold AirBoard app skeleton with healthcheck and error envelope"
```
---

### Task 2: Domain module — lifecycle, IDs, commit-message refs

**Files:**
- Create: `src/domain/lifecycle.ts`, `src/domain/ids.ts`, `src/domain/refs.ts`
- Test: `tests/domain/domain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Status = 'draft'|'active'|'done'|'cancelled'`; `canTransition(from: Status, to: Status): boolean`; `const KINDS: readonly ['ADR','PRD','SPEC','PLAN','ISSUE']`; `type Kind = typeof KINDS[number]`; `formatId(kind: Kind, number: number): string`; `parseId(s: string): { kind: Kind; number: number } | null`; `parseRefs(text: string): string[]` (unique, order of first appearance).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/domain/domain.test.ts
import { describe, it, expect } from 'vitest'
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/domain/domain.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
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
```

```ts
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
```

```ts
// src/domain/refs.ts
const REF_RE = /\b(?:ADR|PRD|SPEC|PLAN|ISSUE)-\d+\b/g
export function parseRefs(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(REF_RE)) if (!out.includes(m[0])) out.push(m[0])
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/domain/domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: domain module - lifecycle, id parsing, commit-message refs"
```

---

### Task 3: Store foundation — schema, users, tokens

**Files:**
- Create: `src/store/db.ts`, `src/store/users.ts`
- Test: `tests/store/users.test.ts`

**Interfaces:**
- Consumes: better-sqlite3, `httpError` from Task 1.
- Produces: `openDb(path: string): DB` (creates all tables idempotently — including resources/revisions/webhook_events/commit_bindings used by later tasks); `type DB = Database.Database`; `type UserRow = { id: number; username: string; display_name: string; created_at: string }`; `createUser(db, { username, displayName }): UserRow` (409 CONFLICT on duplicate); `getUser(db, id)`; `listUsers(db)`; `countUsers(db): number`; `createToken(db, userId, label): { token: string; id: number }`; `verifyToken(db, token): UserRow | null` (revoked → null); `revokeToken(db, tokenId): boolean`; `listTokens(db, userId)`; `hashToken(t): string` (sha256 hex); `newTokenString(): string`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/store/users.test.ts
import { describe, it, expect } from 'vitest'
import { openDb } from '../../src/store/db.js'
import { createUser, verifyToken, createToken, revokeToken, listTokens } from '../../src/store/users.js'

describe('users & tokens store', () => {
  it('creates a user and round-trips a token', () => {
    const db = openDb(':memory:')
    const u = createUser(db, { username: 'alice', displayName: 'Alice' })
    expect(u.username).toBe('alice')
    const { token } = createToken(db, u.id, 'cli')
    expect(token).toMatch(/^abt_[0-9a-f]{32}$/)
    expect(verifyToken(db, token)?.id).toBe(u.id)
    expect(verifyToken(db, 'abt_deadbeef')).toBeNull()
  })
  it('rejects duplicate username', () => {
    const db = openDb(':memory:')
    createUser(db, { username: 'bob', displayName: 'Bob' })
    expect(() => createUser(db, { username: 'bob', displayName: 'Bob' })).toThrowError(/exists/)
  })
  it('revoked tokens no longer verify', () => {
    const db = openDb(':memory:')
    const u = createUser(db, { username: 'carol', displayName: 'Carol' })
    const t = createToken(db, u.id, 'x')
    expect(revokeToken(db, t.id)).toBe(true)
    expect(verifyToken(db, t.token)).toBeNull()
    expect(listTokens(db, u.id)[0].revoked_at).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/store/users.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

```ts
// src/store/db.ts
import Database from 'better-sqlite3'
export type DB = Database.Database
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  gitlab_repo_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS resources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  kind TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, kind, number)
);
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  rev INTEGER NOT NULL,
  title TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (resource_id, rev)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  dedup_key TEXT UNIQUE,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS commit_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  resource_id INTEGER NOT NULL REFERENCES resources(id),
  repo_url TEXT NOT NULL,
  sha TEXT NOT NULL,
  commit_message_ref TEXT NOT NULL,
  pushed_at TEXT,
  webhook_event_id INTEGER REFERENCES webhook_events(id),
  UNIQUE (resource_id, repo_url, sha)
);
`
export function openDb(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA)
  return db
}
```

```ts
// src/store/users.ts
import { createHash, randomBytes } from 'node:crypto'
import type { DB } from './db.js'
import { httpError } from '../http/errors.js'

export interface UserRow { id: number; username: string; display_name: string; created_at: string }
export function hashToken(t: string): string { return createHash('sha256').update(t).digest('hex') }
export function newTokenString(): string { return 'abt_' + randomBytes(16).toString('hex') }

export function createUser(db: DB, input: { username: string; displayName: string }): UserRow {
  try {
    const info = db.prepare('INSERT INTO users (username, display_name) VALUES (?, ?)').run(input.username, input.displayName)
    return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRow
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) throw httpError(409, 'CONFLICT', "username '" + input.username + "' already exists")
    throw e
  }
}
export function getUser(db: DB, id: number): UserRow | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow) ?? null
}
export function listUsers(db: DB): UserRow[] {
  return db.prepare('SELECT * FROM users ORDER BY id').all() as UserRow[]
}
export function countUsers(db: DB): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM users').get() as any).c
}
export function createToken(db: DB, userId: number, label: string): { token: string; id: number } {
  const token = newTokenString()
  const info = db.prepare('INSERT INTO tokens (user_id, token_hash, label) VALUES (?, ?, ?)').run(userId, hashToken(token), label)
  return { token, id: Number(info.lastInsertRowid) }
}
export function verifyToken(db: DB, token: string): UserRow | null {
  const row = db.prepare(
    'SELECT u.* FROM tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND t.revoked_at IS NULL'
  ).get(hashToken(token)) as UserRow | undefined
  return row ?? null
}
export function revokeToken(db: DB, tokenId: number): boolean {
  return db.prepare("UPDATE tokens SET revoked_at = datetime('now') WHERE id = ? AND revoked_at IS NULL").run(tokenId).changes > 0
}
export function listTokens(db: DB, userId: number): Array<{ id: number; label: string; created_at: string; revoked_at: string | null }> {
  return db.prepare('SELECT id, label, created_at, revoked_at FROM tokens WHERE user_id = ? ORDER BY id').all(userId) as any
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/store/users.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: sqlite schema and users/tokens store"
```

---

### Task 4: HTTP auth + users/tokens endpoints + bootstrap helper

**Files:**
- Create: `src/http/auth.ts`, `src/http/routes/users.ts`, `src/bootstrap.ts`, `tests/helpers.ts`, `tests/api/users.test.ts`
- Modify: `src/http/app.ts` — require `db`, register auth + user routes.

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces: `requireAuth` factory usable as `app.requireAuth` (Fastify decoration; sets `req.user`); `bearerToken(req): string | null`; `webUser(db, req): UserRow | null` (cookie `ab_token` first, then bearer — used by Task 11); `bootstrapIfEmpty(db): { token: string } | null` in `src/bootstrap.ts`; test helper `setup(): Promise<{ app; db; auth }>` where `auth = { authorization: string }` and config has `GITLAB_WEBHOOK_SECRET: 's'` (webhook tests in Task 9 rely on this).

- [ ] **Step 1: Write the failing test**

```ts
// tests/helpers.ts
import { buildApp } from '../src/http/app.js'
import { openDb, type DB } from '../src/store/db.js'
import { createUser, createToken } from '../src/store/users.js'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../src/config.js'

export async function setup(): Promise<{ app: FastifyInstance; db: DB; auth: { authorization: string } }> {
  const db = openDb(':memory:')
  const u = createUser(db, { username: 'tester', displayName: 'Tester' })
  const { token } = createToken(db, u.id, 'test')
  const app = await buildApp({ config: loadConfig({ GITLAB_WEBHOOK_SECRET: 's' }), db })
  return { app, db, auth: { authorization: 'Bearer ' + token } }
}
```

```ts
// tests/api/users.test.ts
import { describe, it, expect } from 'vitest'
import { setup } from '../helpers.js'

describe('users & tokens api', () => {
  it('rejects anonymous calls with 401 envelope', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/users' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })
  it('creates a user, mints and revokes a token', async () => {
    const { app, auth } = await setup()
    const create = await app.inject({ method: 'POST', url: '/api/users', headers: auth, payload: { username: 'dave', display_name: 'Dave' } })
    expect(create.statusCode).toBe(201)
    const userId = create.json().id
    const mint = await app.inject({ method: 'POST', url: '/api/users/' + userId + '/tokens', headers: auth, payload: { label: 'agent' } })
    expect(mint.statusCode).toBe(201)
    expect(mint.json().token).toMatch(/^abt_[0-9a-f]{32}$/)
    const tokenId = mint.json().id
    const list = await app.inject({ method: 'GET', url: '/api/users', headers: auth })
    expect(list.json().some((u: any) => u.username === 'dave')).toBe(true)
    const revoke = await app.inject({ method: 'DELETE', url: '/api/tokens/' + tokenId, headers: auth })
    expect(revoke.statusCode).toBe(204)
    const bad = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: 'Bearer ' + mint.json().token } })
    expect(bad.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/users.test.ts`
Expected: FAIL — routes not registered (404 envelope).

- [ ] **Step 3: Implement**

```ts
// src/http/auth.ts
import type { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify'
import type { DB } from '../store/db.js'
import { verifyToken, type UserRow } from '../store/users.js'
import { httpError } from './errors.js'

declare module 'fastify' {
  interface FastifyRequest { user: UserRow }
  interface FastifyInstance { requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void> }
}

export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h?.startsWith('Bearer ')) return null
  return h.slice(7)
}

export function makeRequireAuth(db: DB) {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const token = bearerToken(req)
    const user = token ? verifyToken(db, token) : null
    if (!user) throw httpError(401, 'UNAUTHORIZED', 'missing or invalid bearer token')
    req.user = user
  }
}

export function webUser(db: DB, req: FastifyRequest): UserRow | null {
  const bearer = bearerToken(req)
  if (bearer) return verifyToken(db, bearer)
  const cookie = req.headers.cookie
  if (!cookie) return null
  const m = /(?:^|;\s*)ab_token=([^;]+)/.exec(cookie)
  return m ? verifyToken(db, m[1]) : null
}
```

```ts
// src/http/routes/users.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { createUser, listUsers, createToken, revokeToken, listTokens } from '../../store/users.js'
import { httpError } from '../errors.js'

export function registerUserRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/users', { preHandler: [app.requireAuth] }, async () => listUsers(db))

  app.post('/api/users', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', required: ['username'], properties: { username: { type: 'string', minLength: 1 }, display_name: { type: 'string' } } } }
  }, async (req, reply) => {
    const b = req.body as any
    const u = createUser(db, { username: b.username, displayName: b.display_name ?? b.username })
    reply.code(201)
    return u
  })

  app.post('/api/users/:id/tokens', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', properties: { label: { type: 'string' } } } }
  }, async (req, reply) => {
    const { id } = req.params as any
    const t = createToken(db, Number(id), (req.body as any)?.label ?? '')
    reply.code(201)
    return t
  })

  app.delete('/api/tokens/:id', { preHandler: [app.requireAuth] }, async (req, reply) => {
    const { id } = req.params as any
    if (!revokeToken(db, Number(id))) throw httpError(404, 'NOT_FOUND', 'token not found or already revoked')
    reply.code(204)
  })

  app.get('/api/me/tokens', { preHandler: [app.requireAuth] }, async (req) => listTokens(db, req.user.id))
}
```

Modify `src/http/app.ts`: `db` becomes required (`db: DB`); after error handlers add:

```ts
import { makeRequireAuth } from './auth.js'
import { registerUserRoutes } from './routes/users.js'
// inside buildApp, before route registrations:
app.decorate('requireAuth', makeRequireAuth(opts.db))
registerUserRoutes(app, opts.db)
```

```ts
// src/bootstrap.ts
import type { DB } from './store/db.js'
import { countUsers, createUser, createToken } from './store/users.js'
export function bootstrapIfEmpty(db: DB): { token: string } | null {
  if (countUsers(db) > 0) return null
  const admin = createUser(db, { username: 'admin', displayName: 'Administrator' })
  return { token: createToken(db, admin.id, 'bootstrap').token }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/users.test.ts` then `npx vitest run`
Expected: PASS everywhere.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: bearer auth and users/tokens API with bootstrap helper"
```
---

### Task 5: Projects store + endpoints

**Files:**
- Create: `src/store/projects.ts`, `src/http/routes/projects.ts`, `tests/api/projects.test.ts`
- Modify: `src/http/app.ts` (register)

**Interfaces:**
- Consumes: Task 4 auth decoration.
- Produces: `type ProjectRow = { id: number; key: string; name: string; gitlab_repo_url: string | null; created_at: string }`; `createProject(db, { key, name, gitlabRepoUrl? })` (400 BAD_KEY on non-`^[A-Z][A-Z0-9-]{1,9}$`, 409 on duplicate); `listProjects(db)`; `getProjectByKey(db, key): ProjectRow | null`; `updateProject(db, key, { name?, gitlab_repo_url? })`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/projects.test.ts
import { describe, it, expect } from 'vitest'
import { setup } from '../helpers.js'

describe('projects api', () => {
  it('creates, lists, gets, and sets gitlab repo', async () => {
    const { app, auth } = await setup()
    const bad = await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'x', name: 'X' } })
    expect(bad.statusCode).toBe(400)
    const create = await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
    expect(create.statusCode).toBe(201)
    expect(create.json().key).toBe('CORE')
    const list = await app.inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(list.json()).toHaveLength(1)
    const get = await app.inject({ method: 'GET', url: '/api/projects/CORE', headers: auth })
    expect(get.json().name).toBe('Core')
    const patch = await app.inject({ method: 'PATCH', url: '/api/projects/CORE', headers: auth, payload: { gitlab_repo_url: 'https://gitlab.example.com/team/core.git' } })
    expect(patch.json().gitlab_repo_url).toBe('https://gitlab.example.com/team/core.git')
    const missing = await app.inject({ method: 'GET', url: '/api/projects/NOPE', headers: auth })
    expect(missing.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/projects.test.ts`
Expected: FAIL — routes not registered.

- [ ] **Step 3: Implement**

```ts
// src/store/projects.ts
import type { DB } from './db.js'
import { httpError } from '../http/errors.js'

export interface ProjectRow { id: number; key: string; name: string; gitlab_repo_url: string | null; created_at: string }
const KEY_RE = /^[A-Z][A-Z0-9-]{1,9}$/

export function createProject(db: DB, input: { key: string; name: string; gitlabRepoUrl?: string | null }): ProjectRow {
  if (!KEY_RE.test(input.key)) throw httpError(400, 'BAD_KEY', 'project key must match ^[A-Z][A-Z0-9-]{1,9}$')
  try {
    const info = db.prepare('INSERT INTO projects (key, name, gitlab_repo_url) VALUES (?, ?, ?)').run(input.key, input.name, input.gitlabRepoUrl ?? null)
    return db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid) as ProjectRow
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) throw httpError(409, 'CONFLICT', "project key '" + input.key + "' already exists")
    throw e
  }
}
export function listProjects(db: DB): ProjectRow[] { return db.prepare('SELECT * FROM projects ORDER BY id').all() as ProjectRow[] }
export function getProjectByKey(db: DB, key: string): ProjectRow | null {
  return (db.prepare('SELECT * FROM projects WHERE key = ?').get(key) as ProjectRow) ?? null
}
export function updateProject(db: DB, key: string, patch: { name?: string; gitlab_repo_url?: string | null }): ProjectRow {
  const p = getProjectByKey(db, key)
  if (!p) throw httpError(404, 'NOT_FOUND', 'project ' + key + ' not found')
  const name = patch.name ?? p.name
  const repo = patch.gitlab_repo_url !== undefined ? patch.gitlab_repo_url : p.gitlab_repo_url
  db.prepare('UPDATE projects SET name = ?, gitlab_repo_url = ? WHERE id = ?').run(name, repo, p.id)
  return getProjectByKey(db, key)!
}
```

```ts
// src/http/routes/projects.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { createProject, listProjects, getProjectByKey, updateProject } from '../../store/projects.js'
import { httpError } from '../errors.js'

export function registerProjectRoutes(app: FastifyInstance, db: DB) {
  app.get('/api/projects', { preHandler: [app.requireAuth] }, async () => listProjects(db))
  app.post('/api/projects', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', required: ['key', 'name'], properties: { key: { type: 'string' }, name: { type: 'string' }, gitlab_repo_url: { type: ['string', 'null'] } } } }
  }, async (req, reply) => {
    const b = req.body as any
    reply.code(201)
    return createProject(db, { key: b.key, name: b.name, gitlabRepoUrl: b.gitlab_repo_url })
  })
  app.get('/api/projects/:key', { preHandler: [app.requireAuth] }, async (req) => {
    const p = getProjectByKey(db, (req.params as any).key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    return p
  })
  app.patch('/api/projects/:key', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', properties: { name: { type: 'string' }, gitlab_repo_url: { type: ['string', 'null'] } } } }
  }, async (req) => updateProject(db, (req.params as any).key, req.body as any))
}
```

Register in `buildApp`: `registerProjectRoutes(app, opts.db)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/projects.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: projects store and API"
```

---

### Task 6: Resources — create with ID allocation, list, get, revisions read

**Files:**
- Create: `src/store/resources.ts`, `src/http/routes/resources.ts`, `tests/api/resources.test.ts`
- Modify: `src/http/app.ts` (register)

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `type ResourceView = { id: string; kind: string; number: number; project_key: string; title: string; status: string; content_markdown: string; rev: number; created_by: number; created_at: string; updated_at: string }`; `createResource(db, { projectId, kind, title, contentMarkdown, userId }): ResourceView` (allocation in one transaction); `listResources(db, { projectId, kind?, status?, q? }): ResourceView[]` (no status → excludes cancelled; `q` = LIKE over title+latest content); `getResourceInternal(db, projectId, publicId): { row: any; latest: any; view: ResourceView } | null` (used by Tasks 7–9); `listRevisions(db, resourceRowId)`; `getRevision(db, resourceRowId, rev)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/resources.test.ts
import { describe, it, expect } from 'vitest'
import { setup } from '../helpers.js'

async function mkProject(app: any, auth: any, key = 'CORE') {
  const r = await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key, name: key } })
  return r.json()
}

describe('resources api', () => {
  it('creates a resource with allocated id and revision 1', async () => {
    const { app, auth } = await setup()
    await mkProject(app, auth)
    const res = await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth,
      payload: { kind: 'ADR', title: 'Use SQLite', markdown: 'Because simple.' } })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toBe('ADR-1')
    expect(body.status).toBe('draft')
    expect(body.rev).toBe(1)
    expect(body.content_markdown).toBe('Because simple.')
  })
  it('allocates monotonic numbers per kind', async () => {
    const { app, auth } = await setup()
    await mkProject(app, auth)
    for (let i = 1; i <= 3; i++) {
      await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ISSUE', title: 't' + i, markdown: 'm' } })
    }
    const list = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources?kind=ISSUE', headers: auth })
    expect(list.json().map((r: any) => r.id)).toEqual(['ISSUE-1', 'ISSUE-2', 'ISSUE-3'])
  })
  it('gets a resource and its revisions; 404 for unknown id', async () => {
    const { app, auth } = await setup()
    await mkProject(app, auth)
    await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'SPEC', title: 'S', markdown: 'v1' } })
    const got = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/SPEC-1', headers: auth })
    expect(got.json().title).toBe('S')
    const revs = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/SPEC-1/revisions', headers: auth })
    expect(revs.json()).toHaveLength(1)
    const rev1 = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/SPEC-1/revisions/1', headers: auth })
    expect(rev1.json().content_markdown).toBe('v1')
    const nf = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/SPEC-99', headers: auth })
    expect(nf.statusCode).toBe(404)
  })
  it('rejects invalid kind with 400', async () => {
    const { app, auth } = await setup()
    await mkProject(app, auth)
    const res = await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'EPIC', title: 'x', markdown: 'm' } })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/resources.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement**

```ts
// src/store/resources.ts
import type { DB } from './db.js'
import { httpError } from '../http/errors.js'
import { formatId, parseId, type Kind } from '../domain/ids.js'

export interface ResourceView {
  id: string; kind: string; number: number; project_key: string; title: string; status: string
  content_markdown: string; rev: number; created_by: number; created_at: string; updated_at: string
}

export function createResource(db: DB, input: { projectId: number; kind: Kind; title: string; contentMarkdown: string; userId: number }): ResourceView {
  return db.transaction(() => {
    const next = (db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM resources WHERE project_id = ? AND kind = ?').get(input.projectId, input.kind) as any).n
    const info = db.prepare('INSERT INTO resources (project_id, kind, number, title, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(input.projectId, input.kind, next, input.title, input.userId)
    const rid = Number(info.lastInsertRowid)
    db.prepare('INSERT INTO revisions (resource_id, rev, title, content_markdown, created_by) VALUES (?, 1, ?, ?, ?)')
      .run(rid, input.title, input.contentMarkdown, input.userId)
    return viewByRowId(db, rid)
  })()
}

export function getResourceInternal(db: DB, projectId: number, publicId: string): { row: any; latest: any; view: ResourceView } | null {
  const parsed = parseId(publicId)
  if (!parsed) return null
  const row = db.prepare('SELECT * FROM resources WHERE project_id = ? AND kind = ? AND number = ?').get(projectId, parsed.kind, parsed.number) as any
  if (!row) return null
  const latest = db.prepare('SELECT * FROM revisions WHERE resource_id = ? ORDER BY rev DESC LIMIT 1').get(row.id) as any
  return { row, latest, view: viewByRowId(db, row.id) }
}

function viewByRowId(db: DB, rowId: number): ResourceView {
  const row = db.prepare('SELECT * FROM resources WHERE id = ?').get(rowId) as any
  const latest = db.prepare('SELECT * FROM revisions WHERE resource_id = ? ORDER BY rev DESC LIMIT 1').get(rowId) as any
  const project_key = (db.prepare('SELECT key FROM projects WHERE id = ?').get(row.project_id) as any).key
  return {
    id: formatId(row.kind, row.number), kind: row.kind, number: row.number, project_key,
    title: latest.title, status: row.status, content_markdown: latest.content_markdown,
    rev: latest.rev, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at
  }
}

export function listResources(db: DB, f: { projectId: number; kind?: string; status?: string; q?: string }): ResourceView[] {
  let sql = 'SELECT r.id AS rid FROM resources r WHERE r.project_id = @projectId'
  const params: any = { projectId: f.projectId }
  if (f.kind) { sql += ' AND r.kind = @kind'; params.kind = f.kind }
  if (f.status) { sql += ' AND r.status = @status'; params.status = f.status }
  else { sql += " AND r.status != 'cancelled'" }
  if (f.q) {
    sql += ' AND EXISTS (SELECT 1 FROM revisions v WHERE v.resource_id = r.id AND v.rev = (SELECT MAX(rev) FROM revisions WHERE resource_id = r.id) AND (v.title LIKE @q OR v.content_markdown LIKE @q))'
    params.q = '%' + f.q + '%'
  }
  sql += ' ORDER BY r.kind, r.number'
  return (db.prepare(sql).all(params) as any[]).map((r) => viewByRowId(db, r.rid))
}

export function listRevisions(db: DB, resourceId: number) {
  return db.prepare('SELECT rev, title, created_by, created_at FROM revisions WHERE resource_id = ? ORDER BY rev').all(resourceId)
}
export function getRevision(db: DB, resourceId: number, rev: number) {
  return (db.prepare('SELECT rev, title, content_markdown, created_by, created_at FROM revisions WHERE resource_id = ? AND rev = ?').get(resourceId, rev) as any) ?? null
}
```

```ts
// src/http/routes/resources.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { getProjectByKey } from '../../store/projects.js'
import { createResource, listResources, getResourceInternal, listRevisions, getRevision } from '../../store/resources.js'
import { httpError } from '../errors.js'

export function projectOr404(db: DB, key: string) {
  const p = getProjectByKey(db, key)
  if (!p) throw httpError(404, 'NOT_FOUND', 'project ' + key + ' not found')
  return p
}

export function registerResourceRoutes(app: FastifyInstance, db: DB) {
  app.post('/api/projects/:key/resources', {
    preHandler: [app.requireAuth],
    schema: { body: { type: 'object', required: ['kind', 'title', 'markdown'], properties: {
      kind: { type: 'string', enum: ['ADR', 'PRD', 'SPEC', 'PLAN', 'ISSUE'] },
      title: { type: 'string', minLength: 1 }, markdown: { type: 'string' } } } }
  }, async (req, reply) => {
    const { key } = req.params as any
    const p = projectOr404(db, key)
    const b = req.body as any
    reply.code(201)
    return createResource(db, { projectId: p.id, kind: b.kind, title: b.title, contentMarkdown: b.markdown, userId: req.user.id })
  })

  app.get('/api/projects/:key/resources', { preHandler: [app.requireAuth] }, async (req) => {
    const { key } = req.params as any
    const p = projectOr404(db, key)
    const q = req.query as any
    return listResources(db, { projectId: p.id, kind: q.kind, status: q.status, q: q.q })
  })

  app.get('/api/projects/:key/resources/:id', { preHandler: [app.requireAuth] }, async (req) => {
    const { key, id } = req.params as any
    const p = projectOr404(db, key)
    const r = getResourceInternal(db, p.id, id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
    return r.view
  })

  app.get('/api/projects/:key/resources/:id/revisions', { preHandler: [app.requireAuth] }, async (req) => {
    const { key, id } = req.params as any
    const p = projectOr404(db, key)
    const r = getResourceInternal(db, p.id, id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
    return listRevisions(db, r.row.id)
  })

  app.get('/api/projects/:key/resources/:id/revisions/:rev', { preHandler: [app.requireAuth] }, async (req) => {
    const { key, id, rev } = req.params as any
    const p = projectOr404(db, key)
    const r = getResourceInternal(db, p.id, id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
    const v = getRevision(db, r.row.id, Number(rev))
    if (!v) throw httpError(404, 'NOT_FOUND', 'revision ' + rev + ' not found')
    return v
  })
}
```

Register in `buildApp`: `registerResourceRoutes(app, opts.db)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/resources.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: resources - create with ID allocation, list, get, revisions"
```

---

### Task 7: PATCH resource — revision append + lifecycle transition in one transaction

**Files:**
- Modify: `src/store/resources.ts` (add `updateResource`), `src/http/routes/resources.ts` (add PATCH route)
- Test: `tests/api/patch.test.ts`

**Interfaces:**
- Consumes: Task 6 `getResourceInternal`, Task 2 `canTransition`.
- Produces: `updateResource(db, { projectId, publicId, patch: { title?, content_markdown?, status? }, userId }): ResourceView` — 404 unknown id, 422 `INVALID_TRANSITION` bad transition; content/title change appends revision; status-only change bumps `updated_at` without a revision; content+status in one request = one transaction (422 rolls back the revision).

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/patch.test.ts
import { describe, it, expect } from 'vitest'
import { setup } from '../helpers.js'

async function seed(app: any, auth: any) {
  await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
  await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ADR', title: 'T', markdown: 'v1' } })
}

describe('PATCH resource', () => {
  it('content change appends a revision', async () => {
    const { app, auth } = await setup()
    await seed(app, auth)
    const res = await app.inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { content_markdown: 'v2' } })
    expect(res.json().rev).toBe(2)
    expect(res.json().content_markdown).toBe('v2')
    const revs = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/ADR-1/revisions', headers: auth })
    expect(revs.json()).toHaveLength(2)
  })
  it('status transition works and does not bump revisions', async () => {
    const { app, auth } = await setup()
    await seed(app, auth)
    const res = await app.inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { status: 'active' } })
    expect(res.json().status).toBe('active')
    expect(res.json().rev).toBe(1)
  })
  it('invalid transition is 422', async () => {
    const { app, auth } = await setup()
    await seed(app, auth)
    const res = await app.inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { status: 'done' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('INVALID_TRANSITION')
  })
  it('content + invalid status rolls back the revision', async () => {
    const { app, auth } = await setup()
    await seed(app, auth)
    const res = await app.inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { content_markdown: 'v2', status: 'done' } })
    expect(res.statusCode).toBe(422)
    const after = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/ADR-1', headers: auth })
    expect(after.json().rev).toBe(1)
    expect(after.json().content_markdown).toBe('v1')
  })
  it('cancelled resources disappear from default list but are fetchable', async () => {
    const { app, auth } = await setup()
    await seed(app, auth)
    await app.inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { status: 'cancelled' } })
    const list = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources', headers: auth })
    expect(list.json()).toHaveLength(0)
    const got = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/ADR-1', headers: auth })
    expect(got.json().status).toBe('cancelled')
    const cancelledList = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources?status=cancelled', headers: auth })
    expect(cancelledList.json()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/patch.test.ts`
Expected: FAIL — PATCH route missing (404).

- [ ] **Step 3: Implement**

Add to `src/store/resources.ts`:

```ts
import { canTransition, type Status } from '../domain/lifecycle.js'

export function updateResource(db: DB, input: { projectId: number; publicId: string; patch: { title?: string; content_markdown?: string; status?: string }; userId: number }): ResourceView {
  return db.transaction(() => {
    const found = getResourceInternal(db, input.projectId, input.publicId)
    if (!found) throw httpError(404, 'NOT_FOUND', 'resource ' + input.publicId + ' not found')
    const hasContent = input.patch.title !== undefined || input.patch.content_markdown !== undefined
    if (input.patch.status !== undefined && !canTransition(found.row.status as Status, input.patch.status as Status)) {
      throw httpError(422, 'INVALID_TRANSITION', 'cannot transition ' + found.row.status + ' -> ' + input.patch.status)
    }
    if (hasContent) {
      const newTitle = input.patch.title ?? found.latest.title
      const newContent = input.patch.content_markdown ?? found.latest.content_markdown
      db.prepare('INSERT INTO revisions (resource_id, rev, title, content_markdown, created_by) VALUES (?, ?, ?, ?, ?)')
        .run(found.row.id, found.latest.rev + 1, newTitle, newContent, input.userId)
    }
    if (input.patch.status !== undefined) {
      db.prepare('UPDATE resources SET status = ? WHERE id = ?').run(input.patch.status, found.row.id)
    }
    if (hasContent || input.patch.status !== undefined) {
      db.prepare("UPDATE resources SET updated_at = datetime('now') WHERE id = ?").run(found.row.id)
    }
    return getResourceInternal(db, input.projectId, input.publicId)!.view
  })()
}
```

Add route in `src/http/routes/resources.ts`:

```ts
import { updateResource } from '../../store/resources.js'
// inside registerResourceRoutes:
app.patch('/api/projects/:key/resources/:id', {
  preHandler: [app.requireAuth],
  schema: { body: { type: 'object', properties: {
    title: { type: 'string', minLength: 1 }, content_markdown: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'active', 'done', 'cancelled'] } } } }
}, async (req) => {
  const { key, id } = req.params as any
  const p = projectOr404(db, key)
  return updateResource(db, { projectId: p.id, publicId: id, patch: req.body as any, userId: req.user.id })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/patch.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: PATCH resource - revision append and lifecycle transition transactionally"
```

---

### Task 8: Commit bindings — manual endpoint + list

**Files:**
- Create: `src/store/bindings.ts`, `tests/api/bindings.test.ts`
- Modify: `src/http/routes/resources.ts` (add binding routes)

**Interfaces:**
- Consumes: Task 6 `getResourceInternal`.
- Produces: `addBinding(db, { projectId, resourceRowId, repoUrl, sha, ref, pushedAt?, webhookEventId? }): { id: number; duplicate: boolean }` (idempotent on (resource, repo, sha)); `listBindings(db, resourceRowId): Array<{ id; repo_url; sha; commit_message_ref; pushed_at }>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/bindings.test.ts
import { describe, it, expect } from 'vitest'
import { setup } from '../helpers.js'

async function seed(app: any, auth: any) {
  await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
  await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ISSUE', title: 'Bug', markdown: 'm' } })
}

describe('manual bindings', () => {
  it('adds, lists, and dedups a binding', async () => {
    const { app, auth } = await setup()
    await seed(app, auth)
    const add = await app.inject({ method: 'POST', url: '/api/projects/CORE/resources/ISSUE-1/bindings', headers: auth,
      payload: { repo_url: 'https://gitlab.example.com/team/core.git', sha: 'abc123def456' } })
    expect(add.statusCode).toBe(201)
    const again = await app.inject({ method: 'POST', url: '/api/projects/CORE/resources/ISSUE-1/bindings', headers: auth,
      payload: { repo_url: 'https://gitlab.example.com/team/core.git', sha: 'abc123def456' } })
    expect(again.statusCode).toBe(200)
    expect(again.json().duplicate).toBe(true)
    const list = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/ISSUE-1/bindings', headers: auth })
    expect(list.json()).toHaveLength(1)
    expect(list.json()[0].sha).toBe('abc123def456')
  })
  it('validates payload', async () => {
    const { app, auth } = await setup()
    await seed(app, auth)
    const bad = await app.inject({ method: 'POST', url: '/api/projects/CORE/resources/ISSUE-1/bindings', headers: auth, payload: { repo_url: 'x' } })
    expect(bad.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/bindings.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement**

```ts
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
```

Add to `src/http/routes/resources.ts` (imports: `addBinding, listBindings` from `../../store/bindings.js`):

```ts
app.post('/api/projects/:key/resources/:id/bindings', {
  preHandler: [app.requireAuth],
  schema: { body: { type: 'object', required: ['repo_url', 'sha'], properties: { repo_url: { type: 'string' }, sha: { type: 'string', minLength: 6 } } } }
}, async (req, reply) => {
  const { key, id } = req.params as any
  const p = projectOr404(db, key)
  const r = getResourceInternal(db, p.id, id)
  if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
  const b = req.body as any
  const result = addBinding(db, { projectId: p.id, resourceRowId: r.row.id, repoUrl: b.repo_url, sha: b.sha, ref: id, pushedAt: null })
  reply.code(result.duplicate ? 200 : 201)
  return result
})

app.get('/api/projects/:key/resources/:id/bindings', { preHandler: [app.requireAuth] }, async (req) => {
  const { key, id } = req.params as any
  const p = projectOr404(db, key)
  const r = getResourceInternal(db, p.id, id)
  if (!r) throw httpError(404, 'NOT_FOUND', 'resource ' + id + ' not found')
  return listBindings(db, r.row.id)
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/bindings.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: commit bindings store and manual API"
```
---

### Task 9: GitLab push webhook

**Files:**
- Create: `src/http/routes/gitlab.ts`, `tests/api/gitlab.test.ts`
- Modify: `src/http/app.ts` (register)

**Interfaces:**
- Consumes: Task 2 `parseRefs`/`parseId`, Task 8 `addBinding`, Task 3 `webhook_events` table, Task 5 projects.
- Produces: `handleGitlabPush(db, payload): { bound: number; duplicates: number }` exported from `src/http/routes/gitlab.ts`; route `POST /api/webhooks/gitlab` — no bearer auth; verifies `X-Gitlab-Token === config.gitlabWebhookSecret` (503 `NOT_CONFIGURED` if secret empty; 401 `WEBHOOK_SECRET` on mismatch); always 200 with `{ bound, duplicates }`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/gitlab.test.ts
import { describe, it, expect } from 'vitest'
import { setup } from '../helpers.js'

const PUSH = (msg: string, sha = 'deadbeef', uuid = 'evt-1') => ({
  object_kind: 'push',
  event_uuid: uuid,
  project: { git_http_url: 'https://gitlab.example.com/team/core.git', web_url: 'https://gitlab.example.com/team/core' },
  commits: [{ id: sha, message: msg, timestamp: '2026-09-08T10:00:00Z' }]
})

async function seed(app: any, auth: any) {
  await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core', gitlab_repo_url: 'https://gitlab.example.com/team/core.git' } })
  await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ADR', title: 'A', markdown: 'm' } })
  await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ISSUE', title: 'I', markdown: 'm' } })
}

describe('gitlab webhook', () => {
  it('rejects missing or wrong secret', async () => {
    const { app } = await setup()
    const noTok = await app.inject({ method: 'POST', url: '/api/webhooks/gitlab', payload: PUSH('x') })
    expect(noTok.statusCode).toBe(401)
    const badTok = await app.inject({ method: 'POST', url: '/api/webhooks/gitlab', headers: { 'x-gitlab-token': 'wrong' }, payload: PUSH('x') })
    expect(badTok.statusCode).toBe(401)
    expect(badTok.json().error.code).toBe('WEBHOOK_SECRET')
  })
  it('binds commits whose messages reference resource ids', async () => {
    const { app, auth } = await setup()
    await seed(app, auth)
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/gitlab', headers: { 'x-gitlab-token': 's' }, payload: PUSH('implement ADR-1 and closes ISSUE-1') })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ bound: 2, duplicates: 0 })
    const b1 = await app.inject({ method: 'GET', url: '/api/projects/CORE/resources/ADR-1/bindings', headers: auth })
    expect(b1.json()[0].sha).toBe('deadbeef')
  })
  it('is idempotent on repeated event_uuid', async () => {
    const { app } = await setup()
    await seed(app, auth)
    const h = { 'x-gitlab-token': 's' }
    await app.inject({ method: 'POST', url: '/api/webhooks/gitlab', headers: h, payload: PUSH('refs ADR-1') })
    const dup = await app.inject({ method: 'POST', url: '/api/webhooks/gitlab', headers: h, payload: PUSH('refs ADR-1') })
    expect(dup.json()).toEqual({ bound: 0, duplicates: 1 })
  })
  it('same commit binding another resource is not a duplicate; unbound refs are ignored', async () => {
    const { app } = await setup()
    await seed(app, auth)
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/gitlab', headers: { 'x-gitlab-token': 's' }, payload: PUSH('ADR-1 ISSUE-1 ADR-99') })
    expect(res.json()).toEqual({ bound: 2, duplicates: 0 })
  })
  it('ignores repos not bound to any project', async () => {
    const { app } = await setup()
    const p = { ...PUSH('refs ADR-1'), project: { git_http_url: 'https://gitlab.example.com/other/x.git' } }
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/gitlab', headers: { 'x-gitlab-token': 's' }, payload: p })
    expect(res.statusCode).toBe(200)
    expect(res.json().bound).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/gitlab.test.ts`
Expected: FAIL — route missing.

- [ ] **Step 3: Implement**

```ts
// src/http/routes/gitlab.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import type { Config } from '../../config.js'
import { parseRefs } from '../../domain/refs.js'
import { parseId } from '../../domain/ids.js'
import { addBinding } from '../../store/bindings.js'
import { httpError } from '../errors.js'

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

export function registerGitlabRoutes(app: FastifyInstance, db: DB, config: Config) {
  app.post('/api/webhooks/gitlab', async (req) => {
    if (!config.gitlabWebhookSecret) throw httpError(503, 'NOT_CONFIGURED', 'GITLAB_WEBHOOK_SECRET is not configured')
    const token = req.headers['x-gitlab-token']
    if (token !== config.gitlabWebhookSecret) throw httpError(401, 'WEBHOOK_SECRET', 'invalid X-Gitlab-Token')
    return handleGitlabPush(db, req.body)
  })
}
```

Register in `buildApp`: `registerGitlabRoutes(app, opts.db, opts.config)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/gitlab.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: gitlab push webhook with dedup and commit binding"
```

---

### Task 10: Agent instructions + OpenAPI + AGENTS.md

**Files:**
- Create: `src/http/routes/agents.ts`, `tests/api/agents.test.ts`
- Modify: `src/http/app.ts` (register swagger + agent routes)

**Interfaces:**
- Consumes: `config.baseUrl`, @fastify/swagger.
- Produces: `GET /api/agents/instructions` → JSON (`service`, `base_url`, `auth`, `resource_kinds`, `id_format`, `lifecycle`, `conventions`, `endpoints`, `openapi_url`, `agents_md_url`); `GET /openapi.json` (swagger-generated, includes route schemas); `GET /AGENTS.md` (`text/markdown; charset=utf-8`). All three unauthenticated (discovery).

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/agents.test.ts
import { describe, it, expect } from 'vitest'
import { setup } from '../helpers.js'

describe('agent instructions', () => {
  it('serves JSON instructions without auth', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/api/agents/instructions' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.auth.scheme).toBe('bearer')
    expect(body.resource_kinds).toEqual(['ADR', 'PRD', 'SPEC', 'PLAN', 'ISSUE'])
    expect(body.openapi_url).toBe('/openapi.json')
  })
  it('serves AGENTS.md as markdown', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/AGENTS.md' })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/markdown')
    expect(res.body).toContain('# AirBoard Agent Guide')
    expect(res.body).toContain('Bearer abt_')
  })
  it('serves openapi.json', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/openapi.json' })
    expect(res.statusCode).toBe(200)
    expect(res.json().openapi).toMatch(/^3\./)
    expect(res.json().paths['/api/projects/{key}/resources']).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/agents.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement**

In `buildApp`, register swagger before other routes:

```ts
import swagger from '@fastify/swagger'
// inside buildApp, first registration:
await app.register(swagger, { openapi: { info: { title: 'AirBoard API', version: '0.1.0' } } })
// after all routes are registered:
app.get('/openapi.json', async () => app.swagger())
```

```ts
// src/http/routes/agents.ts
import type { FastifyInstance } from 'fastify'
import type { Config } from '../../config.js'

export function agentInstructions(baseUrl: string) {
  return {
    service: 'airboard',
    base_url: baseUrl,
    auth: {
      scheme: 'bearer', header: 'Authorization', token_prefix: 'abt_',
      how_to_get: ['Ask your sponsoring user to mint a token: POST /api/users/{id}/tokens', 'Or use the web UI token page at /tokens']
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
      commit_refs: 'write KIND-number tokens in git commit messages; pushes via GitLab webhook bind commits automatically'
    },
    endpoints: {
      health: '/api/health', users: '/api/users', tokens: '/api/users/{id}/tokens',
      projects: '/api/projects', resources: '/api/projects/{key}/resources',
      revisions: '/api/projects/{key}/resources/{id}/revisions',
      bindings: '/api/projects/{key}/resources/{id}/bindings',
      webhook: '/api/webhooks/gitlab', openapi: '/openapi.json', agents_md: '/AGENTS.md'
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
    '',
    '## Rules',
    '- IDs are allocated by the server only; never invent one.',
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
```

Register in `buildApp`: `registerAgentRoutes(app, opts.config)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/agents.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: agent instructions endpoint, AGENTS.md, and OpenAPI"
```

---

### Task 11: Web UI

**Files:**
- Create: `src/web/html.ts`, `src/http/routes/web.ts`, `tests/api/web.test.ts`
- Modify: `src/http/app.ts` (register)

**Interfaces:**
- Consumes: all store functions, `webUser` from Task 4.
- Produces: `esc(s): string` and `layout(title, body, loggedIn?): string` and `renderMarkdown(md): string` in `src/web/html.ts`. Routes: `GET /login`, `POST /login` (token → cookie `ab_token` httpOnly → redirect /`), `POST /logout`, `GET /` (project list), `GET /p/:key` (resource table + filters + search), `GET /p/:key/:id` (markdown view, revisions, bindings, edit form, status buttons), `POST /p/:key/:id/edit`, `POST /p/:key/:id/status`, `GET /tokens`, `POST /tokens` (show-once), `POST /tokens/:id/revoke`. Unauthenticated browsing redirects to `/login`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/api/web.test.ts
import { describe, it, expect } from 'vitest'
import { setup } from '../helpers.js'

function withCookie(res: any): string {
  const set = res.headers['set-cookie'] as string[] | string
  return (Array.isArray(set) ? set[0] : set).split(';')[0]
}

describe('web ui', () => {
  it('login page renders anonymously', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/login' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<form')
  })
  it('login with token sets cookie and shows project list', async () => {
    const { app, auth } = await setup()
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    const login = await app.inject({ method: 'POST', url: '/login', payload: { token: tok } })
    expect(login.statusCode).toBe(302)
    const cookie = withCookie(login)
    const home = await app.inject({ method: 'GET', url: '/', headers: { cookie } })
    expect(home.statusCode).toBe(200)
    expect(home.body).toContain('Projects')
  })
  it('resource detail renders markdown, escapes html, transitions', async () => {
    const { app, auth } = await setup()
    await app.inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
    await app.inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ADR', title: 'T <b>x</b>', markdown: 'hello\n\nworld' } })
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    const cookie = 'ab_token=' + tok
    const page = await app.inject({ method: 'GET', url: '/p/CORE/ADR-1', headers: { cookie } })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(page.body).toContain('<p>hello</p>')
    const st = await app.inject({ method: 'POST', url: '/p/CORE/ADR-1/status', headers: { cookie }, payload: { status: 'active' } })
    expect(st.statusCode).toBe(302)
    const after = await app.inject({ method: 'GET', url: '/p/CORE/ADR-1', headers: { cookie } })
    expect(after.body).toContain('active')
  })
  it('rejects unauthenticated browsing with redirect to /login', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/login')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/web.test.ts`
Expected: FAIL — routes missing.

- [ ] **Step 3: Implement**

```ts
// src/web/html.ts
export function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
export function renderMarkdown(md: string): string {
  const parts = md.split('\x60\x60\x60')
  return parts.map((part, i) => {
    if (i % 2 === 1) return '<pre>' + esc(part) + '</pre>'
    return part.split(/\n\n+/).map((p) => (p.trim() ? '<p>' + esc(p).replaceAll('\n', '<br>') + '</p>' : '')).join('')
  }).join('')
}
export function layout(title: string, body: string, loggedIn = true): string {
  const nav = loggedIn ? '<nav><a href="/">Projects</a> <a href="/tokens">Tokens</a> <a href="/AGENTS.md">Agents</a> <form method="post" action="/logout" style="display:inline"><button>Logout</button></form></nav>' : ''
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + ' — AirBoard</title><style>body{font-family:sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem}nav{margin-bottom:1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4rem;text-align:left}pre{background:#f4f4f4;padding:.5rem;overflow:auto}</style></head><body>' + nav + '<h1>' + esc(title) + '</h1>' + body + '</body></html>'
}
```

```ts
// src/http/routes/web.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { verifyToken, createToken, revokeToken, listTokens } from '../../store/users.js'
import { listProjects, getProjectByKey } from '../../store/projects.js'
import { getResourceInternal, listResources, updateResource, listRevisions, listBindings } from '../../store/resources.js'
import { webUser } from '../auth.js'
import { esc, layout, renderMarkdown } from '../../web/html.js'
import { httpError } from '../errors.js'

export function registerWebRoutes(app: FastifyInstance, db: DB) {
  const requireWeb = async (req: any, reply: any) => {
    if (!webUser(db, req)) return reply.redirect('/login')
  }

  app.get('/login', async (_req, reply) => {
    reply.type('text/html')
    return layout('Login', '<form method="post" action="/login"><input name="token" placeholder="abt_..." required><button>Login</button></form>', false)
  })

  app.post('/login', async (req: any, reply) => {
    const user = verifyToken(db, String(req.body?.token ?? ''))
    if (!user) {
      reply.code(401).type('text/html')
      return layout('Login', '<p>Invalid token.</p><form method="post" action="/login"><input name="token"><button>Login</button></form>', false)
    }
    reply.setCookie('ab_token', req.body.token, { path: '/', httpOnly: true, sameSite: 'lax' })
    return reply.redirect('/')
  })

  app.post('/logout', async (_req, reply) => reply.clearCookie('ab_token').redirect('/login'))

  app.get('/', { preHandler: [requireWeb] }, async (_req, reply) => {
    const rows = listProjects(db).map((p) => '<tr><td><a href="/p/' + esc(p.key) + '">' + esc(p.key) + '</a></td><td>' + esc(p.name) + '</td><td>' + esc(p.gitlab_repo_url ?? '') + '</td></tr>').join('')
    reply.type('text/html')
    return layout('Projects', '<table><tr><th>Key</th><th>Name</th><th>GitLab repo</th></tr>' + rows + '</table>')
  })

  app.get('/p/:key', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const p = getProjectByKey(db, req.params.key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    const q = req.query as any
    const rows = listResources(db, { projectId: p.id, kind: q.kind, status: q.status, q: q.q })
      .map((r) => '<tr><td>' + esc(r.id) + '</td><td><a href="/p/' + esc(p.key) + '/' + r.id + '">' + esc(r.title) + '</a></td><td>' + esc(r.kind) + '</td><td>' + esc(r.status) + '</td><td>' + r.rev + '</td></tr>').join('')
    reply.type('text/html')
    return layout(p.key + ' resources', '<table><tr><th>ID</th><th>Title</th><th>Kind</th><th>Status</th><th>Rev</th></tr>' + rows + '</table><form method="get"><input name="q" placeholder="search"><button>Search</button></form>')
  })

  app.get('/p/:key/:id', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const p = getProjectByKey(db, req.params.key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    const r = getResourceInternal(db, p.id, req.params.id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource not found')
    const revs = listRevisions(db, r.row.id).map((v: any) => '<tr><td>' + v.rev + '</td><td>' + esc(v.title) + '</td><td>' + esc(v.created_at) + '</td></tr>').join('')
    const binds = listBindings(db, r.row.id).map((b) => '<tr><td>' + esc(b.repo_url) + '</td><td><code>' + esc(b.sha) + '</code></td><td>' + esc(b.pushed_at ?? '') + '</td></tr>').join('')
    const NEXT: Record<string, string[]> = { draft: ['active', 'cancelled'], active: ['done', 'cancelled'], done: [], cancelled: [] }
    const buttons = NEXT[r.view.status]
      .map((s) => '<form method="post" action="/p/' + esc(p.key) + '/' + r.view.id + '/status" style="display:inline"><input type="hidden" name="status" value="' + s + '"><button>' + s + '</button></form>').join(' ')
    reply.type('text/html')
    return layout(r.view.id + ' — ' + r.view.title,
      '<p>Status: <strong>' + r.view.status + '</strong> (rev ' + r.view.rev + ') ' + buttons + '</p>' +
      '<div>' + renderMarkdown(r.view.content_markdown) + '</div>' +
      '<h2>Edit</h2><form method="post" action="/p/' + esc(p.key) + '/' + r.view.id + '/edit">' +
      '<input name="title" value="' + esc(r.view.title) + '" style="width:100%"><br>' +
      '<textarea name="markdown" rows="12" style="width:100%">' + esc(r.view.content_markdown) + '</textarea><br>' +
      '<button>Save (new revision)</button></form>' +
      '<h2>Revisions</h2><table><tr><th>Rev</th><th>Title</th><th>At</th></tr>' + revs + '</table>' +
      '<h2>Commit bindings</h2><table><tr><th>Repo</th><th>SHA</th><th>Pushed</th></tr>' + binds + '</table>')
  })

  app.post('/p/:key/:id/edit', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const p = getProjectByKey(db, req.params.key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    updateResource(db, { projectId: p.id, publicId: req.params.id, patch: { title: req.body?.title, content_markdown: req.body?.markdown }, userId: webUser(db, req)!.id })
    return reply.redirect('/p/' + p.key + '/' + req.params.id)
  })

  app.post('/p/:key/:id/status', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const p = getProjectByKey(db, req.params.key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    updateResource(db, { projectId: p.id, publicId: req.params.id, patch: { status: req.body?.status }, userId: webUser(db, req)!.id })
    return reply.redirect('/p/' + p.key + '/' + req.params.id)
  })

  app.get('/tokens', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const me = webUser(db, req)!
    const rows = listTokens(db, me.id).map((t) => '<tr><td>' + t.id + '</td><td>' + esc(t.label) + '</td><td>' + esc(t.created_at) + '</td><td>' + (t.revoked_at ? 'revoked' : '<form method="post" action="/tokens/' + t.id + '/revoke"><button>Revoke</button></form>') + '</td></tr>').join('')
    reply.type('text/html')
    return layout('Tokens', '<table><tr><th>ID</th><th>Label</th><th>Created</th><th></th></tr>' + rows + '</table><form method="post" action="/tokens"><input name="label" placeholder="label"><button>Create token</button></form>')
  })

  app.post('/tokens', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const me = webUser(db, req)!
    const { token } = createToken(db, me.id, String(req.body?.label ?? ''))
    reply.type('text/html')
    return layout('Token created', '<p>Copy it now — shown once:</p><pre>' + esc(token) + '</pre><p><a href="/tokens">Back</a></p>')
  })

  app.post('/tokens/:id/revoke', { preHandler: [requireWeb] }, async (req: any, reply) => {
    revokeToken(db, Number(req.params.id))
    return reply.redirect('/tokens')
  })
}
```

Register in `buildApp`: `registerWebRoutes(app, opts.db)` (`@fastify/cookie` was registered in Task 1, so `setCookie`/`clearCookie` work).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/web.test.ts` then `npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: server-rendered web UI - login, browse, edit, transitions, tokens"
```

---

### Task 12: Entrypoint, bootstrap wiring, README

**Files:**
- Create: `src/index.ts`, `README.md`
- Test: `tests/bootstrap.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `src/index.ts` — loadConfig, openDb, `bootstrapIfEmpty` (prints one-time token to console when created), `app.listen({ port, host: '0.0.0.0' })`. README documents env vars, first run, GitLab webhook setup, agent onboarding URLs.

- [ ] **Step 1: Write the failing test**

```ts
// tests/bootstrap.test.ts
import { describe, it, expect } from 'vitest'
import { openDb } from '../src/store/db.js'
import { bootstrapIfEmpty } from '../src/bootstrap.js'
import { verifyToken } from '../src/store/users.js'

describe('bootstrapIfEmpty', () => {
  it('creates admin + token on empty db, once', () => {
    const db = openDb(':memory:')
    const first = bootstrapIfEmpty(db)
    expect(first?.token).toMatch(/^abt_[0-9a-f]{32}$/)
    expect(verifyToken(db, first!.token)?.username).toBe('admin')
    expect(bootstrapIfEmpty(db)).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails or passes**

Run: `npx vitest run tests/bootstrap.test.ts`
Expected: likely PASS already (`src/bootstrap.ts` exists from Task 4) — the test locks the once-only contract; keep it and proceed.

- [ ] **Step 3: Implement**

```ts
// src/index.ts
import { loadConfig } from './config.js'
import { openDb } from './store/db.js'
import { bootstrapIfEmpty } from './bootstrap.js'
import { buildApp } from './http/app.js'

const config = loadConfig()
const db = openDb(config.dbPath)
const boot = bootstrapIfEmpty(db)
if (boot) {
  console.log('==================================================================')
  console.log('AirBoard first run: bootstrap admin token (shown once, save it):')
  console.log(boot.token)
  console.log('Log in with this token at /login, then create your own user+token.')
  console.log('==================================================================')
}
const app = await buildApp({ config, db })
await app.listen({ port: config.port, host: '0.0.0.0' })
console.log('AirBoard listening on :' + config.port + ' (base ' + config.baseUrl + ')')
```

```md
<!-- README.md -->
# AirBoard

Self-hosted, agent-friendly project tracking for ADRs, PRDs, Specs, Plans, and Issues. See CONTEXT.md (glossary), docs/adr/, docs/specs/2026-09-08-airboard-foundation-design.md.

## Run

    npm install && npm run build && npm start     # or: npm run dev

Env vars: PORT (3000), DB_PATH (./airboard.db), BASE_URL, GITLAB_WEBHOOK_SECRET.

## First run

With an empty database the service creates an admin user and prints a one-time bootstrap token to the console. Use it to log in at /login (or as Authorization: Bearer <token>), create your user, mint personal tokens, then revoke the bootstrap token at /tokens.

## GitLab

In your GitLab project: Settings -> Webhooks -> add <BASE_URL>/api/webhooks/gitlab, push events, secret = GITLAB_WEBHOOK_SECRET. Set the AirBoard project's gitlab_repo_url to the repo's HTTP URL (PATCH /api/projects/KEY). Commit messages mentioning ADR-12, ISSUE-345 etc. are auto-bound.

## Agents

- GET /AGENTS.md — human/agent readable guide
- GET /api/agents/instructions — JSON setup instructions
- GET /openapi.json — full API contract
```

- [ ] **Step 4: Run full verification**

Run: `npx vitest run` and `npm run build`; then smoke-test: `PORT=3100 DB_PATH=/tmp/ab-smoke.db npm run dev &` wait 2s, `curl -s localhost:3100/api/health` expect `{"status":"ok"}`, bootstrap token printed, then kill.
Expected: all tests PASS, build clean, health ok.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: service entrypoint with bootstrap and README"
```
