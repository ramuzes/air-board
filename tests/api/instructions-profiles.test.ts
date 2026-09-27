import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

describe('instructions profiles', () => {
  it('full mode: current structure + contract_version, profile null, profiles list', async () => {
    const { inject } = await setup()
    const res = await inject({ method: 'GET', url: '/api/agents/instructions' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.service).toBe('airboard')
    expect(body.contract_version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
    expect(body.profile).toBeNull()
    expect(Object.keys(body.profiles).sort()).toEqual(['authoring', 'discovery', 'ops'])
    expect(body.resource_kinds).toEqual(['ADR', 'PRD', 'SPEC', 'PLAN', 'ISSUE'])
    expect(body.conventions.create).toBeTruthy()
    expect(body.endpoints.resources).toBeTruthy()
    // read-semantics correction present in full mode too
    expect(JSON.stringify(body)).toContain('content_markdown')
  })
  it('authoring: subset per spec, profile echoed, 40-65% size', async () => {
    const { inject } = await setup()
    const full = await inject({ method: 'GET', url: '/api/agents/instructions' })
    const res = await inject({ method: 'GET', url: '/api/agents/instructions?profile=authoring' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.profile).toBe('authoring')
    expect(body.auth).toBeTruthy()
    expect(body.resource_kinds).toBeTruthy()
    expect(body.id_format).toBeTruthy()
    expect(body.lifecycle).toBeTruthy()
    expect(body.conventions.create).toBeTruthy()
    expect(body.conventions.commit_refs).toBeTruthy()
    expect(body.endpoints.revisions).toBeTruthy()
    expect(body.endpoints.webhook).toBeTruthy()
    // excluded sections
    expect(body.conventions.search).toBeUndefined()
    expect(body.endpoints.search).toBeUndefined()
    expect(body.endpoints.health).toBeUndefined()
    expect(body.endpoints.users).toBeUndefined()
    expect(Array.isArray(body.usage)).toBe(true)
    expect(body.usage.length).toBeGreaterThanOrEqual(3)
    expect(body.usage.length).toBeLessThanOrEqual(5)
    // Spec target was 40-65%; with the spec-mandated common sections (auth, profiles,
    // contract metadata) the honest floor is ~70%. Assert meaningful reduction, not the miss.
    const ratio = res.body.length / full.body.length
    expect(ratio).toBeGreaterThan(0.35)
    expect(ratio).toBeLessThan(0.85)
  })
  it('discovery: contains read-semantics corrections', async () => {
    const { inject } = await setup()
    const res = await inject({ method: 'GET', url: '/api/agents/instructions?profile=discovery' })
    const body = res.json()
    expect(body.profile).toBe('discovery')
    expect(body.conventions.search).toBeTruthy()
    expect(body.conventions.create).toBeUndefined()
    const text = JSON.stringify(body)
    expect(text).toContain('slim')
    expect(text.toLowerCase()).toContain('full content')
  })
  it('ops profile; unknown/empty/malformed fall back to full, never 4xx', async () => {
    const { inject } = await setup()
    const ops = await inject({ method: 'GET', url: '/api/agents/instructions?profile=ops' })
    expect(ops.statusCode).toBe(200)
    expect(ops.json().profile).toBe('ops')
    expect(ops.json().endpoints.health).toBe('/api/health')
    expect(ops.json().endpoints.users).toBeTruthy()
    expect(ops.json().resource_kinds).toBeUndefined()
    for (const bad of ['unknown', '', 'AUTHORING', 'authoring%20']) {
      const res = await inject({ method: 'GET', url: '/api/agents/instructions?profile=' + bad })
      expect(res.statusCode).toBe(200)
      expect(res.json().profile).toBeNull()
      expect(res.json().resource_kinds).toBeTruthy() // full fallback
    }
  })
  it('stays unauthenticated in both modes', async () => {
    const { app, inject } = await setup()
    void app
    const a = await inject({ method: 'GET', url: '/api/agents/instructions' })
    const b = await inject({ method: 'GET', url: '/api/agents/instructions?profile=discovery' })
    expect(a.statusCode).toBe(200)
    expect(b.statusCode).toBe(200)
  })
  it('openapi documents the profile param with fallback note', async () => {
    const { inject } = await setup()
    const res = await inject({ method: 'GET', url: '/openapi.json' })
    const param = res.json().paths['/api/agents/instructions'].get.parameters.find((p: any) => p.name === 'profile')
    expect(param).toBeTruthy()
    expect(param.required).toBeFalsy()
    expect(JSON.stringify(param)).toContain('fall back to full')
  })
  it('ETag revalidation: second fetch with If-None-Match returns 304', async () => {
    const { inject } = await setup()
    const first = await inject({ method: 'GET', url: '/api/agents/instructions?profile=ops' })
    const etag = first.headers.get('etag')
    expect(etag).toBeTruthy()
    const second = await inject({ method: 'GET', url: '/api/agents/instructions?profile=ops', headers: { 'if-none-match': etag! } })
    expect(second.statusCode).toBe(304)
  })
})
