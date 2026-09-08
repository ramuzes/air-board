# ADR 0005: Bun runtime with bun:sqlite

## Status

Accepted (amends ADR 0001's storage binding and the test/tooling choices)

## Context

The default Node on this machine (v26) cannot build better-sqlite3's native addon (V8 API removals, no prebuild), and Node 22 had to be smuggled in via scratch space. bun (1.3.x) is available and is the preferred TypeScript runtime. Under bun: fastify and @fastify/swagger serve correctly, but light-my-request (`app.inject()`) — fastify's standard test seam — is broken by bun's node:http shim, and better-sqlite3's node-gyp build also fails. bun ships a built-in `bun:sqlite` whose API is near-identical to better-sqlite3 (prepare/run/get/all/transaction, FTS5 enabled).

## Decision

- bun is the runtime and package manager: `bun install`, `bun test`, `bun src/index.ts`.
- SQLite access via the built-in `bun:sqlite` (`new Database(path)`); no native addon dependency at all.
- Tests use bun's built-in runner (`bun:test`, jest-compatible API). Because `app.inject()` is incompatible, the shared test helper starts the app on an ephemeral real port (`listen({ port: 0 })`) and exposes an `inject(opts)` adapter with fastify-inject's call signature backed by `fetch` with `redirect: 'manual'`.
- TypeScript stays the language; `tsc --noEmit` remains the type checker via `bun-types`.
- Known bun:sqlite API deltas honored in code: named parameters bind with the prefix included in the object key (`{ '@id': 1 }`) — prefer positional `?` params; `.get()` returns `null` (not `undefined`) for no rows.

## Consequences

- Zero native-module builds; install is fast and sandbox-friendly (bun needs BUN_INSTALL/BUN_TMPDIR/BUN_CACHE_DIR redirected into git-ignored scratch on machines with read-only home dirs).
- Tests hit a real listening server — slightly slower than inject, but exercises the true HTTP path (arguably better fidelity).
- Lock-in to bun as runtime; `src/index.ts` and scripts use bun directly. Moving back to Node later means swapping `bun:sqlite` for better-sqlite3 in one file plus the test helper.
