import { toPctString } from '../../../engine/money.js'

/** Format a 0..1 fraction as a percent string. */
export function Pct({
  value,
  dp = 2,
  signed = false,
}: {
  value: string | number | null | undefined
  dp?: number
  /** Prefix a + sign on positive values (for deltas). */
  signed?: boolean
}) {
  if (value === null || value === undefined || value === '') {
    return <span className="money">—</span>
  }
  let text: string
  try {
    const n = Number(value)
    const prefix = signed && Number.isFinite(n) && n > 0 ? '+' : ''
    text = prefix + toPctString(value, dp)
  } catch {
    return <span className="money">—</span>
  }
  return <span className="money">{text}</span>
}
