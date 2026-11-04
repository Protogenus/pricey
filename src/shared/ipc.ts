import type {
  BulkRule,
  BulkTier,
  Bundle,
  BundleItem,
  Channel,
  ChannelFee,
  CostSnapshot,
  DiscountType,
  FeeTreatment,
  FeeType,
  ID,
  LaborMode,
  LaborRole,
  Material,
  MaterialCategory,
  MaterialPriceEvent,
  NewMaterialInput,
  NewProductInput,
  OverheadItem,
  OverheadMethod,
  PriceChannel,
  PricingConfig,
  PricingMethod,
  Product,
  ProductComponentLine,
  ProductFull,
  ProductLaborLine,
  ProductMaterialLine,
  ProductOtherCostLine,
  ProductOverheadLine,
  Quote,
  QuoteItem,
  ScenarioRec,
  TemplateRec,
  UnitDimension,
  UpdateMaterialInput,
} from './types.js'

import type {
  ExchangeLogEntry,
  ExchangePreview,
  ExchangeReport,
  ExchangeSelection,
} from '../engine/exchange.js'

/** Re-exported (type-only, erased at compile) for the preload + renderer. */
export type { ExchangeLogEntry, ExchangePreview, ExchangeReport, ExchangeSelection }

/** Opaque engine payloads — the engine engineer owns their shapes; the UI engineer refines these later. */
export type EngineResult = Record<string, unknown>

/** The wire envelope every IPC handler returns; preload unwraps it. */
export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code?: string } }

