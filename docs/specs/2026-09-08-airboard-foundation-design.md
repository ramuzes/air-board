# AirBoard Foundation

## Requirement (the why & what)

### Problem statement

The team tracks ADRs, PRDs, Specs, DevPlans, and Issues today with no shared system of record, or with tools (like Jira) that are priced per seat and hostile to non-human clients. Our AI Agents — who do much of the actual writing and coding — have no way to create, read, and update these artifacts programmatically, no discoverable instructions for onboarding themselves, and no link between the documents and the commits on the self-hosted GitLab that implement them.

### Goal

A self-hosted AirBoard service (single team, <20 Users) that:

- Manages the five Resource kinds (ADR, PRD, SPEC, PLAN, ISSUE) with full CRUD over an HTTP API, each Resource carrying a stable public ID like `ADR-42`.
- Allocates IDs atomically at creation so concurrent developers/Agents never collide.
- Serves machine-fetchable Agent Instructions (auth scheme, ID conventions, OpenAPI) plus a human-readable AGENTS.md page.
- Identifies Users with personal Access Tokens; every action is attributable.
- Accepts GitLab push webhooks and records Commit Bindings when commit messages reference Resource IDs.
- Provides a read/browse web UI with basic editing and token management.

### User stories

1. As a Developer, I want to create an ADR with one API call and get its ID immediately, so that I can reference it in code and chat without a two-step dance.
2. As a Developer, I want to cancel a Resource I requested, so that abandoned requirements don't masquerade as active work.
3. As an Agent, I want to fetch setup instructions from a well-known URL, so that I can configure my base URL and token without human help.
4. As an Agent, I want to list, search, read, create, update, and transition all Resource kinds via HTTP, so that I can do the same work a human does at a keyboard.
5. As an Agent, I want to read any prior Revision of a Resource, so that I can see what changed and by whom before overwriting work.
6. As a User, I want to create and revoke personal Access Tokens, so that Agents acting for me can be cut off when needed.
7. As a User, I want my GitLab pushes to automatically bind commits to referenced Resources, so that traceability from requirement to code needs zero manual bookkeeping.
8. As a User, I want to browse and edit everything in a web UI, so that I don't need curl for a quick read or typo fix.
9. As a User, I want cancelled Resources retained with their history, so that "why did we stop this?" stays answerable.

### Out of scope

- Multi-team / multi-tenant permissions, roles, orgs.
- Per-kind state machines beyond the shared Lifecycle (e.g. ISSUE workflow columns).
- Bidirectional write-back to GitLab (comments, MRs) — inbound binding only.
- Relevance tuning / ranking controls beyond FTS5 defaults.
- Email/notifications of any kind.
- Kanban / drag-drop UI.

## Design (the how)

### Solution

A single Node.js service exposing: a REST API under `/api` (bearer-token auth), server-rendered web UI at `/`, connector-plugin webhooks at `/api/plugins/<id>/webhook` (gitlab is the first connector, per ADR 0004), and Agent Instructions at `/api/agents/instructions` (JSON + OpenAPI) and `/AGENTS.md` (human-readable markdown). All state lives in one SQLite database file.

### Implementation decisions

**Module layout** (per ADR 0001):

- `domain` — pure, I/O-free logic: lifecycle transitions, ID format, revision numbering, commit-message reference parsing. Fully unit-testable.
- `store` — SQLite via bun's built-in `bun:sqlite` (ADR 0005). Synchronous, transactional. Owns the schema and all SQL. Allocation of the next Resource number happens inside the creation transaction (per ADR 0002).
- `http` — Fastify. JSON Schema-validated routes, OpenAPI document generated from route schemas.
- `web` — server-rendered pages (Fastify view templates) served by the same process; session-cookie auth reusing Access Token verification.

**Data model (core tables):**

- `users` (id, username unique, display_name, created_at)
- `tokens` (id, user_id, token_hash, label, created_at, revoked_at nullable) — tokens are shown once at creation; only the hash is stored. Token format: `abt_` + 32+ random chars.
- `projects` (id, key unique short uppercase, name, created_at)
- `resources` (id, project_id, kind, number, title, status, created_by, created_at, updated_at) — unique (project_id, kind, number). Status ∈ draft/active/done/cancelled.
- `revisions` (id, resource_id, rev, content_markdown, created_by, created_at) — unique (resource_id, rev), append-only per ADR 0003. Title changes also produce a revision.
- `commit_bindings` (id, project_id, resource_id, repo_url, sha, commit_message_ref, pushed_at, raw_payload_id nullable) — unique (resource_id, repo_url, sha).
- `webhook_events` (id, source, dedup_key, received_at, payload) — inbound webhook journal for dedup (GitLab event UUID) and replay/debugging.
- `resource_fts` — FTS5 virtual table over (resource_row_id, title, content); maintained by an AFTER INSERT trigger on `revisions` that replaces the resource's single row, so the index always reflects the latest revision.

**Lifecycle:** shared state machine `draft → active → done`, `draft|active → cancelled`. Transitions validated in `domain`; invalid transitions get 422. Cancellation is soft: the Resource stays queryable, filtered out of default lists.

