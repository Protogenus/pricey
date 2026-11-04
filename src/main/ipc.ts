/**
 * Pricey main-process IPC: every channel in src/shared/ipc.ts, implemented
 * per the PriceyApi interface.
 *
 * Structure per handler: thin validation + DAO call + engine call, wrapped
 * in the {ok:true,data} / {ok:false,error:{message}} envelope. Math lives in
 * src/engine, SQL lives in src/database/* — this file only wires them.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { accessSync, constants, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import Decimal from 'decimal.js'
import { IPC, type IpcResult } from '../shared/ipc.js'
import type {
  ExchangeLogEntry,
  ExchangePreview,
  ExchangeReport,
  ExchangeSelection,
} from '../shared/ipc.js'
import type { DatabaseType } from '../database/index.js'
import { openDatabase } from '../database/index.js'
import { runMigrations } from '../database/migrations.js'
import { allMigrations } from '../database/migrations/all.js'
import * as settingsDao from '../database/settings.js'
import * as materialsDao from '../database/materials.js'
import * as laborDao from '../database/labor.js'
import * as overheadDao from '../database/overhead.js'
import * as productsDao from '../database/products.js'
import * as imagesDao from '../database/images.js'
import * as pricingDao from '../database/pricing.js'
import * as scenariosDao from '../database/scenarios.js'
import * as bundlesDao from '../database/bundles.js'
import * as bulkDao from '../database/bulk.js'
import * as quotesDao from '../database/quotes.js'
import * as snapshotsDao from '../database/snapshots.js'
import * as templatesDao from '../database/templates.js'
import * as exportsDao from '../database/exports.js'
import * as exchangeDao from '../database/exchange.js'
import { parseExchangeFile } from '../engine/exchange.js'
import {
  applyFeesToPrice,
  computeBreakEven,
  computeBulkTable,
  computeBundle,
  computeProductCost,
  explainBreakEven,
  explainFees,
  explainPricing,
  minimumPrice,
  priceCostPlus,
  priceFromFixedProfit,
  priceFromMargin,
  priceFromMarkup,
  referenceComparison,
  solvePriceWithFees,
  suggestRounding,
  validatePricingParams,
  validateProductCostInput,
  type BreakEvenInput as EngineBreakEvenInput,
  type FeeInput,
  type ProductCostResult,
  type RoundingStyle,
} from '../engine/index.js'
import type { CostOverrides } from '../database/products.js'
import type { ID, PricingMethod } from '../shared/types.js'
import { buildQuoteHtml, quotePdfDirectFileName, type QuoteBusinessInfo } from './pdf.js'
import { nowIso, parseJson, requireId } from '../database/util.js'

/** Wrap a handler in the {ok:true,data}/{ok:false,error} envelope. */
function handle<T>(channel: string, fn: (...args: never[]) => T | Promise<T>): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const data = await fn(...(args as never[]))
      return { ok: true, data } satisfies IpcResult<T>
    } catch (err) {
      return {
        ok: false,
        error: { message: err instanceof Error ? err.message : String(err) },
      } satisfies IpcResult<T>
    }
  })
}

/* ------------------------------------------------------------------ */
/* registerIpc                                                         */
/* ------------------------------------------------------------------ */

