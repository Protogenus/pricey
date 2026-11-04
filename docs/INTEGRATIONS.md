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

## Exchange mechanism — current state (manual)

The contracts below are **documented, versioned interfaces**; the file-based
exchange described after them is the planned v1 import path and is **not yet
built**. What exists today, and works fully:

- **Manual exchange:** the user reads a sibling app's export (or its screen)
  and enters the values into Pricey using the field mapping in each contract.
  Every Pricey workflow — materials, products, cost roll-ups, quotes — works
  completely this way. The Settings → Integrations panel lists each contract
  with an honest "Not connected" state and the manual path beside it.

## Planned v1 file exchange (not implemented)

When built, exchange will be file-based JSON through Pricey's Import/Export
screens:

- **Inbound:** user opens Integrations → selects a contract → chooses a
  `.pricey-exchange.json` file exported from the sibling app → reviews a
  field-by-field mapping preview → confirms. Pricey validates the payload
  against the contract schema and reports every rejected field.
- **Outbound:** user selects Pricey records → Export → produces a versioned
  JSON file the sibling app can import under its own contract.
- Payloads will carry `{ "contract": "<name>", "contractVersion": 1,
  "exportedAt": "<ISO>", "exportedBy": "<app>" }`. Unknown contract versions
  are rejected with a clear message, never guessed at.

Until that exists, the field mappings in each contract below are the manual
exchange guide.

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
field named).

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
workflows.

```json
{ "contract": "orderly.pricing-export", "contractVersion": 1,
  "pricings": [
    { "productName": "Citrus Soap", "sku": "SOAP-01",
      "channel": "wholesale", "unitPrice": "8.50",
      "currency": "USD", "snapshotId": 42 }
  ] }
```

Orderly imports prices as quoted figures; Pricey retains the full
calculation snapshot behind `snapshotId` for audit.

## Validation & errors (planned v1 file exchange)

When the file exchange above is built, these rules will govern it:

- Every inbound payload is schema-checked before any write; the first
  failure aborts the import with the offending field named.
- Unit dimensions must match Pricey's unit registry or the line is rejected
  (listed in the import error report).
- Duplicate `externalId`s update rather than duplicate, only after user
  confirmation per record.
- A full import error report (accepted / rejected / skipped rows with
  reasons) is shown before anything is committed, and the commit itself is
  one explicit user action.

## What is NOT built

No auto-discovery of sibling apps, no background sync, no shared database,
no cross-app writes, no network calls. If a sibling app does not exist on
the machine, its contract row reads "Not connected — manual entry works
fully" and that is the truthful end of it.
