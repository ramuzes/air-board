import { describe, it, expect } from 'bun:test'
import { openDb } from '../../src/store/db.js'
import { createUser } from '../../src/store/users.js'
import { createProject } from '../../src/store/projects.js'
import { createResource, searchFts } from '../../src/store/resources.js'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('trigram tokenizer migration', () => {
  it('rebuilds a pre-trigram FTS table on reopen, keeping content searchable incl. CJK', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ab-mig-'))
    const path = join(dir, 'm.db')
    const db = openDb(path)
    const u = createUser(db, { username: 't', displayName: 'T' })
    const p = createProject(db, { key: 'MIG', name: 'M' })
    createResource(db, { projectId: p.id, kind: 'ADR', title: '龙虎榜 data', contentMarkdown: '研究模拟仓 behaviour', userId: u.id })
    createResource(db, { projectId: p.id, kind: 'ISSUE', title: 'plain english', contentMarkdown: 'ordinary words', userId: u.id })
    // Simulate a pre-trigram database: rebuild FTS with default tokenizer
    db.exec('DROP TABLE resource_fts')
    db.exec('CREATE VIRTUAL TABLE resource_fts USING fts5(title, content, resource_row_id UNINDEXED)')
    db.exec("INSERT INTO resource_fts (resource_row_id, title, content) SELECT r.id, v.title, v.content_markdown FROM resources r JOIN revisions v ON v.resource_id = r.id AND v.rev = (SELECT MAX(rev) FROM revisions WHERE resource_id = r.id)")
    db.close()

    const db2 = openDb(path) // migration should fire here
    expect(searchFts(db2, '龙虎').map((h) => h.rid)).toHaveLength(1)   // 2-char CJK via fallback
    expect(searchFts(db2, '模拟仓').map((h) => h.rid)).toHaveLength(1) // 3-char CJK via trigram
    expect(searchFts(db2, 'engl').map((h) => h.rid)).toHaveLength(1)  // latin substring via trigram
    db2.close()
  })
})