export function registerIpc(db: DatabaseType): void {
  // The live connection; replaced (close → copy → reopen) by settings.restore.
  let activeDb = db
  const getDb = (): DatabaseType => activeDb
  const dbPath = (): string => (activeDb as unknown as { name: string }).name
  /** Product images live under this dir: <userData>/images/<sha256>.<ext>. */
  const userDataDir = (): string => app.getPath('userData')

  /* ---------------- ping ---------------- */
  handle<string>(IPC.ping, () => 'pong')

  /* ---------------- settings ---------------- */
  handle<string | null>(IPC.settingsGet, (key: string) => settingsDao.get(getDb(), key))
  handle<void>(IPC.settingsSet, (key: string, value: string) => {
    settingsDao.set(getDb(), key, value)
  })
  handle<string>(IPC.settingsGetDataPath, () => app.getPath('userData'))
  handle<string>(IPC.settingsBackup, async (destinationPath?: string) => {
    let dest = destinationPath
    if (!dest) {
      const picked = await dialog.showSaveDialog({
        title: 'Back up Pricey database',
        defaultPath: `pricey-backup-${new Date().toISOString().slice(0, 10)}.db`,
        filters: [{ name: 'SQLite database', extensions: ['db'] }],
      })
      if (picked.canceled || !picked.filePath) throw new Error('Backup was cancelled.')
      dest = picked.filePath
    }
    exportsDao.backupDatabase(dbPath(), dest)
    return dest
  })
  handle<void>(IPC.settingsRestore, (sourcePath: string) => {
    if (typeof sourcePath !== 'string' || !sourcePath) {
      throw new Error('A source backup file path is required.')
    }
    // Verify BEFORE touching the live database.
    exportsDao.verifyRestoreFile(sourcePath)
    const path = dbPath()
    activeDb.close()
    try {
      exportsDao.restoreDatabase(path, sourcePath)
      activeDb = openDatabase(path)
      runMigrations(activeDb, allMigrations)
    } catch (err) {
      // Best effort: get the app back on a working database.
      activeDb = openDatabase(path)
      throw err
    }
  })

  /* ---------------- materials ---------------- */
  handle(IPC.materialsList, (includeArchived?: boolean) =>
    materialsDao.list(getDb(), includeArchived ?? false),
  )
  handle(IPC.materialsCreate, (input) => materialsDao.create(getDb(), input))
  handle(IPC.materialsUpdate, (input) => materialsDao.update(getDb(), input))
  handle<void>(IPC.materialsArchive, (id: ID) => materialsDao.archive(getDb(), id))
  handle<void>(IPC.materialsDelete, (id: ID) => materialsDao.remove(getDb(), id))
  handle(IPC.materialsPriceEvents, (materialId: ID) =>
    materialsDao.priceEvents(getDb(), materialId),
  )
  handle<string>(IPC.materialsExportCsv, async (destPath?: string) =>
    exportToFile(getDb(), 'materials', 'csv', destPath),
  )
  handle(IPC.materialsImportCsv, (filePath: string) => {
    if (typeof filePath !== 'string' || !filePath) {
      throw new Error('A CSV file path is required.')
    }
    return exportsDao.importMaterialsCsv(getDb(), filePath)
  })

  /* ---------------- labor ---------------- */
  handle(IPC.laborList, (includeArchived?: boolean) =>
    laborDao.list(getDb(), includeArchived ?? false),
  )
  handle(IPC.laborCreate, (input) => laborDao.create(getDb(), input))
  handle(IPC.laborUpdate, (input) => laborDao.update(getDb(), input))
  handle<void>(IPC.laborArchive, (id: ID) => laborDao.archive(getDb(), id))
  handle<void>(IPC.laborDelete, (id: ID) => laborDao.remove(getDb(), id))

  /* ---------------- overhead ---------------- */
  handle(IPC.overheadList, (includeArchived?: boolean) =>
    overheadDao.list(getDb(), includeArchived ?? false),
  )
  handle(IPC.overheadCreate, (input) => overheadDao.create(getDb(), input))
  handle(IPC.overheadUpdate, (input) => overheadDao.update(getDb(), input))
  handle<void>(IPC.overheadArchive, (id: ID) => overheadDao.archive(getDb(), id))
  handle<void>(IPC.overheadDelete, (id: ID) => overheadDao.remove(getDb(), id))

  /* ---------------- products ---------------- */
  handle(IPC.productsList, (includeArchived?: boolean) =>
    productsDao.list(getDb(), includeArchived ?? false),
  )
  handle(IPC.productsCreate, (input) => productsDao.create(getDb(), input))
  handle(IPC.productsUpdate, (input) => productsDao.update(getDb(), input))
  handle<void>(IPC.productsArchive, (id: ID) => productsDao.archive(getDb(), id))
  handle<void>(IPC.productsDelete, (id: ID) => {
    const db = getDb()
    const product = productsDao.get(db, requireId(id, 'product'))
    const imageRef = product.image_path
    productsDao.remove(db, id)
    // The product is gone: drop its image file when nothing else references it.
    imagesDao.releaseUnreferenced(db, userDataDir(), imageRef)
  })
  handle(IPC.productsGetFull, (id: ID) => productsDao.getFull(getDb(), id))

  handle(IPC.productsAddMaterial, (productId: ID, input) =>
    productsDao.addMaterialLine(getDb(), productId, input),
  )
  handle(IPC.productsUpdateMaterialLine, (input) =>
    productsDao.updateMaterialLine(getDb(), input),
  )
  handle<void>(IPC.productsRemoveMaterialLine, (lineId: ID) =>
    productsDao.removeMaterialLine(getDb(), lineId),
  )
  handle(IPC.productsAddLabor, (productId: ID, input) =>
    productsDao.addLaborLine(getDb(), productId, input),
  )
  handle(IPC.productsUpdateLaborLine, (input) => productsDao.updateLaborLine(getDb(), input))
  handle<void>(IPC.productsRemoveLaborLine, (lineId: ID) =>
    productsDao.removeLaborLine(getDb(), lineId),
  )
  handle(IPC.productsAddOverhead, (productId: ID, input) =>
    productsDao.addOverheadLine(getDb(), productId, input),
  )
  handle(IPC.productsUpdateOverheadLine, (input) =>
    productsDao.updateOverheadLine(getDb(), input),
  )
  handle<void>(IPC.productsRemoveOverheadLine, (lineId: ID) =>
    productsDao.removeOverheadLine(getDb(), lineId),
  )
  handle(IPC.productsAddComponent, (productId: ID, input) =>
    productsDao.addComponentLine(getDb(), productId, input),
  )
  handle(IPC.productsUpdateComponentLine, (input) =>
    productsDao.updateComponentLine(getDb(), input),
  )
  handle<void>(IPC.productsRemoveComponentLine, (lineId: ID) =>
    productsDao.removeComponentLine(getDb(), lineId),
  )
  handle(IPC.productsAddOtherCost, (productId: ID, input) =>
    productsDao.addOtherCostLine(getDb(), productId, input),
  )
  handle(IPC.productsUpdateOtherCostLine, (input) =>
    productsDao.updateOtherCostLine(getDb(), input),
  )
  handle<void>(IPC.productsRemoveOtherCostLine, (lineId: ID) =>
    productsDao.removeOtherCostLine(getDb(), lineId),
  )

  handle(IPC.productsComputeCost, (productId: ID) => {
    const db = getDb()
    const result = computeCostOrThrow(db, productId)
    const product = productsDao.get(db, productId)
    snapshotsDao.create(db, {
      kind: 'product',
      product_id: productId,
      label: `Auto — ${product.name} — ${nowIso()}`,
      snapshot_json: JSON.stringify(result),
    })
    return result
  })
  handle(IPC.productsSaveSnapshot, (productId: ID, label?: string) => {
    const db = getDb()
    const result = computeCostOrThrow(db, productId)
    const product = productsDao.get(db, productId)
    return snapshotsDao.create(db, {
      kind: 'product',
      product_id: productId,
      label: label?.trim() || `Snapshot — ${product.name} — ${nowIso()}`,
      snapshot_json: JSON.stringify(result),
    })
  })

  /* ---------------- product images ---------------- */
  /**
   * Flow: productsImagePick (native dialog → validated bytes as a data URL
   * for editor preview, nothing stored) → productsImageSave (validate again,
   * store content-addressed, link to product) or productsImageRemove.
   * productsImageData serves a stored reference back as a data URL for
   * <img> tags — the sandboxed renderer cannot read the file itself.
   */
  handle<{ dataUrl: string; filename: string } | null>(IPC.productsImagePick, async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Choose product image',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    })
    if (picked.canceled || picked.filePaths.length === 0) return null
    const filePath = picked.filePaths[0]
    let bytes: Buffer
    try {
      bytes = readFileSync(filePath)
    } catch {
      throw new Error(
        'Could not read the selected file — it may have been moved, renamed, or deleted.',
      )
    }
    const kind = imagesDao.validateImageBytes(bytes)
    return {
      dataUrl: `data:${imagesDao.mimeFor(kind)};base64,${bytes.toString('base64')}`,
      filename: basename(filePath),
    }
  })

  handle(IPC.productsImageSave, (productId: ID, dataUrl: string, filename: string) => {
    const db = getDb()
    const id = requireId(productId, 'product')
    const bytes = decodeImageDataUrl(dataUrl, filename)
    const prev = productsDao.get(db, id).image_path
    // storeImage re-validates size + magic bytes: the renderer is untrusted.
    const ref = imagesDao.storeImage(userDataDir(), bytes)
    db.transaction(() => {
      productsDao.setImage(db, id, ref)
    })()
    if (prev !== ref) imagesDao.releaseUnreferenced(db, userDataDir(), prev)
    return productsDao.get(db, id)
  })

  handle(IPC.productsImageRemove, (productId: ID) => {
    const db = getDb()
    const id = requireId(productId, 'product')
    const prev = productsDao.get(db, id).image_path
    db.transaction(() => {
      productsDao.setImage(db, id, '')
    })()
    imagesDao.releaseUnreferenced(db, userDataDir(), prev)
    return productsDao.get(db, id)
  })

  handle<string | null>(IPC.productsImageData, (imageRef: string) => {
    if (typeof imageRef !== 'string' || !imageRef) return null
    const bytes = (() => {
      try {
        return imagesDao.readImageBytes(userDataDir(), imageRef)
      } catch {
        return null
      }
    })()
    if (!bytes) return null
    const kind = imagesDao.detectImageKind(bytes)
    if (!kind) return null
    return `data:${imagesDao.mimeFor(kind)};base64,${bytes.toString('base64')}`
  })

  /* ---------------- templates ---------------- */
  handle(IPC.templatesList, () => templatesDao.list(getDb()))
  handle(IPC.templatesCreate, (input) => templatesDao.create(getDb(), input))
  handle(IPC.templatesUpdate, (input) => templatesDao.update(getDb(), input))
  handle<void>(IPC.templatesDelete, (id: ID) => templatesDao.remove(getDb(), id))
  handle(IPC.templatesApply, (templateId: ID, productName: string) =>
    applyTemplate(getDb(), templateId, productName),
  )

  /* ---------------- pricing configs ---------------- */
  handle(IPC.pricingConfigsList, (productId: ID) =>
    pricingDao.listPricingConfigs(getDb(), productId),
  )
  handle(IPC.pricingConfigsCreate, (input) => pricingDao.createPricingConfig(getDb(), input))
  handle(IPC.pricingConfigsUpdate, (input) => pricingDao.updatePricingConfig(getDb(), input))
  handle<void>(IPC.pricingConfigsDelete, (id: ID) => pricingDao.deletePricingConfig(getDb(), id))
  handle(IPC.pricingCalculate, (configId: ID) => calculatePricing(getDb(), configId))
  handle(IPC.pricingExplain, (configId: ID) => explainPricingConfig(getDb(), configId))

  /* ---------------- channels & fees ---------------- */
  handle(IPC.channelsList, () => pricingDao.listChannels(getDb()))
  handle(IPC.channelsCreate, (input) => pricingDao.createChannel(getDb(), input))
  handle(IPC.channelsUpdate, (input) => pricingDao.updateChannel(getDb(), input))
  handle<void>(IPC.channelsDelete, (id: ID) => pricingDao.deleteChannel(getDb(), id))
  handle(IPC.channelFeesList, (channelId: ID) => pricingDao.listChannelFees(getDb(), channelId))
  handle(IPC.channelFeesCreate, (input) => pricingDao.createChannelFee(getDb(), input))
  handle(IPC.channelFeesUpdate, (input) => pricingDao.updateChannelFee(getDb(), input))
  handle<void>(IPC.channelFeesDelete, (id: ID) => pricingDao.deleteChannelFee(getDb(), id))

  /* ---------------- scenarios ---------------- */
  handle(IPC.scenariosList, (productId: ID) => scenariosDao.list(getDb(), productId))
  handle(IPC.scenariosCreate, (input) => scenariosDao.create(getDb(), input))
  handle(IPC.scenariosUpdate, (input) => scenariosDao.update(getDb(), input))
  handle<void>(IPC.scenariosDelete, (id: ID) => scenariosDao.remove(getDb(), id))
  handle(IPC.scenariosDuplicate, (id: ID) => scenariosDao.duplicate(getDb(), id))
  handle(IPC.scenariosCompute, (scenarioId: ID) => computeScenario(getDb(), scenarioId))

  /* ---------------- bundles ---------------- */
  handle(IPC.bundlesList, () => bundlesDao.list(getDb()))
  handle(IPC.bundlesCreate, (input) => bundlesDao.create(getDb(), input))
  handle(IPC.bundlesUpdate, (input) => bundlesDao.update(getDb(), input))
  handle<void>(IPC.bundlesDelete, (id: ID) => bundlesDao.remove(getDb(), id))
  handle(IPC.bundleItemsList, (bundleId: ID) => bundlesDao.listItems(getDb(), bundleId))
  handle(IPC.bundleItemsAdd, (bundleId: ID, input) => bundlesDao.addItem(getDb(), bundleId, input))
  handle(IPC.bundleItemsUpdate, (input) => bundlesDao.updateItem(getDb(), input))
  handle<void>(IPC.bundleItemsRemove, (id: ID) => bundlesDao.removeItem(getDb(), id))
  handle(IPC.bundlesCompute, (bundleId: ID) => computeBundleById(getDb(), bundleId))

  /* ---------------- bulk ---------------- */
  handle(IPC.bulkRulesList, (productId: ID) => bulkDao.listRules(getDb(), productId))
  handle(IPC.bulkRulesCreate, (input) => bulkDao.createRule(getDb(), input))
  handle(IPC.bulkRulesUpdate, (input) => bulkDao.updateRule(getDb(), input))
  handle<void>(IPC.bulkRulesDelete, (id: ID) => bulkDao.deleteRule(getDb(), id))
  handle(IPC.bulkTiersList, (ruleId: ID) => bulkDao.listTiers(getDb(), ruleId))
  handle(IPC.bulkTiersCreate, (input) => bulkDao.createTier(getDb(), input))
  handle(IPC.bulkTiersUpdate, (input) => bulkDao.updateTier(getDb(), input))
  handle<void>(IPC.bulkTiersDelete, (id: ID) => bulkDao.deleteTier(getDb(), id))
  handle(IPC.bulkCompute, (ruleId: ID) => computeBulk(getDb(), ruleId))

  /* ---------------- break-even ---------------- */
  handle(IPC.breakevenCalculate, (input) => {
    const raw = (input ?? {}) as Record<string, unknown>
    const eng: EngineBreakEvenInput = {
      fixedCosts: String(raw['fixed_costs'] ?? '0'),
      variableCostPerUnit: String(raw['unit_variable_cost'] ?? '0'),
      sellingPrice: String(raw['unit_price'] ?? '0'),
    }
    if (raw['target_profit'] !== undefined) eng.targetProfit = String(raw['target_profit'])
    if (raw['variable_cost_excludes_fixed'] !== undefined) {
      eng.variableCostExcludesFixed = Boolean(raw['variable_cost_excludes_fixed'])
    }
    const result = computeBreakEven(eng)
    return { ...result, explainer: explainBreakEven(eng, result) }
  })

  /* ---------------- quotes ---------------- */
  handle(IPC.quotesList, () => quotesDao.list(getDb()))
  handle(IPC.quotesCreate, (input) => quotesDao.create(getDb(), input))
  handle(IPC.quotesUpdate, (input) => quotesDao.update(getDb(), input))
  handle<void>(IPC.quotesDelete, (id: ID) => quotesDao.remove(getDb(), id))
  handle(IPC.quotesGetFull, (id: ID) => quotesDao.getFull(getDb(), id))
  handle(IPC.quotesDuplicate, (id: ID) => quotesDao.duplicate(getDb(), id))
  handle<string>(IPC.quotesExportPdf, (id: ID) => exportQuotePdf(getDb(), id))
  handle<{ path: string }>(IPC.quotesExportPdfDirect, (id: ID) =>
    exportQuotePdfDirect(getDb(), id),
  )
  handle<string | null>(IPC.quotesExportPdfPickDir, () => pickPdfExportDir())
  handle<void>(IPC.quotesExportPdfOpenFolder, (filePath: string) =>
    openPdfExportFolder(filePath),
  )
  handle(IPC.quoteItemsAdd, (quoteId: ID, input) => quotesDao.addItem(getDb(), quoteId, input))
  handle(IPC.quoteItemsUpdate, (input) => quotesDao.updateItem(getDb(), input))
  handle<void>(IPC.quoteItemsRemove, (id: ID) => {
    quotesDao.removeItem(getDb(), id)
  })

  /* ---------------- snapshots ---------------- */
  handle(IPC.snapshotsList, (productId?: ID) => snapshotsDao.list(getDb(), productId ?? undefined))
  handle(IPC.snapshotsCreate, (input) => snapshotsDao.create(getDb(), input))
  handle(IPC.snapshotsGet, (id: ID) => snapshotsDao.get(getDb(), id))

  /* ---------------- exports ---------------- */
  handle<string>(IPC.exportsCsv, async (kind?: string, destPath?: string) =>
    exportToFile(getDb(), kind ?? 'materials', 'csv', destPath),
  )
  handle<string>(IPC.exportsXlsx, async (kind?: string, destPath?: string) =>
    exportToFile(getDb(), kind ?? 'materials', 'xlsx', destPath),
  )
  handle<string>(IPC.exportsImportTemplate, (kind?: string) =>
    exportsDao.importTemplate(exportsDao.assertExportKind(kind ?? 'materials')),
  )

  /* ---------------- integrations ---------------- */
  handle(IPC.integrationsContracts, () => INTEGRATION_CONTRACTS)

  /* ---------------- pricey-exchange-v1 file exchange ---------------- */
  handle<string>(IPC.exchangeExport, async (contract: string, selection?: ExchangeSelection) => {
    const db = getDb()
    const { envelope, counts } = exchangeDao.buildExport(db, contract, selection ?? {}, {
      appVersion: app.getVersion(),
      customUnits: productsDao.readCustomUnits(db),
    })
    const picked = await dialog.showSaveDialog({
      title: 'Export Pricey exchange file',
      defaultPath: `pricey-${contract}-v${envelope.contractVersion}.pricey-exchange.json`,
      filters: [
        { name: 'Pricey exchange (*.pricey-exchange.json)', extensions: ['pricey-exchange.json'] },
        { name: 'JSON', extensions: ['json'] },
      ],
    })
    if (picked.canceled || !picked.filePath) throw new Error('Export was cancelled.')
    writeFileSync(picked.filePath, JSON.stringify(envelope, null, 2), 'utf8')
    exchangeDao.logExchange(db, {
      direction: 'export',
      contract: envelope.contract,
      filename: picked.filePath,
      recordsCreated: counts.products + counts.pricingConfigs + counts.scenarios + counts.quotes,
      recordsUpdated: 0,
      recordsRejected: 0,
    })
    return picked.filePath
  })
  handle<{ filePath: string; preview: ExchangePreview }>(
    IPC.exchangeValidateFile,
    async (contract: string, filePath?: string) => {
      let path = filePath
      if (!path) {
        const picked = await dialog.showOpenDialog({
          title: 'Import Pricey exchange file',
          filters: [
            {
              name: 'Pricey exchange (*.pricey-exchange.json)',
              extensions: ['pricey-exchange.json'],
            },
            { name: 'JSON', extensions: ['json'] },
          ],
          properties: ['openFile'],
        })
        if (picked.canceled || picked.filePaths.length === 0) {
          throw new Error('Import was cancelled.')
        }
        path = picked.filePaths[0]
      }
      const text = readFileSync(path, 'utf8')
      const db = getDb()
      const { envelope } = parseExchangeFile(text, {
        customUnits: productsDao.readCustomUnits(db),
      })
      if (envelope.contract !== contract) {
        throw new Error(
          `This file is a "${envelope.contract}" export, but you started an import for ` +
            `"${contract}". Open the import from the matching contract row. Nothing was imported.`,
        )
      }
      // validateFile never writes — preview only.
      const preview = exchangeDao.previewImport(db, envelope, productsDao.readCustomUnits(db))
      return { filePath: path, preview }
    },
  )
  handle<ExchangeReport>(
    IPC.exchangeApplyImport,
    (filePath: string, options?: { confirmed?: boolean }) => {
      if (typeof filePath !== 'string' || !filePath) {
        throw new Error('A file path is required.')
      }
      const db = getDb()
      const text = readFileSync(filePath, 'utf8')
      const { envelope } = parseExchangeFile(text, {
        customUnits: productsDao.readCustomUnits(db),
      })
      return exchangeDao.applyImport(db, envelope, {
        confirmed: options?.confirmed === true,
        customUnits: productsDao.readCustomUnits(db),
        filename: filePath,
      })
    },
  )
  handle<ExchangeLogEntry[]>(IPC.exchangeLog, (limit?: number) =>
    exchangeDao.listExchangeLog(getDb(), limit),
  )
}

