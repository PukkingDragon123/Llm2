import { useEffect, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc

/** Renders every page of a PDF to canvases (pdf.js), fitted to the container width. */
export default function PdfPages({ data }: { data: ArrayBuffer }) {
  const host = useRef<HTMLDivElement>(null)
  const [err, setErr] = useState('')
  const [n, setN] = useState(0)
  useEffect(() => {
    let cancelled = false
    const el = host.current
    if (!el) return
    el.innerHTML = ''
    const task = pdfjs.getDocument({ data: data.slice(0) })
    task.promise
      .then(async (doc) => {
        setN(doc.numPages)
        const width = Math.max(300, el.clientWidth - 24)
        for (let i = 1; i <= doc.numPages; i++) {
          if (cancelled) return
          const page = await doc.getPage(i)
          const base = page.getViewport({ scale: 1 })
          const scale = (width / base.width) * (window.devicePixelRatio || 1)
          const vp = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(vp.width)
          canvas.height = Math.floor(vp.height)
          canvas.style.width = `${width}px`
          canvas.style.height = `${(vp.height / vp.width) * width}px`
          canvas.className = 'pdf-page'
          canvas.setAttribute('data-page', String(i))
          el.appendChild(canvas)
          await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
        }
      })
      .catch((e: Error) => !cancelled && setErr(e.message))
    return () => {
      cancelled = true
      void task.destroy()
    }
  }, [data])
  return (
    <div className="pdf-pages" data-testid="pdf-pages" data-pages={n}>
      {err && <div className="alert err">Could not render PDF: {err}</div>}
      <div ref={host} />
    </div>
  )
}
