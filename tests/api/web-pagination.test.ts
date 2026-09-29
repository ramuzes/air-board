import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'
import { createProject } from '../../src/store/projects.js'
import { createResource } from '../../src/store/resources.js'

describe('web resource list: newest first + pagination (50/page)', () => {
  it('sorts by creation desc and pages at 50', async () => {
    const { app, auth, inject, db } = await setup()
    void app
    const p = createProject(db, { key: 'PAGE', name: 'P' })
    for (let i = 1; i <= 55; i++) {
      createResource(db, { projectId: p.id, kind: 'ISSUE', title: 'issue ' + i, contentMarkdown: 'm', userId: 1 })
    }
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    const cookie = 'ab_token=' + tok

    const page1 = await inject({ method: 'GET', url: '/p/PAGE', headers: { cookie } })
    expect(page1.statusCode).toBe(200)
    const ids1 = [...new Set([...page1.body.matchAll(/ISSUE-(\d+)/g)].map((m) => Number(m[1])))]
    expect(ids1).toHaveLength(50)
    expect(ids1[0]).toBe(55)          // newest first
    expect(ids1[49]).toBe(6)
    expect(page1.body).toContain('page 1 / 2')
    expect(page1.body).toContain('page=2') // next link

    const page2 = await inject({ method: 'GET', url: '/p/PAGE?page=2', headers: { cookie } })
    const ids2 = [...new Set([...page2.body.matchAll(/ISSUE-(\d+)/g)].map((m) => Number(m[1])))]
    expect(ids2).toHaveLength(5)
    expect(ids2[0]).toBe(5)
    expect(page2.body).toContain('page 2 / 2')

    const page3 = await inject({ method: 'GET', url: '/p/PAGE?page=3', headers: { cookie } })
    expect(page3.statusCode).toBe(200)
    expect(page3.body).not.toContain('ISSUE-') // empty page, no rows
  })
  it('keeps filters across pagination links', async () => {
    const { auth, inject, db } = await setup()
    const p = createProject(db, { key: 'FLT', name: 'F' })
    for (let i = 1; i <= 51; i++) createResource(db, { projectId: p.id, kind: 'ADR', title: 'a' + i, contentMarkdown: 'm', userId: 1 })
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    const res = await inject({ method: 'GET', url: '/p/FLT?kind=ADR', headers: { cookie: 'ab_token=' + tok } })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('kind=ADR&page=2')
  })
})