/* ------------------------------------------------------------------ */
/* Cost                                                                */
/* ------------------------------------------------------------------ */

/**
 * Decode an image data URL back to bytes. The payload is re-validated by
 * imagesDao.validateImageBytes on store — this only guards the envelope.
 */
function decodeImageDataUrl(dataUrl: string, filename: string): Buffer {
  if (typeof dataUrl !== 'string') {
    throw new Error(`No image data was provided for "${filename || 'the image'}".`)
  }
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:image/') || comma < 0) {
    throw new Error(
      `The image data for "${filename || 'the image'}" was corrupted. Choose the image again.`,
    )
  }
  const bytes = Buffer.from(dataUrl.slice(comma + 1), 'base64')
  if (bytes.length === 0) {
    throw new Error(`The image data for "${filename || 'the image'}" was empty. Choose the image again.`)
  }
  return bytes
}

/** Build → validate (naming every bad field) → compute. Throws on any problem. */
function computeCostOrThrow(db: DatabaseType, productId: ID): ProductCostResult {
  const pid = requireId(productId, 'product')
  const input = productsDao.buildCostInput(pid, db, new Set())
  const customUnits = productsDao.readCustomUnits(db)
  const problems = validateProductCostInput(input, customUnits)
  if (problems.length > 0) {
    throw new Error(`Cannot compute cost: ${problems.join(' ')}`)
  }
  return computeProductCost(input, customUnits)
}

