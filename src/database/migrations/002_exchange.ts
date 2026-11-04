import type { Database as DatabaseType } from 'better-sqlite3'
import type { Migration } from '../migrations.js'

/**
 * 002 — pricey-exchange-v1 audit trail.
 *
 * exchange_log records every file exchange (import or export): direction,
 * contract, filename, record counts, timestamp. Append-only — rows are never
 * updated or deleted by the application.
 *
 * externalId matching state lives in the settings table under
 * pricey.exchange.material.<contract>.<externalId> /
 * pricey.exchange.product.<contract>.<externalId> (no schema change needed).
 */
export const migration002Exchange: Migration = {
  id: '002_exchange_log',
  description: 'pricey-exchange-v1 import/export audit log',
  up(db: DatabaseType) {
    db.exec(`
CREATE TABLE exchange_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direction TEXT NOT NULL CHECK (direction IN ('import', 'export')),
  contract TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  records_created INTEGER NOT NULL DEFAULT 0,
  records_updated INTEGER NOT NULL DEFAULT 0,
  records_rejected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL);
CREATE INDEX idx_exchange_log_created ON exchange_log(created_at DESC);
`)
  },
}
