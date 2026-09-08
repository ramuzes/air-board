// src/http/routes/web.ts
import type { FastifyInstance } from 'fastify'
import type { DB } from '../../store/db.js'
import { verifyToken, createToken, revokeToken, listTokens } from '../../store/users.js'
import { listProjects, getProjectByKey } from '../../store/projects.js'
import { getResourceInternal, listResources, updateResource, listRevisions } from '../../store/resources.js'
import { listBindings } from '../../store/bindings.js'
import { webUser } from '../auth.js'
import { commitUrlFor } from '../../plugins/registry.js'
import { esc, layout, renderMarkdown } from '../../web/html.js'
import { httpError } from '../errors.js'

export function registerWebRoutes(app: FastifyInstance, db: DB) {
  const requireWeb = async (req: any, reply: any) => {
    if (!webUser(db, req)) return reply.redirect('/login')
  }

  app.get('/login', async (_req, reply) => {
    reply.type('text/html')
    return layout('Login', '<form method="post" action="/login"><input name="token" placeholder="abt_..." required><button>Login</button></form>', false)
  })

  app.post('/login', async (req: any, reply) => {
    const user = verifyToken(db, String(req.body?.token ?? ''))
    if (!user) {
      reply.code(401).type('text/html')
      return layout('Login', '<p>Invalid token.</p><form method="post" action="/login"><input name="token"><button>Login</button></form>', false)
    }
    reply.setCookie('ab_token', req.body.token, { path: '/', httpOnly: true, sameSite: 'lax' })
    return reply.redirect('/')
  })

  app.post('/logout', async (_req, reply) => reply.clearCookie('ab_token').redirect('/login'))

  app.get('/', { preHandler: [requireWeb] }, async (_req, reply) => {
    const rows = listProjects(db).map((p) => '<tr><td><a href="/p/' + esc(p.key) + '">' + esc(p.key) + '</a></td><td>' + esc(p.name) + '</td><td>' + esc(p.gitlab_repo_url ?? '') + '</td></tr>').join('')
    reply.type('text/html')
    return layout('Projects', '<table><tr><th>Key</th><th>Name</th><th>GitLab repo</th></tr>' + rows + '</table>')
  })

  app.get('/p/:key', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const p = getProjectByKey(db, req.params.key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    const q = req.query as any
    const rows = listResources(db, { projectId: p.id, kind: q.kind, status: q.status, q: q.q })
      .map((r) => '<tr><td>' + esc(r.id) + '</td><td><a href="/p/' + esc(p.key) + '/' + r.id + '">' + esc(r.title) + '</a></td><td>' + esc(r.kind) + '</td><td>' + esc(r.status) + '</td><td>' + r.rev + '</td></tr>').join('')
    reply.type('text/html')
    return layout(p.key + ' resources', '<table><tr><th>ID</th><th>Title</th><th>Kind</th><th>Status</th><th>Rev</th></tr>' + rows + '</table><form method="get"><input name="q" placeholder="search"><button>Search</button></form>')
  })

  app.get('/p/:key/:id', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const p = getProjectByKey(db, req.params.key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    const r = getResourceInternal(db, p.id, req.params.id)
    if (!r) throw httpError(404, 'NOT_FOUND', 'resource not found')
    const revs = listRevisions(db, r.row.id).map((v: any) => '<tr><td>' + v.rev + '</td><td>' + esc(v.title) + '</td><td>' + esc(v.created_at) + '</td></tr>').join('')
    const binds = listBindings(db, r.row.id).map((b) => '<tr><td>' + esc(b.repo_url) + '</td><td><code><a href="' + esc(commitUrlFor(b.repo_url, b.sha) ?? '#') + '" target="_blank">' + esc(b.sha) + '</a></code></td><td>' + esc(b.pushed_at ?? '') + '</td></tr>').join('')
    const NEXT: Record<string, string[]> = { draft: ['active', 'cancelled'], active: ['done', 'cancelled'], done: [], cancelled: [] }
    const buttons = NEXT[r.view.status]
      .map((s) => '<form method="post" action="/p/' + esc(p.key) + '/' + r.view.id + '/status" style="display:inline"><input type="hidden" name="status" value="' + s + '"><button>' + s + '</button></form>').join(' ')
    reply.type('text/html')
    return layout(r.view.id + ' — ' + r.view.title,
      '<p>Status: <strong>' + r.view.status + '</strong> (rev ' + r.view.rev + ') ' + buttons + '</p>' +
      '<div>' + renderMarkdown(r.view.content_markdown) + '</div>' +
      '<h2>Edit</h2><form method="post" action="/p/' + esc(p.key) + '/' + r.view.id + '/edit">' +
      '<input name="title" value="' + esc(r.view.title) + '" style="width:100%"><br>' +
      '<textarea name="markdown" rows="12" style="width:100%">' + esc(r.view.content_markdown) + '</textarea><br>' +
      '<button>Save (new revision)</button></form>' +
      '<h2>Revisions</h2><table><tr><th>Rev</th><th>Title</th><th>At</th></tr>' + revs + '</table>' +
      '<h2>Commit bindings</h2><table><tr><th>Repo</th><th>SHA</th><th>Pushed</th></tr>' + binds + '</table>')
  })

  app.post('/p/:key/:id/edit', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const p = getProjectByKey(db, req.params.key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    updateResource(db, { projectId: p.id, publicId: req.params.id, patch: { title: req.body?.title, content_markdown: req.body?.markdown }, userId: webUser(db, req)!.id })
    return reply.redirect('/p/' + p.key + '/' + req.params.id)
  })

  app.post('/p/:key/:id/status', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const p = getProjectByKey(db, req.params.key)
    if (!p) throw httpError(404, 'NOT_FOUND', 'project not found')
    updateResource(db, { projectId: p.id, publicId: req.params.id, patch: { status: req.body?.status }, userId: webUser(db, req)!.id })
    return reply.redirect('/p/' + p.key + '/' + req.params.id)
  })

  app.get('/tokens', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const me = webUser(db, req)!
    const rows = listTokens(db, me.id).map((t) => '<tr><td>' + t.id + '</td><td>' + esc(t.label) + '</td><td>' + esc(t.created_at) + '</td><td>' + (t.revoked_at ? 'revoked' : '<form method="post" action="/tokens/' + t.id + '/revoke"><button>Revoke</button></form>') + '</td></tr>').join('')
    reply.type('text/html')
    return layout('Tokens', '<table><tr><th>ID</th><th>Label</th><th>Created</th><th></th></tr>' + rows + '</table><form method="post" action="/tokens"><input name="label" placeholder="label"><button>Create token</button></form>')
  })

  app.post('/tokens', { preHandler: [requireWeb] }, async (req: any, reply) => {
    const me = webUser(db, req)!
    const { token } = createToken(db, me.id, String(req.body?.label ?? ''))
    reply.type('text/html')
    return layout('Token created', '<p>Copy it now — shown once:</p><pre>' + esc(token) + '</pre><p><a href="/tokens">Back</a></p>')
  })

  app.post('/tokens/:id/revoke', { preHandler: [requireWeb] }, async (req: any, reply) => {
    revokeToken(db, Number(req.params.id))
    return reply.redirect('/tokens')
  })
}
