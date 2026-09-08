// src/plugins/registry.ts
import type { FastifyInstance } from 'fastify'
import type { ConnectorPlugin } from './types.js'
import type { DB } from '../store/db.js'

const connectors: ConnectorPlugin[] = []

export function registerConnector(app: FastifyInstance, db: DB, plugin: ConnectorPlugin): void {
  if (!connectors.some((c) => c.id === plugin.id)) connectors.push(plugin)
  if (plugin.webhookPath) {
    app.post(plugin.webhookPath, async (req) => {
      plugin.verifyWebhook(req)
      return plugin.handleWebhook(db, req.body, req.headers)
    })
  }
}
export function listConnectors(): ConnectorPlugin[] { return [...connectors] }
export function commitUrlFor(repoUrl: string, sha: string): string | null {
  for (const c of connectors) if (c.commitUrl) return c.commitUrl(repoUrl, sha)
  return null
}
