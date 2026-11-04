/** Pricing configs, channels and channel fees database layer. */
import type { Database as DatabaseType } from 'better-sqlite3'
import type {
  Channel,
  ChannelFee,
  FeeTreatment,
  FeeType,
  ID,
  PriceChannel,
  PricingConfig,
  PricingMethod,
} from '../shared/types.js'
import type {
  NewChannelFeeInput,
  NewChannelInput,
  NewPricingConfigInput,
  UpdateChannelFeeInput,
  UpdateChannelInput,
  UpdatePricingConfigInput,
} from '../shared/ipc.js'
import { nowIso, requireId, requireNonEmpty } from './util.js'
import { get as getProduct } from './products.js'

const PRICE_CHANNELS: PriceChannel[] = ['retail', 'wholesale', 'custom']
const PRICING_METHODS: PricingMethod[] = [
  'margin',
  'markup',
  'fixed_profit',
  'target_profit',
  'minimum',
  'cost_plus',
  'reference',
]
const FEE_TYPES: FeeType[] = ['pct_on_price', 'fixed_per_unit', 'fixed_per_order']
const FEE_TREATMENTS: FeeTreatment[] = ['included', 'deducted', 'customer_pays']

/* ---------------- pricing configs ---------------- */

export function getPricingConfig(db: DatabaseType, id: ID): PricingConfig {
  const rowId = requireId(id, 'pricing config')
  const row = db.prepare('SELECT * FROM pricing_configs WHERE id = ?').get(rowId) as
    | PricingConfig
    | undefined
  if (!row) throw new Error(`Pricing config #${rowId} not found.`)
  return row
}

export function listPricingConfigs(db: DatabaseType, productId: ID): PricingConfig[] {
  const pid = requireId(productId, 'product')
  getProduct(db, pid)
  return db
    .prepare('SELECT * FROM pricing_configs WHERE product_id = ? ORDER BY is_default DESC, name')
    .all(pid) as PricingConfig[]
}

export function defaultPricingConfig(db: DatabaseType, productId: ID): PricingConfig | null {
  const row = db
    .prepare(
      'SELECT * FROM pricing_configs WHERE product_id = ? ORDER BY is_default DESC, id LIMIT 1',
    )
    .get(productId) as PricingConfig | undefined
  return row ?? null
}

