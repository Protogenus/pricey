/** Shared helpers for the database layer. Pure SQLite + validation plumbing. */
import Decimal from 'decimal.js'

export function nowIso(): string {
  return new Date().toISOString()
}

/** Positive-integer id guard that names the thing being looked up. */
export function requireId(id: unknown, what: string): number {
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw new Error(`A valid ${what} id is required.`)
  }
  return id
}

/** Validate a decimal TEXT input; names the field on failure. */
export function requireDecimalText(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : String(value ?? '')
  let d: Decimal
  try {
    d = new Decimal(s)
  } catch {
    throw new Error(`${field} must be a number. Got "${s}".`)
  }
  if (!d.isFinite()) throw new Error(`${field} must be a finite number. Got "${s}".`)
  return s
}

/** Validate a non-negative decimal TEXT input; names the field on failure. */
export function requireNonNegativeText(value: unknown, field: string): string {
  const s = requireDecimalText(value, field)
  if (new Decimal(s).isNegative()) throw new Error(`${field} cannot be negative. Got "${s}".`)
  return s
}

/** Validate a 0..1 fraction TEXT input; names the field on failure. */
export function requireFractionText(value: unknown, field: string): string {
  const s = requireDecimalText(value, field)
  const d = new Decimal(s)
  if (d.isNegative() || d.gte(1)) {
    throw new Error(`${field} must be between 0 (inclusive) and 1 (exclusive). Got "${s}".`)
  }
  return s
}

export function requireNonEmpty(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value.trim() : ''
  if (!s) throw new Error(`${field} is required.`)
  return s
}

/** Parse a JSON TEXT column, throwing a clear error that names the field. */
export function parseJson<T>(text: string, field: string): T {
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${field} contains invalid JSON.`)
  }
}
