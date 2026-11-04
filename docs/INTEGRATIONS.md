# Clever Signal Pricey — Ecosystem Integration Interfaces

**Status: contract-only boundaries. No live integrations exist.**

Pricey is fully functional as a standalone application. Every workflow in
this document also works manually — integrations only remove re-typing, they
never gate functionality. Nothing here assumes another Clever Signal app is
installed, connected, or reachable. Where the UI shows an integration, it
shows an honest "Not connected" state with the manual path beside it.

## Ownership boundaries

- **Pricey owns:** pricing models, cost calculations, pricing scenarios,
  quotation snapshots, fee/channel definitions, and everything derived from
  them.
- **Other applications own** their operational records (inventory movements,
  formulas, production jobs, orders). Pricey never writes into them.
- Exchange is **explicit and versioned**: the user initiates every import or
  export. Nothing syncs silently in the background.
- Imported values are **copies**, not links. If the source changes later,
  Pricey's data does not move until the user re-imports and confirms.
- **Snapshots are never overwritten** by an import. Quote and calculation
  snapshots are append-only history.

## Exchange mechanism — built (v1 file exchange)

Exchange is file-based JSON through Settings → Integrations. Each contract row
has a working button: the five inbound contracts have **Import**, the outbound
`orderly.pricing-export` has **Export**.

- **Inbound:** Integrations → contract row → **Import** → choose a
  `.pricey-exchange.json` file → Pricey validates the whole file, then shows a
  preview: rows to create, rows to update (matched by `externalId`, falling
  back to name+unit for materials and name for products), and rows rejected
  with field-level reasons. **Nothing is written until you press Confirm
  import.** The commit is one explicit user action, applied in a single
  transaction.
- **Outbound:** Integrations → `orderly.pricing-export` → **Export** → native
  save dialog → a versioned `.pricey-exchange.json` file carrying Pricey's
  products, cost structures, pricing models, scenarios and frozen quote
  snapshots.

Payloads carry a versioned envelope:

```json
{ "schema": "pricey-exchange", "schemaVersion": 1,
  "exportedAt": "<ISO>", "producer": "Pricey", "producerVersion": "<app version>",
  "contract": "<name>", "contractVersion": 1, "payload": { ... } }
```

Unknown schema major versions and unsupported contract versions are rejected
with a clear message and the file is not imported — never guessed at.

**Audit trail:** every import and export appends a row to the `exchange_log`
table (direction, contract, filename, created/updated/rejected counts,
timestamp). `externalId` matches are remembered in settings so a re-import of
the same file updates instead of duplicating.

**Pricey-to-Pricey transfer:** the `orderly.pricing-export` payload carries
Pricey-owned sections (`products`, `costStructures`, `pricingModels`,
`scenarios`, `quoteSnapshots`) alongside the documented `pricings` array.
Pricey can import its own exports (moving a library to a new machine or
database): materials and products are created or updated with their full cost
structures, pricing models and scenarios are recreated, and quote snapshots
are imported as **new** quote rows with their frozen totals carried over
verbatim — existing quotes are never touched. Foreign consumers must ignore
sections they do not understand. Labor role links do not transfer (the rate
travels on the line); overhead items are recreated by name when missing.

**Pricing export basis:** `unitPrice` is the pricing-method price on the
product's unit cost, before channel fees and rounding, as exact decimal
strings. Channel fees stay Pricey-side. Each exported pricing row references a
frozen `exchange` cost snapshot (`snapshotId`) kept in Pricey for audit.

What still works fully without any of this: **manual exchange.** The field
mappings in each contract below remain the manual exchange guide — read the
sibling app's export (or its screen) and enter the values. Every Pricey
workflow works completely this way.

## Contracts

### 1. `stockroom.material-costs` v1 — inbound (optional)
Retrieve material costs from Stockroom (inventory).

```json
{ "contract": "stockroom.material-costs", "contractVersion": 1,
  "materials": [
    { "externalId": "sku-123", "name": "Beeswax", "unit": "kg",
      "unitDimension": "mass", "purchaseQty": "5", "purchasePrice": "120.00",
      "supplier": "Acme Wax" }
  ] }
```

Mapping: each entry becomes (or updates) a Pricey material. On price
change the user chooses: **future calculations only**, **recalculate
selected products**, or **preserve existing snapshots** (default).
Historical snapshots are never rewritten.

### 2. `elixer.formula-costs` v1 — inbound (optional)
Receive a formula's composition and ingredient costs from Elixer.

