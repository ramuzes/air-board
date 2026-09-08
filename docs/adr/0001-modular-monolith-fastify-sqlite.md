# ADR 0001: Modular monolith on Fastify + SQLite

## Status

Accepted

## Context

AirBoard is a self-hosted, single-team (<20 users) project management service whose primary API consumers are AI Agents. It must ship an HTTP API, a light web UI, GitLab webhook ingestion, and agent self-setup instructions. Alternatives considered: a separate SPA frontend talking to the API service; a Hono micro-service targeting edge portability.

## Decision

Build a single Node.js process (modular monolith) with Fastify:
- `domain/` — pure logic (ID allocation, lifecycle, revisions), no I/O
- `store/` — better-sqlite3, one SQLite database file, synchronous transactions
- `http/` — Fastify REST API with JSON Schema validation and OpenAPI generation
- `web/` — server-rendered pages in the same process

## Consequences

- Deployment is `node` plus one database file; backup is file copy.
- Generated OpenAPI feeds the agent instructions endpoint, so agents get a machine-readable contract for free.
- A richer SPA UI can replace `web/` later without touching domain or store layers.
- SQLite caps write concurrency (fine at this scale); migrating to Postgres later means rewriting only `store/`.
