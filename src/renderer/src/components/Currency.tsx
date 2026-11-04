import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api.js'

/** ISO code → display symbol. Unknown codes fall back to "CODE ". */
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  CHF: 'CHF ',
  CNY: '¥',
  INR: '₹',
  MXN: 'MX$',
  BRL: 'R$',
  ZAR: 'R',
  SEK: 'kr ',
  NOK: 'kr ',
  DKK: 'kr ',
}

export function symbolForCode(code: string): string {
  const upper = code.trim().toUpperCase()
  return CURRENCY_SYMBOLS[upper] ?? (upper ? `${upper} ` : '$')
}

interface CurrencyState {
  code: string
  symbol: string
  reload: () => void
}

const CurrencyContext = createContext<CurrencyState>({ code: 'USD', symbol: '$', reload: () => {} })

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState('USD')

  const load = useCallback(() => {
    api
      .settingsGet('pricey.currency')
      .then((v) => {
        if (v && v.trim()) setCode(v.trim().toUpperCase())
      })
      .catch(() => {
        /* keep default */
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return (
    <CurrencyContext.Provider value={{ code, symbol: symbolForCode(code), reload: load }}>
      {children}
    </CurrencyContext.Provider>
  )
}

export function useCurrency(): CurrencyState {
  return useContext(CurrencyContext)
}
