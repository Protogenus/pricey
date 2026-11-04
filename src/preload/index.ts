import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc.js'
import type { ExchangePreview, PriceyApi } from '../shared/ipc.js'

/**
 * Zero-dependency preload (Sublium lesson): this bundle may only contain the
 * Electron host APIs and the pure constants+types module ../shared/ipc.js
 * (all of its imports are `import type`, erased at compile time). Any runtime
 * node_modules import here gets externalized by the bundler and leaves
 * `window.pricey` undefined — the app dead on first boot.
 */

/** Unwrap the IPC envelope; surface main-process errors as thrown Errors. */
function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).then((res) => {
    if (res && res.ok === true) return res.data as T
    const message =
      res && res.error && typeof res.error.message === 'string'
        ? res.error.message
        : 'An unexpected error occurred.'
    throw new Error(message)
  })
}

/** Full PriceyApi, typed against the interface so the compiler enforces parity. */
const api: PriceyApi = {
  ping: () => invoke<string>(IPC.ping),

  settingsGet: (key) => invoke<string | null>(IPC.settingsGet, key),
  settingsSet: (key, value) => invoke<void>(IPC.settingsSet, key, value),
  settingsGetDataPath: () => invoke<string>(IPC.settingsGetDataPath),
  settingsBackup: (destinationPath) => invoke<string>(IPC.settingsBackup, destinationPath),
  settingsRestore: (sourcePath) => invoke<void>(IPC.settingsRestore, sourcePath),

  materialsList: (includeArchived = false) => invoke(IPC.materialsList, includeArchived),
  materialsCreate: (input) => invoke(IPC.materialsCreate, input),
  materialsUpdate: (input) => invoke(IPC.materialsUpdate, input),
  materialsArchive: (id) => invoke(IPC.materialsArchive, id),
  materialsDelete: (id) => invoke(IPC.materialsDelete, id),
  materialsPriceEvents: (materialId) => invoke(IPC.materialsPriceEvents, materialId),
  materialsExportCsv: (destPath?: string) => invoke<string>(IPC.materialsExportCsv, destPath),
  materialsImportCsv: (filePath) => invoke(IPC.materialsImportCsv, filePath),

  laborList: (includeArchived = false) => invoke(IPC.laborList, includeArchived),
  laborCreate: (input) => invoke(IPC.laborCreate, input),
  laborUpdate: (input) => invoke(IPC.laborUpdate, input),
  laborArchive: (id) => invoke(IPC.laborArchive, id),
  laborDelete: (id) => invoke(IPC.laborDelete, id),

  overheadList: (includeArchived = false) => invoke(IPC.overheadList, includeArchived),
  overheadCreate: (input) => invoke(IPC.overheadCreate, input),
  overheadUpdate: (input) => invoke(IPC.overheadUpdate, input),
  overheadArchive: (id) => invoke(IPC.overheadArchive, id),
  overheadDelete: (id) => invoke(IPC.overheadDelete, id),

  productsList: (includeArchived = false) => invoke(IPC.productsList, includeArchived),
  productsCreate: (input) => invoke(IPC.productsCreate, input),
  productsUpdate: (input) => invoke(IPC.productsUpdate, input),
  productsArchive: (id) => invoke(IPC.productsArchive, id),
  productsDelete: (id) => invoke(IPC.productsDelete, id),
  productsGetFull: (id) => invoke(IPC.productsGetFull, id),
  productsAddMaterial: (productId, input) => invoke(IPC.productsAddMaterial, productId, input),
  productsUpdateMaterialLine: (input) => invoke(IPC.productsUpdateMaterialLine, input),
  productsRemoveMaterialLine: (lineId) => invoke(IPC.productsRemoveMaterialLine, lineId),
  productsAddLabor: (productId, input) => invoke(IPC.productsAddLabor, productId, input),
  productsUpdateLaborLine: (input) => invoke(IPC.productsUpdateLaborLine, input),
  productsRemoveLaborLine: (lineId) => invoke(IPC.productsRemoveLaborLine, lineId),
  productsAddOverhead: (productId, input) => invoke(IPC.productsAddOverhead, productId, input),
  productsUpdateOverheadLine: (input) => invoke(IPC.productsUpdateOverheadLine, input),
  productsRemoveOverheadLine: (lineId) => invoke(IPC.productsRemoveOverheadLine, lineId),
  productsAddComponent: (productId, input) => invoke(IPC.productsAddComponent, productId, input),
  productsUpdateComponentLine: (input) => invoke(IPC.productsUpdateComponentLine, input),
  productsRemoveComponentLine: (lineId) => invoke(IPC.productsRemoveComponentLine, lineId),
  productsAddOtherCost: (productId, input) => invoke(IPC.productsAddOtherCost, productId, input),
  productsUpdateOtherCostLine: (input) => invoke(IPC.productsUpdateOtherCostLine, input),
  productsRemoveOtherCostLine: (lineId) => invoke(IPC.productsRemoveOtherCostLine, lineId),
  productsComputeCost: (productId) => invoke(IPC.productsComputeCost, productId),
  productsSaveSnapshot: (productId, label) => invoke(IPC.productsSaveSnapshot, productId, label),

  templatesList: () => invoke(IPC.templatesList),
  templatesCreate: (input) => invoke(IPC.templatesCreate, input),
  templatesUpdate: (input) => invoke(IPC.templatesUpdate, input),
  templatesDelete: (id) => invoke(IPC.templatesDelete, id),
  templatesApply: (templateId, productName) => invoke(IPC.templatesApply, templateId, productName),

  pricingConfigsList: (productId) => invoke(IPC.pricingConfigsList, productId),
  pricingConfigsCreate: (input) => invoke(IPC.pricingConfigsCreate, input),
  pricingConfigsUpdate: (input) => invoke(IPC.pricingConfigsUpdate, input),
  pricingConfigsDelete: (id) => invoke(IPC.pricingConfigsDelete, id),
  pricingCalculate: (configId) => invoke(IPC.pricingCalculate, configId),
  pricingExplain: (configId) => invoke(IPC.pricingExplain, configId),

  channelsList: () => invoke(IPC.channelsList),
  channelsCreate: (input) => invoke(IPC.channelsCreate, input),
  channelsUpdate: (input) => invoke(IPC.channelsUpdate, input),
  channelsDelete: (id) => invoke(IPC.channelsDelete, id),
  channelFeesList: (channelId) => invoke(IPC.channelFeesList, channelId),
  channelFeesCreate: (input) => invoke(IPC.channelFeesCreate, input),
  channelFeesUpdate: (input) => invoke(IPC.channelFeesUpdate, input),
  channelFeesDelete: (id) => invoke(IPC.channelFeesDelete, id),

  scenariosList: (productId) => invoke(IPC.scenariosList, productId),
  scenariosCreate: (input) => invoke(IPC.scenariosCreate, input),
  scenariosUpdate: (input) => invoke(IPC.scenariosUpdate, input),
  scenariosDelete: (id) => invoke(IPC.scenariosDelete, id),
  scenariosDuplicate: (id) => invoke(IPC.scenariosDuplicate, id),
  scenariosCompute: (scenarioId) => invoke(IPC.scenariosCompute, scenarioId),

  bundlesList: () => invoke(IPC.bundlesList),
  bundlesCreate: (input) => invoke(IPC.bundlesCreate, input),
  bundlesUpdate: (input) => invoke(IPC.bundlesUpdate, input),
  bundlesDelete: (id) => invoke(IPC.bundlesDelete, id),
  bundleItemsList: (bundleId) => invoke(IPC.bundleItemsList, bundleId),
  bundleItemsAdd: (bundleId, input) => invoke(IPC.bundleItemsAdd, bundleId, input),
  bundleItemsUpdate: (input) => invoke(IPC.bundleItemsUpdate, input),
  bundleItemsRemove: (id) => invoke(IPC.bundleItemsRemove, id),
  bundlesCompute: (bundleId) => invoke(IPC.bundlesCompute, bundleId),

  bulkRulesList: (productId) => invoke(IPC.bulkRulesList, productId),
  bulkRulesCreate: (input) => invoke(IPC.bulkRulesCreate, input),
  bulkRulesUpdate: (input) => invoke(IPC.bulkRulesUpdate, input),
  bulkRulesDelete: (id) => invoke(IPC.bulkRulesDelete, id),
  bulkTiersList: (ruleId) => invoke(IPC.bulkTiersList, ruleId),
  bulkTiersCreate: (input) => invoke(IPC.bulkTiersCreate, input),
  bulkTiersUpdate: (input) => invoke(IPC.bulkTiersUpdate, input),
  bulkTiersDelete: (id) => invoke(IPC.bulkTiersDelete, id),
  bulkCompute: (ruleId) => invoke(IPC.bulkCompute, ruleId),

  breakevenCalculate: (input) => invoke(IPC.breakevenCalculate, input),

  quotesList: () => invoke(IPC.quotesList),
  quotesCreate: (input) => invoke(IPC.quotesCreate, input),
  quotesUpdate: (input) => invoke(IPC.quotesUpdate, input),
  quotesDelete: (id) => invoke(IPC.quotesDelete, id),
  quotesGetFull: (id) => invoke(IPC.quotesGetFull, id),
  quotesDuplicate: (id) => invoke(IPC.quotesDuplicate, id),
  quotesExportPdf: (id) => invoke(IPC.quotesExportPdf, id),
  quoteItemsAdd: (quoteId, input) => invoke(IPC.quoteItemsAdd, quoteId, input),
  quoteItemsUpdate: (input) => invoke(IPC.quoteItemsUpdate, input),
  quoteItemsRemove: (id) => invoke(IPC.quoteItemsRemove, id),

  snapshotsList: (productId) => invoke(IPC.snapshotsList, productId),
  snapshotsCreate: (input) => invoke(IPC.snapshotsCreate, input),
  snapshotsGet: (id) => invoke(IPC.snapshotsGet, id),

  exportsCsv: (kind?: string, destPath?: string) => invoke<string>(IPC.exportsCsv, kind, destPath),
  exportsXlsx: (kind?: string, destPath?: string) => invoke<string>(IPC.exportsXlsx, kind, destPath),
  exportsImportTemplate: (kind?: string) => invoke<string>(IPC.exportsImportTemplate, kind),

  integrationsContracts: () => invoke(IPC.integrationsContracts),

  exchangeExport: (contract, selection) => invoke<string>(IPC.exchangeExport, contract, selection),
  exchangeValidateFile: (contract, filePath) =>
    invoke<{ filePath: string; preview: ExchangePreview }>(
      IPC.exchangeValidateFile,
      contract,
      filePath,
    ),
  exchangeApplyImport: (filePath, options) => invoke(IPC.exchangeApplyImport, filePath, options),
  exchangeLog: (limit) => invoke(IPC.exchangeLog, limit),
}

contextBridge.exposeInMainWorld('pricey', api)
