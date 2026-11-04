/**
 * Export / import / backup database layer.
 *
 * - csvContent / xlsxBuffer: content builders for the supported kinds.
 * - importTemplate: CSV header template strings for each kind.
 * - importMaterialsCsv: import materials from a CSV file (papaparse).
 * - backupDatabase: WAL checkpoint, then a plain file copy.
 * - restoreDatabase: verify SQLite header magic + schema_migrations before
 *   replacing; throws otherwise. Callers close the live connection first.
 */
import { copyFileSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import Decimal from 'decimal.js'
import type { Database as DatabaseType } from 'better-sqlite3'
import { openDatabase } from './index.js'
import { create as createMaterial, list as listMaterials } from './materials.js'
import { computeProductCost } from '../engine/index.js'
import { buildCostInput, list as listProducts, readCustomUnits } from './products.js'

export type ExportKind = 'materials' | 'products' | 'quotes' | 'pricing'

export function assertExportKind(kind: unknown): ExportKind {
  if (kind === 'materials' || kind === 'products' || kind === 'quotes' || kind === 'pricing') {
    return kind
  }
  throw new Error(`Unknown export kind "${String(kind)}". Expected materials, products, quotes or pricing.`)
}

function materialRows(db: DatabaseType): Record<string, unknown>[] {
  return listMaterials(db, true).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    category: m.category,
    unit: m.unit,
    unit_dimension: m.unit_dimension,
    purchase_qty: m.purchase_qty,
    purchase_price: m.purchase_price,
    cost_per_unit: m.cost_per_unit,
    supplier: m.supplier,
    tax_note: m.tax_note,
    notes: m.notes,
    archived: m.archived,
    created_at: m.created_at,
    updated_at: m.updated_at,
  }))
}

function productRows(db: DatabaseType): Record<string, unknown>[] {
  const customUnits = readCustomUnits(db)
  return listProducts(db, true).map((p) => {
    let unitCost = ''
    try {
      const input = buildCostInput(p.id, db, new Set())
      unitCost = new Decimal(computeProductCost(input, customUnits).totalUnitCost).toFixed(4)
    } catch {
      unitCost = ''
    }
    return {
      id: p.id,
      name: p.name,
      sku: p.sku,
      description: p.description,
      category: p.category,
      unit_of_sale: p.unit_of_sale,
      batch_size: p.batch_size,
      waste_pct: p.waste_pct,
      defect_pct: p.defect_pct,
      unit_cost: unitCost,
      notes: p.notes,
      archived: p.archived,
      created_at: p.created_at,
      updated_at: p.updated_at,
    }
  })
}

function quoteRows(db: DatabaseType): Record<string, unknown>[] {
  const rows = db.prepare('SELECT * FROM quotes ORDER BY created_at DESC').all() as Array<
    Record<string, unknown>
  >
  return rows.map((q) => {
    const { snapshot_json: _snap, ...rest } = q
    void _snap
    return rest
  })
}

function pricingRows(db: DatabaseType): Record<string, unknown>[] {
  return db
    .prepare(
      `SELECT pc.id, pc.product_id, p.name AS product_name, pc.name, pc.channel,
              pc.method, pc.params_json, pc.is_default, pc.created_at, pc.updated_at
       FROM pricing_configs pc JOIN products p ON p.id = pc.product_id
       ORDER BY p.name, pc.name`,
    )
    .all() as Array<Record<string, unknown>>
}

export function exportRows(db: DatabaseType, kind: ExportKind): Record<string, unknown>[] {
  switch (kind) {
    case 'materials':
      return materialRows(db)
    case 'products':
      return productRows(db)
    case 'quotes':
      return quoteRows(db)
    case 'pricing':
      return pricingRows(db)
  }
}

/** CSV text for a kind (papaparse). */
export function csvContent(db: DatabaseType, kind: ExportKind): string {
  return Papa.unparse(exportRows(db, kind))
}

