# Clever Signal Pricey — Calculation Formulas & Assumptions

All money math uses **decimal.js** (40 significant digits, half-up rounding).
Binary floating point is never used for currency. Display values are rounded
to 2 decimals; stored snapshots keep full precision. Every formula below is
implemented once in `src/engine/` and reused by every screen.

## 1. Unit conversion

Each unit belongs to a dimension (mass, volume, length, area, count) with an
exact decimal factor to the dimension's base unit (g, ml, cm, cm², piece).

```
qty_in_target = qty × fromFactor ÷ toFactor
```

Converting across dimensions (e.g. grams → millilitres) is **refused** with
`UnitConversionError` — never silently coerced. Unknown units must be
registered as custom units (symbol + dimension + factor) before use.

## 2. Material line cost

```
requiredQty  = quantity ÷ (1 − lineWaste)        # lineWaste in [0, 1)
lineCost     = requiredQty × costPerUnit          # costPerUnit in material's own unit
wastePortion = lineCost − quantity × costPerUnit  # reported separately
```

The waste portion is shown as its own **waste cost** line, but it is real
material you must buy, so it is included in the totals.

## 3. Product-level waste and yield

Product waste is applied **once** to the whole material subtotal
(materials + packaging + services) — never per line, never on labor/overhead:

```
productWasteCost = materialSubtotal × waste ÷ (1 − waste)
materialTotal    = materialSubtotal + lineWasteTotal + productWasteCost
```

Defective output reduces usable units; the full batch cost is spread over
usable units only:

```
usableUnits        = batchSize × (1 − defectPct)
costPerUsableUnit  = totalBatchCost ÷ usableUnits
```

## 4. Labor

| mode       | formula                              |
|------------|--------------------------------------|
| hourly     | hourlyRate × minutes ÷ 60            |
| per_minute | perMinuteRate × minutes              |
| per_unit   | perUnitRate × units                  |
| fixed      | fixedCharge                          |

## 5. Overhead allocation

| method        | formula per unit                                              |
|---------------|---------------------------------------------------------------|
| per_unit      | amount                                                        |
| per_batch     | amount ÷ batchSize                                            |
| pct_of_direct | fraction × directCost (direct = materials incl. waste + labor + other + components) |
| per_hour      | hoursPerUnit × hourlyOverheadRate (rate supplied explicitly)   |
| monthly_share | share × monthlyAmount ÷ monthlyUnits                          |

## 6. Cost roll-up

```
directCost    = materialTotal + laborCost + otherDirect + componentCost
totalUnitCost = directCost + overheadCost
totalBatchCost = totalUnitCost × batchSize
```

**Nested components:** a component contributes its own full `totalUnitCost`
× quantity. Each component's materials, labor, overhead and waste are
counted exactly once. Circular references are rejected, not recursed.

## 7. Margin vs markup — never conflated

```
MARKUP (profit on COST):   price  = cost × (1 + markup)
                           markup = (price − cost) ÷ cost
MARGIN (profit on PRICE):   price  = cost ÷ (1 − margin)
                           margin = (price − cost) ÷ price
```

Equivalence: a markup of m equals a margin of m ÷ (1 + m).
Example: cost $10.50, 60% margin → $26.25; cost $10.50, 150% markup → $26.25.
Margin must be in [0, 100%); 100%+ is rejected as impossible.

## 8. Other pricing methods

```
fixed-profit:   price = cost + profit
cost-plus:      price = Σ categoryCostᵢ × (1 + categoryMarkupᵢ)
minimum:        price = coveredCosts + requiredProfit
reference:      margin/markup/profit computed against a manually entered
                market price (never scraped, never a feed)
reverse discount: listPrice = priceFromMargin(cost, margin) ÷ (1 − discountPct)
```

## 9. Fee engine — fee on the final price, solved explicitly

With `a` = total pct-on-price fraction (deducted + included) and
`F` = total fixed fees per unit (incl. per-order ÷ orderQty):

```
net   = P − a·P − F
P     = (net + F) ÷ (1 − a)        # explicit algebra, no iteration
```

- `deducted` / `included` fees both reduce seller net; the treatment is kept
  as an honest label in breakdowns (the math is identical by construction).
- `customer_pays` fees are added **on top** of the price and do not affect
  the seller's price or net.
- Combined pct fees ≥ 100% are rejected: no price can cover them.

## 10. Discounts

```
salePrice = listPrice × (1 − pct)  |  listPrice − fixedAmount   (floored at 0)
```

Impact is always computed on full economics: discounted price → fees on that
price → net → profit vs unit cost. Tiered discounts pick the best eligible
tier (highest minQty ≤ quantity).

## 11. Bundles

```
totalCost      = Σ itemUnitCost × qty
totalList      = Σ itemUnitPrice × qty
bundlePrice    = totalList − bundleDiscount
profit / margin / markup on the bundle totals
```

Revenue allocation back to items is explicit: `proportional_cost`,
`proportional_price`, or `equal` (per unit).

## 12. Bulk / quantity pricing

Per tier (selected by highest minQty ≤ quantity):

```
materialTotal = materialPerUnit × (1 − matDiscount) × qty ÷ (1 − batchWaste)
laborTotal    = laborPerUnit × (1 − laborEfficiency) × qty
total         = materialTotal + laborTotal + overheadTotal + otherTotal + fixedSetup
costPerUnit   = total ÷ qty
```

No linear-decrease assumption: every tier carries its own rules.

## 13. Break-even

```
contributionPerUnit = sellingPrice − variableCostPerUnit
breakEvenUnits      = ceil(fixedCosts ÷ contributionPerUnit)
breakEvenRevenue    = breakEvenUnits × sellingPrice
targetProfitUnits   = ceil((fixedCosts + targetProfit) ÷ contributionPerUnit)
```

**Double-counting guard:** fixed costs already allocated into the product's
per-unit cost must NOT also be entered as fixedCosts. The UI asks explicitly
and records the caller's confirmation.

## 14. Rounding

Display: 2dp half-up. Suggested customer prices: round up to whole, to x.99,
or to x.95 (`suggestRounding`).

## 15. What this engine never does

- Never invents a missing cost or hides an assumption (assumptions are listed
  in every result).
- Never applies waste twice; never double-counts overhead in break-even.
- Never confuses markup with margin, revenue with profit, or estimates with
  guarantees: all outputs are **calculated estimates**, not promised profits.
- Never requires historical sales data or any network/AI service.