export function createPricingConfig(db: DatabaseType, input: NewPricingConfigInput): PricingConfig {
  const productId = requireId(input?.product_id, 'product')
  getProduct(db, productId)
  const name = requireNonEmpty(input?.name, 'Pricing config name')
  const method = (input?.method ?? 'margin') as PricingMethod
  if (!PRICING_METHODS.includes(method)) throw new Error(`Unknown pricing method "${input?.method}".`)
  const channel = (input?.channel ?? 'retail') as PriceChannel
  if (!PRICE_CHANNELS.includes(channel)) throw new Error(`Unknown price channel "${input?.channel}".`)
  const now = nowIso()
  const info = db
    .prepare(
      `INSERT INTO pricing_configs
         (product_id, name, channel, method, params_json, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      productId,
      name,
      channel,
      method,
      input.params_json ?? '{}',
      input.is_default ? 1 : 0,
      now,
      now,
    )
  return getPricingConfig(db, info.lastInsertRowid as number)
}

export function updatePricingConfig(
  db: DatabaseType,
  input: UpdatePricingConfigInput,
): PricingConfig {
  const id = requireId(input?.id, 'pricing config')
  getPricingConfig(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Pricing config name'))
  }
  if (patch['channel'] !== undefined) {
    const channel = patch['channel'] as PriceChannel
    if (!PRICE_CHANNELS.includes(channel)) throw new Error(`Unknown price channel "${patch['channel']}".`)
    sets.push('channel = ?')
    values.push(channel)
  }
  if (patch['method'] !== undefined) {
    const method = patch['method'] as PricingMethod
    if (!PRICING_METHODS.includes(method)) throw new Error(`Unknown pricing method "${patch['method']}".`)
    sets.push('method = ?')
    values.push(method)
  }
  if (patch['params_json'] !== undefined) {
    sets.push('params_json = ?')
    values.push(String(patch['params_json'] ?? '{}'))
  }
  if (patch['is_default'] !== undefined) {
    sets.push('is_default = ?')
    values.push(patch['is_default'] ? 1 : 0)
  }
  if (patch['product_id'] !== undefined) {
    const pid = requireId(patch['product_id'], 'product')
    getProduct(db, pid)
    sets.push('product_id = ?')
    values.push(pid)
  }
  if (sets.length === 0) return getPricingConfig(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE pricing_configs SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getPricingConfig(db, id)
}

export function deletePricingConfig(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'pricing config')
  getPricingConfig(db, rowId)
  db.prepare('DELETE FROM pricing_configs WHERE id = ?').run(rowId)
}

/* ---------------- channels ---------------- */

export function getChannel(db: DatabaseType, id: ID): Channel {
  const rowId = requireId(id, 'channel')
  const row = db.prepare('SELECT * FROM channels WHERE id = ?').get(rowId) as
    | Channel
    | undefined
  if (!row) throw new Error(`Channel #${rowId} not found.`)
  return row
}

export function listChannels(db: DatabaseType): Channel[] {
  return db.prepare('SELECT * FROM channels ORDER BY name COLLATE NOCASE').all() as Channel[]
}

export function createChannel(db: DatabaseType, input: NewChannelInput): Channel {
  const name = requireNonEmpty(input?.name, 'Channel name')
  const now = nowIso()
  const info = db
    .prepare('INSERT INTO channels (name, kind, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(name, input.kind ?? 'custom', input.notes ?? '', now, now)
  return getChannel(db, info.lastInsertRowid as number)
}

export function updateChannel(db: DatabaseType, input: UpdateChannelInput): Channel {
  const id = requireId(input?.id, 'channel')
  getChannel(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Channel name'))
  }
  if (patch['kind'] !== undefined) {
    sets.push('kind = ?')
    values.push(String(patch['kind'] ?? 'custom'))
  }
  if (patch['notes'] !== undefined) {
    sets.push('notes = ?')
    values.push(String(patch['notes'] ?? ''))
  }
  if (sets.length === 0) return getChannel(db, id)
  sets.push('updated_at = ?')
  values.push(nowIso(), id)
  db.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getChannel(db, id)
}

export function deleteChannel(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'channel')
  getChannel(db, rowId)
  // channel_fees.channel_id is ON DELETE CASCADE.
  db.prepare('DELETE FROM channels WHERE id = ?').run(rowId)
}

/* ---------------- channel fees ---------------- */

export function getChannelFee(db: DatabaseType, id: ID): ChannelFee {
  const rowId = requireId(id, 'channel fee')
  const row = db.prepare('SELECT * FROM channel_fees WHERE id = ?').get(rowId) as
    | ChannelFee
    | undefined
  if (!row) throw new Error(`Channel fee #${rowId} not found.`)
  return row
}

export function listChannelFees(db: DatabaseType, channelId: ID): ChannelFee[] {
  const cid = requireId(channelId, 'channel')
  getChannel(db, cid)
  return db
    .prepare('SELECT * FROM channel_fees WHERE channel_id = ? ORDER BY sort_order, id')
    .all(cid) as ChannelFee[]
}

export function createChannelFee(db: DatabaseType, input: NewChannelFeeInput): ChannelFee {
  const channelId = requireId(input?.channel_id, 'channel')
  getChannel(db, channelId)
  const name = requireNonEmpty(input?.name, 'Fee name')
  const feeType = (input?.fee_type ?? 'pct_on_price') as FeeType
  if (!FEE_TYPES.includes(feeType)) throw new Error(`Unknown fee type "${input?.fee_type}".`)
  const treatment = (input?.treatment ?? 'deducted') as FeeTreatment
  if (!FEE_TREATMENTS.includes(treatment)) throw new Error(`Unknown fee treatment "${input?.treatment}".`)
  const info = db
    .prepare(
      `INSERT INTO channel_fees (channel_id, name, fee_type, value, treatment, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(channelId, name, feeType, input.value ?? '0', treatment, input.sort_order ?? 0)
  return getChannelFee(db, info.lastInsertRowid as number)
}

export function updateChannelFee(db: DatabaseType, input: UpdateChannelFeeInput): ChannelFee {
  const id = requireId(input?.id, 'channel fee')
  getChannelFee(db, id)
  const patch = input as unknown as Record<string, unknown>
  const sets: string[] = []
  const values: unknown[] = []
  if (patch['name'] !== undefined) {
    sets.push('name = ?')
    values.push(requireNonEmpty(patch['name'], 'Fee name'))
  }
  if (patch['fee_type'] !== undefined) {
    const ft = patch['fee_type'] as FeeType
    if (!FEE_TYPES.includes(ft)) throw new Error(`Unknown fee type "${patch['fee_type']}".`)
    sets.push('fee_type = ?')
    values.push(ft)
  }
  if (patch['value'] !== undefined) {
    sets.push('value = ?')
    values.push(String(patch['value'] ?? '0'))
  }
  if (patch['treatment'] !== undefined) {
    const tr = patch['treatment'] as FeeTreatment
    if (!FEE_TREATMENTS.includes(tr)) throw new Error(`Unknown fee treatment "${patch['treatment']}".`)
    sets.push('treatment = ?')
    values.push(tr)
  }
  if (patch['sort_order'] !== undefined) {
    sets.push('sort_order = ?')
    values.push(Number(patch['sort_order']) || 0)
  }
  if (sets.length === 0) return getChannelFee(db, id)
  values.push(id)
  db.prepare(`UPDATE channel_fees SET ${sets.join(', ')} WHERE id = ?`).run(...values)
  return getChannelFee(db, id)
}

export function deleteChannelFee(db: DatabaseType, id: ID): void {
  const rowId = requireId(id, 'channel fee')
  getChannelFee(db, rowId)
  db.prepare('DELETE FROM channel_fees WHERE id = ?').run(rowId)
}
