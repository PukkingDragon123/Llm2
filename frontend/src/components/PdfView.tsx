import { lazy, Suspense, useEffect, useState } from 'react'
import { Spinner } from './ui'

const PdfPages = lazy(() => import('./PdfPages'))

/** Fetches a PDF (showing server errors properly) and displays it in the browser's viewer or as pdf.js page images. */
export function PdfView({ url, title }: { url: string; title: string }) {
  const [buf, setBuf] = useState<ArrayBuffer | null>(null)
  const [blobUrl, setBlobUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [mode, setMode] = useState<'browser' | 'pages'>('browser')
  useEffect(() => {
    let alive = true
    let obj: string | null = null
    setBuf(null)
    setBlobUrl(null)
    setErr(null)
    fetch(url)
      .then(async (r) => {
        if (!r.ok) {
          const t = await r.text()
          let msg = t
          try { msg = (JSON.parse(t) as { detail?: string }).detail || t } catch { /* plain text */ }
          throw new Error(`${r.status}: ${msg}`)
        }
        return r.arrayBuffer()
      })
      .then((b) => {
        if (!alive) return
        obj = URL.createObjectURL(new Blob([b], { type: 'application/pdf' }))
        setBuf(b)
        setBlobUrl(obj)
      })
      .catch((e: Error) => alive && setErr(e.message))
    return () => {
      alive = false
      if (obj) URL.revokeObjectURL(obj)
    }
  }, [url])
  return (
    <div className="pdfview">
      <div className="pdfview-bar">
        <div className="subtabs inline">
          <button className={mode === 'browser' ? 'on' : ''} onClick={() => setMode('browser')}>Browser viewer</button>
          <button className={mode === 'pages' ? 'on' : ''} onClick={() => setMode('pages')} data-testid="pdf-pages-mode">Rendered pages</button>
        </div>
      </div>
      <div className="pdf-frame">
        {!buf && !err && <div className="pdf-loading"><Spinner label="Generating the document with LibreOffice… this takes a few seconds" /></div>}
        {err && <div className="alert err" style={{ margin: 12 }}>Could not generate the document: {err}</div>}
        {blobUrl && mode === 'browser' && <iframe title={title} src={blobUrl} data-testid="preview-iframe" />}
        {buf && mode === 'pages' && (
          <div className="pdf-scroll"><Suspense fallback={<Spinner label="Loading viewer…" />}><PdfPages data={buf} /></Suspense></div>
        )}
      </div>
    </div>
  )
}
