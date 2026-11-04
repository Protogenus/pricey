/**
 * Clever Signal Pricey — unit system.
 *
 * Units live in dimensions (mass, volume, length, area, count, custom).
 * Conversions are exact decimal factors against a base unit per dimension.
 * Converting across dimensions (e.g. grams -> millilitres) is refused with
 * UnitConversionError — never silently coerced.
 *
 * Base units: mass=g, volume=ml, length=cm, area=cm2, count=piece.
 */
import Decimal from 'decimal.js'
import { dec } from './money.js'

export type UnitDimension = 'mass' | 'volume' | 'length' | 'area' | 'count' | 'custom'

export interface UnitDef {
  symbol: string
  dimension: UnitDimension
  /** Exact decimal factor converting ONE of this unit into the base unit. */
  toBase: string
}

export interface CustomUnitDef {
  symbol: string
  dimension: Exclude<UnitDimension, 'custom'>
  toBase: string
}

export class UnitConversionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnitConversionError'
  }
}

const UNITS: UnitDef[] = [
  // mass (base: g)
  { symbol: 'g', dimension: 'mass', toBase: '1' },
  { symbol: 'kg', dimension: 'mass', toBase: '1000' },
  { symbol: 'mg', dimension: 'mass', toBase: '0.001' },
  { symbol: 'oz', dimension: 'mass', toBase: '28.349523125' },
  { symbol: 'lb', dimension: 'mass', toBase: '453.59237' },
  // volume (base: ml)
  { symbol: 'ml', dimension: 'volume', toBase: '1' },
  { symbol: 'l', dimension: 'volume', toBase: '1000' },
  { symbol: 'tsp', dimension: 'volume', toBase: '4.92892159375' },
  { symbol: 'tbsp', dimension: 'volume', toBase: '14.78676478125' },
  { symbol: 'floz', dimension: 'volume', toBase: '29.5735295625' },
  { symbol: 'cup', dimension: 'volume', toBase: '236.5882365' },
  { symbol: 'pint', dimension: 'volume', toBase: '473.176473' },
  { symbol: 'quart', dimension: 'volume', toBase: '946.352946' },
  { symbol: 'gal', dimension: 'volume', toBase: '3785.411784' },
  // length (base: cm)
  { symbol: 'mm', dimension: 'length', toBase: '0.1' },
  { symbol: 'cm', dimension: 'length', toBase: '1' },
  { symbol: 'm', dimension: 'length', toBase: '100' },
  { symbol: 'km', dimension: 'length', toBase: '100000' },
  { symbol: 'inch', dimension: 'length', toBase: '2.54' },
  { symbol: 'ft', dimension: 'length', toBase: '30.48' },
  { symbol: 'yd', dimension: 'length', toBase: '91.44' },
  // area (base: cm2)
  { symbol: 'cm2', dimension: 'area', toBase: '1' },
  { symbol: 'm2', dimension: 'area', toBase: '10000' },
  { symbol: 'sqin', dimension: 'area', toBase: '6.4516' },
  { symbol: 'sqft', dimension: 'area', toBase: '929.0304' },
  // count (base: piece) — sheets, rolls, packs are discrete items
  { symbol: 'piece', dimension: 'count', toBase: '1' },
  { symbol: 'sheet', dimension: 'count', toBase: '1' },
  { symbol: 'roll', dimension: 'count', toBase: '1' },
  { symbol: 'pack', dimension: 'count', toBase: '1' },
  { symbol: 'dozen', dimension: 'count', toBase: '12' },
]

/** All known units, built-ins plus caller-supplied custom units. */
export function listUnits(customUnits: CustomUnitDef[] = []): UnitDef[] {
  const customs: UnitDef[] = customUnits.map((c) => ({
    symbol: c.symbol,
    dimension: 'custom',
    toBase: c.toBase,
  }))
  return [...UNITS, ...customs]
}

/** Look up a unit by symbol. Unknown symbols raise UnitConversionError. */
export function getUnit(symbol: string, customUnits: CustomUnitDef[] = []): UnitDef {
  const found = listUnits(customUnits).find((u) => u.symbol === symbol)
  if (!found) {
    throw new UnitConversionError(
      `Unknown unit "${symbol}". Add it as a custom unit before converting.`,
    )
  }
  return found
}

/**
 * Convert a quantity from one unit to another.
 * Throws UnitConversionError when the dimensions are incompatible,
 * or when a custom-dimension unit is converted without its definition.
 */
export function convert(
  quantity: Decimal.Value,
  from: string,
  to: string,
  customUnits: CustomUnitDef[] = [],
): Decimal {
  const fromDef = getUnit(from, customUnits)
  const toDef = getUnit(to, customUnits)
  if (fromDef.symbol === toDef.symbol) return dec(quantity)
  const fromDim = fromDef.dimension === 'custom' ? resolveCustomDimension(fromDef, customUnits) : fromDef.dimension
  const toDim = toDef.dimension === 'custom' ? resolveCustomDimension(toDef, customUnits) : toDef.dimension
  if (fromDim !== toDim) {
    throw new UnitConversionError(
      `Incompatible units: cannot convert ${fromDim} ("${from}") to ${toDim} ("${to}").`,
    )
  }
  // qty_in_base = qty * fromFactor ; result = qty_in_base / toFactor
  return dec(quantity).times(dec(fromDef.toBase)).div(dec(toDef.toBase))
}

function resolveCustomDimension(def: UnitDef, customUnits: CustomUnitDef[]): string {
  const c = customUnits.find((u) => u.symbol === def.symbol)
  if (!c) {
    throw new UnitConversionError(
      `Custom unit "${def.symbol}" has no registered dimension. Register it before converting.`,
    )
  }
  return c.dimension
}

/** True when both symbols exist and share a dimension. */
export function canConvert(from: string, to: string, customUnits: CustomUnitDef[] = []): boolean {
  try {
    convert(1, from, to, customUnits)
    return true
  } catch {
    return false
  }
}
