# Pricey

**Know exactly what your product costs. Know exactly what to charge.** Pricey is a Clever Signal universal product pricing, costing & profitability app for makers, resellers, and small manufacturers — Electron + React + TypeScript + Vite + SQLite (better-sqlite3), offline-first, no AI, no cloud, no demo data.

## Commands

- `npm install` — install dependencies
- `npm run rebuild` — rebuild better-sqlite3 for Electron
- `npm run dev` — run the app in development mode
- `npm run typecheck` — typecheck main/preload/shared/database + renderer
- `npm run build` — production build (`electron-vite build`)
- `npm run smoke` — headless smoke test against the built app (requires `npm run build` first)
- `npm run dist:win` — build + package a Windows x64 NSIS installer (only when Blake asks)

## Notes

- Money values are stored in SQLite as TEXT (never REAL); all math runs through decimal.js.
- The calculation engine lives in `src/engine/` (owned by the engine engineer); the scaffold owns the app shell, IPC bridge, migrations, and UI skeleton only.
- The app ships with an empty database — no sample data, ever.
