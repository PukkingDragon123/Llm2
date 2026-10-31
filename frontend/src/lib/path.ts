/** Immutable helpers for editing nested JSON by path. */
export type Path = (string | number)[]

export function getIn(obj: unknown, path: Path): unknown {
  let cur: unknown = obj
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[k]
  }
  return cur
}

/** Move an array item (returns same array when out of range). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (to < 0 || to >= arr.length || from === to) return arr
  const a = arr.slice()
  const [x] = a.splice(from, 1)
  a.splice(to, 0, x)
  return a
}

/** Map a dotted issue path to the workspace tab that edits it. */
export function tabForPath(path: string): string {
  const head = path.split('.')[0]
  switch (head) {
    case 'parts':
    case 'part':
      return 'bom'
    case 'price_sheets':
    case 'ps':
      return 'prices'
    case 'labor_params':
    case 'labor_rates':
    case 'crews':
    case 'crew':
    case 'rate':
    case 'lab':
      return 'labor'
    case 'machines':
    case 'machine_params':
    case 'mach':
      return 'machines'
    case 'services':
    case 'svc':
      return 'services'
    case 'settings':
    case 'buckets':
    case 'set':
      return 'pricing'
    case 'quote_doc':
      return 'quotation'
    default:
      return 'overview'
  }
}

/** View a typed object as a string-keyed record (for generic cell editing). */
export const R = (o: object) => o as Record<string, unknown>
