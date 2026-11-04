/**
 * Renderer-side builder for ProductCostInput.
 *
 * Mirrors src/database/products.ts buildCostInput() (materials, labor with
 * role-rate fallback, overhead with per_hour/monthly_share item resolution,
 * other, components, waste/defect/batch) so the renderer can run the pure
 * engine (src/engine) client-side for live previews — Scenarios, product cost
 * explainers. The backend remains authoritative: anything saved or reported
 * as final goes through the IPC handlers.
 */
import Decimal from 'decimal.js'
import {
  computeProductCost,
  type ComponentInput,
  type LaborLineInput,
  type MaterialLineInput,
  type OtherCostInput,
  type OverheadLineInput,
  type ProductCostInput,
  type ProductCostResult,
} from '../../../engine/index.js'
import type { CustomUnitDef } from '../../../engine/units.js'
import type {
  LaborRole,
  Material,
  OverheadItem,
  ProductFull,
} from '../../../shared/types.js'
import type { PriceyApi } from '../../../shared/ipc.js'

export interface ScenarioCostOverrides {
  /** 0..1 fraction added to every material's cost per unit, e.g. 0.05 = +5%. */
  materialPricePct?: string
  /** 0..1 fraction applied to every labor line rate. */
  laborRatePct?: string
  /** 0..1 fraction applied to every labor line quantity (production time). */
  productionTimePct?: string
  /** Absolute product-level waste fraction (replaces the product's own). */
  wastePct?: string
  /** Absolute defect fraction (replaces the product's own). */
  defectPct?: string
  /** Absolute batch size (replaces the product's own). */
  batchSize?: number
}

export interface CostInputDeps {
  materialsById: Map<number, Material>
  laborRolesById?: Map<number, LaborRole>
  overheadItemsById?: Map<number, OverheadItem>
}

const ENGINE_CATEGORIES = new Set(['material', 'packaging', 'service'])

function scaleByPct(value: string, pct: string | undefined): string {
  if (pct === undefined || pct === '') return value
  return new Decimal(value).times(new Decimal(1).plus(new Decimal(pct))).toString()
}

/**
 * Build the engine cost input for a product. Throws a descriptive error when
 * a referenced material/role/item is missing or a method lacks its data —
 * matching the backend's refusal to guess.
 */
