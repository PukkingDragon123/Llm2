import { useState } from 'react'
import { PdfView } from '../components/PdfView'
import { Card } from '../components/ui'
import { useEditor } from '../editor'

const DOCS = [
  { id: 'quotation.pdf', label: 'Quotation (PDF)' },
  { id: 'costing.pdf', label: 'Internal costing report (PDF)' },
]
const DOWNLOADS = [
  { id: 'quotation.xlsx', label: 'quotation.xlsx', hint: 'customer quotation workbook' },
  { id: 'quotation.pdf', label: 'quotation.pdf', hint: 'customer quotation PDF' },
  { id: 'costing.xlsx', label: 'costing.xlsx', hint: 'editable live-formula costing workbook' },
  { id: 'costing.pdf', label: 'costing.pdf', hint: 'internal costing report (confidential)' },
]

export function PreviewTab() {
  const { id, dirty, save, saving } = useEditor()
  const [doc, setDoc] = useState('quotation.pdf')
  const [nonce, setNonce] = useState(() => Date.now())
  const src = `/api/projects/${id}/export/${doc}?inline=true&t=${nonce}`
  const refresh = () => setNonce(Date.now())
  return (
    <div className="stack">
      {dirty && (
        <div className="alert warn slim">
          The preview and exports are generated from the <strong>saved</strong> project. You have unsaved changes.{' '}
          <button className="btn sm primary" disabled={saving} onClick={async () => { if (await save()) refresh() }}>Save & refresh preview</button>
        </div>
      )}
      <Card
        title="Document preview"
        actions={
          <>
            <select className="inp" value={doc} onChange={(e) => setDoc(e.target.value)} aria-label="Document">
              {DOCS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <button className="btn" onClick={refresh} data-testid="preview-refresh">Refresh</button>
            <a className="btn" href={src} target="_blank" rel="noreferrer">Open in new tab</a>
          </>
        }
        flush
      >
        <PdfView key={src} url={src} title="Document preview" />
      </Card>
      <Card title="Downloads">
        <div className="dl-grid">
          {DOWNLOADS.map((d) => (
            <a key={d.id} className="dl-card" href={`/api/projects/${id}/export/${d.id}`} download data-testid={`download-${d.id}`}>
              <strong>{d.label}</strong>
              <span className="muted small">{d.hint}</span>
            </a>
          ))}
        </div>
        <p className="muted small">Generation runs the full export pipeline (a few seconds per file).</p>
      </Card>
    </div>
  )
}
