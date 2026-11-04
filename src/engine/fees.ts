/**
 * Clever Signal Pricey — fee engine.
 *
 * Handles percentage and fixed selling fees, including the case where a
 * percentage fee is computed on the FINAL selling price. That is solved
 * with explicit algebra — never iteration, never circular math:
 *
 *   net = P − a·P − F        (a = total pct-on-price fraction, F = total fixed)
 *   P   = (net + F) ÷ (1 − a)
 *
 * Fee treatments:
 *  - deducted:      taken from revenue (reduces seller net). Includes the
 *                   common marketplace / payment-processor percentage fees.
 *  - included:      baked into the selling price. The seller absorbs it as a
 *                   cost of the price itself, so it reduces net exactly like
 *                   a deducted fee. The treatment is preserved in breakdowns
 *                   for honest labeling; the math is identical by construction
 *                   and the explainer says so explicitly.
 *  - customer_pays: added ON TOP of the price (e.g. buyer-paid shipping).
 *                   Does not affect the seller's price or net.
 */
import Decimal from 'decimal.js'
import { dec, ZERO, ONE } from './money.js'

export class FeeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeeError'
  }
}

export type FeeType = 'pct_on_price' | 'fixed_per_unit' | 'fixed_per_order'
export type FeeTreatment = 'included' | 'deducted' | 'customer_pays'

export interface FeeInput {
  name: string
  type: FeeType
  /** fraction 0..1 for pct_on_price; currency amount for fixed types. */
  value: Decimal.Value
  treatment: FeeTreatment
}

export interface FeeLineResult {
  name: string
  type: FeeType
  treatment: FeeTreatment
  amount: string
}

export interface FeeSolution {
  /** The selling price that delivers exactly targetNet to the seller. */
  price: string
  feeBreakdown: FeeLineResult[]
  totalFees: string
  /** Seller net per unit after deducted/included fees (== targetNet). */
  netRevenue: string
  /** Extra the customer pays on top (customer_pays fees). */
  customerSurcharge: string
}

interface FeeParts {
  pctFrac: Decimal
  fixedPerUnit: Decimal
  surchargePerUnit: Decimal
}

/** Partition fees into the pct fraction, fixed per-unit cost, and customer surcharge. */
function feeParts(fees: FeeInput[], orderQty: Decimal): FeeParts {
  let pctFrac = ZERO
  let fixedPerUnit = ZERO
  let surchargePerUnit = ZERO
  for (const f of fees) {
    const v = dec(f.value)
    if (!v.isFinite() || v.isNegative()) {
      throw new FeeError(`Fee "${f.name}" value must be a finite number >= 0.`)
    }
    if (f.treatment === 'customer_pays') {
      if (f.type === 'pct_on_price') {
        // Surcharge pct is computed on the final price — handled in applyFeesToPrice.
        surchargePerUnit = surchargePerUnit.plus(v) // stored as fraction; flagged below
      } else if (f.type === 'fixed_per_unit') {
        surchargePerUnit = surchargePerUnit.plus(v)
      } else {
        if (orderQty.lte(ZERO)) throw new FeeError(`Order quantity must be > 0 for per-order fee "${f.name}".`)
        surchargePerUnit = surchargePerUnit.plus(v.div(orderQty))
      }
      continue
    }
    if (f.type === 'pct_on_price') {
      if (v.gte(ONE)) throw new FeeError(`Fee "${f.name}" percentage must be below 100%.`)
      pctFrac = pctFrac.plus(v)
    } else if (f.type === 'fixed_per_unit') {
      fixedPerUnit = fixedPerUnit.plus(v)
    } else {
      if (orderQty.lte(ZERO)) throw new FeeError(`Order quantity must be > 0 for per-order fee "${f.name}".`)
      fixedPerUnit = fixedPerUnit.plus(v.div(orderQty))
    }
  }
  if (pctFrac.gte(ONE)) {
    throw new FeeError(
      `Combined percentage fees are ${pctFrac.times(100).toString()}% — at or above 100% no price can cover them.`,
    )
  }
  return { pctFrac, fixedPerUnit, surchargePerUnit }
}

/**
 * Solve for the selling price P such that the seller nets exactly targetNet
 * per unit after all deducted/included fees.
 */
export function solvePriceWithFees(
  targetNet: Decimal.Value,
  fees: FeeInput[],
  orderQty: Decimal.Value = 1,
): FeeSolution {
  const net = dec(targetNet)
  if (!net.isFinite()) throw new FeeError('Target net must be a finite number.')
  const qty = dec(orderQty)
  if (qty.lte(ZERO) || !qty.isFinite()) throw new FeeError('Order quantity must be > 0.')
  const { pctFrac, fixedPerUnit } = feeParts(fees, qty)
  // P = (net + F) / (1 - a)
  const price = net.plus(fixedPerUnit).div(ONE.minus(pctFrac))
  if (price.isNegative()) {
    throw new FeeError('No non-negative price can deliver the target net with these fees.')
  }
  return applyFeesToPrice(price, fees, qty)
}

/** Apply fees to a known price: returns net revenue and the full breakdown. */
export function applyFeesToPrice(
  price: Decimal.Value,
  fees: FeeInput[],
  orderQty: Decimal.Value = 1,
): FeeSolution {
  const p = dec(price)
  if (!p.isFinite() || p.isNegative()) throw new FeeError('Price must be a finite number >= 0.')
  const qty = dec(orderQty)
  if (qty.lte(ZERO) || !qty.isFinite()) throw new FeeError('Order quantity must be > 0.')

  const breakdown: FeeLineResult[] = []
  let absorbed = ZERO // deducted + included: reduce seller net
  let surcharge = ZERO // customer_pays: added on top

  for (const f of fees) {
    const v = dec(f.value)
    let amount: Decimal
    if (f.type === 'pct_on_price') amount = p.times(v)
    else if (f.type === 'fixed_per_unit') amount = v
    else amount = v.div(qty)
    breakdown.push({ name: f.name, type: f.type, treatment: f.treatment, amount: amount.toString() })
    if (f.treatment === 'customer_pays') surcharge = surcharge.plus(amount)
    else absorbed = absorbed.plus(amount)
  }

  return {
    price: p.toString(),
    feeBreakdown: breakdown,
    totalFees: absorbed.plus(surcharge).toString(),
    netRevenue: p.minus(absorbed).toString(),
    customerSurcharge: surcharge.toString(),
  }
}
