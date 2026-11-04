import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { openDatabase, type DatabaseType } from '../database/index.js'
import { runMigrations } from '../database/migrations.js'
import { allMigrations } from '../database/migrations/all.js'
import { registerIpc } from './ipc.js'

/**
 * PRICEY_SMOKE=1: headless integration check (used by scripts/smoke.mjs).
 * Points userData at a temp dir so the smoke run never touches real user data,
 * then exercises the full stack: window → preload bridge → IPC → SQLite.
 */
const SMOKE = process.env.PRICEY_SMOKE === '1'
if (SMOKE) {
  app.setPath('userData', mkdtempSync(join(tmpdir(), 'pricey-smoke-')))
}

function databasePath(): string {
  return join(app.getPath('userData'), 'pricey.db')
}

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 640,
    title: 'Pricey',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

app.whenReady().then(async () => {
  let db: DatabaseType
  try {
    db = openDatabase(databasePath())
    runMigrations(db, allMigrations)
  } catch (err) {
    await dialog.showErrorBox(
      'Pricey cannot start',
      `The database could not be opened or upgraded.\n\n${
        err instanceof Error ? err.message : String(err)
      }\n\nYour existing data has not been modified.`,
    )
    app.quit()
    return
  }

  registerIpc(db)

  const win = await createWindow()
  if (SMOKE) {
    await runSmokeTest(win, db)
    return
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

/**
 * In-app smoke hook: driven by scripts/smoke.mjs. Exercises the real stack —
 * renderer → preload bridge (window.pricey) → IPC handlers → SQLite — against
 * a throwaway temp userData dir. Prints SMOKE_OK or SMOKE_FAIL lines and
 * exits with the matching code.
 */
async function runSmokeTest(win: BrowserWindow, _db: DatabaseType): Promise<void> {
  const failures: string[] = []
  const fail = (msg: string) => {
    failures.push(msg)
    console.error(`SMOKE_FAIL: ${msg}`)
  }
  const wc = win.webContents
  console.log('SMOKE: attaching listeners')

  wc.on('console-message', (_e, _level, message) => {
    if (/error/i.test(message) && !/favicon/i.test(message)) fail(`renderer console error: ${message}`)
  })
  wc.on('render-process-gone', (_e, details) => fail(`renderer gone: ${details.reason}`))

  // Wait until the page has settled. Note: did-finish-load may already have
  // fired (loadFile resolved before we subscribed), and isLoading() stays
  // true until did-stop-loading — so cover all completion signals.
  await new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (!settled) {
        settled = true
        resolve()
      }
    }
    wc.once('did-finish-load', done)
    wc.once('did-stop-loading', done)
    wc.once('did-fail-load', done)
    setImmediate(() => {
      if (!wc.isLoading()) done()
    })
  })
  console.log('SMOKE: page settled, waiting for React')
  // Give React a moment to mount and run its effects.
  await new Promise((r) => setTimeout(r, 2500))
  console.log('SMOKE: probing renderer')

  try {
    const title = await wc.executeJavaScript('document.title')
    if (title !== 'Pricey') fail(`unexpected title: ${title}`)

    // The Sublium lesson: the preload bridge itself is what must be verified —
    // window.pricey undefined means the app is dead on first boot.
    const hasBridge = await wc.executeJavaScript('typeof window.pricey === "object" && window.pricey !== null')
    if (!hasBridge) fail('window.pricey missing — preload bridge broken')

    // Parity: every channel the renderer calls must resolve through the real
    // preload bridge. This mirrors the PriceyApi surface; if a method is
    // missing from window.pricey the renderer is broken even when main has
    // the handler.
    const parity = await wc.executeJavaScript(`(() => {
      const expected = ${JSON.stringify(PRICEY_API_METHODS)}
      const missing = expected.filter((m) => typeof window.pricey[m] !== 'function')
      return missing.length === 0 ? 'ok' : 'missing: ' + missing.join(', ')
    })()`)
    if (parity !== 'ok') fail(`preload parity: ${parity}`)

    // Full-stack round trip: renderer → preload → IPC → main → SQLite → back.
    const roundTrip = await wc.executeJavaScript(`(async () => {
      const pong = await window.pricey.ping()
      if (pong !== 'pong') return 'ping: ' + pong
      const before = await window.pricey.materialsList()
      if (before.length !== 0) return 'list: expected empty DB, got ' + before.length
      const created = await window.pricey.materialsCreate({
        name: 'Smoke Test Steel', unit: 'kg', purchase_qty: '1000', purchase_price: '250.00',
      })
      if (!created.id) return 'create: no id returned'
      if (created.purchase_price !== '250.00') return 'create: price not TEXT-exact: ' + created.purchase_price
      const list = await window.pricey.materialsList()
      if (list.length !== 1) return 'list: expected 1 material, got ' + list.length
      if (list[0].name !== 'Smoke Test Steel') return 'list: wrong name ' + list[0].name
      const updated = await window.pricey.materialsUpdate({ id: created.id, name: 'Smoke Test Steel (v2)' })
      if (updated.name !== 'Smoke Test Steel (v2)') return 'update: name not applied'
      await window.pricey.materialsArchive(created.id)
      const afterArchive = await window.pricey.materialsList()
      if (afterArchive.length !== 0) return 'archive: expected 0 listed, got ' + afterArchive.length
      const withArchived = await window.pricey.materialsList(true)
      if (withArchived.length !== 1) return 'list archived: expected 1, got ' + withArchived.length
      return 'ok'
    })()`)
    if (roundTrip !== 'ok') fail(`IPC round trip: ${roundTrip}`)
  } catch (err) {
    fail(`exception during smoke test: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (failures.length === 0) console.log('SMOKE_OK')
  app.exit(failures.length === 0 ? 0 : 1)
}

/** PriceyApi method names, mirrored for the in-app parity check. */
const PRICEY_API_METHODS: string[] = [
  'ping',
  'settingsGet', 'settingsSet', 'settingsGetDataPath', 'settingsBackup', 'settingsRestore',
  'materialsList', 'materialsCreate', 'materialsUpdate', 'materialsArchive', 'materialsDelete',
  'materialsPriceEvents', 'materialsExportCsv', 'materialsImportCsv',
  'laborList', 'laborCreate', 'laborUpdate', 'laborArchive', 'laborDelete',
  'overheadList', 'overheadCreate', 'overheadUpdate', 'overheadArchive', 'overheadDelete',
  'productsList', 'productsCreate', 'productsUpdate', 'productsArchive', 'productsDelete',
  'productsGetFull',
  'productsAddMaterial', 'productsUpdateMaterialLine', 'productsRemoveMaterialLine',
  'productsAddLabor', 'productsUpdateLaborLine', 'productsRemoveLaborLine',
  'productsAddOverhead', 'productsUpdateOverheadLine', 'productsRemoveOverheadLine',
  'productsAddComponent', 'productsUpdateComponentLine', 'productsRemoveComponentLine',
  'productsAddOtherCost', 'productsUpdateOtherCostLine', 'productsRemoveOtherCostLine',
  'productsComputeCost', 'productsSaveSnapshot',
  'productsImagePick', 'productsImageSave', 'productsImageRemove', 'productsImageData',
  'templatesList', 'templatesCreate', 'templatesUpdate', 'templatesDelete', 'templatesApply',
  'pricingConfigsList', 'pricingConfigsCreate', 'pricingConfigsUpdate', 'pricingConfigsDelete',
  'pricingCalculate', 'pricingExplain',
  'channelsList', 'channelsCreate', 'channelsUpdate', 'channelsDelete',
  'channelFeesList', 'channelFeesCreate', 'channelFeesUpdate', 'channelFeesDelete',
  'scenariosList', 'scenariosCreate', 'scenariosUpdate', 'scenariosDelete',
  'scenariosDuplicate', 'scenariosCompute',
  'bundlesList', 'bundlesCreate', 'bundlesUpdate', 'bundlesDelete',
  'bundleItemsList', 'bundleItemsAdd', 'bundleItemsUpdate', 'bundleItemsRemove', 'bundlesCompute',
  'bulkRulesList', 'bulkRulesCreate', 'bulkRulesUpdate', 'bulkRulesDelete',
  'bulkTiersList', 'bulkTiersCreate', 'bulkTiersUpdate', 'bulkTiersDelete', 'bulkCompute',
  'breakevenCalculate',
  'quotesList', 'quotesCreate', 'quotesUpdate', 'quotesDelete', 'quotesGetFull',
  'quotesDuplicate', 'quotesExportPdf',
  'quoteItemsAdd', 'quoteItemsUpdate', 'quoteItemsRemove',
  'snapshotsList', 'snapshotsCreate', 'snapshotsGet',
  'exportsCsv', 'exportsXlsx', 'exportsImportTemplate',
  'integrationsContracts',
  'exchangeExport', 'exchangeValidateFile', 'exchangeApplyImport', 'exchangeLog',
]

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
