// tests/api/bindings.test.ts
import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

async function seed(inject: any, auth: any) {
  await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
  await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ISSUE', title: 'Bug', markdown: 'm' } })
}

describe('manual bindings', () => {
  it('adds, lists, and dedups a binding', async () => {
    const { app, auth, inject } = await setup()
    await seed(inject, auth)
    const add = await inject({ method: 'POST', url: '/api/projects/CORE/resources/ISSUE-1/bindings', headers: auth,
      payload: { repo_url: 'https://gitlab.example.com/team/core.git', sha: 'abc123def456' } })
    expect(add.statusCode).toBe(201)
    const again = await inject({ method: 'POST', url: '/api/projects/CORE/resources/ISSUE-1/bindings', headers: auth,
      payload: { repo_url: 'https://gitlab.example.com/team/core.git', sha: 'abc123def456' } })
    expect(again.statusCode).toBe(200)
    expect(again.json().duplicate).toBe(true)
    const list = await inject({ method: 'GET', url: '/api/projects/CORE/resources/ISSUE-1/bindings', headers: auth })
    expect(list.json()).toHaveLength(1)
    expect(list.json()[0].sha).toBe('abc123def456')
  })
  it('validates payload', async () => {
    const { app, auth, inject } = await setup()
    await seed(inject, auth)
    const bad = await inject({ method: 'POST', url: '/api/projects/CORE/resources/ISSUE-1/bindings', headers: auth, payload: { repo_url: 'x' } })
    expect(bad.statusCode).toBe(400)
  })
})
