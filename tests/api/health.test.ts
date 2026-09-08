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
