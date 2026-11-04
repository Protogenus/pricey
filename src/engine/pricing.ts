/**
 * Clever Signal Pricey — pricing engine.
 *
 * Margin and markup are mathematically distinct and never conflated:
 *  - MARKUP is profit as a fraction of COST:   price = cost × (1 + markup)
 *  - MARGIN is profit as a fraction of PRICE:  price = cost ÷ (1 − margin)
 * A 150% markup equals a 60% margin on the same cost — the engine exposes
 * both directions explicitly so the UI can label them unmistakably.
 */
import Decimal from 'decimal.js'
import { dec, ZERO, ONE } from './money.js'

export class PricingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PricingError'
  }
}

/** Margin must satisfy 0 <= margin < 1. A margin of 100%+ is impossible. */
export function assertValidMargin(margin: Decimal.Value): Decimal {
  const m = dec(margin)
  if (!m.isFinite() || m.isNegative() || m.gte(ONE)) {
    throw new PricingError(
      `Target margin must be at least 0% and below 100%. Got ${m.times(100).toString()}%.`,
    )
  }
  return m
}

/** Markup must be greater than -100% (a price at or below zero is impossible). */
export function assertValidMarkup(markup: Decimal.Value): Decimal {
  const m = dec(markup)
  if (!m.isFinite() || m.lte(-1)) {
    throw new PricingError(`Markup must be greater than -100%. Got ${m.times(100).toString()}%.`)
  }
  return m
}

function assertValidCost(cost: Decimal.Value): Decimal {
  const c = dec(cost)
  if (!c.isFinite() || c.isNegative()) {
    throw new PricingError(`Cost must be a finite number >= 0. Got ${String(cost)}.`)
  }
  return c
}

/** Selling price = cost ÷ (1 − margin). */
export function priceFromMargin(cost: Decimal.Value, margin: Decimal.Value): Decimal {
  const c = assertValidCost(cost)
  const m = assertValidMargin(margin)
  return c.div(ONE.minus(m))
}

/** Selling price = cost × (1 + markup). */
export function priceFromMarkup(cost: Decimal.Value, markup: Decimal.Value): Decimal {
  const c = assertValidCost(cost)
  const m = assertValidMarkup(markup)
  return c.times(ONE.plus(m))
}

/** Margin implied by a cost and a selling price: (price − cost) ÷ price. */
export function marginFromPrice(cost: Decimal.Value, price: Decimal.Value): Decimal {
  const c = assertValidCost(cost)
  const p = dec(price)
  if (!p.isFinite() || p.lte(ZERO)) {
    throw new PricingError(`Price must be greater than zero to compute margin. Got ${String(price)}.`)
  }
  return p.minus(c).div(p)
}

/** Markup implied by a cost and a selling price: (price − cost) ÷ cost. */
export function markupFromPrice(cost: Decimal.Value, price: Decimal.Value): Decimal {
  const c = assertValidCost(cost)
  const p = dec(price)
  if (c.isZero()) {
    throw new PricingError('Cannot compute markup on a zero cost (division by zero).')
  }
  if (!p.isFinite() || p.isNegative()) {
    throw new PricingError(`Price must be >= 0 to compute markup. Got ${String(price)}.`)
  }
  return p.minus(c).div(c)
}

/** Selling price = cost + fixed profit amount. */
export function priceFromFixedProfit(cost: Decimal.Value, profit: Decimal.Value): Decimal {
  const c = assertValidCost(cost)
  const p = dec(profit)
  if (!p.isFinite()) throw new PricingError(`Profit must be a finite number. Got ${String(profit)}.`)
  const price = c.plus(p)
  if (price.isNegative()) throw new PricingError('Fixed profit would make the price negative.')
  return price
}

/**
 * Cost-plus: each cost category gets its own markup, then summed.
 * price = Σ costᵢ × (1 + markupᵢ)
 */
export interface CostPlusCategory {
  name: string
  cost: Decimal.Value
  markup: Decimal.Value
}

export function priceCostPlus(categories: CostPlusCategory[]): Decimal {
  return categories.reduce((sum, cat) => {
    const c = assertValidCost(cat.cost)
    const m = assertValidMarkup(cat.markup)
    return sum.plus(c.times(ONE.plus(m)))
  }, ZERO)
}

/**
 * Reverse discount calculator: "If I offer a discount of d, what list price
 * do I need so the DISCOUNTED price still earns the target margin on cost?"
 * listPrice = priceFromMargin(cost, margin) ÷ (1 − d)
 */
export function priceForDiscountedMargin(
  cost: Decimal.Value,
  targetMargin: Decimal.Value,
  discountPct: Decimal.Value,
): Decimal {
  const d = dec(discountPct)
  if (!d.isFinite() || d.isNegative() || d.gte(ONE)) {
    throw new PricingError(`Discount must be in [0, 100%). Got ${d.times(100).toString()}%.`)
  }
  return priceFromMargin(cost, targetMargin).div(ONE.minus(d))
}

/**
 * Minimum viable price: the price that exactly covers the selected costs
 * plus the required profit. No margin math — pure cost coverage.
 */
export function minimumPrice(coveredCosts: Decimal.Value, requiredProfit: Decimal.Value): Decimal {
  const c = assertValidCost(coveredCosts)
  const p = dec(requiredProfit)
  if (!p.isFinite() || p.isNegative()) {
    throw new PricingError(`Required profit must be >= 0. Got ${String(requiredProfit)}.`)
  }
  return c.plus(p)
}

/** Compare a manually entered market reference price against our cost. */
export interface ReferenceComparison {
  margin: Decimal
  markup: Decimal
  profit: Decimal
}

export function referenceComparison(cost: Decimal.Value, refPrice: Decimal.Value): ReferenceComparison {
  const c = assertValidCost(cost)
  const p = dec(refPrice)
  return {
    margin: marginFromPrice(c, p),
    markup: markupFromPrice(c, p),
    profit: p.minus(c),
  }
}

/** The margin equivalent of a given markup: margin = markup ÷ (1 + markup). */
export function marginMarkupEquivalent(markup: Decimal.Value): Decimal {
  const m = assertValidMarkup(markup)
  return m.div(ONE.plus(m))
}

/** The markup equivalent of a given margin: markup = margin ÷ (1 − margin). */
export function markupMarginEquivalent(margin: Decimal.Value): Decimal {
  const m = assertValidMargin(margin)
  return m.div(ONE.minus(m))
}

/** Round a price to a customer-friendly figure. */
export type RoundingStyle = 'none' | 'whole' | 'nine' | 'nine5'

export function suggestRounding(price: Decimal.Value, style: RoundingStyle): Decimal {
  const p = dec(price)
  if (!p.isFinite() || p.isNegative()) {
    throw new PricingError(`Cannot round an invalid price: ${String(price)}.`)
  }
  switch (style) {
    case 'none':
      return p
    case 'whole':
      return p.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
    case 'nine': {
      // Round UP to the next whole minus one cent (e.g. 26.25 -> 26.99)
      const whole = p.toDecimalPlaces(0, Decimal.ROUND_CEIL)
      const candidate = whole.minus(0.01)
      return candidate.gte(p) ? candidate : whole.plus(1).minus(0.01)
    }
    case 'nine5': {
      // Round UP to the next .95 (e.g. 26.25 -> 26.95)
      const base = p.toDecimalPlaces(0, Decimal.ROUND_FLOOR)
      const candidate = base.plus(0.95)
      return candidate.gte(p) ? candidate : base.plus(1).plus(0.95)
    }
  }
}
