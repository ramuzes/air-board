// src/plugins/registry.ts
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ConnectorPlugin } from './types.js'
import type { DB } from '../store/db.js'

const connectors: ConnectorPlugin[] = []

export function registerConnector(app: FastifyInstance, db: DB, plugin: ConnectorPlugin): void {
  if (!connectors.some((c) => c.id === plugin.id)) connectors.push(plugin)
  if (plugin.webhookPath) {
    const handler = async (req: FastifyRequest) => {
      plugin.verifyWebhook(req)
      const ctx = plugin.webhookProjectParam ? { projectKey: String((req.params as any)?.[plugin.webhookProjectParam] ?? '') || undefined } : undefined
      return plugin.handleWebhook(db, req.body, req.headers, ctx)
    }
    app.post(plugin.webhookPath, handler)
    if (plugin.webhookProjectParam) app.post(plugin.webhookPath + '/:' + plugin.webhookProjectParam, handler)
  }
}
export function listConnectors(): ConnectorPlugin[] { return [...connectors] }
export function commitUrlFor(repoUrl: string, sha: string): string | null {
  for (const c of connectors) if (c.commitUrl) return c.commitUrl(repoUrl, sha)
  return null
}
