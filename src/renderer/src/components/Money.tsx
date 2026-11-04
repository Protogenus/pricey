import { toMoneyString } from '../../../engine/money.js'
import { useCurrency } from './Currency.js'

/** Format a decimal string as money, 2dp, with the display currency symbol. */
export function Money({
  value,
  symbol,
}: {
  value: string | number | null | undefined
  /** Override the currency symbol for this instance. */
  symbol?: string
}) {
  const { symbol: ctxSymbol } = useCurrency()
  if (value === null || value === undefined || value === '') {
    return <span className="money">—</span>
  }
  let text: string
  try {
    text = toMoneyString(value)
  } catch {
    return <span className="money">—</span>
  }
  return (
    <span className="money">
      {symbol ?? ctxSymbol}
      {text}
    </span>
  )
}