```json
{ "contract": "elixer.formula-costs", "contractVersion": 1,
  "formula": { "externalId": "f-9", "name": "Citrus Soap",
    "yieldQty": "12", "yieldUnit": "piece",
    "ingredients": [
      { "name": "Olive oil", "qty": "800", "unit": "g", "costPerUnit": "14.00", "costUnit": "kg" }
    ] } }
```

Mapping: creates/updates a Pricey product with material lines (unit
conversions applied by the engine; incompatible units rejected with the
field named). Ingredient quantities cover the whole `yieldQty`, so each
line is stored per-unit (`qty ÷ yieldQty`) and the product's batch size is
the yield.

### 3. `stagepoint.production-costs` v1 — inbound (optional)
Receive production quantities, labor requirements and production cost
information from StagePoint.

```json
{ "contract": "stagepoint.production-costs", "contractVersion": 1,
  "run": { "externalId": "sp-44", "name": "Batch 44 — Candles",
    "quantity": "50", "laborMinutes": "750", "laborRatePerHour": "20.00",
    "materialCostTotal": "321.43", "notes": "" } }
```

Mapping: material total becomes an "other direct cost" line or a set of
material lines at the user's choice; labor becomes a labor line.

### 4. `sublium.production-costs` v1 — inbound (optional)
Receive sublimation material and production cost calculations from Sublium.

```json
{ "contract": "sublium.production-costs", "contractVersion": 1,
  "job": { "externalId": "sub-7", "name": "Mug run",
    "blankCostPerUnit": "2.40", "inkCostPerUnit": "0.35",
    "pressMinutesPerUnit": "4", "laborRatePerHour": "18.00" } }
```

Mapping: blanks → material line, ink → material line, press time → labor
line. Ink estimates are accepted only as the measured/user-entered values
Sublium exports — Pricey never invents them.

### 5. `threadcount.production-costs` v1 — inbound (optional)
Receive embroidery production and material cost calculations from Threadcount.

```json
{ "contract": "threadcount.production-costs", "contractVersion": 1,
  "design": { "externalId": "tc-12", "name": "Left-chest logo",
    "threadCostPerUnit": "0.42", "stabilizerCostPerUnit": "0.18",
    "productionMinutesPerUnit": "22", "machineRatePerHour": "25.00" } }
```

Mapping: thread + stabilizer → material lines; production time → labor line.

### 6. `orderly.pricing-export` v1 — outbound (optional)
Make saved pricing and quotation information available to Orderly's order
workflows. The payload travels inside the standard envelope
(`schema: "pricey-exchange"`, `schemaVersion: 1`).

```json
{ "schema": "pricey-exchange", "schemaVersion": 1,
  "contract": "orderly.pricing-export", "contractVersion": 1,
  "payload": {
    "pricings": [
      { "productName": "Citrus Soap", "sku": "SOAP-01",
        "channel": "wholesale", "unitPrice": "8.50",
        "currency": "USD", "snapshotId": 42 }
    ],
    "products": [ { "name": "Citrus Soap", "sku": "SOAP-01", "category": "Soap",
      "unitOfSale": "piece", "batchSize": 12, "wastePct": "0", "defectPct": "0",
      "costPerUnit": "5.25" } ],
    "costStructures": [ { "productName": "Citrus Soap", "materials": [ ... ],
      "labor": [ ... ], "overhead": [ ... ], "otherCosts": [ ... ] } ],
    "pricingModels": [ ... ], "scenarios": [ ... ], "quoteSnapshots": [ ... ]
  } }
```

Orderly reads the `pricings` array and ignores the additive Pricey-owned
sections. Pricey retains the full calculation snapshot behind `snapshotId`
for audit.

## Validation & errors (v1 file exchange — built)

- Every file is schema-checked before any write; a structural failure
  (malformed JSON, wrong schema, unsupported schema or contract version,
  duplicate `externalId`s within the file) aborts the whole import with the
  offending field named — nothing is written.
- Row-level problems (unknown or incompatible units, bad decimal values) do
  not abort the file: the row is rejected and listed in the preview's
  rejected section with field-level reasons, and it is skipped at commit.
- Unit symbols must exist in Pricey's unit registry (built-ins plus the
  custom units defined in Settings); a declared `unitDimension` must match
  the registry or the row is rejected.
- Duplicate `externalId`s update rather than duplicate, matched in the
  preview and applied only after the explicit Confirm.
- A full import report (created / updated / rejected rows with reasons) is
  returned after the commit, and the exchange log records the run.

## What is NOT built

No auto-discovery of sibling apps, no background sync, no shared database,
no cross-app writes, no network calls. If a sibling app does not exist on
the machine, its contract row reads "Not connected — manual entry works
fully" and that is the truthful end of it.
