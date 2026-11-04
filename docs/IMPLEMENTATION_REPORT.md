# Clever Signal Pricey — Implementation Report

**Product:** Clever Signal Pricey — universal product pricing, costing & profitability
**Promise:** Know exactly what your product costs. Know exactly what to charge.
**Build:** `~/workspace/pricey/` · Electron 45 + React 19 + TypeScript + Vite + better-sqlite3
**Architecture:** offline-first, single-user, local SQLite. No server, no cloud auth, no network calls, no AI anywhere.

## What was built (spec §1–§16)

**§2 Universal cost engine** (`src/engine/`, pure TS + decimal.js, no float money math):
- Materials with exact unit conversions across 5 dimensions (mass g, volume ml, length cm, area cm², count piece); cross-dimension conversion **refused** with `UnitConversionError`, never coerced; custom unit registry.
- Labor: hourly / per-minute / per-unit / fixed, multi-role, explicit quantities × rates.
- Overhead: 5 allocation methods (per-unit, per-batch, % of direct, per-hour, monthly share); direct vs allocated costs distinguished in results.
- Waste/yield: line-level waste folded into required quantities; product waste applied **once** to the material subtotal; defect % spreads batch cost over usable units only.
- Nested components/subassemblies with recursive roll-up and cycle rejection (a real infinite-recursion bug was found by the harness and fixed — clean `Circular component reference` error now).

**§3 Product & cost library:** products (SKU, category, batch size, waste/defect %), centralized materials with price-change audit trail (user chooses future-only / recalculate / preserve snapshots — snapshots never rewritten), labor roles, overhead items, reusable components, cost-structure templates.

**§4–§6 Pricing engine:** margin vs markup mathematically distinct and unmistakably labeled in UI ("Margin — profit as % of PRICE" / "Markup — profit as % of COST"); fixed-profit, target-profit, minimum, cost-plus (per-category), manual reference comparison. Retail/wholesale channels with independent strategies and per-channel fees. Fee engine solves fee-on-final-price with explicit algebra `P = (net + F) ÷ (1 − a)` — no iteration, no circular math. Treatments: deducted / included / customer-pays.

**§7 What-if scenarios:** override material prices, labor, waste, batch size, fees etc.; base snapshot vs scenario compared side-by-side; scenarios never mutate the original unless explicitly applied.

**§8 Discount simulator:** percentage / fixed / tiered / bundle discounts with full economics (discounted price → fees on that price → net → profit); reverse calculator ("25% off at 60% margin needs a $35.00 list on a $10.50 cost").

**§9 Bundles:** multi-product bundles, total/list/discount/profit/margin, explicit revenue allocation (proportional_cost / proportional_price / equal).

**§10 Bulk pricing:** per-tier material discounts, labor efficiency, fixed setup, batch waste — no linear-decrease assumption.

**§11 Break-even:** contribution-margin math, BE units (rounded up) / revenue / target-profit units; double-counting guard asks explicitly whether the variable cost excludes allocated fixed overhead and records the answer.

**§12 Quotes:** customer details, reference, dates, multi-item, discounts, shipping, taxes, terms; **frozen assumption snapshots** — quote totals survive later material price changes; PDF export (HTML builder + printToPDF; native save dialog).

**§13 Calculation explainer:** every major result screen shows formulas with substituted values (Products, Pricing, Break-even via ExplainView; Bundles/Scenarios show assumptions; Quotes show frozen assumptions; Bulk shows per-tier row breakdown). Validation rejects negative costs, ≥100% margins, incompatible units, zero batch sizes, ≥100% combined fees — each naming the offending field.

**§14 Navigation:** 13 screens — Dashboard, Products, Materials, Components, Labor, Overhead, Pricing Calculator, Scenarios, Bundles, Bulk Pricing, Break-even, Quotations, Settings.

**§15 Exports & ownership:** CSV/XLSX export + import with templates and per-row error reports; backup/restore (restore rejects non-SQLite files); append-only calculation snapshots.

