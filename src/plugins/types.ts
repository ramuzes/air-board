// src/plugins/types.ts — the extension point for future connectors (ADR 0004)
import type { FastifyRequest } from 'fastify'
import type { DB } from '../store/db.js'

export interface ConnectorPlugin {
  id: string
  displayName: string
  webhookPath?: string                                  // mounted as POST <webhookPath>
  verifyWebhook(req: FastifyRequest): void              // throw httpError(...) to reject
  handleWebhook(db: DB, payload: unknown, headers: FastifyRequest['headers']): unknown  // returns the 200 response body
  commitUrl?(repoUrl: string, sha: string): string      // external deep-link derivation
}
