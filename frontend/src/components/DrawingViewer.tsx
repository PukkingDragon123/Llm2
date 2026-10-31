import { useCallback, useEffect, useRef, useState } from 'react'
import type { Drawing } from '../api/types'
import { Spinner } from './ui'

export interface Highlight { page: number; bbox: number[]; n: number; label?: string }
const LW = 2400 // logical layer width; the image is rendered at this width (or 2x for "sharp")

interface View { s: number; x: number; y: number }

export function DrawingViewer({ drawing, page, onPage, hl }: { drawing: Drawing; page: number; onPage: (p: number) => void; hl: Highlight | null }) {
  const ps = drawing.page_sizes[page - 1] || [1, 1.414]
  const LH = (LW * ps[1]) / ps[0]
  const cont = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ s: 0.3, x: 0, y: 0 })
  const [sharp, setSharp] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const viewRef = useRef(view)
  useEffect(() => { viewRef.current = view }, [view])
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null)
  const fitKey = useRef('')
  const jumped = useRef(-1)
  const src = `/api/drawings/${drawing.id}/page/${page}.png?w=${sharp ? 4800 : 2400}`

  useEffect(() => { setLoaded(false) }, [src])

  useEffect(() => {
    const el = cont.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const minS = size.w ? Math.min(size.w / LW, size.h / LH) * 0.5 : 0.05
  const clampS = useCallback((s: number) => Math.max(minS, Math.min(s, 3)), [minS])

  const fitWidth = useCallback(() => {
    const s = (size.w - 16) / LW
    setView({ s, x: 8, y: 8 })
  }, [size.w])
  const fitPage = useCallback(() => {
    const s = Math.min((size.w - 16) / LW, (size.h - 16) / LH)
    setView({ s, x: (size.w - LW * s) / 2, y: (size.h - LH * s) / 2 })
  }, [size.w, size.h, LH])
  const zoomAt = useCallback((px: number, py: number, factor: number) => {
    const v = viewRef.current
    const s = clampS(v.s * factor)
    setView({ s, x: px - (px - v.x) * (s / v.s), y: py - (py - v.y) * (s / v.s) })
  }, [clampS])
  const jump = useCallback((h: Highlight) => {
    const [x0, y0, x1, y1] = h.bbox
    const bw = Math.max(0.005, x1 - x0) * LW
    const bh = Math.max(0.005, y1 - y0) * LH
    const fit = (size.w - 16) / LW
    const s = Math.max(fit, Math.min(3, Math.min((size.w * 0.45) / bw, (size.h * 0.45) / bh)))
    const cx = ((x0 + x1) / 2) * LW
    const cy = ((y0 + y1) / 2) * LH
    setView({ s, x: size.w / 2 - cx * s, y: size.h / 2 - cy * s })
  }, [size.w, size.h, LH])

  // fit on page change; jump to a highlight when one is requested
  useEffect(() => {
    if (!size.w) return
    const key = `${drawing.id}:${page}`
    if (hl && hl.page === page && jumped.current !== hl.n) {
      jump(hl)
      jumped.current = hl.n
      fitKey.current = key
      return
    }
    if (fitKey.current !== key) {
      fitWidth()
      fitKey.current = key
    }
  }, [hl, page, size.w, drawing.id, jump, fitWidth])

  // wheel zoom (non-passive so the page does not scroll)
  useEffect(() => {
    const el = cont.current
    if (!el) return
    const h = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.15 : 1 / 1.15)
    }
    el.addEventListener('wheel', h, { passive: false })
    return () => el.removeEventListener('wheel', h)
  }, [zoomAt])

  return (
    <div className="viewer-wrap">
      <div className="viewer-bar">
        <button className="btn sm" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1} aria-label="Previous page">◀</button>
        <select className="inp" value={page} onChange={(e) => onPage(Number(e.target.value))} aria-label="Page" data-testid="page-select">
          {Array.from({ length: drawing.pages }, (_, i) => <option key={i} value={i + 1}>Page {i + 1} / {drawing.pages}</option>)}
        </select>
        <button className="btn sm" onClick={() => onPage(Math.min(drawing.pages, page + 1))} disabled={page >= drawing.pages} aria-label="Next page">▶</button>
        <span className="sep" />
        <button className="btn sm" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.3)} aria-label="Zoom out" data-testid="zoom-out">−</button>
        <span className="zoom-val num" data-testid="zoom-val">{Math.round(view.s * 100)}%</span>
        <button className="btn sm" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.3)} aria-label="Zoom in" data-testid="zoom-in">+</button>
        <button className="btn sm" onClick={fitWidth} data-testid="fit-width">Fit width</button>
        <button className="btn sm" onClick={fitPage}>Fit page</button>
        <label className="chk small" title="Render at 4800 px for fine detail"><input type="checkbox" checked={sharp} onChange={(e) => setSharp(e.target.checked)} /> sharp</label>
        <span className="grow" />
        {hl && hl.page === page && <span className="hl-label">▭ {hl.label}</span>}
      </div>
      <div
        ref={cont}
        className={`viewer${dragging ? ' dragging' : ''}`}
        data-testid="drawing-viewer"
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y }; setDragging(true) }}
        onPointerMove={(e) => { const d = drag.current; if (d) setView((v) => ({ ...v, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py })) }}
        onPointerUp={() => { drag.current = null; setDragging(false) }}
        onPointerCancel={() => { drag.current = null; setDragging(false) }}
        onDoubleClick={(e) => { const r = cont.current!.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, 1.6) }}
      >
        <div className="viewer-layer" style={{ width: LW, height: LH, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          <img key={src} src={src} alt={`${drawing.filename} page ${page}`} draggable={false} onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} data-testid="drawing-img" style={{ width: LW, height: LH }} />
          {hl && hl.page === page && (
            <div
              className="hl-box"
              data-testid="hl-box"
              style={{ left: `${hl.bbox[0] * 100}%`, top: `${hl.bbox[1] * 100}%`, width: `${(hl.bbox[2] - hl.bbox[0]) * 100}%`, height: `${(hl.bbox[3] - hl.bbox[1]) * 100}%`, borderWidth: Math.max(2, 3 / view.s) }}
            />
          )}
        </div>
        {!loaded && <div className="viewer-loading"><Spinner label="Rendering page…" /></div>}
      </div>
    </div>
  )
}
