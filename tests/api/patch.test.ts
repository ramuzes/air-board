// tests/api/patch.test.ts
import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

async function seed(inject: any, auth: any) {
  await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
  await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ADR', title: 'T', markdown: 'v1' } })
}

describe('PATCH resource', () => {
  it('content change appends a revision', async () => {
    const { app, auth, inject } = await setup()
    await seed(inject, auth)
    const res = await inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { content_markdown: 'v2' } })
    expect(res.json().rev).toBe(2)
    expect(res.json().content_markdown).toBe('v2')
    const revs = await inject({ method: 'GET', url: '/api/projects/CORE/resources/ADR-1/revisions', headers: auth })
    expect(revs.json()).toHaveLength(2)
  })
  it('status transition works and does not bump revisions', async () => {
    const { app, auth, inject } = await setup()
    await seed(inject, auth)
    const res = await inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { status: 'active' } })
    expect(res.json().status).toBe('active')
    expect(res.json().rev).toBe(1)
  })
  it('invalid transition is 422', async () => {
    const { app, auth, inject } = await setup()
    await seed(inject, auth)
    const res = await inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { status: 'done' } })
    expect(res.statusCode).toBe(422)
    expect(res.json().error.code).toBe('INVALID_TRANSITION')
  })
  it('content + invalid status rolls back the revision', async () => {
    const { app, auth, inject } = await setup()
    await seed(inject, auth)
    const res = await inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { content_markdown: 'v2', status: 'done' } })
    expect(res.statusCode).toBe(422)
    const after = await inject({ method: 'GET', url: '/api/projects/CORE/resources/ADR-1', headers: auth })
    expect(after.json().rev).toBe(1)
    expect(after.json().content_markdown).toBe('v1')
  })
  it('cancelled resources disappear from default list but are fetchable', async () => {
    const { app, auth, inject } = await setup()
    await seed(inject, auth)
    await inject({ method: 'PATCH', url: '/api/projects/CORE/resources/ADR-1', headers: auth, payload: { status: 'cancelled' } })
    const list = await inject({ method: 'GET', url: '/api/projects/CORE/resources', headers: auth })
    expect(list.json()).toHaveLength(0)
    const got = await inject({ method: 'GET', url: '/api/projects/CORE/resources/ADR-1', headers: auth })
    expect(got.json().status).toBe('cancelled')
    const cancelledList = await inject({ method: 'GET', url: '/api/projects/CORE/resources?status=cancelled', headers: auth })
    expect(cancelledList.json()).toHaveLength(1)
  })
})
