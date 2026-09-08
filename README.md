<!-- README.md -->
# AirBoard

Self-hosted, agent-friendly project tracking for ADRs, PRDs, Specs, Plans, and Issues. See CONTEXT.md (glossary), docs/adr/, docs/specs/2026-09-08-airboard-foundation-design.md.

## Run

    bun install
    cp .env.example .env    # optional — edit settings; bun loads .env automatically
    bun start               # or: bun run dev

Config via .env or env vars: PORT (3000), DB_PATH (./airboard.db), BASE_URL, GITLAB_WEBHOOK_SECRET. See QUICKSTART.md for the full walkthrough.

## First run

With an empty database the service creates an admin user and prints a one-time bootstrap token to the console. Use it to log in at /login (or as Authorization: Bearer <token>), create your user, mint personal tokens, then revoke the bootstrap token at /tokens.

## GitLab

In your GitLab project: Settings -> Webhooks -> add <BASE_URL>/api/plugins/gitlab/webhook, push events, secret = GITLAB_WEBHOOK_SECRET. Set the AirBoard project's gitlab_repo_url to the repo's HTTP URL (PATCH /api/projects/KEY). Commit messages mentioning ADR-12, ISSUE-345 etc. are auto-bound.

## Agents

- GET /AGENTS.md — human/agent readable guide
- GET /api/agents/instructions — JSON setup instructions
- GET /openapi.json — full API contract
