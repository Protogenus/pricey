import type { ReactNode } from 'react'

/** Honest empty state — describes what is missing and how to fix it. Never fake data. */
export function EmptyState({
  title,
  message,
  action,
}: {
  title: string
  message: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      <p className="muted">{message}</p>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  )
}
