// src/index.ts
import { loadConfig } from './config.js'
import { openDb } from './store/db.js'
import { bootstrapIfEmpty } from './bootstrap.js'
import { buildApp } from './http/app.js'

const config = loadConfig()
const db = openDb(config.dbPath)
const boot = bootstrapIfEmpty(db, config.initialAccessToken)
if (boot?.generated) {
  console.log('==================================================================')
  console.log('AirBoard first run: bootstrap admin token (shown once, save it):')
  console.log(boot.token)
  console.log('Log in with this token at /login, then create your own user+token.')
  console.log('==================================================================')
} else if (boot) {
  console.log('AirBoard first run: bootstrap admin created with INITIAL_ACCESS_TOKEN (not logged).')
}
const app = await buildApp({ config, db })
await app.listen({ port: config.port, host: '0.0.0.0' })
console.log('AirBoard listening on :' + config.port + ' (base ' + config.baseUrl + ')')
