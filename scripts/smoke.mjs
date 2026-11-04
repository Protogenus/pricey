#!/usr/bin/env node
/**
 * Pricey headless smoke test.
 *
 * Launches the BUILT app (requires `npm run build` first) with PRICEY_SMOKE=1,
 * which points userData at a throwaway temp dir. The in-app smoke hook in
 * src/main/index.ts then exercises the real stack —
 *   window → preload bridge (window.pricey) → IPC → SQLite
 * — including a parity assertion that every PriceyApi method exists on
 * window.pricey (the Sublium lesson: a broken preload bridge leaves
 * window.pricey undefined and the app dead on first boot).
 *
 * Usage: npm run smoke   (or: xvfb-run -a npm run smoke on headless Linux)
 *
 * Exit 0 on SMOKE_OK, 1 on any SMOKE_FAIL / timeout / launch error.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const mainEntry = join(root, 'out', 'main', 'index.js')
const preloadBundle = join(root, 'out', 'preload', 'index.js')

function die(msg) {
  console.error(`smoke: ${msg}`)
  process.exit(1)
}

if (!existsSync(mainEntry)) die('build output missing (out/main/index.js) — run `npm run build` first')
if (!existsSync(preloadBundle)) die('preload bundle missing (out/preload/index.js) — run `npm run build` first')

// Sublium lesson, build-side guard: the preload bundle must be zero-dependency.
// electron-vite's externalizeDepsPlugin turns node_modules imports into require()
// calls; in the sandboxed preload those fail and window.pricey ends up
// undefined. The only require() allowed here is Electron's own host module.
const preloadSrc = readFileSync(preloadBundle, 'utf8')
const requires = [...preloadSrc.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])
const bad = requires.filter((r) => r !== 'electron' && !r.startsWith('node:'))
if (bad.length > 0) {
  die(`preload bundle externalized dependencies: ${[...new Set(bad)].join(', ')} — fix the preload imports, do not work around`)
}
console.log('smoke: preload bundle is zero-dependency (only requires "electron")')

const electronBin = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron.cmd' : 'electron',
)
if (!existsSync(electronBin)) die('electron binary missing — run `npm install` first')

const useXvfb = process.platform === 'linux' && !process.env.DISPLAY && !process.env.PRICEY_NO_XVFB
// --no-sandbox: this VM runs as root, where Chromium's OS sandbox cannot
// initialize. The app's own renderer sandbox (webPreferences.sandbox) is
// untouched — this flag only affects the smoke harness launch.
const electronArgs = ['--no-sandbox', '.']
let cmd = electronBin
let args = electronArgs
if (useXvfb) {
  const probe = spawnSync('which', ['xvfb-run'], { encoding: 'utf8' })
  if (probe.status !== 0) die('no DISPLAY and xvfb-run not found — install xvfb or set PRICEY_NO_XVFB=1')
  cmd = 'xvfb-run'
  args = ['-a', electronBin, ...electronArgs]
}

console.log(`smoke: launching ${useXvfb ? 'xvfb-run -a electron' : 'electron'} with PRICEY_SMOKE=1`)
const child = spawn(cmd, args, {
  cwd: root,
  env: { ...process.env, PRICEY_SMOKE: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const TIMEOUT_MS = 120_000
let sawOk = false
let sawFail = false
let output = ''

const timer = setTimeout(() => {
  console.error('smoke: TIMEOUT — app did not finish within 120s')
  child.kill('SIGKILL')
  process.exit(1)
}, TIMEOUT_MS)

child.stdout.on('data', (d) => {
  const text = d.toString()
  output += text
  process.stdout.write(`[app] ${text}`)
  if (text.includes('SMOKE_OK')) sawOk = true
  if (text.includes('SMOKE_FAIL')) sawFail = true
})
child.stderr.on('data', (d) => {
  const text = d.toString()
  output += text
  process.stderr.write(`[app:err] ${text}`)
  if (text.includes('SMOKE_FAIL')) sawFail = true
})
child.on('error', (err) => {
  clearTimeout(timer)
  die(`failed to launch electron: ${err.message}`)
})
child.on('exit', (code) => {
  clearTimeout(timer)
  if (sawOk && !sawFail && code === 0) {
    console.log('smoke: PASS')
    process.exit(0)
  }
  console.error(`smoke: FAIL (exit=${code}, sawOk=${sawOk}, sawFail=${sawFail})`)
  process.exit(1)
})
