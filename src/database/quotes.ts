/**
 * Quotes database layer.
 *
 * Totals are Decimal-exact (decimal.js), never floating point. Every
 * create/update/item mutation runs freezeQuote(), which recomputes totals
 * AND freezes snapshot_json — a point-in-time record of the items' unit
 * costs, the pricing params, business info and fee config. Later material
 * price changes never rewrite a frozen snapshot.
 *
 * tax_rate is a PERCENT (e.g. "8.25" = 8.25%). tax_mode: 'exclusive' |
 * 'inclusive' | 'none'.
 */
import Decimal from 'decimal.js'
import type { Database as DatabaseType } from 'better-sqlite3'
import type { DiscountType, ID, Quote, QuoteItem } from '../shared/types.js'
import type {
  NewQuoteInput,
  NewQuoteItemInput,
  QuoteFull,
  UpdateQuoteInput,
  UpdateQuoteItemInput,
} from '../shared/ipc.js'
import { computeProductCost } from '../engine/index.js'
import { buildCostInput, get as getProduct, readCustomUnits } from './products.js'
import { nowIso, parseJson, requireDecimalText, requireId, requireNonEmpty } from './util.js'

const DISCOUNT_TYPES: DiscountType[] = ['none', 'pct', 'fixed']
const TAX_MODES = ['exclusive', 'inclusive', 'none']

export function get(db: DatabaseType, id: ID): Quote {
  const rowId = requireId(id, 'quote')
  const row = db.prepare('SELECT * FROM quotes WHERE id = ?').get(rowId) as
    | Quote
    | undefined
  if (!row) throw new Error(`Quote #${rowId} not found.`)
  return row
}

export function list(db: DatabaseType): Quote[] {
  return db.prepare('SELECT * FROM quotes ORDER BY created_at DESC').all() as Quote[]
}

export function getFull(db: DatabaseType, id: ID): QuoteFull {
  return { quote: get(db, id), items: listItems(db, id) }
}

/** Next per-year reference: Q-YYYY-NNNN with NNNN = max+1 for that year. */
export function nextReference(db: DatabaseType, dateIso?: string): string {
  const year = (dateIso && /^\d{4}/.test(dateIso) ? dateIso : nowIso()).slice(0, 4)
  const rows = db
    .prepare(`SELECT reference FROM quotes WHERE reference LIKE ?`)
    .all(`Q-${year}-%`) as Array<{ reference: string }>
  let max = 0
  for (const r of rows) {
    const m = /^Q-\d{4}-(\d+)$/.exec(r.reference)
    if (m) max = Math.max(max, parseInt(m[1], 10))
  }
  return `Q-${year}-${String(max + 1).padStart(4, '0')}`
}

function checkReferenceUnique(db: DatabaseType, reference: string, exceptId?: number): void {
  const row = db
    .prepare('SELECT id FROM quotes WHERE reference = ?')
    .get(reference) as { id: number } | undefined
  if (row && row.id !== exceptId) {
    throw new Error(`Quote reference "${reference}" is already in use.`)
  }
}

function validateQuoteFields(input: Record<string, unknown>): void {
  if (input['discount_type'] !== undefined) {
    if (!DISCOUNT_TYPES.includes(input['discount_type'] as DiscountType)) {
      throw new Error(`Unknown discount type "${input['discount_type']}".`)
    }
  }
  if (input['discount_value'] !== undefined) {
    const dv = requireDecimalText(input['discount_value'], 'discount value')
    if (Number(dv) < 0) throw new Error('discount value cannot be negative.')
    if (input['discount_type'] === 'pct' && Number(dv) >= 1) {
      throw new Error('discount value for a percentage discount must be below 1 (a fraction).')
    }
  }
  if (input['tax_rate'] !== undefined) {
    const tr = requireDecimalText(input['tax_rate'], 'tax rate')
    if (Number(tr) < 0) throw new Error('tax rate cannot be negative.')
  }
  if (input['tax_mode'] !== undefined && !TAX_MODES.includes(String(input['tax_mode']))) {
    throw new Error(`Unknown tax mode "${input['tax_mode']}".`)
  }
  if (input['shipping'] !== undefined) {
    const sh = requireDecimalText(input['shipping'], 'shipping')
    if (Number(sh) < 0) throw new Error('shipping cannot be negative.')
  }
}

