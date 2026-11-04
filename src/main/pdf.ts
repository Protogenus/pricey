/**
 * Quote PDF rendering: self-contained HTML (Vista-ish inline styles, no
 * external assets) for the hidden-BrowserWindow → printToPDF export.
 */
import type { Quote, QuoteItem } from '../shared/types.js'

export interface QuoteBusinessInfo {
  name?: string
  address?: string
  phone?: string
  email?: string
  [key: string]: unknown
}

const money = (v: string): string => {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : v
}

function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Build the full printable HTML for a quote. */
export function buildQuoteHtml(
  quote: Quote,
  items: QuoteItem[],
  businessInfo: QuoteBusinessInfo,
): string {
  const itemRows = items
    .map((it, i) => {
      const qty = Number(it.quantity)
      const price = Number(it.unit_price)
      const lineTotal = Number.isFinite(qty) && Number.isFinite(price) ? (qty * price).toFixed(2) : '—'
      return `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e8e2d4;">${i + 1}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e8e2d4;">${esc(it.description || '(no description)')}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e8e2d4;text-align:right;">${esc(it.quantity)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e8e2d4;text-align:right;">${money(it.unit_price)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e8e2d4;text-align:right;font-weight:600;">${lineTotal}</td>
      </tr>`
    })
    .join('')

  const discountLabel =
    quote.discount_type === 'pct'
      ? `Discount (${(Number(quote.discount_value) * 100).toFixed(2)}%)`
      : 'Discount'
  const taxLabel = esc(quote.tax_label || 'Tax') + (quote.tax_mode === 'inclusive' ? ' (incl.)' : '')

  const totals = [
    ['Subtotal', money(quote.subtotal)],
    ...(Number(quote.discount_total) !== 0 ? [[discountLabel, '−' + money(quote.discount_total)]] : []),
    ...(Number(quote.tax_total) !== 0 ? [[taxLabel, money(quote.tax_total)]] : []),
    ...(Number(quote.shipping_total) !== 0 ? [['Shipping', money(quote.shipping_total)]] : []),
  ]
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px;text-align:right;color:#6b6353;">${label}</td>
         <td style="padding:6px 12px;text-align:right;min-width:120px;">${value}</td></tr>`,
    )
    .join('')

  const bizLines = [
    businessInfo.name,
    businessInfo.address,
    [businessInfo.phone, businessInfo.email].filter(Boolean).join(' · '),
  ]
    .filter((l) => l && String(l).trim())
    .map((l) => `<div style="margin:2px 0;">${esc(String(l))}</div>`)
    .join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Quote ${esc(quote.reference)}</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color: #2b2620; background: #fff;
         margin: 48px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .cream { background: #f5f0e6; }
</style></head>
<body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;">
    <div>
      <div style="font-size:13px;letter-spacing:3px;color:#8a7f68;margin-bottom:6px;">CLEVER SIGNAL · PRICEY</div>
      ${bizLines}
    </div>
    <div style="text-align:right;">
      <div style="font-size:32px;font-weight:600;">Quote</div>
      <div style="font-size:18px;margin-top:4px;">${esc(quote.reference)}</div>
      <div style="color:#6b6353;margin-top:4px;">${esc(quote.quote_date)}${quote.expires_at ? ` · valid until ${esc(quote.expires_at)}` : ''}</div>
    </div>
  </div>

  <div style="display:flex;gap:32px;margin-bottom:28px;">
    <div style="flex:1;">
      <div style="font-size:12px;letter-spacing:2px;color:#8a7f68;margin-bottom:6px;">BILL TO</div>
      <div style="font-size:16px;font-weight:600;">${esc(quote.customer_name || '—')}</div>
      <div style="color:#6b6353;">${esc(quote.customer_contact || '')}</div>
    </div>
    ${quote.notes ? `<div style="flex:1;"><div style="font-size:12px;letter-spacing:2px;color:#8a7f68;margin-bottom:6px;">NOTES</div><div>${esc(quote.notes)}</div></div>` : ''}
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead><tr class="cream">
      <th style="padding:10px 12px;text-align:left;font-size:12px;letter-spacing:1px;">#</th>
      <th style="padding:10px 12px;text-align:left;font-size:12px;letter-spacing:1px;">DESCRIPTION</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:1px;">QTY</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:1px;">UNIT PRICE</th>
      <th style="padding:10px 12px;text-align:right;font-size:12px;letter-spacing:1px;">LINE TOTAL</th>
    </tr></thead>
    <tbody>${itemRows || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#8a7f68;">No items</td></tr>'}</tbody>
  </table>

  <table style="margin-left:auto;border-collapse:collapse;margin-bottom:32px;">
    <tbody>${totals}
      <tr><td style="padding:10px 12px;text-align:right;font-size:18px;font-weight:600;border-top:2px solid #2b2620;">Total</td>
      <td style="padding:10px 12px;text-align:right;font-size:18px;font-weight:600;border-top:2px solid #2b2620;min-width:120px;">${money(quote.total)}</td></tr>
    </tbody>
  </table>

  ${quote.terms ? `<div style="margin-bottom:24px;"><div style="font-size:12px;letter-spacing:2px;color:#8a7f68;margin-bottom:6px;">TERMS</div><div style="white-space:pre-wrap;">${esc(quote.terms)}</div></div>` : ''}

  <div style="margin-top:48px;padding-top:16px;border-top:1px solid #e8e2d4;color:#8a7f68;font-size:12px;">
    Calculated estimate — not a guaranteed profit.
  </div>
</body></html>`
}

/* ------------------------------------------------------------------ */
/* Direct-save filename helpers                                        */
/* ------------------------------------------------------------------ */

/** Windows reserved device names — illegal as a bare filename. */
const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
])

const MAX_FILENAME_STEM = 80

/**
 * Sanitize a quote reference into a safe filename stem: strip path
 * separators and every character illegal in Windows/Unix filenames, trim
 * trailing dots/spaces (illegal on Windows), cap length. Falls back to
 * 'quote' when nothing usable remains.
 */
export function sanitizeQuoteFileName(reference: string): string {
  let stem = String(reference ?? '')
    // Strip illegal filename characters (incl. path separators) and control chars.
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
  // Trailing dots/spaces are illegal on Windows.
  stem = stem.replace(/[.\s]+$/, '')
  if (stem.length > MAX_FILENAME_STEM) stem = stem.slice(0, MAX_FILENAME_STEM)
  if (!stem || RESERVED_NAMES.has(stem.toUpperCase())) stem = 'quote'
  return stem
}

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** Local-time timestamp for direct-save filenames: YYYYMMDD-HHmmss. */
export function quotePdfTimestamp(date: Date = new Date()): string {
  return (
    `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}` +
    `-${pad2(date.getHours())}${pad2(date.getMinutes())}${pad2(date.getSeconds())}`
  )
}

/** Full direct-save filename: <sanitized-ref>_<YYYYMMDD-HHmmss>.pdf */
export function quotePdfDirectFileName(reference: string, date: Date = new Date()): string {
  return `${sanitizeQuoteFileName(reference)}_${quotePdfTimestamp(date)}.pdf`
}
