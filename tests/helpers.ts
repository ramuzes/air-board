// tests/helpers.ts
import { afterAll } from 'bun:test'
import { buildApp } from '../src/http/app.js'
import { openDb, type DB } from '../src/store/db.js'
import { createUser, createToken } from '../src/store/users.js'
import type { FastifyInstance } from 'fastify'
import { loadConfig } from '../src/config.js'

// Real ephemeral listener + fetch adapter with fastify-inject's call signature (ADR 0005).
// afterAll inside setup() registers per-call cleanup for whichever test file imports this.
export async function setup(): Promise<{ app: FastifyInstance; db: DB; auth: { authorization: string }; inject: (opts: { method: string; url: string; headers?: any; payload?: any }) => Promise<{ statusCode: number; headers: any; body: string; json: () => any }> }> {
  const db = openDb(':memory:')
  const u = createUser(db, { username: 'tester', displayName: 'Tester' })
  const { token } = createToken(db, u.id, 'test')
  const app = await buildApp({ config: loadConfig({ GITLAB_WEBHOOK_SECRET: 's' }), db })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const base = 'http://127.0.0.1:' + (app.server.address() as any).port
  afterAll(async () => { await app.close(); db.close() })
  const inject = async (opts: { method: string; url: string; headers?: any; payload?: any }) => {
    const res = await fetch(base + opts.url, {
      method: opts.method,
      headers: {
        ...(opts.payload !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.headers ?? {})
      },
      body: opts.payload !== undefined ? JSON.stringify(opts.payload) : undefined,
      redirect: 'manual'
    })
    const body = await res.text()
    return { statusCode: res.status, headers: res.headers, body, json: () => JSON.parse(body) }
  }
  return { app, db, auth: { authorization: 'Bearer ' + token }, inject }
}
