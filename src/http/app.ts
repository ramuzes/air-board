// src/http/app.ts
import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import swagger from '@fastify/swagger'
import type { Config } from '../config.js'
import type { DB } from '../store/db.js'
import { makeRequireAuth } from './auth.js'
import { registerUserRoutes } from './routes/users.js'
import { registerProjectRoutes } from './routes/projects.js'
import { registerResourceRoutes } from './routes/resources.js'
import { registerAgentRoutes } from './routes/agents.js'
import { registerWebRoutes } from './routes/web.js'
import { createGitlabPlugin } from '../plugins/gitlab.js'
import { registerConnector, listConnectors } from '../plugins/registry.js'

export interface BuildOpts { config: Config; db: DB }

export async function buildApp(opts: BuildOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  // inside buildApp, first registration:
  await app.register(swagger, { openapi: { info: { title: 'AirBoard API', version: '0.1.0' } } })
  await app.register(cookie)
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url === '/openapi.json' || req.url === '/AGENTS.md') {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route ' + req.method + ':' + req.url + ' not found' } })
    } else {
      reply.status(404).send('Not found')
    }
  })
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as any).status ?? (err as any).statusCode ?? 500
    const code = (err as any).code ?? 'INTERNAL'
    const envelope: any = { error: { code, message: err.message } }
    if ((err as any).details !== undefined) envelope.error.details = (err as any).details
    reply.status(status).send(envelope)
  })
  // inside buildApp, before route registrations:
  app.decorate('requireAuth', makeRequireAuth(opts.db))
  registerUserRoutes(app, opts.db)
  registerProjectRoutes(app, opts.db)
  registerResourceRoutes(app, opts.db)
  registerConnector(app, opts.db, createGitlabPlugin(opts.config))
  registerAgentRoutes(app, opts.config)
  registerWebRoutes(app, opts.db)
  app.get('/api/plugins', { preHandler: [app.requireAuth] }, async () =>
    listConnectors().map((c) => ({ id: c.id, display_name: c.displayName, webhook_url: c.webhookPath })))
  app.get('/api/health', async () => ({ status: 'ok' }))
  // after all routes are registered:
  app.get('/openapi.json', async () => app.swagger())
  return app
}