/** Logical IPC channel names → wire channel strings. */
export const IPC = {
  ping: 'ping',

  settingsGet: 'settings.get',
  settingsSet: 'settings.set',
  settingsGetDataPath: 'settings.getDataPath',
  settingsBackup: 'settings.backup',
  settingsRestore: 'settings.restore',

  materialsList: 'materials.list',
  materialsCreate: 'materials.create',
  materialsUpdate: 'materials.update',
  materialsArchive: 'materials.archive',
  materialsDelete: 'materials.delete',
  materialsPriceEvents: 'materials.priceEvents',
  materialsExportCsv: 'materials.exportCsv',
  materialsImportCsv: 'materials.importCsv',

  laborList: 'labor.list',
  laborCreate: 'labor.create',
  laborUpdate: 'labor.update',
  laborArchive: 'labor.archive',
  laborDelete: 'labor.delete',

  overheadList: 'overhead.list',
  overheadCreate: 'overhead.create',
  overheadUpdate: 'overhead.update',
  overheadArchive: 'overhead.archive',
  overheadDelete: 'overhead.delete',

  productsList: 'products.list',
  productsCreate: 'products.create',
  productsUpdate: 'products.update',
  productsArchive: 'products.archive',
  productsDelete: 'products.delete',
  productsGetFull: 'products.getFull',
  productsAddMaterial: 'products.addMaterial',
  productsUpdateMaterialLine: 'products.updateMaterialLine',
  productsRemoveMaterialLine: 'products.removeMaterialLine',
  productsAddLabor: 'products.addLabor',
  productsUpdateLaborLine: 'products.updateLaborLine',
  productsRemoveLaborLine: 'products.removeLaborLine',
  productsAddOverhead: 'products.addOverhead',
  productsUpdateOverheadLine: 'products.updateOverheadLine',
  productsRemoveOverheadLine: 'products.removeOverheadLine',
  productsAddComponent: 'products.addComponent',
  productsUpdateComponentLine: 'products.updateComponentLine',
  productsRemoveComponentLine: 'products.removeComponentLine',
  productsAddOtherCost: 'products.addOtherCost',
  productsUpdateOtherCostLine: 'products.updateOtherCostLine',
  productsRemoveOtherCostLine: 'products.removeOtherCostLine',
  productsComputeCost: 'products.computeCost',
  productsSaveSnapshot: 'products.saveSnapshot',
  productsImagePick: 'products.image.pick',
  productsImageSave: 'products.image.save',
  productsImageRemove: 'products.image.remove',
  productsImageData: 'products.image.data',

  templatesList: 'templates.list',
  templatesCreate: 'templates.create',
  templatesUpdate: 'templates.update',
  templatesDelete: 'templates.delete',
  templatesApply: 'templates.apply',

  pricingConfigsList: 'pricing.configs.list',
  pricingConfigsCreate: 'pricing.configs.create',
  pricingConfigsUpdate: 'pricing.configs.update',
  pricingConfigsDelete: 'pricing.configs.delete',
  pricingCalculate: 'pricing.calculate',
  pricingExplain: 'pricing.explain',

  channelsList: 'channels.list',
  channelsCreate: 'channels.create',
  channelsUpdate: 'channels.update',
  channelsDelete: 'channels.delete',
  channelFeesList: 'channels.fees.list',
  channelFeesCreate: 'channels.fees.create',
  channelFeesUpdate: 'channels.fees.update',
  channelFeesDelete: 'channels.fees.delete',

  scenariosList: 'scenarios.list',
  scenariosCreate: 'scenarios.create',
  scenariosUpdate: 'scenarios.update',
  scenariosDelete: 'scenarios.delete',
  scenariosDuplicate: 'scenarios.duplicate',
  scenariosCompute: 'scenarios.compute',

  bundlesList: 'bundles.list',
  bundlesCreate: 'bundles.create',
  bundlesUpdate: 'bundles.update',
  bundlesDelete: 'bundles.delete',
  bundleItemsList: 'bundles.items.list',
  bundleItemsAdd: 'bundles.items.add',
  bundleItemsUpdate: 'bundles.items.update',
  bundleItemsRemove: 'bundles.items.remove',
  bundlesCompute: 'bundles.compute',

  bulkRulesList: 'bulk.rules.list',
  bulkRulesCreate: 'bulk.rules.create',
  bulkRulesUpdate: 'bulk.rules.update',
  bulkRulesDelete: 'bulk.rules.delete',
  bulkTiersList: 'bulk.tiers.list',
  bulkTiersCreate: 'bulk.tiers.create',
  bulkTiersUpdate: 'bulk.tiers.update',
  bulkTiersDelete: 'bulk.tiers.delete',
  bulkCompute: 'bulk.compute',

  breakevenCalculate: 'breakeven.calculate',

  quotesList: 'quotes.list',
  quotesCreate: 'quotes.create',
  quotesUpdate: 'quotes.update',
  quotesDelete: 'quotes.delete',
  quotesGetFull: 'quotes.getFull',
  quotesDuplicate: 'quotes.duplicate',
  quotesExportPdf: 'quotes.exportPdf',
  quotesExportPdfDirect: 'quotes.exportPdfDirect',
  quotesExportPdfPickDir: 'quotes.exportPdfPickDir',
  quotesExportPdfOpenFolder: 'quotes.exportPdfOpenFolder',
  quoteItemsAdd: 'quotes.items.add',
  quoteItemsUpdate: 'quotes.items.update',
  quoteItemsRemove: 'quotes.items.remove',

  snapshotsList: 'snapshots.list',
  snapshotsCreate: 'snapshots.create',
  snapshotsGet: 'snapshots.get',

  exportsCsv: 'exports.csv',
  exportsXlsx: 'exports.xlsx',
  exportsImportTemplate: 'exports.importTemplate',

  integrationsContracts: 'integrations.contracts',

  exchangeExport: 'exchange.export',
  exchangeValidateFile: 'exchange.validateFile',
  exchangeApplyImport: 'exchange.applyImport',
  exchangeLog: 'exchange.log',
} as const

/* ---- Input shapes (scaffold-level; the backend engineer refines) ---- */

export interface UpdateProductInput extends Partial<NewProductInput> {
  id: ID
}

export interface NewLaborRoleInput {
  name: string
  rate_per_hour?: string
  notes?: string
}
export interface UpdateLaborRoleInput extends Partial<NewLaborRoleInput> {
  id: ID
}

export interface NewOverheadItemInput {
  name: string
  amount?: string
  period?: string
  notes?: string
}
export interface UpdateOverheadItemInput extends Partial<NewOverheadItemInput> {
  id: ID
}

export interface NewProductMaterialLineInput {
  material_id: ID
  quantity: string
  unit: string
  waste_pct?: string
  sort_order?: number
}
export interface UpdateProductMaterialLineInput extends Partial<NewProductMaterialLineInput> {
  id: ID
}

export interface NewProductLaborLineInput {
  role_id?: ID | null
  task_name?: string
  mode?: LaborMode
  rate?: string
  quantity?: string
  sort_order?: number
}
export interface UpdateProductLaborLineInput extends Partial<NewProductLaborLineInput> {
  id: ID
}

export interface NewProductOverheadLineInput {
  overhead_item_id?: ID | null
  method?: OverheadMethod
  value?: string
  sort_order?: number
}
export interface UpdateProductOverheadLineInput extends Partial<NewProductOverheadLineInput> {
  id: ID
}