/* ------------------------------------------------------------------ */
/* Pricing                                                             */
/* ------------------------------------------------------------------ */

type PricingExtras = {
  channelId?: number
  orderQty?: number
  rounding?: RoundingStyle
  [key: string]: unknown
}

function readPricingParams(cfg: { params_json: string }): PricingExtras {
  const parsed = parseJson<Record<string, unknown>>(cfg.params_json || '{}', 'pricing params')
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('pricing params must be a JSON object.')
  }
  const out: PricingExtras = { ...parsed }
  if (out.channelId !== undefined && (typeof out.channelId !== 'number' || out.channelId <= 0)) {
    throw new Error('pricing params: channelId must be a positive channel id.')
  }
  return out
}

function strRecord(params: PricingExtras): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) out[k] = String(v)
  return out
}

/** Price from a pricing method + cost. The engine owns all the math. */
function methodPrice(
  method: PricingMethod,
  cost: Decimal,
  costResult: ProductCostResult,
  params: PricingExtras,
): { price: Decimal; explainerParams: Record<string, string> } {
  const strParams = strRecord(params)
  strParams.cost = cost.toString()
  switch (method) {
    case 'margin':
      return { price: priceFromMargin(cost, params.margin as string), explainerParams: strParams }
    case 'markup':
      return { price: priceFromMarkup(cost, params.markup as string), explainerParams: strParams }
    case 'fixed_profit':
    case 'target_profit':
      return {
        price: priceFromFixedProfit(cost, params.profit as string),
        explainerParams: strParams,
      }
    case 'minimum':
      return {
        price: minimumPrice(
          (params.coveredCosts as string | undefined) ?? cost,
          (params.requiredProfit as string | undefined) ?? '0',
        ),
        explainerParams: strParams,
      }
    case 'cost_plus': {
      const cats = costPlusCategories(costResult, params)
      strParams.detail = cats.map((c) => `${c.name}: ${c.cost} × (1 + ${c.markup})`).join(' + ')
      return { price: priceCostPlus(cats), explainerParams: strParams }
    }
    case 'reference': {
      const ref = new Decimal(params.refPrice as string)
      strParams.refPrice = ref.toString()
      return { price: ref, explainerParams: strParams }
    }
    default:
      throw new Error(`Unknown pricing method "${method}".`)
  }
}

