import type { CSSProperties } from 'react'
import type { CalcResult, QuoteDoc, QuoteRow, Run } from '../api/types'
import { evalNum, fmt } from '../lib/format'

const hex = (c?: string | null) => (c ? `#${c.slice(-6)}` : undefined)

export function RunsView({ runs, base }: { runs: Run[]; base?: Partial<Run> }) {
  return (
    <>
      {runs.map((r, i) => {
        const st: CSSProperties = {
          fontWeight: r.bold || base?.bold ? 700 : 400,
          fontStyle: r.italic ? 'italic' : undefined,
          textDecoration: r.underline || base?.underline ? 'underline' : undefined,
          color: hex(r.color),
          whiteSpace: 'pre-wrap',
        }
        return <span key={i} style={st}>{r.text}</span>
      })}
    </>
  )
}

/** HTML approximation of the quotation body, styled like the PDF (Cambria/Caladea serif, green item bars, yellow highlight rows, red runs). */
export function QuotePreview({ qd, result, selected, onSelect }: { qd: QuoteDoc; result: CalcResult; selected?: number | null; onSelect?: (rowIndex: number) => void }) {
  const items = new Map(result.items.map((i) => [i.no, i]))
  const cur = (qd.currency_label || result.totals.currency).replace(/\.$/, '') + '.'
  const breaks = Array.isArray(qd.page_breaks) ? new Set(qd.page_breaks) : null
  const t = qd.title
  const tq = evalNum(t.qty)
  return (
    <div className="qp-page" data-testid="quote-preview">
      <div className="qp-head">
        <div className="qp-title">QUOTATION</div>
        <table className="qp-meta">
          <tbody>
            <tr><th>Quotation no.</th><td>{qd.quotation_no}</td><th>Job no.</th><td>{qd.job_no}</td></tr>
            <tr><th>Customer</th><td>{qd.customer_name}</td><th>Enquiry date</th><td>{qd.enquiry_date}</td></tr>
            <tr><th>Contact person</th><td>{qd.contact_person}</td><th>Quotation date</th><td>{qd.quotation_date}</td></tr>
            <tr><th>Tel / Fax</th><td>{qd.tel || '-'} / {qd.fax || '-'}</td><th>Validity until</th><td>{qd.validity_date}</td></tr>
            <tr><th>E-mail</th><td>{qd.email || '-'}</td><th>Payment term</th><td>{qd.payment_term || '-'}</td></tr>
            <tr><th>Product subject</th><td>{qd.product_subject}</td><th>Delivery time</th><td>{qd.delivery_time ?? ''} {qd.delivery_unit}</td></tr>
            <tr><th>Drawing no.</th><td>{qd.drawing_no || '-'}</td><th>Currency</th><td>{qd.currency_label}</td></tr>
          </tbody>
        </table>
      </div>
      <table className="qp-body">
        <thead>
          <tr><th className="qp-no">Item</th><th>Description</th><th className="r">Unit Price ({cur})</th><th className="r">Qty</th><th>Unit</th><th className="r">Total Price ({cur})</th></tr>
        </thead>
        <tbody>
          <tr className={`qp-row title${selected === -1 ? ' sel' : ''}`} onClick={() => onSelect?.(-1)}>
            <td />
            <td><RunsView runs={t.runs} base={{ bold: true }} /></td>
            <td className="r red">{fmt(result.totals.header_price)}</td>
            <td className="r">{tq ?? ''}</td>
            <td>{t.unit}</td>
            <td className="r red">{fmt(result.totals.header_price * (tq ?? 1))}</td>
          </tr>
          {qd.rows.map((r: QuoteRow, i) => {
            const bodyIdx = i + 1
            const it = r.kind === 'item' && r.item_no != null ? items.get(r.item_no) : undefined
            return (
              <FragmentRow key={i}>
                <tr
                  className={`qp-row ${r.kind}${r.indent ? ' indent' : ''}${selected === i ? ' sel' : ''}`}
                  style={r.height ? { height: `${Math.round(r.height * 1.25)}px` } : undefined}
                  onClick={() => onSelect?.(i)}
                >
                  <td className="qp-no">{r.kind === 'item' ? r.item_no : ''}</td>
                  <td className="qp-desc"><RunsView runs={r.runs} />{r.kind === 'blank' && ' '}</td>
                  <td className="r">{it ? fmt(it.unit_price) : ''}</td>
                  <td className="r">{it ? it.qty : ''}</td>
                  <td>{it ? it.unit : ''}</td>
                  <td className="r">{it ? fmt(it.total) : ''}</td>
                </tr>
                {breaks?.has(bodyIdx) && <tr className="qp-break"><td colSpan={6}>— page break —</td></tr>}
              </FragmentRow>
            )
          })}
        </tbody>
        <tfoot>
          <tr><td colSpan={5} className="r">Total Price ({cur})</td><td className="r">{fmt(result.totals.total)}</td></tr>
          <tr><td colSpan={5} className="r">Discount ({fmt(result.totals.discount_pct * 100, 0)}%)</td><td className="r">{fmt(result.totals.discount)}</td></tr>
          <tr className="net"><td colSpan={5} className="r">Net Total Price ({cur})</td><td className="r">{fmt(result.totals.net)}</td></tr>
        </tfoot>
      </table>
      <div className="qp-sign">
        <div><span>Prepared by</span><b>{qd.prepared_by}</b></div>
        <div><span>Reviewed by</span><b>{qd.reviewed_by}</b></div>
        <div><span>Approved by</span><b>{qd.approved_by}</b></div>
      </div>
      <div className="qp-note">Preview approximates the PDF layout. Use “Preview &amp; export” for the exact rendered document.</div>
    </div>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export const rowText = (r: { runs: Run[] }) => r.runs.map((x) => x.text).join('')
