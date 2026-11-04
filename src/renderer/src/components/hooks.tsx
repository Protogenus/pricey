import { useCallback, useEffect, useRef, useState } from 'react'

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Format an ISO timestamp for display. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

export function fmtDateOnly(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString()
}

interface AsyncState<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

/**
 * Load async data with loading/error state. The loader must not depend on
 * values that change every render — pass stable deps.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    loaderRef
      .current()
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setLoading(false)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errMsg(e))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

/** Inline error banner. */
export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <div className="notice notice-danger">
      <strong>Something went wrong</strong>
      <div>{message}</div>
      {onDismiss ? (
        <button type="button" className="secondary" onClick={onDismiss} style={{ marginTop: 8 }}>
          Dismiss
        </button>
      ) : null}
    </div>
  )
}

/** Small muted loading indicator. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <p className="muted">{label}</p>
}