function costPlusCategories(
  costResult: ProductCostResult,
  params: PricingExtras,
): Array<{ name: string; cost: Decimal.Value; markup: Decimal.Value }> {
  if (Array.isArray(params.categories)) {
    return (params.categories as Array<Record<string, unknown>>).map((c, i) => ({
      name: String(c.name ?? `category ${i + 1}`),
      cost: String(c.cost ?? '0'),
      markup: String(c.markup ?? '0'),
    }))
  }
  const markups = (params.markups ?? {}) as Record<string, unknown>
  const d = (s: string) => new Decimal(s)
  return [
    {
      name: 'Materials',
      cost: d(costResult.materialCost).plus(costResult.packagingCost).plus(costResult.serviceCost).plus(costResult.wasteCost).toString(),
      markup: String(markups['material'] ?? '0'),
    },
    { name: 'Labor', cost: costResult.laborCost, markup: String(markups['labor'] ?? '0') },
    { name: 'Overhead', cost: costResult.overheadCost, markup: String(markups['overhead'] ?? '0') },
    {
      name: 'Other & components',
      cost: d(costResult.otherDirectCost).plus(costResult.componentCost).toString(),
      markup: String(markups['other'] ?? '0'),
    },
  ]
}

function channelFeeInputs(db: DatabaseType, channelId: number): FeeInput[] {
  return pricingDao.listChannelFees(db, channelId).map((f) => ({
    name: f.name,
    type: f.fee_type,
    value: f.value,
    treatment: f.treatment,
  }))
}

