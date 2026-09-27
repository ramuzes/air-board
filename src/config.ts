// src/config.ts
export interface Config {
  dbPath: string; port: number; baseUrl: string; gitlabWebhookSecret: string; initialAccessToken: string
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    dbPath: env.DB_PATH ?? './airboard.db',
    port: Number(env.PORT ?? 3000),
    baseUrl: env.BASE_URL ?? 'http://localhost:3000',
    gitlabWebhookSecret: env.GITLAB_WEBHOOK_SECRET ?? '',
    initialAccessToken: env.INITIAL_ACCESS_TOKEN ?? ''
  }
}
