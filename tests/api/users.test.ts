// tests/api/users.test.ts
import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

describe('users & tokens api', () => {
  it('rejects anonymous calls with 401 envelope', async () => {
    const { app, inject } = await setup()
    const res = await inject({ method: 'GET', url: '/api/users' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('UNAUTHORIZED')
  })
  it('creates a user, mints and revokes a token', async () => {
    const { app, auth, inject } = await setup()
    const create = await inject({ method: 'POST', url: '/api/users', headers: auth, payload: { username: 'dave', display_name: 'Dave' } })
    expect(create.statusCode).toBe(201)
    const userId = create.json().id
    const mint = await inject({ method: 'POST', url: '/api/users/' + userId + '/tokens', headers: auth, payload: { label: 'agent' } })
    expect(mint.statusCode).toBe(201)
    expect(mint.json().token).toMatch(/^abt_[0-9a-f]{32}$/)
    const tokenId = mint.json().id
    const list = await inject({ method: 'GET', url: '/api/users', headers: auth })
    expect(list.json().some((u: any) => u.username === 'dave')).toBe(true)
    const revoke = await inject({ method: 'DELETE', url: '/api/tokens/' + tokenId, headers: auth })
    expect(revoke.statusCode).toBe(204)
    const bad = await inject({ method: 'GET', url: '/api/users', headers: { authorization: 'Bearer ' + mint.json().token } })
    expect(bad.statusCode).toBe(401)
  })
})
