// tests/api/web.test.ts
import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

function withCookie(res: any): string {
  return (res.headers as any).getSetCookie()[0].split(';')[0]
}

describe('web ui', () => {
  it('login page renders anonymously', async () => {
    const { app, inject } = await setup()
    const res = await inject({ method: 'GET', url: '/login' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('<form')
  })
  it('login with token sets cookie and shows project list', async () => {
    const { app, auth, inject } = await setup()
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    const login = await inject({ method: 'POST', url: '/login', payload: { token: tok } })
    expect(login.statusCode).toBe(302)
    const cookie = withCookie(login)
    const home = await inject({ method: 'GET', url: '/', headers: { cookie } })
    expect(home.statusCode).toBe(200)
    expect(home.body).toContain('Projects')
  })
  it('accepts form-encoded bodies like real html form posts', async () => {
    const { app, auth, inject } = await setup()
    await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
    await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ADR', title: 'T', markdown: 'hello' } })
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    const login = await inject({ method: 'POST', url: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'token=' + tok })
    expect(login.statusCode).toBe(302)
    const cookie = withCookie(login)
    const st = await inject({ method: 'POST', url: '/p/CORE/ADR-1/status', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, payload: 'status=active' })
    expect(st.statusCode).toBe(302)
    const after = await inject({ method: 'GET', url: '/p/CORE/ADR-1', headers: { cookie } })
    expect(after.statusCode).toBe(200)
    expect(after.body).toContain('active')
  })
  it('resource detail renders markdown, escapes html, transitions', async () => {
    const { app, auth, inject } = await setup()
    await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
    await inject({ method: 'POST', url: '/api/projects/CORE/resources', headers: auth, payload: { kind: 'ADR', title: 'T <b>x</b>', markdown: 'hello\n\nworld' } })
    const tok = (auth.authorization.match(/Bearer (.+)/) as any)[1]
    const cookie = 'ab_token=' + tok
    const page = await inject({ method: 'GET', url: '/p/CORE/ADR-1', headers: { cookie } })
    expect(page.statusCode).toBe(200)
    expect(page.body).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(page.body).toContain('<p>hello</p>')
    const st = await inject({ method: 'POST', url: '/p/CORE/ADR-1/status', headers: { cookie }, payload: { status: 'active' } })
    expect(st.statusCode).toBe(302)
    const after = await inject({ method: 'GET', url: '/p/CORE/ADR-1', headers: { cookie } })
    expect(after.body).toContain('active')
  })
  it('rejects unauthenticated browsing with redirect to /login', async () => {
    const { app, inject } = await setup()
    const res = await inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })
})
