export type ID = number;
export type UnitDimension = 'mass' | 'volume' | 'length' | 'area' | 'count' | 'custom';
export type MaterialCategory = 'material' | 'packaging' | 'service' | 'other';
export type LaborMode = 'hourly' | 'per_minute' | 'per_unit' | 'fixed';
export type OverheadMethod = 'per_unit' | 'per_batch' | 'pct_of_direct' | 'per_hour' | 'monthly_share';
export type PricingMethod = 'margin' | 'markup' | 'fixed_profit' | 'target_profit' | 'minimum' | 'cost_plus' | 'reference';
export type PriceChannel = 'retail' | 'wholesale' | 'custom';
export type FeeType = 'pct_on_price' | 'fixed_per_unit' | 'fixed_per_order';
export type FeeTreatment = 'included' | 'deducted' | 'customer_pays';
export type DiscountType = 'none' | 'pct' | 'fixed';

export interface Material { id: ID; name: string; description: string; category: MaterialCategory; unit: string; unit_dimension: UnitDimension; purchase_qty: string; purchase_price: string; cost_per_unit: string; supplier: string; tax_note: string; notes: string; archived: number; created_at: string; updated_at: string; }
export interface NewMaterialInput { name: string; description?: string; category?: MaterialCategory; unit: string; unit_dimension?: UnitDimension; purchase_qty: string; purchase_price: string; supplier?: string; tax_note?: string; notes?: string; }
export interface UpdateMaterialInput extends Partial<NewMaterialInput> { id: ID; }
export interface MaterialPriceEvent { id: ID; material_id: ID; purchase_price: string; purchase_qty: string; effective_at: string; note: string; }

export interface LaborRole { id: ID; name: string; rate_per_hour: string; notes: string; archived: number; created_at: string; updated_at: string; }
export interface OverheadItem { id: ID; name: string; amount: string; period: string; notes: string; archived: number; created_at: string; updated_at: string; }

export interface Product { id: ID; name: string; sku: string; description: string; category: string; image_path: string; unit_of_sale: string; batch_size: number; is_component: number; waste_pct: string; defect_pct: string; notes: string; archived: number; created_at: string; updated_at: string; }
export interface NewProductInput { name: string; sku?: string; description?: string; category?: string; unit_of_sale?: string; batch_size?: number; is_component?: boolean; waste_pct?: string; defect_pct?: string; notes?: string; }
export interface ProductMaterialLine { id: ID; product_id: ID; material_id: ID; material_name?: string; quantity: string; unit: string; waste_pct: string; sort_order: number; }
export interface ProductLaborLine { id: ID; product_id: ID; role_id: ID | null; role_name?: string; task_name: string; mode: LaborMode; rate: string; quantity: string; sort_order: number; }
export interface ProductOverheadLine { id: ID; product_id: ID; overhead_item_id: ID | null; item_name?: string; method: OverheadMethod; value: string; sort_order: number; }
export interface ProductComponentLine { id: ID; product_id: ID; component_id: ID; component_name?: string; quantity: string; sort_order: number; }
export interface ProductOtherCostLine { id: ID; product_id: ID; name: string; amount_per_unit: string; sort_order: number; }
export interface ProductFull extends Product { materials: ProductMaterialLine[]; labor: ProductLaborLine[]; overhead: ProductOverheadLine[]; components: ProductComponentLine[]; other_costs: ProductOtherCostLine[]; }

export interface PricingConfig { id: ID; product_id: ID; name: string; channel: PriceChannel; method: PricingMethod; params_json: string; is_default: number; created_at: string; updated_at: string; }
export interface Channel { id: ID; name: string; kind: string; notes: string; created_at: string; updated_at: string; }
export interface ChannelFee { id: ID; channel_id: ID; name: string; fee_type: FeeType; value: string; treatment: FeeTreatment; sort_order: number; }

export interface ScenarioRec { id: ID; product_id: ID; name: string; base_snapshot_json: string; overrides_json: string; notes: string; created_at: string; updated_at: string; }
export interface Bundle { id: ID; name: string; description: string; discount_type: DiscountType; discount_value: string; created_at: string; updated_at: string; }
export interface BundleItem { id: ID; bundle_id: ID; product_id: ID; product_name?: string; quantity: string; sort_order: number; }
export interface BulkRule { id: ID; product_id: ID; name: string; created_at: string; updated_at: string; }
export interface BulkTier { id: ID; bulk_rule_id: ID; min_qty: number; material_discount_pct: string; labor_efficiency_pct: string; fixed_setup: string; batch_waste_pct: string; sort_order: number; }
export interface Quote { id: ID; reference: string; customer_name: string; customer_contact: string; quote_date: string; expires_at: string; business_info_json: string; terms: string; notes: string; discount_type: DiscountType; discount_value: string; tax_label: string; tax_rate: string; tax_mode: string; shipping: string; subtotal: string; discount_total: string; tax_total: string; shipping_total: string; total: string; snapshot_json: string; status: string; created_at: string; updated_at: string; }
export interface QuoteItem { id: ID; quote_id: ID; product_id: ID | null; description: string; quantity: string; unit_price: string; sort_order: number; }
export interface CostSnapshot { id: ID; kind: string; product_id: ID | null; label: string; snapshot_json: string; created_at: string; }
export interface TemplateRec { id: ID; name: string; description: string; structure_json: string; created_at: string; updated_at: string; }
