import { Link } from 'react-router-dom'
import { Calc, TextIn } from '../components/fields'
import { Badge, Card, Field } from '../components/ui'
import { useEditor } from '../editor'
import { fmt, fmtPct } from '../lib/format'

export function OverviewTab() {
  const { result: r, fields, setField, tabPath, est } = useEditor()
  const cur = r.totals.currency
  const ces = r.ces
  return (
    <div className="stack">
      <Card title="Project">
        <div className="form-grid cols4">
          <Field label="Customer" wide><TextIn path="project.customer_name" value={fields.customer_name} onChange={(v) => setField('customer_name', v)} /></Field>
          <Field label="Job no."><TextIn path="project.job_no" value={fields.job_no} onChange={(v) => setField('job_no', v)} /></Field>
          <Field label="Quotation no."><TextIn path="project.quotation_no" value={fields.quotation_no} onChange={(v) => setField('quotation_no', v)} /></Field>
          <Field label="Product subject" wide><TextIn path="project.product_subject" value={fields.product_subject} onChange={(v) => setField('product_subject', v)} /></Field>
          <Field label="Drawing no."><TextIn path="project.drawing_no" value={fields.drawing_no} onChange={(v) => setField('drawing_no', v)} /></Field>
          <Field label="Job class"><TextIn path="project.job_class" list="job-classes" value={fields.job_class} onChange={(v) => setField('job_class', v)} /><datalist id="job-classes"><option value="CUSTOM MADE" /><option value="STANDARD" /><option value="REPAIR" /></datalist></Field>
        </div>
      </Card>

      <Card title={`Quote items (${cur})`} actions={<Link className="link" to={tabPath('pricing')}>Edit items & pricing →</Link>} flush>
        <table className="dt" data-testid="items-table">
          <thead>
            <tr><th className="idx">Item</th><th>Heading</th><th className="r">Cost base</th><th className="r">Unit price</th><th className="r">Qty</th><th>Unit</th><th className="r">Total</th><th className="r">Margin</th></tr>
          </thead>
          <tbody>
            {r.items.map((it) => (
              <tr key={it.no} data-row={`item.${it.no}`}>
                <td className="idx">{it.no}</td>
                <td>{it.heading} {it.overridden && <Badge tone="amber" title="Manual price override">override</Badge>} {!it.markup && <Badge title="No OVH/Risk/margin markup">no markup</Badge>}</td>
                <td className="r"><Calc k={`item.${it.no}.base`} v={it.base} /></td>
                <td className="r"><Calc k={`item.${it.no}.price`} v={it.unit_price} strong /></td>
                <td className="r"><Calc k={`item.${it.no}.qty`} v={it.qty} dp={0} /></td>
                <td>{it.unit}</td>
                <td className="r"><Calc k={`item.${it.no}.total`} v={it.total} strong /></td>
                <td className="r"><Calc v={it.margin} pct /></td>
              </tr>
            ))}
            {r.items.length === 0 && <tr><td colSpan={8} className="empty-cell">No quote items defined.</td></tr>}
          </tbody>
          <tfoot>
            <tr className="tot"><td colSpan={6} className="r">Total price</td><td className="r"><Calc k="totals.total" v={r.totals.total} strong /></td><td /></tr>
            <tr className="tot"><td colSpan={6} className="r">Discount ({fmtPct(r.totals.discount_pct, 1)})</td><td className="r"><Calc k="totals.discount" v={r.totals.discount} /></td><td /></tr>
            <tr className="tot grand"><td colSpan={6} className="r">Net total price</td><td className="r"><Calc k="totals.net" v={r.totals.net} strong /></td><td /></tr>
            <tr className="tot"><td colSpan={6} className="r">Product line (header) price per set <span className="muted small">[{String(est.settings.header_price_mode)}]</span></td><td className="r"><Calc k="header.price" v={r.totals.header_price} strong /></td><td /></tr>
          </tfoot>
        </table>
      </Card>

      <div className="two-col">
        <Card title={`Cost estimate sheet — CES (${cur})`}>
          <table className="kv" data-testid="ces-table">
            <tbody>
              <tr><th>Material (DM)</th><td><Calc k="ces.dm" v={ces.dm} /></td></tr>
              <tr><th>Labor (DL1: services + crews)</th><td><Calc k="ces.dl1" v={ces.dl1} /></td></tr>
              <tr><th>Machine (DL2)</th><td><Calc k="ces.dl2" v={ces.dl2} /></td></tr>
              <tr className="sub"><th>Direct cost</th><td><Calc k="ces.direct" v={ces.direct} strong /></td></tr>
              <tr><th>Overhead (OVH)</th><td><Calc k="ces.ovh" v={ces.ovh} /></td></tr>
              <tr><th>Risk</th><td><Calc k="ces.risk" v={ces.risk} /></td></tr>
              <tr className="sub"><th>Full cost</th><td><Calc k="ces.full" v={ces.full} strong /></td></tr>
              <tr><th>CES price</th><td><Calc k="ces.price" v={ces.price} strong /></td></tr>
              <tr className="sub"><th>CES net (after {fmtPct(ces.discount_pct, 1)} discount)</th><td><Calc k="ces.net" v={ces.net} strong /></td></tr>
              <tr><th>Gross margin on net (vs direct cost)</th><td><Calc v={ces.gross_margin_on_net} pct /></td></tr>
            </tbody>
          </table>
        </Card>
        <div className="stack">
          <Card title="Weights">
            <table className="kv">
              <tbody>
                <tr><th>Material price sheets (titanium etc.)</th><td><Calc v={r.weights.price_sheet_kg} unit="kg" /></td></tr>
                <tr><th>BOM parts (calculated from dimensions)</th><td><Calc v={r.weights.parts_kg} unit="kg" /></td></tr>
              </tbody>
            </table>
          </Card>
          <Card title="Cost categories (THB)">
            <table className="kv">
              <tbody>
                <tr><th>Crew labor</th><td><Calc k="crews.total" v={r.summary_thb.crews} /></td></tr>
                <tr><th>Services / outsource / NDT</th><td><Calc k="svc.total" v={r.summary_thb.services} /></td></tr>
                <tr><th>Machine processes</th><td><Calc k="parts.machine" v={r.summary_thb.machines} /></td></tr>
                <tr><th>Parts material (by weight)</th><td><Calc k="parts.material" v={r.summary_thb.parts_material} /></td></tr>
                <tr><th>FX: THB per USD (conversion TU / UT)</th><td><Calc k="set.TU" v={r.TU} dp={4} /> <span className="muted">/</span> <Calc k="set.UT" v={r.UT} dp={4} /></td></tr>
              </tbody>
            </table>
            <p className="muted small">Weights and totals in THB unless noted. Click any <span className="fx">ƒ</span> number to see how it is calculated ({fmt(r.items.length, 0)} quote items).</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