function calculatePricing(db: DatabaseType, configId: ID) {
  const cfg = pricingDao.getPricingConfig(db, requireId(configId, 'pricing config'))
  const params = readPricingParams(cfg)
  const problems = validatePricingParams(cfg.method, params)
  if (problems.length > 0) {
    throw new Error(`Invalid pricing params: ${problems.join(' ')}`)
  }

  const costResult = computeCostOrThrow(db, cfg.product_id)
  const cost = new Decimal(costResult.totalUnitCost)
  const { price: methodPriceValue, explainerParams } = methodPrice(cfg.method, cost, costResult, params)
  const steps = explainPricing(cfg.method, explainerParams, methodPriceValue)

  const rounding = (params.rounding ?? 'none') as RoundingStyle
  const channelId = params.channelId
  const orderQty = params.orderQty ?? 1

  if (channelId === undefined) {
    const price = suggestRounding(methodPriceValue, rounding).toString()
    return {
      method: cfg.method,
      cost: cost.toString(),
      price,
      netRevenue: price,
      feeBreakdown: [],
      explainer: steps,
      costBreakdown: costResult,
    }
  }

  const fees = channelFeeInputs(db, channelId)
  const solved = solvePriceWithFees(methodPriceValue, fees, orderQty)
  // Rounding happens after the fee solve; net is recomputed on the ROUNDED
  // price so the reported net is honest, not the pre-rounding target.
  const roundedPrice = suggestRounding(solved.price, rounding).toString()
  const applied = applyFeesToPrice(roundedPrice, fees, orderQty)
  return {
    method: cfg.method,
    cost: cost.toString(),
    price: roundedPrice,
    netRevenue: applied.netRevenue,
    feeBreakdown: applied.feeBreakdown,
    explainer: [...steps, ...explainFees(methodPriceValue, fees, solved)],
    costBreakdown: costResult,
  }
}

function explainPricingConfig(db: DatabaseType, configId: ID) {
  const cfg = pricingDao.getPricingConfig(db, requireId(configId, 'pricing config'))
  const params = readPricingParams(cfg)
  const problems = validatePricingParams(cfg.method, params)
  if (problems.length > 0) {
    throw new Error(`Invalid pricing params: ${problems.join(' ')}`)
  }
  const costResult = computeCostOrThrow(db, cfg.product_id)
  const cost = new Decimal(costResult.totalUnitCost)
  const { price, explainerParams } = methodPrice(cfg.method, cost, costResult, params)
  const extra: Record<string, unknown> = { method: cfg.method, cost: cost.toString(), price: price.toString() }
  if (cfg.method === 'reference') {
    extra.comparison = referenceComparison(cost, params.refPrice as string)
  }
  return { ...extra, explainer: explainPricing(cfg.method, explainerParams, price) }
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                           */
/* ------------------------------------------------------------------ */

type ScenarioOverrides = CostOverrides & {
  fees?: Array<{ name: string; type: FeeInput['type']; value: string; treatment: FeeInput['treatment'] }>
}

function computeScenario(db: DatabaseType, scenarioId: ID) {
  const sc = scenariosDao.get(db, requireId(scenarioId, 'scenario'))
  const overrides = parseJson<ScenarioOverrides>(sc.overrides_json || '{}', 'scenario overrides')
  if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
    throw new Error('scenario overrides must be a JSON object.')
  }
  const customUnits = productsDao.readCustomUnits(db)

  // Base: the stored snapshot when it looks like a cost result, else fresh.
  let base: ProductCostResult
  try {
    const parsed = parseJson<unknown>(sc.base_snapshot_json || '{}', 'base snapshot')
    base =
      typeof parsed === 'object' && parsed !== null && typeof (parsed as { totalUnitCost?: unknown }).totalUnitCost === 'string'
        ? (parsed as ProductCostResult)
        : computeCostOrThrow(db, sc.product_id)
  } catch {
    base = computeCostOrThrow(db, sc.product_id)
  }

  // Scenario: overrides applied to a rebuilt (cloned) cost input. Products
  // are only READ here — a scenario never writes to product data.
  const scenarioInput = productsDao.buildCostInput(sc.product_id, db, new Set(), overrides)
  const scenario = computeProductCost(scenarioInput, customUnits)

  const fields = [
    'materialCost',
    'packagingCost',
    'serviceCost',
    'laborCost',
    'otherDirectCost',
    'componentCost',
    'directCost',
    'overheadCost',
    'wasteCost',
    'totalUnitCost',
    'totalBatchCost',
    'costPerUsableUnit',
  ] as const
  const differences = fields.map((f) => {
    const b = new Decimal(base[f])
    const s = new Decimal(scenario[f])
    const change = s.minus(b)
    return {
      field: f,
      base: b.toString(),
      scenario: s.toString(),
      change: change.toString(),
      changePct: b.isZero() ? null : change.div(b).toString(),
    }
  })

  let feeSolution: unknown = null
  if (Array.isArray(overrides.fees) && overrides.fees.length > 0) {
    const fees: FeeInput[] = overrides.fees.map((f) => ({
      name: String(f.name ?? 'fee'),
      type: f.type,
      value: String(f.value ?? '0'),
      treatment: f.treatment,
    }))
    const solved = solvePriceWithFees(scenario.totalUnitCost, fees, 1)
    feeSolution = { ...solved, explainer: explainFees(scenario.totalUnitCost, fees, solved) }
  }

  return { base, scenario, differences, feeSolution, assumptions: scenario.assumptions }
}

/* ------------------------------------------------------------------ */
/* Bundles                                                             */
/* ------------------------------------------------------------------ */

