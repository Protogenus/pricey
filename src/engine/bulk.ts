/**
 * Clever Signal Pricey — bulk production & quantity pricing.
 *
 * Compares total and per-unit cost across production quantities using the
 * user's own quantity tiers and cost rules. Cost is NOT assumed to fall
 * linearly: each tier carries its own material discount, labor efficiency,
 * fixed setup cost and batch waste.
 */
import Decimal from 'decimal.js'
import { dec, ZERO, ONE } from './money.js'

export class BulkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BulkError'
  }
}

export interface BulkTierInput {
  minQty: number
  /** 0..1 supplier discount on materials at this tier. */
  materialDiscountPct: Decimal.Value
  /** 0..1 reduction in labor time at this tier (explicitly configured only). */
  laborEfficiencyPct: Decimal.Value
  /** Fixed setup cost incurred once per batch at this tier. */
  fixedSetup: Decimal.Value
  /** 0..1 batch waste at this tier. */
  batchWastePct: Decimal.Value
}

export interface BulkBaseInput {
  materialPerUnit: Decimal.Value
  laborPerUnit: Decimal.Value
  overheadPerUnit: Decimal.Value
  otherPerUnit: Decimal.Value
}

export interface BulkRow {
  quantity: number
  tierMinQty: number
  materialTotal: string
  laborTotal: string
  overheadTotal: string
  otherTotal: string
  fixedSetup: string
  totalCost: string
  costPerUnit: string
}

function reqFrac(v: Decimal.Value, what: string): Decimal {
  const d = dec(v)
  if (!d.isFinite() || d.isNegative() || d.gte(ONE)) {
    throw new BulkError(`${what} must be in [0, 1). Got ${String(v)}.`)
  }
  return d
}

/** Pick the best tier for a quantity: the highest minQty that does not exceed it. */
export function tierForQuantity(tiers: BulkTierInput[], qty: number): BulkTierInput {
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty)
  let best = sorted[0]
  for (const t of sorted) {
    if (qty >= t.minQty) best = t
  }
  return best
}

export function computeBulkTable(
  base: BulkBaseInput,
  tiers: BulkTierInput[],
  quantities: number[],
): BulkRow[] {
  if (tiers.length === 0) throw new BulkError('At least one bulk tier is required.')
  const matBase = dec(base.materialPerUnit)
  const labBase = dec(base.laborPerUnit)
  const ohBase = dec(base.overheadPerUnit)
  const othBase = dec(base.otherPerUnit)
  for (const [label, v] of [['materialPerUnit', matBase], ['laborPerUnit', labBase], ['overheadPerUnit', ohBase], ['otherPerUnit', othBase]] as const) {
    if (!v.isFinite() || v.isNegative()) throw new BulkError(`${label} must be >= 0.`)
  }

  return quantities.map((qty) => {
    if (!Number.isFinite(qty) || qty <= 0) throw new BulkError(`Quantity must be > 0. Got ${qty}.`)
    const tier = tierForQuantity(tiers, qty)
    const matDisc = reqFrac(tier.materialDiscountPct, 'materialDiscountPct')
    const labEff = reqFrac(tier.laborEfficiencyPct, 'laborEfficiencyPct')
    const setup = dec(tier.fixedSetup)
    if (!setup.isFinite() || setup.isNegative()) throw new BulkError('fixedSetup must be >= 0.')
    const waste = reqFrac(tier.batchWastePct, 'batchWastePct')

    const q = new Decimal(qty)
    const materialTotal = matBase.times(ONE.minus(matDisc)).times(q).div(ONE.minus(waste))
    const laborTotal = labBase.times(ONE.minus(labEff)).times(q)
    const overheadTotal = ohBase.times(q)
    const otherTotal = othBase.times(q)
    const total = materialTotal.plus(laborTotal).plus(overheadTotal).plus(otherTotal).plus(setup)

    return {
      quantity: qty,
      tierMinQty: tier.minQty,
      materialTotal: materialTotal.toString(),
      laborTotal: laborTotal.toString(),
      overheadTotal: overheadTotal.toString(),
      otherTotal: otherTotal.toString(),
      fixedSetup: setup.toString(),
      totalCost: total.toString(),
      costPerUnit: total.div(q).toString(),
    }
  })
}

// Keep ZERO referenced for strict builds.
void ZERO
