// tests/api/resources.test.ts
import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

async function mkProject(inject: any, auth: any, key = 'CORE') {
  const r = await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key, name: key } })
  return r.json()
}

describe('resources api', () => {
  it('creates a resource with allocated id and revision 1', async () => {
    const { app, auth, inject } = await setup()
    await mkProject(inject, auth)
    const res = await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth,
      payload: { kind: 'ADR', title: 'Use SQLite', markdown: 'Because simple.' } })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.id).toBe('ADR-1')
    expect(body.status).toBe('draft')
    expect(body.rev).toBe(1)
    expect(body.content_markdown).toBe('Because simple.')
  })
  it('allocates monotonic numbers per kind', async () => {
    const { app, auth, inject } = await setup()
    await mkProject(inject, auth)
    for (let i = 1; i <= 3; i++) {
      await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ISSUE', title: 't' + i, markdown: 'm' } })
    }
    const list = await inject({ method: 'GET', url: '/api/projects/CORE/resources?kind=ISSUE', headers: auth })
    expect(list.json().map((r: any) => r.id)).toEqual(['ISSUE-1', 'ISSUE-2', 'ISSUE-3'])
  })
  it('gets a resource and its revisions; 404 for unknown id', async () => {
    const { app, auth, inject } = await setup()
    await mkProject(inject, auth)
    await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'SPEC', title: 'S', markdown: 'v1' } })
    const got = await inject({ method: 'GET', url: '/api/projects/CORE/resources/SPEC-1', headers: auth })
    expect(got.json().title).toBe('S')
    const revs = await inject({ method: 'GET', url: '/api/projects/CORE/resources/SPEC-1/revisions', headers: auth })
    expect(revs.json()).toHaveLength(1)
    const rev1 = await inject({ method: 'GET', url: '/api/projects/CORE/resources/SPEC-1/revisions/1', headers: auth })
    expect(rev1.json().content_markdown).toBe('v1')
    const nf = await inject({ method: 'GET', url: '/api/projects/CORE/resources/SPEC-99', headers: auth })
    expect(nf.statusCode).toBe(404)
  })
  it('rejects invalid kind with 400', async () => {
    const { app, auth, inject } = await setup()
    await mkProject(inject, auth)
    const res = await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'EPIC', title: 'x', markdown: 'm' } })
    expect(res.statusCode).toBe(400)
  })
  it('full-text search matches titles and content, and reindexes on revision', async () => {
    const { app, auth, inject } = await setup()
    await mkProject(inject, auth)
    await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ADR', title: 'Search engine choice', markdown: 'We will use bleve for indexing.' } })
    await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ISSUE', title: 'Unrelated', markdown: 'nothing here' } })
    const byTitle = await inject({ method: 'GET', url: '/api/projects/CORE/resources?q=search', headers: auth })
    expect(byTitle.json().map((r: any) => r.id)).toEqual(['ADR-1'])
    const byContent = await inject({ method: 'GET', url: '/api/projects/CORE/resources?q=bleve', headers: auth })
    expect(byContent.json().map((r: any) => r.id)).toEqual(['ADR-1'])
    // update content: old term disappears, new term appears (trigger reindexes latest revision only)
    await inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { content_markdown: 'switched to zinc instead' } })
    const oldTerm = await inject({ method: 'GET', url: '/api/projects/CORE/resources?q=bleve', headers: auth })
    expect(oldTerm.json()).toHaveLength(0)
    const newTerm = await inject({ method: 'GET', url: '/api/projects/CORE/resources?q=zinc', headers: auth })
    expect(newTerm.json().map((r: any) => r.id)).toEqual(['ADR-1'])
  })
  it('GET /api/search spans projects and tolerates bad fts syntax', async () => {
    const { app, auth, inject } = await setup()
    await mkProject(inject, auth, 'ONE')
    await mkProject(inject, auth, 'TWO')
    await inject({ method: 'POST', url: '/api/projects/ONE/resources', headers: auth, payload: { kind: 'ADR', title: 'alpha design', markdown: 'm' } })
    await inject({ method: 'POST', url: '/api/projects/TWO/resources', headers: auth, payload: { kind: 'ISSUE', title: 'beta bug', markdown: 'm' } })
    const res = await inject({ method: 'GET', url: '/api/search?q=beta', headers: auth })
    expect(res.json()).toHaveLength(1)
    expect(res.json()[0].project_key).toBe('TWO')
    const junk = await inject({ method: 'GET', url: '/api/search?q=' + encodeURIComponent('NEAR('), headers: auth })
    expect(junk.statusCode).toBe(200)
  })
})