**§16 Ecosystem integration:** contract-only boundaries — 6 versioned contracts (Stockroom, Elixer, StagePoint, Sublium, Threadcount, Orderly) documented in `docs/INTEGRATIONS.md`, listed in Settings as honest "Not connected" with the manual exchange path. No fabricated integrations; the app is fully usable with zero integrations connected.

## Verification (direct execution — no test suites, per the build order)

- **Engine + database:** 87 checks, all passing — hand-computed fixtures through the real DB layer and engine (candle cost roll-up $7.6967239527/unit across all categories, nested gift-box $13.8967239527, fee solve $31.235294…, break-even 42 units/$1,102.50, bundle profit, bulk tiers, discount impact with fees, quote snapshot freeze across a material price shock, CSV import error report, close/reopen persistence).
- **Renderer:** all 13 routes render through the real preload bridge on the built app (CDP-driven); fresh DB is empty (zero demo data); IPC create→list round-trips through `window.pricey`.
- **PDF:** quote HTML builder verified (escaping, totals, business info); `printToPDF` verified producing a valid PDF in this Electron build.
- **Final gate:** `typecheck` ✓, `build` ✓, headless `smoke` ✓ (`SMOKE_OK`, preload zero-dependency guard passes).

## Honestly unfinished / known gaps

1. **File-based `.pricey-exchange.json` import/export — FILLED (gap-fill mission, commit 6fc17cd).** `pricey-exchange-v1` schema with versioned envelope; export for the outbound `orderly.pricing-export` contract; import for all 5 inbound contracts with read-only preview/diff and explicit confirm; hard errors on unknown schema/contract versions; per-row rejections naming the field; migration `002_exchange_log` audit table; Settings → Integrations Import/Export wired to native file dialogs. Verified: ~60 checks incl. export→fresh-DB round-trip with exact string equality, no duplicates on re-import, quotes never overwritten. `docs/INTEGRATIONS.md` rewritten in present tense.
2. **Product image — FILLED (gap-fill mission, commit eb2c0a6).** Product editor has an image picker (native dialog); images validated by magic bytes (png/jpg/webp), 5 MB cap, stored content-addressed by SHA-256 under `<userData>/images/` with reference-counted deletion; thumbnails on list and detail; migration `003_product_images`. Verified: 33 DAO checks + 26 E2E checks through the built app.
3. **Fixed-profit vs target-profit tabs** are the same underlying math (`price = cost + profit`) with different framing — presented as separate tabs per the spec's two sections. (Standing, not a defect.)
4. **Quote PDF end-to-end — FILLED (gap-fill mission, commit b415f73).** Settings → "Save PDFs without asking" + configurable export folder (default `<userData>/exports/`); direct save writes `<sanitized-ref>_<YYYYMMDD-HHmmss>.pdf` with an "Open folder" action; the native-dialog path remains when the setting is off. Both paths share one HTML→PDF pipeline — page content verified identical across direct and dialog paths (raw bytes differ only in Chromium's baked-in CreationDate/ModDate/ID metadata, impossible to equalize by construction).
5. **No Windows installer zip** — being built in Gap 4 of this mission (repo Protogenus/pricey + Windows CI + v0.1.0 release).
6. **No multi-currency** — USD-centric display; not in the spec. (Standing.)

## Completion requirements 1–15

1 ✓ product from nothing · 2 ✓ reusable library CRUD · 3 ✓ cost roll-up hand-verified · 4 ✓ margin/markup distinct + labeled · 5 ✓ fees incl. fee-on-price algebra · 6 ✓ retail/wholesale independent · 7 ✓ bundle/bulk hand-verified · 8 ✓ discounts show true profit with fees · 9 ✓ break-even + double-count guard · 10 ✓ quote snapshots frozen · 11 ✓ explainers with formulas + values · 12 ✓ persists across sessions · 13 ✓ CSV/XLSX round-trip + error reports · 14 ✓ fully standalone, zero integrations needed · 15 ✓ no AI, no historical-sales dependency, no network calls (grep-verified in `src/`, dependency list clean).
