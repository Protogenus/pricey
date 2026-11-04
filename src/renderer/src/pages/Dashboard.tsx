import { useNavigate } from 'react-router-dom'
import { api } from '../api.js'
import { Money } from '../components/Money.js'
import { EmptyState } from '../components/EmptyState.js'
import { ErrorBanner, Loading, fmtDate, useAsync } from '../components/hooks.js'
import type { CostSnapshot, Material, MaterialPriceEvent, Product, Quote } from '../../../shared/types.js'

interface DashboardData {
  products: Product[]
  materials: Material[]
  quotes: Quote[]
  snapshots: CostSnapshot[]
  scenarioCount: number
  priceChanges: Array<{
    material: Material
    latest: MaterialPriceEvent
    previous: MaterialPriceEvent | null
  }>
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

async function load(): Promise<DashboardData> {
  const [products, materials, quotes, snapshots] = await Promise.all([
    api.productsList(),
    api.materialsList(),
    api.quotesList(),
    api.snapshotsList(),
  ])

  const scenarioCounts = await Promise.all(
    products.map((p) => api.scenariosList(p.id).catch(() => [])),
  )
  const scenarioCount = scenarioCounts.reduce((s, list) => s + list.length, 0)

  // Materials whose price changed in the last 30 days need attention:
  // any product using them may be underpriced now.
  const priceChanges: DashboardData['priceChanges'] = []
  const now = Date.now()
  for (const material of materials) {
    const events = await api.materialsPriceEvents(material.id).catch(() => [])
    if (events.length === 0) continue
    const latest = events[0]
    const when = new Date(latest.effective_at).getTime()
    if (Number.isNaN(when) || now - when > THIRTY_DAYS_MS) continue
    priceChanges.push({ material, latest, previous: events[1] ?? null })
  }
  priceChanges.sort(
    (a, b) => new Date(b.latest.effective_at).getTime() - new Date(a.latest.effective_at).getTime(),
  )

  return { products, materials, quotes, snapshots, scenarioCount, priceChanges }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const { data, error, loading, reload } = useAsync(load, [])

  if (loading) {
    return (
      <div className="page">
        <h1>Dashboard</h1>
        <Loading />
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="page">
        <h1>Dashboard</h1>
        <ErrorBanner message={error ?? 'Failed to load.'} onDismiss={reload} />
      </div>
    )
  }

  const recentProducts = [...data.products]
    .sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1))
    .slice(0, 5)
  const productNames = new Map(data.products.map((p) => [p.id, p.name]))
  const recentSnapshots = [...data.snapshots]
    .sort((a, b) => (b.created_at > a.created_at ? 1 : -1))
    .slice(0, 5)

  return (
    <div className="page">
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="stat-num">{data.products.length}</div>
          <div className="stat-label">Products</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{data.materials.length}</div>
          <div className="stat-label">Materials</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{data.scenarioCount}</div>
          <div className="stat-label">Scenarios</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{data.quotes.length}</div>
          <div className="stat-label">Quotes</div>
        </div>
      </div>

      <div className="card mb-16">
        <div className="section-title">Quick actions</div>
        <div className="pill-row">
          <button type="button" onClick={() => navigate('/products')}>
            New product
          </button>
          <button type="button" className="secondary" onClick={() => navigate('/pricing')}>
            Calculate price
          </button>
          <button type="button" className="secondary" onClick={() => navigate('/quotes')}>
            New quote
          </button>
          <button type="button" className="secondary" onClick={() => navigate('/materials')}>
            Manage materials
          </button>
        </div>
      </div>

      <div className="two-col mb-16">
        <div className="card">
          <div className="section-title">Recently edited products</div>
          {recentProducts.length === 0 ? (
            <EmptyState
              title="No products yet"
              message="Create your first product to start costing."
              action={
                <button type="button" onClick={() => navigate('/products')}>
                  Go to Products
                </button>
              }
            />
          ) : (
            <ul className="list-plain">
              {recentProducts.map((p) => (
                <li key={p.id}>
                  <button type="button" className="link-btn" onClick={() => navigate('/products')}>
                    {p.name}
                  </button>
                  <span className="muted">
                    {' '}
                    · {p.sku || 'no SKU'} · updated {fmtDate(p.updated_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="section-title">Recent cost snapshots</div>
          {recentSnapshots.length === 0 ? (
            <EmptyState
              title="No snapshots yet"
              message="Snapshots freeze a product's cost breakdown at a point in time. Save one from a product's detail view."
            />
          ) : (
            <ul className="list-plain">
              {recentSnapshots.map((s) => (
                <li key={s.id}>
                  {s.label || 'Snapshot'}
                  <span className="muted">
                    {' '}
                    · {s.product_id ? productNames.get(s.product_id) ?? `product #${s.product_id}` : '—'}{' '}
                    · {fmtDate(s.created_at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="section-title">Cost changes needing attention</div>
        <p className="muted">
          Materials whose purchase price changed in the last 30 days. Products using them may need
          their prices recalculated.
        </p>
        {data.priceChanges.length === 0 ? (
          <EmptyState
            title="No recent price changes"
            message="No material has had a price change in the last 30 days."
          />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Material</th>
                <th>Changed</th>
                <th>New purchase price</th>
                <th>Previous</th>
                <th>Cost per unit now</th>
              </tr>
            </thead>
            <tbody>
              {data.priceChanges.map(({ material, latest, previous }) => (
                <tr key={material.id}>
                  <td>{material.name}</td>
                  <td>{fmtDate(latest.effective_at)}</td>
                  <td className="money">
                    <Money value={latest.purchase_price} /> / {latest.purchase_qty} {material.unit}
                  </td>
                  <td className="money">
                    {previous ? (
                      <>
                        <Money value={previous.purchase_price} /> / {previous.purchase_qty}{' '}
                        {material.unit}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="money">
                    <Money value={material.cost_per_unit} /> / {material.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
