/** Product templates database layer. */
import type { Database as DatabaseType } from 'better-sqlite3'
import type { ID, TemplateRec } from '../shared/types.js'
import type { NewTemplateInput, UpdateTemplateInput } from '../shared/ipc.js'
import { nowIso, requireId, requireNonEmpty } from './util.js'

export function get(db: DatabaseType, id: ID): TemplateRec {
  const rowId = requireId(id, 'template')
  const row = db.prepare('SELECT * FROM templates WHERE id = ?').get(rowId) as
    | TemplateRec
    | undefined
  if (!row) throw new Error(`Template #${rowId} not found.`)
  return row
}

export function list(db: DatabaseType): TemplateRec[] {
  return db.prepare('SELECT * FROM templates ORDER BY name COLLATE NOCASE').all() as TemplateRec[]
}

export function create(db: DatabaseType, input: NewTemplateInput): TemplateRec {
  const name = requireNonEmpty(input?.name, 'Template name')
  const structure = input?.structure_json ?? '{}'
  try {
    JSON.parse(structure)
  } catch {
    throw new Error('template structure must be valid JSON.')
  }
  const now = nowIso()
  const info = db
    .prepare(
      'INSERT INTO templates (name, description, structure_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(name, input.description ?? '', structure, now, now)
  return get(db, info.lastInsertRowid as number)
}

export function update(db: DatabaseType, input: UpdateTemplateInput): TemplateRec {
  const id = requireId(input?.id, 'template')
  get(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Template name'))
  }
  if (patch['description'] !== undefined) {
    sets.push('description = ?')
    values.push(String(patch['description'] ?? ''))
  }
  if (patch['structure_json'] !== undefined) {
    const s = String(patch['structure_json'] ?? '{}')
    try {
      JSON.parse(s)
    } catch {
      throw new Error('template structure must be valid JSON.')
    }
    sets.push('structure_json = ?')
    values.push(s)
  }
  if (sets.length === 0) return get(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE templates SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return get(db, id)
}

export function remove(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'template')
  get(db, rowId)
  db.prepare('DELETE FROM templates WHERE id = ?').run(rowId)
}
