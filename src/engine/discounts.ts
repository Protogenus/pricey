/**
 * Clever Signal Pricey — discount & promotion simulator.
 *
 * All discount impacts are computed against the FULL economics: unit cost,
 * channel fees on the discounted price, and quantity. A discount is never
 * shown as profitable without fees and costs included.
 */
import Decimal from 'decimal.js'
import { dec, ZERO, ONE } from './money.js'
import { marginFromPrice, markupFromPrice, priceForDiscountedMargin, PricingError } from './pricing.js'
import { applyFeesToPrice, type FeeInput } from './fees.js'

export class DiscountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscountError'
  }
}

export interface DiscountInput {
  type: 'pct' | 'fixed'
  value: Decimal.Value
}

function assertValidDiscount(d: DiscountInput): Decimal {
  const v = dec(d.value)
  if (!v.isFinite() || v.isNegative()) {
    throw new DiscountError(`Discount value must be >= 0. Got ${String(d.value)}.`)
  }
  if (d.type === 'pct' && v.gte(ONE)) {
    throw new DiscountError('Percentage discount must be below 100%.')
  }
  return v
}

/** Apply a single discount to a price. Never returns a negative price. */
export function applyDiscount(price: Decimal.Value, discount: DiscountInput): Decimal {
  const p = dec(price)
  if (!p.isFinite() || p.isNegative()) throw new DiscountError('Price must be >= 0.')
  const v = assertValidDiscount(discount)
  const result = discount.type === 'pct' ? p.times(ONE.minus(v)) : p.minus(v)
  return Decimal.max(result, ZERO)
}

export interface TierInput {
  minQty: number
  discount: DiscountInput
}

/** Best (lowest) unit price for a quantity given tiered discounts. */
export function tieredPrice(unitPrice: Decimal.Value, qty: number, tiers: TierInput[]): Decimal {
  const p = dec(unitPrice)
  if (!Number.isFinite(qty) || qty < 0) throw new DiscountError('Quantity must be >= 0.')
  const eligible = tiers
    .filter((t) => Number.isFinite(t.minQty) && t.minQty >= 0 && qty >= t.minQty)
    .sort((a, b) => b.minQty - a.minQty)
  if (eligible.length === 0) return p
  return applyDiscount(p, eligible[0].discount)
}

export interface DiscountImpact {
  listPrice: string
  salePrice: string
  discountAmount: string
  quantity: string
  revenue: string
  totalFees: string
  netRevenue: string
  unitCost: string
  profitPerUnit: string
  totalProfit: string
  margin: string
  markup: string
}

/**
 * Full economics of selling `qty` units at a discounted price:
 * discounted price -> fees on that price -> net -> profit vs unit cost.
 */
export function discountImpact(
  listPrice: Decimal.Value,
  unitCost: Decimal.Value,
  fees: FeeInput[],
  qty: Decimal.Value,
  discount: DiscountInput,
): DiscountImpact {
  const lp = dec(listPrice)
  const cost = dec(unitCost)
  const q = dec(qty)
  if (!lp.isFinite() || lp.isNegative()) throw new DiscountError('List price must be >= 0.')
  if (!cost.isFinite() || cost.isNegative()) throw new DiscountError('Unit cost must be >= 0.')
  if (!q.isFinite() || q.isNegative()) throw new DiscountError('Quantity must be >= 0.')

  const sale = applyDiscount(lp, discount)
  const feeResult = applyFeesToPrice(sale, fees, q)
  const netPerUnit = dec(feeResult.netRevenue)
  const profitPerUnit = netPerUnit.minus(cost)
  const revenue = sale.times(q)
  const totalProfit = profitPerUnit.times(q)

  return {
    listPrice: lp.toString(),
    salePrice: sale.toString(),
    discountAmount: lp.minus(sale).toString(),
    quantity: q.toString(),
    revenue: revenue.toString(),
    totalFees: dec(feeResult.totalFees).times(q).toString(),
    netRevenue: netPerUnit.times(q).toString(),
    unitCost: cost.toString(),
    profitPerUnit: profitPerUnit.toString(),
    totalProfit: totalProfit.toString(),
    margin: netPerUnit.gt(ZERO) ? marginFromPrice(cost, netPerUnit).toString() : '0',
    markup: cost.gt(ZERO) ? markupFromPrice(cost, netPerUnit).toString() : '0',
  }
}

/**
 * Reverse calculator: "If I offer this discount, what LIST price do I need
 * so the discounted price still earns targetMargin on unitCost?"
 */
export function listPriceForDiscountedMargin(
  unitCost: Decimal.Value,
  targetMargin: Decimal.Value,
  discount: DiscountInput,
): Decimal {
  const v = assertValidDiscount(discount)
  const discountPct = discount.type === 'pct' ? v : (() => {
    throw new PricingError('Reverse calculator needs a percentage discount, not a fixed amount.')
  })()
  return priceForDiscountedMargin(unitCost, targetMargin, discountPct)
}
