/**
 * Clever Signal Pricey — bundle & multi-product pricing.
 *
 * A bundle has a combined cost (sum of item unit costs × quantities) and a
 * bundle price (sum of item list prices × quantities, less the bundle
 * discount). When the bundle price is distributed back across items, the
 * allocation method is explicit — never an invisible pro-rata.
 */
import Decimal from 'decimal.js'
import { dec, ZERO, ONE } from './money.js'
import { applyDiscount, type DiscountInput } from './discounts.js'

export class BundleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundleError'
  }
}

export interface BundleItemInput {
  name: string
  unitCost: Decimal.Value
  unitPrice: Decimal.Value
  quantity: Decimal.Value
}

export type BundleDiscountInput = { type: 'none' } | DiscountInput
export type AllocationMethod = 'proportional_cost' | 'proportional_price' | 'equal'

export interface BundleItemResult {
  name: string
  quantity: string
  itemCost: string
  itemListPrice: string
  allocatedRevenue: string
  allocatedProfit: string
}

export interface BundleResult {
  totalCost: string
  totalListPrice: string
  bundlePrice: string
  discountAmount: string
  profit: string
  margin: string
  markup: string
  allocationMethod: AllocationMethod
  items: BundleItemResult[]
}

export function computeBundle(
  items: BundleItemInput[],
  discount: BundleDiscountInput,
  allocation: AllocationMethod = 'proportional_cost',
): BundleResult {
  if (items.length === 0) throw new BundleError('A bundle needs at least one item.')

  let totalCost = ZERO
  let totalList = ZERO
  let totalUnits = ZERO
  const prepared = items.map((it) => {
    const cost = dec(it.unitCost)
    const price = dec(it.unitPrice)
    const qty = dec(it.quantity)
    if (!cost.isFinite() || cost.isNegative()) throw new BundleError(`Item "${it.name}" cost must be >= 0.`)
    if (!price.isFinite() || price.isNegative()) throw new BundleError(`Item "${it.name}" price must be >= 0.`)
    if (!qty.isFinite() || qty.lte(ZERO)) throw new BundleError(`Item "${it.name}" quantity must be > 0.`)
    const itemCost = cost.times(qty)
    const itemList = price.times(qty)
    totalCost = totalCost.plus(itemCost)
    totalList = totalList.plus(itemList)
    totalUnits = totalUnits.plus(qty)
    return { name: it.name, qty, itemCost, itemList }
  })

  const bundlePrice =
    discount.type === 'none' ? totalList : applyDiscount(totalList, discount)
  const discountAmount = totalList.minus(bundlePrice)
  const profit = bundlePrice.minus(totalCost)

  // Allocate the bundle price back across items.
  const itemResults: BundleItemResult[] = prepared.map((p) => {
    let share: Decimal
    if (allocation === 'equal') {
      share = p.qty.div(totalUnits)
    } else if (allocation === 'proportional_price') {
      share = totalList.gt(ZERO) ? p.itemList.div(totalList) : p.qty.div(totalUnits)
    } else {
      share = totalCost.gt(ZERO) ? p.itemCost.div(totalCost) : p.qty.div(totalUnits)
    }
    const allocatedRevenue = bundlePrice.times(share)
    return {
      name: p.name,
      quantity: p.qty.toString(),
      itemCost: p.itemCost.toString(),
      itemListPrice: p.itemList.toString(),
      allocatedRevenue: allocatedRevenue.toString(),
      allocatedProfit: allocatedRevenue.minus(p.itemCost).toString(),
    }
  })

  return {
    totalCost: totalCost.toString(),
    totalListPrice: totalList.toString(),
    bundlePrice: bundlePrice.toString(),
    discountAmount: discountAmount.toString(),
    profit: profit.toString(),
    margin: bundlePrice.gt(ZERO) ? profit.div(bundlePrice).toString() : '0',
    markup: totalCost.gt(ZERO) ? profit.div(totalCost).toString() : '0',
    allocationMethod: allocation,
    items: itemResults,
  }
}

// Re-exported for convenience; keeps the bundle discount type tight.
export type { DiscountInput }
void ONE
