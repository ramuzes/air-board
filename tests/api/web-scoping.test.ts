import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

describe('web UI scoping and project creation', () => {
  it('global session can create a project via the form', async () => {
    const { app, auth, inject } = await setup()
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    const home = await inject({ method: 'GET', url: '/', headers: { cookie: 'ab_token=' + tok } })
    expect(home.body).toContain('New project')
    const form = 'key=NEW&name=Brand+New&gitlab_repo_url='
    const create = await inject({ method: 'POST', url: '/projects', headers: { cookie: 'ab_token=' + tok, 'content-type': 'application/x-www-form-urlencoded' }, payload: form })
    expect(create.statusCode).toBe(302)
    const after = await inject({ method: 'GET', url: '/', headers: { cookie: 'ab_token=' + tok } })
    expect(after.body).toContain('/p/NEW')
  })
  it('scoped session sees only bound projects, no create form, 403 elsewhere', async () => {
    const { app, auth, inject } = await setup()
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'ONE', name: 'One' } })
    await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'TWO', name: 'Two' } })
    const mint = await inject({ method: 'POST', url: '/api/users/1/tokens', headers: auth, payload: { label: 'ui-scoped', global: false, project_keys: ['ONE'] } })
    const scoped = 'ab_token=' + mint.json().token
    const home = await inject({ method: 'GET', url: '/', headers: { cookie: scoped } })
    expect(home.statusCode).toBe(200)
    expect(home.body).toContain('/p/ONE')
    expect(home.body).not.toContain('/p/TWO')
    expect(home.body).not.toContain('New project')
    const denied = await inject({ method: 'GET', url: '/p/TWO', headers: { cookie: scoped } })
    expect(denied.statusCode).toBe(403)
    const tokens = await inject({ method: 'GET', url: '/tokens', headers: { cookie: scoped } })
    expect(tokens.statusCode).toBe(403)
  })
  it('global session can change the gitlab repo url from the project page', async () => {
    const { auth, inject } = await setup()
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'GL', name: 'Git' } })
    const page = await inject({ method: 'GET', url: '/p/GL', headers: { cookie: 'ab_token=' + tok } })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('GitLab')
    expect(page.body).toContain('Current repo')
    const save = await inject({ method: 'POST', url: '/p/GL/repo', headers: { cookie: 'ab_token=' + tok, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'gitlab_repo_url=https%3A%2F%2Fgitlab.example.com%2Fteam%2Fgl.git' })
    expect(save.statusCode).toBe(302)
    const after = await inject({ method: 'GET', url: '/p/GL', headers: { cookie: 'ab_token=' + tok } })
    expect(after.body).toContain('https://gitlab.example.com/team/gl.git')
    const viaApi = await inject({ method: 'GET', url: '/api/projects/GL', headers: auth })
    expect(viaApi.json().gitlab_repo_url).toBe('https://gitlab.example.com/team/gl.git')
  })
  it('tokens page shows scope and rebinds projects via checkboxes', async () => {
    const { app, auth, inject } = await setup()
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'ONE', name: 'One' } })
    await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'TWO', name: 'Two' } })
    const mint = await inject({ method: 'POST', url: '/api/users/1/tokens', headers: auth, payload: { label: 'sc', global: false, project_keys: ['ONE'] } })
    const page = await inject({ method: 'GET', url: '/tokens', headers: { cookie: 'ab_token=' + tok } })
    expect(page.body).toContain('ONE')
    expect(page.body).toContain('Rebind')
    const rebind = await inject({ method: 'POST', url: '/tokens/' + mint.json().id + '/projects', headers: { cookie: 'ab_token=' + tok, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'project_keys=TWO' })
    expect(rebind.statusCode).toBe(302)
    const scopedCookie = 'ab_token=' + mint.json().token
    expect((await inject({ method: 'GET', url: '/p/TWO', headers: { cookie: scopedCookie } })).statusCode).toBe(200)
    expect((await inject({ method: 'GET', url: '/p/ONE', headers: { cookie: scopedCookie } })).statusCode).toBe(403)
  })
})
