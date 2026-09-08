import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

const PUSH = (msg: string, sha = 'deadbeef', uuid = 'evt-1') => ({
  object_kind: 'push',
  event_uuid: uuid,
  project: { git_http_url: 'https://gitlab.example.com/team/core.git', web_url: 'https://gitlab.example.com/team/core' },
  commits: [{ id: sha, message: msg, timestamp: '2026-09-08T10:00:00Z' }]
})

async function seed(inject: any, auth: any) {
  await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core', gitlab_repo_url: 'https://gitlab.example.com/team/core.git' } })
  await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ADR', title: 'A', markdown: 'm' } })
  await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ISSUE', title: 'I', markdown: 'm' } })
}

describe('gitlab webhook', () => {
  it('rejects missing or wrong secret', async () => {
    const { inject } = await setup()
    const noTok = await inject({ method: 'POST', url: '/api/plugins/gitlab/webhook', payload: PUSH('x') })
    expect(noTok.statusCode).toBe(401)
    const badTok = await inject({ method: 'POST', url: '/api/plugins/gitlab/webhook', headers: { 'x-gitlab-token': 'wrong' }, payload: PUSH('x') })
    expect(badTok.statusCode).toBe(401)
    expect(badTok.json().error.code).toBe('WEBHOOK_SECRET')
  })
  it('binds commits whose messages reference resource ids', async () => {
    const { auth, inject } = await setup()
    await seed(inject, auth)
    const res = await inject({ method: 'POST', url: '/api/plugins/gitlab/webhook', headers: { 'x-gitlab-token': 's' }, payload: PUSH('implement ADR-1 and closes ISSUE-1') })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ bound: 2, duplicates: 0 })
    const b1 = await inject({ method: 'GET', url: '/api/projects/CORE/resources/ADR-1/bindings', headers: auth })
    expect(b1.json()[0].sha).toBe('deadbeef')
    expect(b1.json()[0].commit_url).toBe('https://gitlab.example.com/team/core/-/commit/deadbeef')
  })
  it('is idempotent on repeated event_uuid', async () => {
    const { auth, inject } = await setup()
    await seed(inject, auth)
    const h = { 'x-gitlab-token': 's' }
    await inject({ method: 'POST', url: '/api/plugins/gitlab/webhook', headers: h, payload: PUSH('refs ADR-1') })
    const dup = await inject({ method: 'POST', url: '/api/plugins/gitlab/webhook', headers: h, payload: PUSH('refs ADR-1') })
    expect(dup.json()).toEqual({ bound: 0, duplicates: 1 })
  })
  it('same commit binding another resource is not a duplicate; unbound refs are ignored', async () => {
    const { auth, inject } = await setup()
    await seed(inject, auth)
    const res = await inject({ method: 'POST', url: '/api/plugins/gitlab/webhook', headers: { 'x-gitlab-token': 's' }, payload: PUSH('ADR-1 ISSUE-1 ADR-99') })
    expect(res.json()).toEqual({ bound: 2, duplicates: 0 })
  })
  it('ignores repos not bound to any project', async () => {
    const { auth, inject } = await setup()
    await seed(inject, auth)
    const p = { ...PUSH('refs ADR-1'), project: { git_http_url: 'https://gitlab.example.com/other/x.git' } }
    const res = await inject({ method: 'POST', url: '/api/plugins/gitlab/webhook', headers: { 'x-gitlab-token': 's' }, payload: p })
    expect(res.statusCode).toBe(200)
    expect(res.json().bound).toBe(0)
  })
})
