import { describe, it, expect } from 'bun:test'
import { setup } from '../helpers.js'
import { createGitlabPlugin } from '../../src/plugins/gitlab.js'

describe('connector registry', () => {
  it('lists the gitlab connector with its webhook url', async () => {
    const { auth, inject } = await setup()
    const res = await inject({ method: 'GET', url: '/api/plugins', headers: auth })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual([{ id: 'gitlab', display_name: 'GitLab', webhook_url: '/api/plugins/gitlab/webhook' }])
  })
  it('requires auth', async () => {
    const { inject } = await setup()
    const res = await inject({ method: 'GET', url: '/api/plugins' })
    expect(res.statusCode).toBe(401)
  })
  it('derives commit urls, stripping .git', () => {
    const p = createGitlabPlugin({ dbPath: ':memory:', port: 1, baseUrl: 'http://x', gitlabWebhookSecret: 's', initialAccessToken: '' })
    expect(p.commitUrl!('https://gitlab.example.com/team/core.git', 'abc')).toBe('https://gitlab.example.com/team/core/-/commit/abc')
  })
})