export interface NewProductComponentLineInput {
  component_id: ID
  quantity?: string
  sort_order?: number
}
export interface UpdateProductComponentLineInput extends Partial<NewProductComponentLineInput> {
  id: ID
}

export interface NewProductOtherCostLineInput {
  name: string
  amount_per_unit?: string
  sort_order?: number
}
export interface UpdateProductOtherCostLineInput extends Partial<NewProductOtherCostLineInput> {
  id: ID
}

export interface NewPricingConfigInput {
  product_id: ID
  name: string
  channel?: PriceChannel
  method?: PricingMethod
  params_json?: string
  is_default?: boolean
}
export interface UpdatePricingConfigInput extends Partial<NewPricingConfigInput> {
  id: ID
}

export interface NewChannelInput {
  name: string
  kind?: string
  notes?: string
}
export interface UpdateChannelInput extends Partial<NewChannelInput> {
  id: ID
}

export interface NewChannelFeeInput {
  channel_id: ID
  name: string
  fee_type?: FeeType
  value?: string
  treatment?: FeeTreatment
  sort_order?: number
}
export interface UpdateChannelFeeInput extends Partial<NewChannelFeeInput> {
  id: ID
}

export interface NewScenarioInput {
  product_id: ID
  name: string
  base_snapshot_json?: string
  overrides_json?: string
  notes?: string
}
export interface UpdateScenarioInput extends Partial<NewScenarioInput> {
  id: ID
}

export interface NewBundleInput {
  name: string
  description?: string
  discount_type?: DiscountType
  discount_value?: string
}
export interface UpdateBundleInput extends Partial<NewBundleInput> {
  id: ID
}

export interface NewBundleItemInput {
  product_id: ID
  quantity?: string
  sort_order?: number
}
export interface UpdateBundleItemInput extends Partial<NewBundleItemInput> {
  id: ID
}

export interface NewBulkRuleInput {
  product_id: ID
  name: string
}
export interface UpdateBulkRuleInput extends Partial<NewBulkRuleInput> {
  id: ID
}

export interface NewBulkTierInput {
  bulk_rule_id: ID
  min_qty?: number
  material_discount_pct?: string
  labor_efficiency_pct?: string
  fixed_setup?: string
  batch_waste_pct?: string
  sort_order?: number
}
export interface UpdateBulkTierInput extends Partial<NewBulkTierInput> {
  id: ID
}

export interface BreakEvenInput {
  fixed_costs?: string
  unit_price?: string
  unit_variable_cost?: string
}

export interface NewQuoteInput {
  reference: string
  customer_name?: string
  customer_contact?: string
  quote_date?: string
  expires_at?: string
  business_info_json?: string
  terms?: string
  notes?: string
  discount_type?: DiscountType
  discount_value?: string
  tax_label?: string
  tax_rate?: string
  tax_mode?: string
  shipping?: string
}
export interface UpdateQuoteInput extends Partial<NewQuoteInput> {
  id: ID
}

export interface NewQuoteItemInput {
  product_id?: ID | null
  description?: string
  quantity?: string
  unit_price?: string
  sort_order?: number
}
export interface UpdateQuoteItemInput extends Partial<NewQuoteItemInput> {
  id: ID
}

export interface QuoteFull {
  quote: Quote
  items: QuoteItem[]
}

export interface NewSnapshotInput {
  kind?: string
  product_id?: ID | null
  label?: string
  snapshot_json: string
}

export interface NewTemplateInput {
  name: string
  description?: string
  structure_json?: string
}
export interface UpdateTemplateInput extends Partial<NewTemplateInput> {
  id: ID
}

/* ---- The full renderer → main API surface ---- */

export interface PriceyApi {
  ping(): Promise<string>

  settingsGet(key: string): Promise<string | null>
  settingsSet(key: string, value: string): Promise<void>
  settingsGetDataPath(): Promise<string>
  settingsBackup(destinationPath?: string): Promise<string>
  settingsRestore(sourcePath: string): Promise<void>

  materialsList(includeArchived?: boolean): Promise<Material[]>
  materialsCreate(input: NewMaterialInput): Promise<Material>
  materialsUpdate(input: UpdateMaterialInput): Promise<Material>
  materialsArchive(id: ID): Promise<void>
  materialsDelete(id: ID): Promise<void>
  materialsPriceEvents(materialId: ID): Promise<MaterialPriceEvent[]>
  materialsExportCsv(): Promise<string>
  materialsImportCsv(filePath: string): Promise<EngineResult>

