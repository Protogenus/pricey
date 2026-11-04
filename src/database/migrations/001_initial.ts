import type { Database as DatabaseType } from 'better-sqlite3'
import type { Migration } from '../migrations.js'

/**
 * 001 — Initial Pricey schema: settings, materials (+ price events),
 * labor roles, overhead items, products (+ cost-component lines), pricing
 * configs, channels (+ fees), scenarios, bundles, bulk rules, quotes,
 * cost snapshots, templates.
 *
 * Money/decimal values are stored as TEXT, never REAL.
 */
export const migration001Initial: Migration = {
  id: '001_initial',
  description: 'Initial Pricey schema',
  up(db: DatabaseType) {
    db.exec(`
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'material',
  unit TEXT NOT NULL DEFAULT 'piece', unit_dimension TEXT NOT NULL DEFAULT 'count',
  purchase_qty TEXT NOT NULL DEFAULT '1', purchase_price TEXT NOT NULL DEFAULT '0',
  supplier TEXT NOT NULL DEFAULT '', tax_note TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_materials_archived_name ON materials(archived, name);
CREATE TABLE material_price_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
  purchase_price TEXT NOT NULL, purchase_qty TEXT NOT NULL,
  effective_at TEXT NOT NULL, note TEXT NOT NULL DEFAULT '');
CREATE INDEX idx_mpe_material ON material_price_events(material_id, effective_at);
CREATE TABLE labor_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  rate_per_hour TEXT NOT NULL DEFAULT '0', notes TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE overhead_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  amount TEXT NOT NULL DEFAULT '0', period TEXT NOT NULL DEFAULT 'monthly',
  notes TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  sku TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '', image_path TEXT NOT NULL DEFAULT '',
  unit_of_sale TEXT NOT NULL DEFAULT 'piece', batch_size INTEGER NOT NULL DEFAULT 1,
  is_component INTEGER NOT NULL DEFAULT 0,
  waste_pct TEXT NOT NULL DEFAULT '0', defect_pct TEXT NOT NULL DEFAULT '0',
  notes TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_products_archived_name ON products(archived, name);
CREATE TABLE product_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id) ON DELETE RESTRICT,
  quantity TEXT NOT NULL DEFAULT '0', unit TEXT NOT NULL,
  waste_pct TEXT NOT NULL DEFAULT '0', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_pm_product ON product_materials(product_id);
CREATE TABLE product_labor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  role_id INTEGER REFERENCES labor_roles(id) ON DELETE SET NULL,
  task_name TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'hourly',
  rate TEXT NOT NULL DEFAULT '0', quantity TEXT NOT NULL DEFAULT '0',
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_pl_product ON product_labor(product_id);
CREATE TABLE product_overhead (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  overhead_item_id INTEGER REFERENCES overhead_items(id) ON DELETE SET NULL,
  method TEXT NOT NULL DEFAULT 'per_unit', value TEXT NOT NULL DEFAULT '0',
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_po_product ON product_overhead(product_id);
CREATE TABLE product_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  component_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity TEXT NOT NULL DEFAULT '1', sort_order INTEGER NOT NULL DEFAULT 0,
  CHECK (product_id != component_id));
CREATE INDEX idx_pcomp_product ON product_components(product_id);
CREATE TABLE product_other_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, amount_per_unit TEXT NOT NULL DEFAULT '0',
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE pricing_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'retail',
  method TEXT NOT NULL DEFAULT 'margin', params_json TEXT NOT NULL DEFAULT '{}',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_prcfg_product ON pricing_configs(product_id);
CREATE TABLE channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE channel_fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id INTEGER NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  name TEXT NOT NULL, fee_type TEXT NOT NULL DEFAULT 'pct_on_price',
  value TEXT NOT NULL DEFAULT '0', treatment TEXT NOT NULL DEFAULT 'deducted',
  sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE scenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, base_snapshot_json TEXT NOT NULL DEFAULT '{}',
  overrides_json TEXT NOT NULL DEFAULT '{}', notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE bundles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', discount_type TEXT NOT NULL DEFAULT 'none',
  discount_value TEXT NOT NULL DEFAULT '0',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE bundle_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bundle_id INTEGER NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity TEXT NOT NULL DEFAULT '1', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE bulk_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE bulk_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bulk_rule_id INTEGER NOT NULL REFERENCES bulk_rules(id) ON DELETE CASCADE,
  min_qty INTEGER NOT NULL DEFAULT 1,
  material_discount_pct TEXT NOT NULL DEFAULT '0',
  labor_efficiency_pct TEXT NOT NULL DEFAULT '0',
  fixed_setup TEXT NOT NULL DEFAULT '0',
  batch_waste_pct TEXT NOT NULL DEFAULT '0', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, reference TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL DEFAULT '', customer_contact TEXT NOT NULL DEFAULT '',
  quote_date TEXT NOT NULL, expires_at TEXT NOT NULL DEFAULT '',
  business_info_json TEXT NOT NULL DEFAULT '{}', terms TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '', discount_type TEXT NOT NULL DEFAULT 'none',
  discount_value TEXT NOT NULL DEFAULT '0', tax_label TEXT NOT NULL DEFAULT 'Tax',
  tax_rate TEXT NOT NULL DEFAULT '0', tax_mode TEXT NOT NULL DEFAULT 'exclusive',
  shipping TEXT NOT NULL DEFAULT '0', subtotal TEXT NOT NULL DEFAULT '0',
  discount_total TEXT NOT NULL DEFAULT '0', tax_total TEXT NOT NULL DEFAULT '0',
  shipping_total TEXT NOT NULL DEFAULT '0', total TEXT NOT NULL DEFAULT '0',
  snapshot_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE quote_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '', quantity TEXT NOT NULL DEFAULT '1',
  unit_price TEXT NOT NULL DEFAULT '0', sort_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE cost_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'product',
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  label TEXT NOT NULL DEFAULT '', snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL);
CREATE INDEX idx_snapshots_kind ON cost_snapshots(kind, created_at);
CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', structure_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`)
  },
}
