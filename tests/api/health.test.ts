// tests/api/health.test.ts
import { describe, it, expect, afterAll } from 'bun:test'
import { buildApp } from '../../src/http/app.js'
import { openDb } from '../../src/store/db.js'

// Real ephemeral listener — fastify's inject() is incompatible with bun (ADR 0005);
// fetch with redirect: 'manual' so 302s are inspectable (same pattern the shared helper uses)
const db = openDb(':memory:')
const app = await buildApp({ config: { dbPath: ':memory:', port: 3000, baseUrl: 'http://x', gitlabWebhookSecret: 's', initialAccessToken: '' }, db })
await app.listen({ port: 0, host: '127.0.0.1' })
const base = 'http://127.0.0.1:' + (app.server.address() as any).port
afterAll(async () => { await app.close(); db.close() })

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await fetch(base + '/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('uses the error envelope for unknown routes under /api', async () => {
    const res = await fetch(base + '/api/nope')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'Route GET:/api/nope not found' } })
  })
})