**ID allocation:** on create, within one SQLite transaction: read max(number)+1 per (project, kind), insert, commit. Response returns the full Resource in `draft` with its `ADR-42`-style ID. Gaps from cancelled drafts are permanent (ADR 0002).

**Revisions:** create inserts revision 1. Content/title updates append revision n+1 with the acting user recorded. Status-only changes do NOT create revisions. GET a Resource returns latest content plus revision metadata; `GET /revisions` lists; `GET /revisions/:n` fetches.

**API surface (all under `/api`, bearer token):**

- `POST /users`, `GET /users` (admin-ish; single team, any authenticated user may list)
- `POST /users/:id/tokens` → returns plaintext token once; `DELETE /tokens/:id` revokes
- `POST /projects`, `GET /projects`, `GET /projects/:key`
- `POST /projects/:key/resources` (kind, title, markdown) → 201 with allocated ID
- `GET /projects/:key/resources?kind=&status=&q=` — `q` runs a full-text search over title + latest content via SQLite FTS5 (one row per resource, reindexed on every revision append), falling back to LIKE matching when the FTS5 query syntax is invalid
- `GET /search?q=` — the same full-text search across all projects, returning hits with `project_key` so agents can jump straight to the right resource
- `GET|PATCH /resources/:id` — `:id` is the **public** `ADR-42`-style ID (with optional project scoping `/projects/:key/resources/:id`). PATCH: title/content changes append a revision; status triggers a lifecycle transition. A PATCH carrying both content and status applies both in one transaction (revision appended and transition validated together; if the transition is invalid the whole request is 422 and no revision is written).
- `GET /resources/:id/revisions`, `GET /resources/:id/revisions/:rev`
- `POST /resources/:id/bindings` (manual commit binding: repo_url, sha) and `GET /resources/:id/bindings`
- **Connector plugins:** external-service integrations implement a small `ConnectorPlugin` interface (id, display name, optional webhook, optional external-URL derivation such as commit deep-links) and register in a plugin registry at startup (ADR 0004). Each connector's webhook is mounted at the predictable path `POST /api/plugins/<id>/webhook`. `GET /api/plugins` (authenticated) lists registered connectors with their webhook URLs for agent discovery.
- The **gitlab** connector mounts `POST /api/plugins/gitlab/webhook` (unauthenticated but secret-token-verified per GitLab convention — the shared secret is configured via an environment variable, e.g. `GITLAB_WEBHOOK_SECRET`, and checked against GitLab's `X-Gitlab-Token` header) — on push events, parse every commit message for `(ADR|PRD|SPEC|PLAN|ISSUE)-\d+` tokens scoped to the project bound to that GitLab repo, and record bindings idempotently. The webhook always responds 200 with `{ bound: <n>, deduplicated: <bool> }` so GitLab does not retry. The connector also derives direct GitLab links from the project's configured `gitlab_repo_url`: binding responses include `commit_url = <repo-without-.git>/-/commit/<sha>` so the UI and agents can redirect straight to GitLab.
- `GET /agents/instructions` — JSON: base_url, auth scheme, token acquisition steps, ID conventions, lifecycle rules, link to OpenAPI JSON, link to AGENTS.md.
- `GET /openapi.json`, `GET /AGENTS.md` (plain markdown, same content orientation as the JSON instructions).
- Error envelope: `{ error: { code, message, details? } }` with proper status codes; 404 for unknown IDs, 422 for invalid transitions/schemas.

**Project ↔ GitLab repo binding:** a project field `gitlab_repo_url`; the gitlab connector matches incoming pushes to projects by repo URL before parsing refs. (A repo maps to at most one project at launch.) The same URL powers commit deep-links (`commit_url`) on bindings.

**First-run bootstrap:** if no users exist, the service prints/creates a bootstrap admin token on first start (once, logged to console) so the initial User and tokens can be created without seed scripts.

**Web UI:** login (paste token — the bootstrap console token works here too), project list, resource list with kind/status filters, resource detail (rendered markdown, revision history, commit bindings, edit form), status transition buttons, token management page, AGENTS.md viewer.

### Testing decisions

- **Seam:** the HTTP API over a real ephemeral listener (`listen({ port: 0 })` + `fetch`, per ADR 0005) — one integration test seam covering http + domain + store against an in-memory SQLite database. This is the highest-value seam since the API is the product. Test framework: bun:test; type checking: `tsc --noEmit`.
- Domain unit tests (no I/O) for: lifecycle transition table, commit-message ref parsing, ID formatting.
- Store-level tests for the ID-allocation transaction under simulated concurrency (sequential interleaved transactions, since SQLite is single-writer) and revision append-only invariants.
- No prior art (greenfield); these tests become the pattern for future work.

## Further notes

- Glossary and core decisions live in `CONTEXT.md` and `docs/adr/0001-0003`.
- Migration path off SQLite (if ever needed) is confined to `store`.
- Manual binding endpoint doubles as backfill tooling for pre-AirBoard history.