function computeBundleById(db: DatabaseType, bundleId: ID) {
  const bundle = bundlesDao.get(db, requireId(bundleId, 'bundle'))
  const items = bundlesDao.listItems(db, bundle.id)
  if (items.length === 0) {
    throw new Error(`Bundle "${bundle.name}" has no items — add at least one product.`)
  }
  const customUnits = productsDao.readCustomUnits(db)
  const assumptions: string[] = []

  const prepared = items.map((it) => {
    const product = productsDao.get(db, it.product_id)
    const costResult = computeCostOrThrow(db, it.product_id)
    const unitCost = costResult.totalUnitCost
    // List price: the product's default pricing config when one exists,
    // otherwise its unit cost (stated, never invented).
    const cfg = pricingDao.defaultPricingConfig(db, it.product_id)
    let unitPrice = unitCost
    let priceSource = 'unit cost (no default pricing config)'
    if (cfg) {
      const params = readPricingParams(cfg)
      const { price } = methodPrice(cfg.method, new Decimal(unitCost), costResult, params)
      unitPrice = price.toString()
      priceSource = `pricing config "${cfg.name}" (${cfg.method})`
    } else {
      assumptions.push(
        `Item "${product.name}" has no default pricing config — its list price was set to its unit cost.`,
      )
    }
    return {
      name: product.name,
      unitCost,
      unitPrice,
      quantity: it.quantity,
      priceSource,
    }
  })

  const discount =
    bundle.discount_type === 'none'
      ? { type: 'none' as const }
      : { type: bundle.discount_type as 'pct' | 'fixed', value: bundle.discount_value }
  const result = computeBundle(prepared, discount)
  return { ...result, items: prepared, assumptions }
}

/* ------------------------------------------------------------------ */
/* Bulk                                                                */
/* ------------------------------------------------------------------ */

function computeBulk(db: DatabaseType, ruleId: ID) {
  const rule = bulkDao.getRule(db, requireId(ruleId, 'bulk rule'))
  const tiers = bulkDao.listTiers(db, rule.id)
  if (tiers.length === 0) {
    throw new Error(`Bulk rule "${rule.name}" has no tiers — add at least one tier.`)
  }
  const cost = computeCostOrThrow(db, rule.product_id)
  const d = (s: string) => new Decimal(s)
  const base = {
    materialPerUnit: d(cost.materialCost).plus(cost.packagingCost).plus(cost.serviceCost).plus(cost.wasteCost).toString(),
    laborPerUnit: cost.laborCost,
    overheadPerUnit: cost.overheadCost,
    otherPerUnit: d(cost.otherDirectCost).plus(cost.componentCost).toString(),
  }
  // Quantities: every tier's minimum plus one larger run for comparison.
  const mins = tiers.map((t) => t.min_qty)
  const maxMin = Math.max(...mins)
  const quantities = [...new Set([...mins, maxMin * 10])].sort((a, b) => a - b)
  const rows = computeBulkTable(
    base,
    tiers.map((t) => ({
      minQty: t.min_qty,
      materialDiscountPct: t.material_discount_pct,
      laborEfficiencyPct: t.labor_efficiency_pct,
      fixedSetup: t.fixed_setup,
      batchWastePct: t.batch_waste_pct,
    })),
    quantities,
  )
  return { rule, tiers, basePerUnit: base, rows }
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

interface TemplateStructure {
  settings?: {
    sku?: string
    description?: string
    category?: string
    unit_of_sale?: string
    batch_size?: number
    waste_pct?: string
    defect_pct?: string
    notes?: string
  }
  lines?: {
    materials?: Array<{ material_name: string; quantity?: string; unit?: string; waste_pct?: string }>
    labor?: Array<{ role_name?: string; task_name?: string; mode?: string; rate?: string; quantity?: string }>
    overhead?: Array<{ item_name?: string; method?: string; value?: string }>
    other?: Array<{ name: string; amount_per_unit?: string }>
  }
}

function applyTemplate(db: DatabaseType, templateId: ID, productName: string) {
  const t = templatesDao.get(db, requireId(templateId, 'template'))
  const name = typeof productName === 'string' ? productName.trim() : ''
  if (!name) throw new Error('A product name is required to apply a template.')
  const s = parseJson<TemplateStructure>(t.structure_json || '{}', 'template structure')
  const st = s.settings ?? {}
  const product = productsDao.create(db, {
    name,
    sku: st.sku,
    description: st.description ?? t.description,
    category: st.category,
    unit_of_sale: st.unit_of_sale,
    batch_size: st.batch_size,
    waste_pct: st.waste_pct,
    defect_pct: st.defect_pct,
    notes: st.notes,
  })
  const lines = s.lines ?? {}
  for (const m of lines.materials ?? []) {
    const mat = materialsDao.findByName(db, m.material_name)
    if (!mat) throw new Error(`Template "${t.name}" needs material "${m.material_name}", which does not exist.`)
    productsDao.addMaterialLine(db, product.id, {
      material_id: mat.id,
      quantity: m.quantity ?? '0',
      unit: m.unit ?? mat.unit,
      waste_pct: m.waste_pct ?? '0',
    })
  }
  for (const l of lines.labor ?? []) {
    const role = l.role_name ? laborDao.findByName(db, l.role_name) : null
    if (l.role_name && !role) {
      throw new Error(`Template "${t.name}" needs labor role "${l.role_name}", which does not exist.`)
    }
    productsDao.addLaborLine(db, product.id, {
      role_id: role ? role.id : null,
      task_name: l.task_name,
      mode: (l.mode as 'hourly' | 'per_minute' | 'per_unit' | 'fixed' | undefined) ?? 'hourly',
      rate: l.rate ?? role?.rate_per_hour ?? '0',
      quantity: l.quantity ?? '0',
    })
  }
  for (const o of lines.overhead ?? []) {
    const item = o.item_name ? overheadDao.findByName(db, o.item_name) : null
    if (o.item_name && !item) {
      throw new Error(`Template "${t.name}" needs overhead item "${o.item_name}", which does not exist.`)
    }
    productsDao.addOverheadLine(db, product.id, {
      overhead_item_id: item ? item.id : null,
      method: (o.method as 'per_unit' | 'per_batch' | 'pct_of_direct' | 'per_hour' | 'monthly_share' | undefined) ?? 'per_unit',
      value: o.value ?? '0',
    })
  }
  for (const oc of lines.other ?? []) {
    productsDao.addOtherCostLine(db, product.id, {
      name: oc.name,
      amount_per_unit: oc.amount_per_unit ?? '0',
    })
  }
  return productsDao.getFull(db, product.id)
}

/* ------------------------------------------------------------------ */
/* Quotes → PDF                                                        */
/* ------------------------------------------------------------------ */

/**
 * Shared HTML → PDF pipeline: both the native-save-dialog export and the
 * direct-save export render from the exact same quote HTML builder, so the
 * page content is byte-identical and only the destination differs. Returns
 * the PDF bytes plus the quote reference for naming the output file.
 */
async function renderQuotePdfBuffer(
  db: DatabaseType,
  quoteId: ID,
): Promise<{ pdf: Buffer; reference: string }> {
  const full = quotesDao.getFull(db, requireId(quoteId, 'quote'))
  let businessInfo: QuoteBusinessInfo = {}
  try {
    businessInfo = parseJson<QuoteBusinessInfo>(full.quote.business_info_json || '{}', 'business info')
  } catch {
    businessInfo = {}
  }
  const html = buildQuoteHtml(full.quote, full.items, businessInfo)
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const pdf = await win.webContents.printToPDF({ printBackground: true })
    return { pdf, reference: full.quote.reference }
  } finally {
    win.close()
  }
}

