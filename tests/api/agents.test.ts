// tests/api/agents.test.ts
import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

describe('agent instructions', () => {
  it('serves JSON instructions without auth', async () => {
    const { app, inject } = await setup()
    const res = await inject({ method: 'GET', url: '/api/agents/instructions' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.auth.scheme).toBe('bearer')
    expect(body.resource_kinds).toEqual(['ADR', 'PRD', 'SPEC', 'PLAN', 'ISSUE'])
    expect(body.openapi_url).toBe('/openapi.json')
  })
  it('serves AGENTS.md as markdown', async () => {
    const { app, inject } = await setup()
    const res = await inject({ method: 'GET', url: '/AGENTS.md' })
    expect(res.statusCode).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/markdown')
    expect(res.body).toContain('# AirBoard Agent Guide')
    expect(res.body).toContain('Bearer abt_')
  })
  it('serves openapi.json', async () => {
    const { app, inject } = await setup()
    const res = await inject({ method: 'GET', url: '/openapi.json' })
    expect(res.statusCode).toBe(200)
    expect(res.json().openapi).toMatch(/^3\./)
    expect(res.json().paths['/api/projects/{key}/resources']).toBeTruthy()
  })
})
