import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { listUnits, type CustomUnitDef } from '../../../engine/units.js'

/** Label + control + error wrapper. */
export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string
  error?: string
  hint?: string
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <label className="field" htmlFor={htmlFor}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" {...props} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...props} />
}

const DECIMAL_RE = /^-?\d*\.?\d*$/

/**
 * Decimal-string-aware number input. The value stays a string end to end —
 * money is never parsed to a JS float. Invalid keystrokes are rejected.
 */
export function NumberInput({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  inputMode = 'decimal',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  inputMode?: 'decimal' | 'numeric'
}) {
  return (
    <input
      type="text"
      inputMode={inputMode}
      className={className}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value
        if (v === '' || DECIMAL_RE.test(v)) onChange(v)
      }}
    />
  )
}

/** True when the string is a finite decimal number. */
export function isDecimalString(v: string): boolean {
  if (v.trim() === '') return false
  try {
    const n = Number(v)
    return Number.isFinite(n)
  } catch {
    return false
  }
}

export function Select({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  disabled?: boolean
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'>) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/** Unit picker fed by the engine's unit registry (built-ins + custom units). */
export function UnitSelect({
  value,
  onChange,
  customUnits = [],
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  customUnits?: CustomUnitDef[]
  disabled?: boolean
}) {
  const units = listUnits(customUnits)
  const groups = new Map<string, typeof units>()
  for (const u of units) {
    const g = groups.get(u.dimension) ?? []
    g.push(u)
    groups.set(u.dimension, g)
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
      {[...groups.entries()].map(([dim, us]) => (
        <optgroup key={dim} label={dim}>
          {us.map((u) => (
            <option key={u.symbol} value={u.symbol}>
              {u.symbol}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