export function buildProductCostInput(
  full: ProductFull,
  deps: CostInputDeps,
  overrides: ScenarioCostOverrides = {},
  ancestors: ReadonlySet<number> = new Set(),
): ProductCostInput {
  if (ancestors.has(full.id)) {
    throw new Error(
      `Circular component reference: "${full.name}" contains itself through a component chain.`,
    )
  }
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(full.id)
  const { materialsById, laborRolesById, overheadItemsById } = deps

  const materials: MaterialLineInput[] = full.materials.map((line) => {
    const mat = materialsById.get(line.material_id)
    if (!mat) {
      throw new Error(
        `Material #${line.material_id} on a material line of "${full.name}" no longer exists.`,
      )
    }
    const costPerUnit = scaleByPct(mat.cost_per_unit, overrides.materialPricePct)
    return {
      material: {
        id: mat.id,
        name: mat.name,
        category: (
          ENGINE_CATEGORIES.has(mat.category) ? mat.category : 'material'
        ) as 'material' | 'packaging' | 'service',
        unit: mat.unit,
        dimension: mat.unit_dimension,
        costPerUnit,
      },
      quantity: line.quantity,
      unit: line.unit,
      wastePct: line.waste_pct,
    }
  })

  const labor: LaborLineInput[] = full.labor.map((line) => {
    // Backend fallback: a role-linked line with no own rate uses the role's rate.
    let rate = line.rate
    if (
      line.role_id !== null &&
      (rate === '0' || rate === '' || rate === null) &&
      laborRolesById
    ) {
      const role = laborRolesById.get(line.role_id)
      if (role) rate = role.rate_per_hour
    }
    return {
      taskName: line.task_name || 'Labor',
      mode: line.mode,
      rate: scaleByPct(rate, overrides.laborRatePct),
      quantity: scaleByPct(line.quantity, overrides.productionTimePct),
    }
  })

  const batchSizeStr = String(overrides.batchSize ?? full.batch_size)
  const overhead: OverheadLineInput[] = full.overhead.map((line) => {
    const ol: OverheadLineInput = {
      name: line.item_name || `${line.method} overhead`,
      method: line.method,
      value: line.value,
    }
    if (line.method === 'per_hour') {
      const item =
        line.overhead_item_id !== null ? overheadItemsById?.get(line.overhead_item_id) : undefined
      if (!item || !item.amount) {
        throw new Error(
          `Overhead "${ol.name}" uses per-hour allocation but has no linked overhead item with an hourly rate.`,
        )
      }
      ol.hourlyRate = item.amount
    }
    if (line.method === 'monthly_share') {
      const item =
        line.overhead_item_id !== null ? overheadItemsById?.get(line.overhead_item_id) : undefined
      if (!item || !item.amount) {
        throw new Error(
          `Overhead "${ol.name}" uses monthly-share allocation but has no linked overhead item with a monthly amount.`,
        )
      }
      ol.monthlyAmount = item.amount
      ol.monthlyUnits = batchSizeStr
    }
    return ol
  })

  const other: OtherCostInput[] = full.other_costs.map((oc) => ({
    name: oc.name,
    amountPerUnit: oc.amount_per_unit,
  }))

  const components: ComponentInput[] = []
  for (const comp of full.components) {
    const sub = (comp as ComponentLineWithFull).subFull
    if (!sub) {
      throw new Error(
        `Component "${comp.component_name ?? `#${comp.component_id}`}" could not be loaded.`,
      )
    }
    components.push({
      product: buildProductCostInput(sub, deps, overrides, nextAncestors),
      quantity: comp.quantity,
    })
  }

  return {
    id: full.id,
    name: full.name,
    batchSize: batchSizeStr,
    materials,
    labor,
    overhead,
    other,
    components,
    wastePct: overrides.wastePct ?? full.waste_pct,
    defectPct: overrides.defectPct ?? full.defect_pct,
  }
}

/** Component line with the resolved sub-product, for the recursive builder. */
export interface ComponentLineWithFull {
  id: number
  product_id: number
  component_id: number
  component_name?: string
  quantity: string
  sort_order: number
  subFull?: ProductFull
}

export type DeepProductFull = Omit<ProductFull, 'components'> & {
  components: ComponentLineWithFull[]
}

/**
 * Load a product and, recursively, every component's full record so the
 * client-side builder can roll up nested components. Cycle-safe: a repeated
 * id throws a clear circular-reference error instead of recursing forever.
 */
export async function loadFullDeep(
  api: Pick<PriceyApi, 'productsGetFull'>,
  productId: number,
  maxDepth = 8,
  ancestors: ReadonlySet<number> = new Set(),
): Promise<DeepProductFull> {
  if (ancestors.has(productId)) {
    throw new Error(
      'Circular component reference detected while loading — this product contains itself through a component chain.',
    )
  }
  if (maxDepth <= 0) {
    throw new Error('Component nesting is deeper than 8 levels — refusing to load further.')
  }
  const full = await api.productsGetFull(productId)
  const nextAncestors = new Set(ancestors)
  nextAncestors.add(productId)
  const components: ComponentLineWithFull[] = []
  for (const line of full.components) {
    const sub = await loadFullDeep(api, line.component_id, maxDepth - 1, nextAncestors)
    components.push({ ...line, subFull: sub as ProductFull })
  }
  return { ...full, components }
}

/** Compute a product's cost fully client-side via the engine. */
export function computeCostClientSide(
  full: ProductFull,
  deps: CostInputDeps,
  customUnits: CustomUnitDef[] = [],
  overrides: ScenarioCostOverrides = {},
): { input: ProductCostInput; result: ProductCostResult } {
  const input = buildProductCostInput(full, deps, overrides)
  const result = computeProductCost(input, customUnits)
  return { input, result }
}