/** Dialog path: native save dialog, unchanged behavior. */
async function exportQuotePdf(db: DatabaseType, quoteId: ID): Promise<string> {
  const { pdf, reference } = await renderQuotePdfBuffer(db, quoteId)
  const picked = await dialog.showSaveDialog({
    title: 'Export quote as PDF',
    defaultPath: `${reference}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  if (picked.canceled || !picked.filePath) throw new Error('PDF export was cancelled.')
  writeFileSync(picked.filePath, pdf)
  return picked.filePath
}

/** Default PDF export folder: <userData>/exports. */
const defaultPdfExportDir = (): string => join(app.getPath('userData'), 'exports')

/**
 * Make sure a directory exists and is writable. Throws an Error that names
 * the offending path so the UI can surface a clear message.
 */
function ensureWritableDir(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true })
  } catch (err) {
    throw new Error(
      `Could not create the PDF export folder: ${dir} — ${err instanceof Error ? err.message : String(err)}`,
    )
  }
  try {
    accessSync(dir, constants.W_OK)
  } catch {
    throw new Error(`The PDF export folder is not writable: ${dir}`)
  }
}

/**
 * Direct-save path (Gap 3): writes the rendered PDF straight to
 * <outputDir>/<sanitized-ref>_<YYYYMMDD-HHmmss>.pdf with no dialog.
 * The outputDir comes from the `pdf.outputDir` setting; empty means the
 * default <userData>/exports folder.
 */
async function exportQuotePdfDirect(db: DatabaseType, quoteId: ID): Promise<{ path: string }> {
  const { pdf, reference } = await renderQuotePdfBuffer(db, quoteId)
  const configured = settingsDao.get(db, 'pdf.outputDir')
  const dir = configured && configured.trim() ? configured.trim() : defaultPdfExportDir()
  ensureWritableDir(dir)
  const filePath = join(dir, quotePdfDirectFileName(reference))
  writeFileSync(filePath, pdf)
  return { path: filePath }
}

/** Native directory picker for the "PDF export folder" setting. Validates writability. */
async function pickPdfExportDir(): Promise<string | null> {
  const picked = await dialog.showOpenDialog({
    title: 'Choose PDF export folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (picked.canceled || picked.filePaths.length === 0) return null
  const dir = picked.filePaths[0]
  ensureWritableDir(dir)
  return dir
}

/** Reveal the folder containing an exported PDF in the OS file manager. */
async function openPdfExportFolder(filePath: string): Promise<void> {
  if (typeof filePath !== 'string' || !filePath) {
    throw new Error('A file path is required to open its folder.')
  }
  const error = await shell.openPath(dirname(filePath))
  if (error) throw new Error(`Could not open the folder: ${error}`)
}

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

async function exportToFile(
  db: DatabaseType,
  kind: string,
  format: 'csv' | 'xlsx',
  destPath?: string,
): Promise<string> {
  const k = exportsDao.assertExportKind(kind)
  const ext = format === 'csv' ? 'csv' : 'xlsx'
  let dest = destPath
  if (!dest) {
    const picked = await dialog.showSaveDialog({
      title: `Export ${k} as ${ext.toUpperCase()}`,
      defaultPath: `pricey-${k}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    })
    if (picked.canceled || !picked.filePath) throw new Error('Export was cancelled.')
    dest = picked.filePath
  }
  if (format === 'csv') writeFileSync(dest, exportsDao.csvContent(db, k), 'utf8')
  else writeFileSync(dest, exportsDao.xlsxBuffer(db, k))
  return dest
}

/* ------------------------------------------------------------------ */
/* Integration contracts (docs/INTEGRATIONS.md — data, not connected)  */
/* ------------------------------------------------------------------ */

const INTEGRATION_CONTRACTS = [
  {
    name: 'stockroom.material-costs',
    version: 1,
    direction: 'inbound',
    title: 'Stockroom — material costs',
    description:
      'Retrieve material costs from Stockroom (inventory). Each entry becomes or updates a Pricey material; snapshots are never rewritten.',
    status: 'not-connected',
  },
  {
    name: 'elixer.formula-costs',
    version: 1,
    direction: 'inbound',
    title: 'Elixer — formula costs',
    description:
      'Receive a formula\u2019s composition and ingredient costs from Elixer. Creates/updates a Pricey product with material lines.',
    status: 'not-connected',
  },
  {
    name: 'stagepoint.production-costs',
    version: 1,
    direction: 'inbound',
    title: 'StagePoint — production costs',
    description:
      'Receive production quantities, labor requirements and production cost information from StagePoint.',
    status: 'not-connected',
  },
  {
    name: 'sublium.production-costs',
    version: 1,
    direction: 'inbound',
    title: 'Sublium — production costs',
    description:
      'Receive sublimation material and production cost calculations from Sublium (blanks, ink, press time).',
    status: 'not-connected',
  },
  {
    name: 'threadcount.production-costs',
    version: 1,
    direction: 'inbound',
    title: 'Threadcount — production costs',
    description:
      'Receive embroidery production and material cost calculations from Threadcount (thread, stabilizer, machine time).',
    status: 'not-connected',
  },
  {
    name: 'orderly.pricing-export',
    version: 1,
    direction: 'outbound',
    title: 'Orderly — pricing export',
    description:
      'Make saved pricing and quotation information available to Orderly\u2019s order workflows.',
    status: 'not-connected',
  },
]
