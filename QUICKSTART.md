# AirBoard Quick Start

## 1. Start the service

```bash
bun install
cp .env.example .env   # edit to taste — bun loads .env automatically
bun src/index.ts
```

Or with Docker (database persisted on the `airboard-data` volume):

```bash
cp .env.example .env       # optional — compose reads BASE_URL / GITLAB_WEBHOOK_SECRET from it
docker compose up -d --build
docker compose logs airboard   # first run prints the one-time bootstrap token
```

All settings are optional and can also be passed as plain environment variables (env vars and `.env` behave the same; bun auto-loads `.env` from the working directory):

| Var | Default | Purpose |
|---|---|---|
| `PORT` | 3000 | listen port |
| `DB_PATH` | ./airboard.db | SQLite database file (created if missing) |
| `BASE_URL` | http://localhost:3000 | advertised in agent instructions |
| `GITLAB_WEBHOOK_SECRET` | (unset) | shared secret for the GitLab webhook — until set, the webhook answers 503 NOT_CONFIGURED |
| `INITIAL_ACCESS_TOKEN` | (unset) | token for the first-run bootstrap admin — empty: generated and logged once; set: your exact token is used and never logged |

`.env` is git-ignored (it holds secrets); `.env.example` documents every variable.

## 2. Grab the one-time bootstrap token

On first run (empty DB) the console prints an admin token **once**:

```
AirBoard first run: bootstrap admin token (shown once, save it):
abt_acc050d706841707c9b56378a59077d3
```

Use it to log in at `http://localhost:3010/login` (paste the token) or as a Bearer token.

## 3. First setup (one time)

```bash
B=http://localhost:3010
T=<bootstrap-token>

# create your own user
curl -X POST $B/api/users -H "Authorization: Bearer $T" \
  -H "content-type: application/json" \
  -d '{"username":"you","display_name":"You"}'

# mint a personal token (shown once) — then use THIS token and revoke the bootstrap one at /tokens in the UI
curl -X POST $B/api/users/2/tokens -H "Authorization: Bearer $T" \
  -H "content-type: application/json" -d '{"label":"cli"}'

# create a project (also possible in the web UI on the home page)
curl -X POST $B/api/projects -H "Authorization: Bearer $T" \
  -H "content-type: application/json" \
  -d '{"key":"CORE","name":"My Project"}'

# mint a PROJECT-SCOPED token (access control): sees only CORE, 403 elsewhere
# scoped tokens cannot manage users/tokens/projects; unbound+non-global sees nothing
curl -X POST $B/api/users/2/tokens -H "Authorization: Bearer $T" \
  -H "content-type: application/json" \
  -d '{"label":"agent-core","global":false,"project_keys":["CORE"]}'

# rebind a token to different projects later
curl -X PUT $B/api/tokens/<id>/projects -H "Authorization: Bearer $T" \
  -H "content-type: application/json" -d '{"project_keys":["CORE","OTHER"]}'
```

## 4. Everyday usage

```bash
# create a resource — the ID (e.g. ADR-1) is allocated atomically, starts in draft
curl -X POST $B/api/projects/CORE/resources -H "Authorization: Bearer $T" \
  -H "content-type: application/json" \
  -d '{"kind":"ADR","title":"Use SQLite","markdown":"Because one file is enough."}'

# list (kind/status filters); full-text search across ALL projects
curl "$B/api/projects/CORE/resources?kind=ADR" -H "Authorization: Bearer $T"
curl "$B/api/search?q=sqlite" -H "Authorization: Bearer $T"

# read any revision
curl "$B/api/projects/CORE/resources/ADR-1/revisions/1" -H "Authorization: Bearer $T"

# update: content/title appends a revision; status transitions the lifecycle
# (draft → active → done; draft/active → cancelled; invalid → 422)
curl -X PATCH $B/api/projects/CORE/resources/ADR-1 -H "Authorization: Bearer $T" \
  -H "content-type: application/json" \
  -d '{"status":"active","content_markdown":"Updated decision."}'
```

Kinds: `ADR`, `PRD`, `SPEC`, `PLAN`, `ISSUE` — IDs are per project per kind (`ADR-1`, `ISSUE-345`), monotonic, never reused.

## 5. GitLab integration

```bash
# 1) bind the project to its repo
curl -X PATCH $B/api/projects/CORE -H "Authorization: Bearer $T" \
  -H "content-type: application/json" \
  -d '{"gitlab_repo_url":"https://gitlab.example.com/team/core.git"}'
```

2) In GitLab: **Settings → Webhooks** → URL `$B/api/plugins/gitlab/webhook`, trigger *Push events*, secret = your `GITLAB_WEBHOOK_SECRET`.

3) Now commit messages mentioning `ADR-1`, `ISSUE-345`, … auto-bind on every push:

```bash
curl -X POST $B/api/plugins/gitlab/webhook \
  -H "x-gitlab-token: $GITLAB_WEBHOOK_SECRET" \
  -H "x-gitlab-event-uuid: any-uuid" \
  -H "content-type: application/json" \
  -d '{"object_kind":"push",
       "project":{"git_http_url":"https://gitlab.example.com/team/core.git"},
       "commits":[{"id":"deadbeef42","message":"implement ADR-1, fixes ISSUE-1"}]}'
# → {"bound":2,"duplicates":0,"deduplicated":false}

curl $B/api/projects/CORE/resources/ADR-1/bindings -H "Authorization: Bearer $T"
# → commit_url links straight to the GitLab commit
```

## 6. Agents

Point any AI agent at:

- `GET /AGENTS.md` — readable setup guide
- `GET /api/agents/instructions` — JSON instructions (base URL, auth, conventions)
- `GET /openapi.json` — full API contract (16 paths)

An agent only needs: the base URL + a Bearer token; everything else it can discover itself.

## 7. Web UI

Browse `http://localhost:3010/` — log in by pasting a token. Lists, editing (each save = new revision), status buttons, revision history, commit bindings with GitLab deep-links, and token management at `/tokens`.
