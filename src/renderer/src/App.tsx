import { HashRouter, NavLink, Route, Routes } from 'react-router-dom'
import { CurrencyProvider } from './components/Currency.js'
import Dashboard from './pages/Dashboard.js'
import Products from './pages/Products.js'
import Materials from './pages/Materials.js'
import Components from './pages/Components.js'
import Labor from './pages/Labor.js'
import Overhead from './pages/Overhead.js'
import Pricing from './pages/Pricing.js'
import Scenarios from './pages/Scenarios.js'
import Bundles from './pages/Bundles.js'
import Bulk from './pages/Bulk.js'
import BreakEven from './pages/BreakEven.js'
import Quotes from './pages/Quotes.js'
import Settings from './pages/Settings.js'

const NAV: { path: string; label: string; end?: boolean }[] = [
  { path: '/', label: 'Dashboard', end: true },
  { path: '/products', label: 'Products' },
  { path: '/materials', label: 'Materials' },
  { path: '/components', label: 'Components' },
  { path: '/labor', label: 'Labor' },
  { path: '/overhead', label: 'Overhead' },
  { path: '/pricing', label: 'Pricing' },
  { path: '/scenarios', label: 'Scenarios' },
  { path: '/bundles', label: 'Bundles' },
  { path: '/bulk', label: 'Bulk Pricing' },
  { path: '/breakeven', label: 'Break-even' },
  { path: '/quotes', label: 'Quotations' },
  { path: '/settings', label: 'Settings' },
]

export default function App() {
  return (
    <CurrencyProvider>
    <HashRouter>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">Pricey</div>
          <nav className="sidebar-nav">
            {NAV.map((item) => (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.end}
                className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>
        <main className="main">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/products" element={<Products />} />
            <Route path="/materials" element={<Materials />} />
            <Route path="/components" element={<Components />} />
            <Route path="/labor" element={<Labor />} />
            <Route path="/overhead" element={<Overhead />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/scenarios" element={<Scenarios />} />
            <Route path="/bundles" element={<Bundles />} />
            <Route path="/bulk" element={<Bulk />} />
            <Route path="/breakeven" element={<BreakEven />} />
            <Route path="/quotes" element={<Quotes />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
    </CurrencyProvider>
  )
}