  laborList(includeArchived?: boolean): Promise<LaborRole[]>
  laborCreate(input: NewLaborRoleInput): Promise<LaborRole>
  laborUpdate(input: UpdateLaborRoleInput): Promise<LaborRole>
  laborArchive(id: ID): Promise<void>
  laborDelete(id: ID): Promise<void>

  overheadList(includeArchived?: boolean): Promise<OverheadItem[]>
  overheadCreate(input: NewOverheadItemInput): Promise<OverheadItem>
  overheadUpdate(input: UpdateOverheadItemInput): Promise<OverheadItem>
  overheadArchive(id: ID): Promise<void>
  overheadDelete(id: ID): Promise<void>

  productsList(includeArchived?: boolean): Promise<Product[]>
  productsCreate(input: NewProductInput): Promise<Product>
  productsUpdate(input: UpdateProductInput): Promise<Product>
  productsArchive(id: ID): Promise<void>
  productsDelete(id: ID): Promise<void>
  productsGetFull(id: ID): Promise<ProductFull>
  productsAddMaterial(productId: ID, input: NewProductMaterialLineInput): Promise<ProductMaterialLine>
  productsUpdateMaterialLine(input: UpdateProductMaterialLineInput): Promise<ProductMaterialLine>
  productsRemoveMaterialLine(lineId: ID): Promise<void>
  productsAddLabor(productId: ID, input: NewProductLaborLineInput): Promise<ProductLaborLine>
  productsUpdateLaborLine(input: UpdateProductLaborLineInput): Promise<ProductLaborLine>
  productsRemoveLaborLine(lineId: ID): Promise<void>
  productsAddOverhead(productId: ID, input: NewProductOverheadLineInput): Promise<ProductOverheadLine>
  productsUpdateOverheadLine(input: UpdateProductOverheadLineInput): Promise<ProductOverheadLine>
  productsRemoveOverheadLine(lineId: ID): Promise<void>
  productsAddComponent(productId: ID, input: NewProductComponentLineInput): Promise<ProductComponentLine>
  productsUpdateComponentLine(input: UpdateProductComponentLineInput): Promise<ProductComponentLine>
  productsRemoveComponentLine(lineId: ID): Promise<void>
  productsAddOtherCost(productId: ID, input: NewProductOtherCostLineInput): Promise<ProductOtherCostLine>
  productsUpdateOtherCostLine(input: UpdateProductOtherCostLineInput): Promise<ProductOtherCostLine>
  productsRemoveOtherCostLine(lineId: ID): Promise<void>
  productsComputeCost(productId: ID): Promise<EngineResult>
  productsSaveSnapshot(productId: ID, label?: string): Promise<CostSnapshot>
  /** Native open dialog → validated image bytes as a data URL for preview. Nothing is stored yet. */
  productsImagePick(): Promise<{ dataUrl: string; filename: string } | null>
  /** Validate + store image bytes and link them to the product. Replaces any previous image. */
  productsImageSave(productId: ID, dataUrl: string, filename: string): Promise<Product>
  /** Unlink the product's image; the file is deleted when nothing else references it. */
  productsImageRemove(productId: ID): Promise<Product>
  /** Data URL for a stored image reference; null when the file is missing or unreadable. */
  productsImageData(imageRef: string): Promise<string | null>

  templatesList(): Promise<TemplateRec[]>
  templatesCreate(input: NewTemplateInput): Promise<TemplateRec>
  templatesUpdate(input: UpdateTemplateInput): Promise<TemplateRec>
  templatesDelete(id: ID): Promise<void>
  templatesApply(templateId: ID, productName: string): Promise<Product>

  pricingConfigsList(productId: ID): Promise<PricingConfig[]>
  pricingConfigsCreate(input: NewPricingConfigInput): Promise<PricingConfig>
  pricingConfigsUpdate(input: UpdatePricingConfigInput): Promise<PricingConfig>
  pricingConfigsDelete(id: ID): Promise<void>
  pricingCalculate(configId: ID): Promise<EngineResult>
  pricingExplain(configId: ID): Promise<EngineResult>

  channelsList(): Promise<Channel[]>
  channelsCreate(input: NewChannelInput): Promise<Channel>
  channelsUpdate(input: UpdateChannelInput): Promise<Channel>
  channelsDelete(id: ID): Promise<void>
  channelFeesList(channelId: ID): Promise<ChannelFee[]>
  channelFeesCreate(input: NewChannelFeeInput): Promise<ChannelFee>
  channelFeesUpdate(input: UpdateChannelFeeInput): Promise<ChannelFee>
  channelFeesDelete(id: ID): Promise<void>

