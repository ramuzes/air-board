// tests/api/projects.test.ts
import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'

describe('projects api', () => {
  it('creates, lists, gets, and sets gitlab repo', async () => {
    const { app, auth, inject } = await setup()
    const bad = await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'x', name: 'X' } })
    expect(bad.statusCode).toBe(400)
    const create = await inject({ method: 'POST', url: '/api/projects', headers: auth, payload: { key: 'CORE', name: 'Core' } })
    expect(create.statusCode).toBe(201)
    expect(create.json().key).toBe('CORE')
    const list = await inject({ method: 'GET', url: '/api/projects', headers: auth })
    expect(list.json()).toHaveLength(1)
    const get = await inject({ method: 'GET', url: '/api/projects/CORE', headers: auth })
    expect(get.json().name).toBe('Core')
    const patch = await inject({ method: 'PATCH', url: '/api/projects/CORE', headers: auth, payload: { gitlab_repo_url: 'https://gitlab.example.com/team/core.git' } })
    expect(patch.json().gitlab_repo_url).toBe('https://gitlab.example.com/team/core.git')
    const missing = await inject({ method: 'GET', url: '/api/projects/NOPE', headers: auth })
    expect(missing.statusCode).toBe(404)
  })
})
