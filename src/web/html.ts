// src/web/html.ts
export function esc(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}
export function renderMarkdown(md: string): string {
  const parts = md.split('\x60\x60\x60')
  return parts.map((part, i) => {
    if (i % 2 === 1) return '<pre>' + esc(part) + '</pre>'
    return part.split(/\n\n+/).map((p) => (p.trim() ? '<p>' + esc(p).replaceAll('\n', '<br>') + '</p>' : '')).join('')
  }).join('')
}
export function layout(title: string, body: string, loggedIn = true): string {
  const nav = loggedIn ? '<nav><a href="/">Projects</a> <a href="/tokens">Tokens</a> <a href="/AGENTS.md">Agents</a> <form method="post" action="/logout" style="display:inline"><button>Logout</button></form></nav>' : ''
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + ' — AirBoard</title><style>body{font-family:sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem}nav{margin-bottom:1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.4rem;text-align:left}pre{background:#f4f4f4;padding:.5rem;overflow:auto}</style></head><body>' + nav + '<h1>' + esc(title) + '</h1>' + body + '</body></html>'
}
