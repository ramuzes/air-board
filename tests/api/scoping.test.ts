import { describe, it, expect, beforeAll } from 'bun:test'
import { setup } from '../helpers.js'

// Builds: two projects, one scoped token bound to ONE only.
async function scoped() {
  const s = await setup()
  const { app, auth, inject, db } = s
  await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'ONE', name: 'One' } })
  await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'TWO', name: 'Two' } })
  await inject({ method: 'POST', url: '/api/projects/ONE/resources', headers: auth, payload: { kind: 'ADR', title: 'alpha decision', markdown: 'm' } })
  await inject({ method: 'POST', url: '/api/projects/TWO/resources', headers: auth, payload: { kind: 'ISSUE', title: 'beta bug', markdown: 'm' } })
  const mint = await inject({ method: 'POST', url: '/api/users/1/tokens', headers: auth, payload: { label: 'scoped', global: false, project_keys: ['ONE'] } })
  expect(mint.statusCode).toBe(201)
  return { ...s, scopedAuth: { authorization: 'Bearer ' + mint.json().token }, tokenId: mint.json().id }
}

describe('token project scoping', () => {
  it('scoped token: 200 on bound project, 403 on unbound', async () => {
    const { inject, scopedAuth } = await scoped()
    const ok = await inject({ method: 'GET', url: '/api/projects/ONE/resources', headers: scopedAuth })
    expect(ok.statusCode).toBe(200)
    const denied = await inject({ method: 'GET', url: '/api/projects/TWO/resources', headers: scopedAuth })
    expect(denied.statusCode).toBe(403)
    expect(denied.json().error.code).toBe('FORBIDDEN')
  })
  it('scoped token: write on bound project works, unbound 403', async () => {
    const { inject, scopedAuth } = await scoped()
    const create = await inject({ method: 'POST', url: '/api/projects/ONE/resources', headers: scopedAuth, payload: { kind: 'ISSUE', title: 'x', markdown: 'm' } })
    expect(create.statusCode).toBe(201)
    const patch = await inject({ method: 'PATCH', url: '/api/projects/TWO/resources/ISSUE-1', headers: scopedAuth, payload: { status: 'active' } })
    expect(patch.statusCode).toBe(403)
  })
  it('cross endpoints are filtered: project list and search', async () => {
    const { inject, scopedAuth } = await scoped()
    const list = await inject({ method: 'GET', url: '/api/projects', headers: scopedAuth })
    expect(list.json().map((p: any) => p.key)).toEqual(['ONE'])
    const search = await inject({ method: 'GET', url: '/api/search?q=beta', headers: scopedAuth })
    expect(search.json()).toHaveLength(0)
    const search2 = await inject({ method: 'GET', url: '/api/search?q=alpha', headers: scopedAuth })
    expect(search2.json().map((r: any) => r.project_key)).toEqual(['ONE'])
  })
  it('global-only endpoints reject scoped tokens', async () => {
    const { inject, scopedAuth } = await scoped()
    expect((await inject({ method: 'POST', url: '/api/projects', headers: scopedAuth, payload: { key: 'THR', name: 'T' } })).statusCode).toBe(403)
    expect((await inject({ method: 'GET', url: '/api/users', headers: scopedAuth })).statusCode).toBe(403)
    expect((await inject({ method: 'POST', url: '/api/users/1/tokens', headers: scopedAuth, payload: { label: 'escalate' } })).statusCode).toBe(403)
    expect((await inject({ method: 'PATCH', url: '/api/projects/ONE', headers: scopedAuth, payload: { name: 'X' } })).statusCode).toBe(403)
    expect((await inject({ method: 'GET', url: '/api/me/tokens', headers: scopedAuth })).statusCode).toBe(200)
  })
  it('global token still sees everything', async () => {
    const { inject, auth } = await scoped()
    const list = await inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(list.json().map((p: any) => p.key)).toEqual(['ONE', 'TWO'])
    expect((await inject({ method: 'GET', url: '/api/projects/TWO/resources', headers: auth })).statusCode).toBe(200)
  })
  it('rebinding via PUT /api/tokens/:id/projects changes access', async () => {
    const s = await scoped()
    const { inject, auth, scopedAuth, tokenId } = s
    const rebind = await inject({ method: 'PUT', url: '/api/tokens/' + tokenId + '/projects', headers: auth, payload: { project_keys: ['TWO'] } })
    expect(rebind.statusCode).toBe(200)
    expect((await inject({ method: 'GET', url: '/api/projects/TWO/resources', headers: scopedAuth })).statusCode).toBe(200)
    expect((await inject({ method: 'GET', url: '/api/projects/ONE/resources', headers: scopedAuth })).statusCode).toBe(403)
    expect((await inject({ method: 'PUT', url: '/api/tokens/' + tokenId + '/projects', headers: scopedAuth, payload: { project_keys: ['ONE'] } })).statusCode).toBe(403)
  })
  it('token listings show scope', async () => {
    const { inject, auth } = await scoped()
    const list = await inject({ method: 'GET', url: '/api/me/tokens', headers: auth })
    const scopedTok = list.json().find((t: any) => t.label === 'scoped')
    expect(scopedTok.is_global).toBe(0)
    expect(scopedTok.project_keys).toEqual(['ONE'])
  })
})
