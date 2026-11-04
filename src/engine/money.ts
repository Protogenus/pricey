/**
 * Clever Signal Pricey — decimal-safe money math.
 *
 * Every currency calculation in the app flows through decimal.js.
 * Ordinary binary floating point is NEVER used for money totals.
 * Display rounding (2dp, half-up) happens only at presentation boundaries.
 */
import Decimal from 'decimal.js'

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export type DecimalValue = Decimal.Value

/** Coerce anything numeric into a Decimal. Throws on garbage input. */
export function dec(v: Decimal.Value): Decimal {
  return new Decimal(v)
}

export const ZERO = new Decimal(0)
export const ONE = new Decimal(1)

/** Round to 2dp (currency display) and return the Decimal. */
export function toMoney(d: Decimal.Value): Decimal {
  return new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
}

/** Format as a 2dp decimal string for display/export. */
export function toMoneyString(d: Decimal.Value): string {
  return toMoney(d).toFixed(2)
}

/** Format a 0..1 fraction as a percent string, e.g. 0.6 -> "60.00%". */
export function toPctString(frac: Decimal.Value, dp = 2): string {
  return new Decimal(frac).times(100).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp) + '%'
}

/** True when the value is a finite, non-NaN number. */
export function isValidNumber(v: Decimal.Value): boolean {
  try {
    const d = new Decimal(v)
    return d.isFinite()
  } catch {
    return false
  }
}