export function create(db: DatabaseType, input: NewQuoteInput): Quote {
  const fields = (input ?? {}) as unknown as Record<string, unknown>
  validateQuoteFields(fields)
  const quoteDate = typeof fields['quote_date'] === 'string' && fields['quote_date']
    ? String(fields['quote_date'])
    : nowIso().slice(0, 10)
  const reference = requireNonEmpty(
    String(fields['reference'] ?? '').trim() || nextReference(db, quoteDate),
    'Quote reference',
  )
  checkReferenceUnique(db, reference)
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO quotes
         (reference, customer_name, customer_contact, quote_date, expires_at,
          business_info_json, terms, notes, discount_type, discount_value,
          tax_label, tax_rate, tax_mode, shipping, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .run(
      reference,
      String(fields['customer_name'] ?? ''),
      String(fields['customer_contact'] ?? ''),
      quoteDate,
      String(fields['expires_at'] ?? ''),
      String(fields['business_info_json'] ?? '{}'),
      String(fields['terms'] ?? ''),
      String(fields['notes'] ?? ''),
      String(fields['discount_type'] ?? 'none'),
      String(fields['discount_value'] ?? '0'),
      String(fields['tax_label'] ?? 'Tax'),
      String(fields['tax_rate'] ?? '0'),
      String(fields['tax_mode'] ?? 'exclusive'),
      String(fields['shipping'] ?? '0'),
      now,
      now,
    )
  const id = info.lastInsertRowid as number
  return freezeQuote(db, id)
}

export function update(db: DatabaseType, input: UpdateQuoteInput): Quote {
  const id = requireId(input?.id, 'quote')
  const existing = get(db, id)
  const patch = input as unknown as Record<string, unknown>
  validateQuoteFields(patch)
  const sets: string[] = []
  const values: unknown[] = []
  const textCols = [
    'customer_name',
    'customer_contact',
    'quote_date',
    'expires_at',
    'business_info_json',
    'terms',
    'notes',
    'discount_type',
    'discount_value',
    'tax_label',
    'tax_rate',
    'tax_mode',
    'shipping',
    'status',
  ]
  for (const col of textCols) {
    if (patch[col] !== undefined) {
      sets.push(`${col} = ?`)
      values.push(String(patch[col] ?? ''))
    }
  }
  if (patch['reference'] !== undefined) {
    const ref = requireNonEmpty(patch['reference'], 'Quote reference')
    checkReferenceUnique(db, ref, id)
    sets.push('reference = ?')
    values.push(ref)
  }
  if (sets.length > 0) {
    sets.push('updated_at = ?')
    values.push(nowIso(), id)
    db.prepare(`UPDATE quotes SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  void existing
  return freezeQuote(db, id)
}

export function remove(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'quote')
  get(db, rowId)
  // quote_items.quote_id is ON DELETE CASCADE.
  db.prepare('DELETE FROM quotes WHERE id = ?').run(rowId)
}

export function duplicate(db: DatabaseType, id: ID): Quote {
  const src = getFull(db, id)
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO quotes
         (reference, customer_name, customer_contact, quote_date, expires_at,
          business_info_json, terms, notes, discount_type, discount_value,
          tax_label, tax_rate, tax_mode, shipping, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    )
    .run(
      nextReference(db, src.quote.quote_date),
      src.quote.customer_name,
      src.quote.customer_contact,
      src.quote.quote_date,
      src.quote.expires_at,
      src.quote.business_info_json,
      src.quote.terms,
      src.quote.notes,
      src.quote.discount_type,
      src.quote.discount_value,
      src.quote.tax_label,
      src.quote.tax_rate,
      src.quote.tax_mode,
      src.quote.shipping,
      now,
      now,
    )
  const newId = info.lastInsertRowid as number
  for (const it of src.items) {
    db.prepare(
      `INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(newId, it.product_id, it.description, it.quantity, it.unit_price, it.sort_order)
  }
  return freezeQuote(db, newId)
}

/* ---------------- quote items ---------------- */

export function getItem(db: DatabaseType, id: ID): QuoteItem {
  const rowId = requireId(id, 'quote item')
  const row = db.prepare('SELECT * FROM quote_items WHERE id = ?').get(rowId) as
    | QuoteItem
    | undefined
  if (!row) throw new Error(`Quote item #${rowId} not found.`)
  return row
}

export function listItems(db: DatabaseType, quoteId: ID): QuoteItem[] {
  const qid = requireId(quoteId, 'quote')
  get(db, qid)
  return db
    .prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order, id')
    .all(qid) as QuoteItem[]
}

export function addItem(db: DatabaseType, quoteId: ID, input: NewQuoteItemInput): QuoteItem {
  const qid = requireId(quoteId, 'quote')
  get(db, qid)
  const productId = input?.product_id ?? null
  if (productId !== null) getProduct(db, requireId(productId, 'product'))
  const quantity = requireDecimalText(input?.quantity ?? '1', 'item quantity')
  if (Number(quantity) <= 0) throw new Error('item quantity must be greater than zero.')
  const unitPrice = requireDecimalText(input?.unit_price ?? '0', 'unit price')
  if (Number(unitPrice) < 0) throw new Error('unit price cannot be negative.')
  const info = db
    .prepare(
      `INSERT INTO quote_items (quote_id, product_id, description, quantity, unit_price, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(qid, productId, input.description ?? '', quantity, unitPrice, input.sort_order ?? 0)
  const item = getItem(db, info.lastInsertRowid as number)
  freezeQuote(db, qid)
  return item
}

export function updateItem(db: DatabaseType, input: UpdateQuoteItemInput): QuoteItem {
  const id = requireId(input?.id, 'quote item')
  const line = getItem(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['product_id'] !== undefined) {
    const pid = patch['product_id']
    const productId = pid === null ? null : requireId(pid, 'product')
    if (productId !== null) getProduct(db, productId)
    sets.push('product_id = ?')
    values.push(productId)
  }
  if (patch['description'] !== undefined) {
    sets.push('description = ?')
    values.push(String(patch['description'] ?? ''))
  }
  if (patch['quantity'] !== undefined) {
    const q = requireDecimalText(patch['quantity'], 'item quantity')
    if (Number(q) <= 0) throw new Error('item quantity must be greater than zero.')
    sets.push('quantity = ?')
    values.push(q)
  }
  if (patch['unit_price'] !== undefined) {
    const p = requireDecimalText(patch['unit_price'], 'unit price')
    if (Number(p) < 0) throw new Error('unit price cannot be negative.')
    sets.push('unit_price = ?')
    values.push(p)
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length > 0) {
    values.push(id)
    db.prepare(`UPDATE quote_items SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  }
  freezeQuote(db, line.quote_id)
  return getItem(db, id)
}

export function removeItem(db: DatabaseType, id: ID): QuoteItem {
  const rowId = requireId(id, 'quote item')
  const line = getItem(db, rowId)
  db.prepare('DELETE FROM quote_items WHERE id = ?').run(rowId)
  freezeQuote(db, line.quote_id)
  return line
}

/* ---------------- freezing ---------------- */

export interface FrozenQuoteItem {
  quoteItemId: number
  productId: number | null
  description: string
  quantity: string
  unitPrice: string
  /** The product's full unit cost at freeze time ('0' when not product-linked). */
  unitCost: string
  /** The full cost breakdown at freeze time (null when not product-linked). */
  costSnapshot: unknown
  lineTotal: string
}

/**
 * Recompute a quote's totals and freeze snapshot_json. Called after every
 * mutation so the snapshot always reflects the last saved state — and never
 * changes when material prices change later.
 */
export function freezeQuote(db: DatabaseType, quoteId: ID): Quote {
  const qid = requireId(quoteId, 'quote')
  const quote = get(db, qid)
  const items = db
    .prepare('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order, id')
    .all(qid) as QuoteItem[]
  const customUnits = readCustomUnits(db)

  const frozen: FrozenQuoteItem[] = items.map((it) => {
    const qty = new Decimal(it.quantity)
    const price = new Decimal(it.unit_price)
    let unitCost = '0'
    let costSnapshot: unknown = null
    if (it.product_id !== null) {
      try {
        const input = buildCostInput(it.product_id, db, new Set())
        const result = computeProductCost(input, customUnits)
        unitCost = result.totalUnitCost
        costSnapshot = result
      } catch {
        // A product whose cost no longer computes (e.g. deleted material)
        // freezes honestly with a zero cost rather than breaking the quote.
      }
    }
    return {
      quoteItemId: it.id,
      productId: it.product_id,
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unit_price,
      unitCost,
      costSnapshot,
      lineTotal: qty.times(price).toString(),
    }
  })

  const subtotal = frozen.reduce((s, f) => s.plus(new Decimal(f.lineTotal)), new Decimal(0))
  let discountTotal = new Decimal(0)
  if (quote.discount_type === 'pct') {
    discountTotal = subtotal.times(new Decimal(quote.discount_value || '0'))
  } else if (quote.discount_type === 'fixed') {
    discountTotal = Decimal.min(new Decimal(quote.discount_value || '0'), subtotal)
  }
  const taxable = subtotal.minus(discountTotal)
  const rate = new Decimal(quote.tax_rate || '0').div(100)
  let taxTotal = new Decimal(0)
  if (quote.tax_mode === 'exclusive') {
    taxTotal = taxable.times(rate)
  } else if (quote.tax_mode === 'inclusive') {
    taxTotal = rate.gt(0) ? taxable.minus(taxable.div(new Decimal(1).plus(rate))) : new Decimal(0)
  }
  const shippingTotal = new Decimal(quote.shipping || '0')
  const taxAdd = quote.tax_mode === 'exclusive' ? taxTotal : new Decimal(0)
  const total = taxable.plus(taxAdd).plus(shippingTotal)

  let businessInfo: unknown = {}
  try {
    businessInfo = parseJson<unknown>(quote.business_info_json || '{}', 'business info')
  } catch {
    businessInfo = {}
  }
  const snapshot = {
    frozenAt: nowIso(),
    items: frozen,
    discount: { type: quote.discount_type, value: quote.discount_value },
    tax: { label: quote.tax_label, rate: quote.tax_rate, mode: quote.tax_mode },
    shipping: quote.shipping,
    businessInfo,
  }

  db.prepare(
    `UPDATE quotes SET subtotal = ?, discount_total = ?, tax_total = ?,
       shipping_total = ?, total = ?, snapshot_json = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    subtotal.toString(),
    discountTotal.toString(),
    taxTotal.toString(),
    shippingTotal.toString(),
    total.toString(),
    JSON.stringify(snapshot),
    nowIso(),
    qid,
  )
  return get(db, qid)
}
