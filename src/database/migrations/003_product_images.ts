import type { Database as DatabaseType } from 'better-sqlite3'
import type { Migration } from '../migrations.js'

/**
 * 003 — Product images.
 *
 * `products.image_path` now stores a content-addressed image reference:
 * `images/<sha256>.<ext>`, with the file bytes under <userData>/images/.
 * The column already exists from 001 (the DAO always wrote '' until this
 * gap shipped a UI for it), so this migration only guarantees its presence
 * for databases built from an older 001 snapshot — and documents the
 * reference convention. No existing data is moved or dropped.
 */
export const migration003ProductImages: Migration = {
  id: '003_product_images',
  description: 'Product images: image_path stores content-addressed refs (images/<sha256>.<ext>)',
  up(db: DatabaseType) {
    const cols = db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === 'image_path')) {
      db.exec(`ALTER TABLE products ADD COLUMN image_path TEXT NOT NULL DEFAULT ''`)
    }
  },
}
