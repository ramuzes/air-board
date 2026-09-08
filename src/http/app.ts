// src/http/app.ts
import Fastify, { FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { Config } from '../config.js'

export interface BuildOpts { config: Config }

export async function buildApp(opts: BuildOpts): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })
  await app.register(cookie)
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url === '/openapi.json' || req.url === '/AGENTS.md') {
      reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Route ' + req.method + ':' + req.url + ' not found' } })
    } else {
      reply.status(404).send('Not found')
    }
  })
  app.setErrorHandler((err, _req, reply) => {
    const status = (err as any).status ?? 500
    const code = (err as any).code ?? 'INTERNAL'
    const envelope: any = { error: { code, message: err.message } }
    if ((err as any).details !== undefined) envelope.error.details = (err as any).details
    reply.status(status).send(envelope)
  })
  app.get('/api/health', async () => ({ status: 'ok' }))
  return app
}