  scenariosList(productId: ID): Promise<ScenarioRec[]>
  scenariosCreate(input: NewScenarioInput): Promise<ScenarioRec>
  scenariosUpdate(input: UpdateScenarioInput): Promise<ScenarioRec>
  scenariosDelete(id: ID): Promise<void>
  scenariosDuplicate(id: ID): Promise<ScenarioRec>
  scenariosCompute(scenarioId: ID): Promise<EngineResult>

  bundlesList(): Promise<Bundle[]>
  bundlesCreate(input: NewBundleInput): Promise<Bundle>
  bundlesUpdate(input: UpdateBundleInput): Promise<Bundle>
  bundlesDelete(id: ID): Promise<void>
  bundleItemsList(bundleId: ID): Promise<BundleItem[]>
  bundleItemsAdd(bundleId: ID, input: NewBundleItemInput): Promise<BundleItem>
  bundleItemsUpdate(input: UpdateBundleItemInput): Promise<BundleItem>
  bundleItemsRemove(id: ID): Promise<void>
  bundlesCompute(bundleId: ID): Promise<EngineResult>

  bulkRulesList(productId: ID): Promise<BulkRule[]>
  bulkRulesCreate(input: NewBulkRuleInput): Promise<BulkRule>
  bulkRulesUpdate(input: UpdateBulkRuleInput): Promise<BulkRule>
  bulkRulesDelete(id: ID): Promise<void>
  bulkTiersList(ruleId: ID): Promise<BulkTier[]>
  bulkTiersCreate(input: NewBulkTierInput): Promise<BulkTier>
  bulkTiersUpdate(input: UpdateBulkTierInput): Promise<BulkTier>
  bulkTiersDelete(id: ID): Promise<void>
  bulkCompute(ruleId: ID): Promise<EngineResult>

  breakevenCalculate(input: BreakEvenInput): Promise<EngineResult>

  quotesList(): Promise<Quote[]>
  quotesCreate(input: NewQuoteInput): Promise<Quote>
  quotesUpdate(input: UpdateQuoteInput): Promise<Quote>
  quotesDelete(id: ID): Promise<void>
  quotesGetFull(id: ID): Promise<QuoteFull>
  quotesDuplicate(id: ID): Promise<Quote>
  quotesExportPdf(id: ID): Promise<string>
  /** Direct-save export: writes to the configured PDF folder with no dialog. */
  quotesExportPdfDirect(id: ID): Promise<{ path: string }>
  /** Native directory picker for the PDF export folder; null when cancelled. */
  quotesExportPdfPickDir(): Promise<string | null>
  /** Reveal the folder containing an exported PDF in the OS file manager. */
  quotesExportPdfOpenFolder(filePath: string): Promise<void>
  quoteItemsAdd(quoteId: ID, input: NewQuoteItemInput): Promise<QuoteItem>
  quoteItemsUpdate(input: UpdateQuoteItemInput): Promise<QuoteItem>
  quoteItemsRemove(id: ID): Promise<void>

  snapshotsList(productId?: ID): Promise<CostSnapshot[]>
  snapshotsCreate(input: NewSnapshotInput): Promise<CostSnapshot>
  snapshotsGet(id: ID): Promise<CostSnapshot>

  exportsCsv(): Promise<string>
  exportsXlsx(): Promise<string>
  exportsImportTemplate(): Promise<string>

  integrationsContracts(): Promise<EngineResult>

  /**
   * pricey-exchange-v1 file exchange. Export writes a versioned
   * .pricey-exchange.json file (native save dialog) and returns its path.
   * Validate reads a file and returns the create/update/reject preview —
   * it never writes. Apply needs confirmed: true and returns the report.
   */
  exchangeExport(contract: string, selection?: ExchangeSelection): Promise<string>
  exchangeValidateFile(
    contract: string,
    filePath?: string,
  ): Promise<{ filePath: string; preview: ExchangePreview }>
  exchangeApplyImport(
    filePath: string,
    options: { confirmed: boolean },
  ): Promise<ExchangeReport>
  exchangeLog(limit?: number): Promise<ExchangeLogEntry[]>
}

export type { MaterialCategory, UnitDimension }
export type { Material, LaborRole, OverheadItem, Product, Quote }
