import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { Calc, ChkIn, NumIn, SelIn, TextIn } from './fields'
import type { Option } from './fields'

export interface Col<T> {
  key: string
  label: ReactNode
  w?: number | string
  kind?: 'text' | 'num' | 'sel' | 'chk' | 'calc' | 'node'
  opts?: Option[] | ((row: T, i: number) => Option[])
  calc?: (row: T, i: number) => { k?: string; v: number | null | undefined; dp?: number; pct?: boolean; unit?: string; strong?: boolean }
  node?: (row: T, i: number) => ReactNode
  disabled?: (row: T, i: number) => boolean
  placeholder?: string | ((row: T, i: number) => string)
  pct?: boolean
  title?: string
  /** override the data-path leaf (defaults to key) */
  noPath?: boolean
}

interface Props<T> {
  path: string
  rows: T[]
  cols: Col<T>[]
  onCell?: (i: number, key: string, value: unknown) => void
  onAdd?: () => void
  addLabel?: string
  onDelete?: (i: number) => void
  onDuplicate?: (i: number) => void
  onMove?: (i: number, dir: -1 | 1) => void
  expanded?: Set<number>
  renderExpanded?: (row: T, i: number) => ReactNode
  footer?: ReactNode
  empty?: string
  maxHeight?: number | string
  rowClass?: (row: T, i: number) => string
  numbered?: boolean
  toolbar?: ReactNode
}

export function DataTable<T extends object>({ path, rows, cols, onCell, onAdd, addLabel = 'Add row', onDelete, onDuplicate, onMove, expanded, renderExpanded, footer, empty, maxHeight, rowClass, numbered = true, toolbar }: Props<T>) {
  const hasActions = !!(onDelete || onDuplicate || onMove)
  const ncols = cols.length + (numbered ? 1 : 0) + (hasActions ? 1 : 0)
  return (
    <div className="dt-wrap">
      <div className="dt-scroll" style={maxHeight ? { maxHeight } : undefined}>
        <table className="dt">
          <thead>
            <tr>
              {numbered && <th className="idx">#</th>}
              {cols.map((c) => (
                <th key={c.key} style={c.w ? { minWidth: c.w } : undefined} className={c.kind === 'num' || c.kind === 'calc' ? 'r' : ''} title={c.title}>
                  {c.label}
                </th>
              ))}
              {hasActions && <th className="act" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={ncols} className="empty-cell">
                  {empty || 'No rows'}
                </td>
              </tr>
            )}
            {rows.map((row, i) => {
              const rec = row as Record<string, unknown>
              return (
                <Fragment key={i}>
                  <tr data-row={`${path}.${i}`} className={rowClass?.(row, i)}>
                    {numbered && <td className="idx">{i + 1}</td>}
                    {cols.map((c) => {
                      const p = c.noPath ? undefined : `${path}.${i}.${c.key}`
                      const dis = c.disabled?.(row, i)
                      const ph = typeof c.placeholder === 'function' ? c.placeholder(row, i) : c.placeholder
                      let cell: ReactNode
                      switch (c.kind || 'text') {
                        case 'num':
                          cell = <NumIn path={p} value={rec[c.key] as never} disabled={dis} placeholder={ph} pct={c.pct} onChange={(v) => onCell?.(i, c.key, v)} />
                          break
                        case 'sel':
                          cell = <SelIn path={p} value={rec[c.key] as string} disabled={dis} options={typeof c.opts === 'function' ? c.opts(row, i) : c.opts || []} onChange={(v) => onCell?.(i, c.key, v)} />
                          break
                        case 'chk':
                          cell = <ChkIn path={p} value={rec[c.key] as boolean} disabled={dis} onChange={(v) => onCell?.(i, c.key, v)} />
                          break
                        case 'calc': {
                          const r = c.calc!(row, i)
                          cell = <Calc k={r.k} v={r.v} dp={r.dp} pct={r.pct} unit={r.unit} strong={r.strong} />
                          break
                        }
                        case 'node':
                          cell = c.node!(row, i)
                          break
                        default:
                          cell = <TextIn path={p} value={rec[c.key] as string} disabled={dis} placeholder={ph} onChange={(v) => onCell?.(i, c.key, v)} />
                      }
                      return (
                        <td key={c.key} className={c.kind === 'calc' || c.kind === 'num' ? 'r' : ''}>
                          {cell}
                        </td>
                      )
                    })}
                    {hasActions && (
                      <td className="act">
                        <span className="row-actions">
                          {onMove && (
                            <>
                              <button className="icon-btn" title="Move up" onClick={() => onMove(i, -1)} disabled={i === 0}>
                                ↑
                              </button>
                              <button className="icon-btn" title="Move down" onClick={() => onMove(i, 1)} disabled={i === rows.length - 1}>
                                ↓
                              </button>
                            </>
                          )}
                          {onDuplicate && (
                            <button className="icon-btn" title="Duplicate row" onClick={() => onDuplicate(i)}>
                              ⧉
                            </button>
                          )}
                          {onDelete && (
                            <button className="icon-btn danger" title="Delete row" onClick={() => onDelete(i)}>
                              ✕
                            </button>
                          )}
                        </span>
                      </td>
                    )}
                  </tr>
                  {expanded?.has(i) && renderExpanded && (
                    <tr className="expanded-row">
                      <td colSpan={ncols}>{renderExpanded(row, i)}</td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          {footer && <tfoot>{footer}</tfoot>}
        </table>
      </div>
      {(onAdd || toolbar) && (
        <div className="dt-foot">
          {onAdd && (
            <button className="btn sm" onClick={onAdd}>
              + {addLabel}
            </button>
          )}
          {toolbar}
        </div>
      )}
    </div>
  )
}