/** XLSX file bytes for a kind. */
export function xlsxBuffer(db: DatabaseType, kind: ExportKind): Buffer {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(exportRows(db, kind))
  XLSX.utils.book_append_sheet(wb, ws, kind)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** A CSV template (header row) for a kind, for manual imports. */
export function importTemplate(kind: ExportKind): string {
  switch (kind) {
    case 'materials':
      return 'name,description,category,unit,unit_dimension,purchase_qty,purchase_price,supplier,tax_note,notes\n'
    case 'products':
      return 'name,sku,description,category,unit_of_sale,batch_size,waste_pct,defect_pct,notes\n'
    case 'quotes':
      return 'reference,customer_name,customer_contact,quote_date,expires_at,terms,notes,discount_type,discount_value,tax_label,tax_rate,tax_mode,shipping\n'
    case 'pricing':
      return 'product_id,name,channel,method,params_json,is_default\n'
  }
}

export interface MaterialsImportResult {
  created: number
  skipped: number
  errors: string[]
}

/** Import materials from a CSV file with the materials template headers. */
export function importMaterialsCsv(db: DatabaseType, filePath: string): MaterialsImportResult {
  const text = readFileSync(filePath, 'utf8')
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true })
  const result: MaterialsImportResult = { created: 0, skipped: 0, errors: [] }
  const rows = parsed.data ?? []
  if (rows.length === 0) {
    result.errors.push('The file contains no data rows.')
    return result
  }
const CSV_CATEGORIES = ['material', 'packaging', 'service', 'other'] as const
const CSV_DIMENSIONS = ['mass', 'volume', 'length', 'area', 'count', 'custom'] as const

  rows.forEach((row, i) => {
    const line = i + 2 // header is line 1
    try {
      if (!row['name'] || !String(row['name']).trim()) {
        result.skipped += 1
        result.errors.push(`Line ${line}: skipped — material name is required.`)
        return
      }
      const category = String(row['category'] || 'material').trim()
      if (!(CSV_CATEGORIES as readonly string[]).includes(category)) {
        throw new Error(`unknown category "${category}" (expected ${CSV_CATEGORIES.join(', ')}).`)
      }
      const dimension = String(row['unit_dimension'] || 'count').trim()
      if (!(CSV_DIMENSIONS as readonly string[]).includes(dimension)) {
        throw new Error(`unknown unit dimension "${dimension}" (expected ${CSV_DIMENSIONS.join(', ')}).`)
      }
      createMaterial(db, {
        name: String(row['name']).trim(),
        description: row['description'] ?? '',
        category: category as (typeof CSV_CATEGORIES)[number],
        unit: String(row['unit'] || 'piece').trim(),
        unit_dimension: dimension as (typeof CSV_DIMENSIONS)[number],
        purchase_qty: String(row['purchase_qty'] ?? '1'),
        purchase_price: String(row['purchase_price'] ?? '0'),
        supplier: row['supplier'] ?? '',
        tax_note: row['tax_note'] ?? '',
        notes: row['notes'] ?? '',
      })
      result.created += 1
    } catch (err) {
      result.skipped += 1
      result.errors.push(`Line ${line}: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
  return result
}

/** Checkpoint the WAL, then copy the database file. */
export function backupDatabase(dbPath: string, destPath: string): void {
  const tmp = openDatabase(dbPath)
  try {
    tmp.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    tmp.close()
  }
  copyFileSync(dbPath, destPath)
}

const SQLITE_MAGIC = 'SQLite format 3\0'

/** Verify a candidate restore file is a Pricey database; throws otherwise. */
export function verifyRestoreFile(srcPath: string): void {
  const buf = Buffer.alloc(16)
  const fd = openSync(srcPath, 'r')
  try {
    readSync(fd, buf, 0, 16, 0)
  } finally {
    closeSync(fd)
  }
  if (buf.toString('latin1') !== SQLITE_MAGIC) {
    throw new Error('That file is not a SQLite database (bad header magic) — restore aborted.')
  }
  let probe: DatabaseType | null = null
  try {
    probe = openDatabase(srcPath)
    probe.pragma('query_only = ON')
    const row = probe
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'`)
      .get() as { name: string } | undefined
    if (!row) {
      throw new Error('That file is a SQLite database but not a Pricey database (no schema_migrations table) — restore aborted.')
    }
  } catch (err) {
    if (err instanceof Error && /not a Pricey database/.test(err.message)) throw err
    throw new Error(
      `Could not read the restore file: ${err instanceof Error ? err.message : String(err)}`,
    )
  } finally {
    probe?.close()
  }
}

/**
 * Replace dbPath with srcPath after verification. The caller must close the
 * live database connection BEFORE calling this (file replacement under an
 * open connection is unsafe), and reopen afterwards.
 */
export function restoreDatabase(dbPath: string, srcPath: string): void {
  verifyRestoreFile(srcPath)
  copyFileSync(srcPath, dbPath)
}
