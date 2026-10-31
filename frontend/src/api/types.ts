// TypeScript shapes of the Prolog Titanium Estimator API.

/** A numeric input that may hold an arithmetic expression (e.g. "45000+42000"); null = blank/missing. */
export type Num = number | string | null

export type Severity = 'missing' | 'error' | 'warning' | 'info'
export interface Issue {
  severity: Severity
  path: string
  message: string
  question: string
}

// ------------------------------------------------------------------ estimate (input data model)
export interface Settings {
  quote_currency: string
  fx_thb_per_usd: Num
  fx_date?: string
  thb_to_usd_factor: Num
  usd_to_thb_factor: Num
  ovh_pct: Num
  risk_pct: Num
  margin_divisor: Num
  item_round_digits: number | string
  ces_round_digits: number | string
  ces_discount_pct: Num
  quote_discount_pct: Num
  set_qty: Num
  header_price_mode: 'ces' | 'sum_items' | 'manual'
  header_price_manual?: Num
  job_class?: string
  [k: string]: unknown
}
export interface LaborParams { salary_adj: Num; days_per_month: Num; hours_per_day: Num }
export interface LaborRate {
  id: string
  position: string
  site?: string
  salary?: Num
  hourly_rate?: Num
  note?: string
  optional?: boolean
}
export interface CrewMember { role: string; rate_id: string; persons: Num }
export interface CrewExtra { name: string; amount: Num; basis: 'fixed' | 'per_person'; persons_per_unit?: Num }
export interface Crew {
  id: string
  name: string
  days: Num
  per_diem: Num
  ot15_hours?: Num
  ot3_hours?: Num
  confined_pct?: Num
  members: CrewMember[]
  extras_per_day: CrewExtra[]
}
export interface MachineParams {
  hours_per_year: Num
  dep_years: Num
  electricity_rate: Num
  operator_rate_id?: string | null
  operator_rate?: Num
}
export interface Machine {
  name: string
  description?: string
  price?: Num
  kwh?: Num
  consumable_ratio?: Num
  rate_override?: Num
  workbook_rate?: number | null
}
export interface Material {
  code: string
  name: string
  thb_per_kg?: Num
  density?: Num
  shape?: string
  size_labels?: string[]
}
export interface PartProcess { machine: string; hours: Num }
export interface Part {
  id: string
  group?: string
  name: string
  grade_code?: string
  grade?: string
  material_spec?: string | null
  shape?: string
  s1?: Num
  s2?: Num
  s3?: Num
  qty: Num
  pricing?: 'price_sheet' | 'by_weight'
  unit_price_thb_kg?: Num
  discount_pct?: Num
  processes?: PartProcess[]
  machine_multiplier?: Num
  remark?: string
  source?: string
  [k: string]: unknown
}
export interface Service {
  id?: string
  group?: string
  name: string
  amount?: Num
  rate?: Num
  qty?: Num
  minimum?: Num
  currency?: string
  unit?: string
  source?: string
  optional?: boolean
}
export interface FreightLine { label: string; amount: Num; currency?: string; optional?: boolean }
export interface PriceLine {
  id?: string
  group?: string
  material?: string
  description?: string
  qty: Num
  unit_price: Num
  unit_weight?: Num
  price_source?: string
  supplier_price_id?: number | null
}
export interface PriceSheet {
  id: string
  name: string
  currency: string
  round_digits: number | string
  tax_pct?: Num
  margin_divisor?: Num
  exchange?: Num
  freight: FreightLine[]
  lines: PriceLine[]
  bucket?: unknown
  workbook_total?: number
}
export interface BucketSource {
  type: 'price_sheet' | 'services' | 'crews' | 'machines' | 'parts_material' | 'fixed'
  id?: string
  label?: string
  amount?: Num
  currency?: string
}
export interface Adjustment { label: string; pct: Num; reason?: string; source?: string }
export interface Bucket {
  no: number
  heading: string
  unit: string
  qty: Num
  markup: boolean
  sources: BucketSource[]
  override_price?: Num
  override_reason?: string
  adjustments?: Adjustment[]
}
export interface Estimate {
  settings: Settings
  labor_params: LaborParams
  labor_rates: LaborRate[]
  crews: Crew[]
  machine_params: MachineParams
  machines: Machine[]
  materials: Material[]
  parts: Part[]
  services: Service[]
  price_sheets: PriceSheet[]
  buckets: Bucket[]
}

// ------------------------------------------------------------------ quotation document
export interface Run { text: string; bold?: boolean; italic?: boolean; underline?: boolean; color?: string | null }
export type RowKind = 'item' | 'line' | 'bullet' | 'blank' | 'highlight_head' | 'highlight_line' | 'section_head' | 'text'
export interface QuoteRow { kind: RowKind; item_no?: number | null; runs: Run[]; height?: number | null; indent?: boolean }
export interface QuoteDoc {
  quotation_no: string
  job_no: string
  customer_name: string
  contact_person?: string
  tel?: string
  fax?: string
  email?: string
  product_subject: string
  drawing_no?: string
  enquiry_date?: string
  quotation_date?: string
  validity_date?: string
  payment_term?: string
  delivery_time?: number | string | null
  delivery_unit?: string
  currency_label?: string
  title: { runs: Run[]; qty: Num; unit: string }
  rows: QuoteRow[]
  page_breaks: 'auto' | number[]
  prepared_by?: string
  reviewed_by?: string
  approved_by?: string
  include_disclaimers?: boolean
  [k: string]: unknown
}

// ------------------------------------------------------------------ calculation result
export interface TraceNodeFlat {
  key: string
  label: string
  value: number | null
  unit: string
  formula: string
  expr: string
  inputs: string[]
  kind: string
  source: string
  missing: boolean
}
export interface ResultItem {
  no: number
  heading: string
  unit: string
  qty: number
  base: number
  calc_price: number
  unit_price: number
  total: number
  markup: boolean
  overridden: boolean
  margin: number | null
}
export interface ResultSheetLine extends PriceLine {
  qty_v: number
  unit_price_v: number
  cost: number
  allocated: number
  selling_unit: number
  amount: number
  unit_weight_v: number | null
  weight_total: number
}
export interface ResultSheet extends Omit<PriceSheet, 'lines'> {
  lines: ResultSheetLine[]
  material_cost: number
  freight_total: number
  grand: number
  total: number
}
export interface ResultPart extends Part {
  weight: number | null
  total_weight: number
  material_cost_thb: number
  machine_cost_thb: number
}
export interface ResultCrewMember extends CrewMember { rate: number; day_rate: number; cost_per_day: number }
export interface ResultCrew extends Omit<Crew, 'members'> {
  members: ResultCrewMember[]
  per_day: number
  total_thb: number
  persons: number
}
export interface CalcResult {
  nodes: Record<string, TraceNodeFlat>
  issues: Issue[]
  settings: Settings
  TU: number
  UT: number
  labor_rates: (LaborRate & { rate: number })[]
  crews: ResultCrew[]
  machines: (Machine & { rate: number })[]
  parts: ResultPart[]
  services: (Service & { amount: number; amount_thb: number })[]
  price_sheets: ResultSheet[]
  items: ResultItem[]
  totals: { total: number; discount_pct: number; discount: number; net: number; header_price: number; currency: string }
  ces: {
    dm: number; dl1: number; dl2: number; direct: number; ovh: number; risk: number; full: number
    price: number; discount_pct: number; net: number; gross_margin_on_net: number | null
  }
  summary_thb: { crews: number; services: number; machines: number; parts_material: number }
  weights: { price_sheet_kg: number; parts_kg: number }
  missing_count: number
  categories_thb?: Record<string, number>
}

export interface TraceNode {
  key: string
  label: string
  value: number | null
  unit?: string
  formula?: string
  expr?: string
  kind?: string
  source?: string
  missing?: boolean
  children: TraceNode[]
}

// ------------------------------------------------------------------ projects
export interface ProjectSummary {
  id: number
  job_no: string
  quotation_no: string
  customer_name: string
  product_subject: string
  drawing_no: string
  status: string
  job_class: string
  meta: Record<string, unknown>
  summary: {
    totals?: CalcResult['totals']
    missing_count?: number
    issue_count?: number
    items?: { no: number; heading: string; total: number }[]
  } | null
  created_at: string
  updated_at: string
  has_actuals: boolean
}
export interface RevisionFiles {
  quotation_xlsx: string
  quotation_pdf: string
  costing_xlsx: string
  costing_pdf: string
}
export interface RevisionRow {
  id: number
  rev_no: number
  quotation_no: string
  note: string
  created_at: string
  totals: CalcResult['totals'] | null
  files: RevisionFiles
}
export interface ActualsRecord {
  categories?: Record<string, { estimate: number | null; actual: number }>
  note?: string
  recorded_at?: string
}
export interface ProjectFull extends ProjectSummary {
  estimate: Estimate
  quote_doc: QuoteDoc
  actuals: ActualsRecord | null
  revisions: RevisionRow[]
  drawings: Drawing[]
  result: CalcResult
}

// ------------------------------------------------------------------ drawings
export interface Loc { page: number; bbox: number[] }
export interface ExtField { key: string; value: string; unit?: string | null; confidence: number; location?: Loc | null }
export interface ExtPart {
  mark?: string | null
  name: string
  category: string
  material_spec?: string | null
  form: string
  thk_mm?: number | null
  width_mm?: number | null
  length_mm?: number | null
  od_mm?: number | null
  id_mm?: number | null
  nominal_size?: string | null
  rating?: string | null
  qty?: number | null
  unit_weight_kg?: number | null
  notes?: string | null
  confidence: number
  unclear_fields: string[]
  location?: Loc | null
}
export interface ExtNozzle {
  mark: string
  service?: string | null
  size?: string | null
  schedule_or_thk?: string | null
  flange_rating?: string | null
  facing?: string | null
  type?: string | null
  qty?: number | null
  projection_mm?: number | null
  confidence: number
  location?: Loc | null
}
export interface ExtUnclear { field: string; description: string; question: string; location?: Loc | null }
export interface DrawingExtraction {
  drawing_type: string
  title_block: ExtField[]
  design_data: ExtField[]
  main_dimensions: ExtField[]
  parts: ExtPart[]
  nozzles: ExtNozzle[]
  welding_and_nde: ExtField[]
  surface_finish_and_painting: ExtField[]
  general_notes: string[]
  unclear_items: ExtUnclear[]
  summary: string
}
export interface PartReview { status: 'accepted' | 'edited' | 'rejected'; values?: Partial<ExtPart> }
export interface DrawingReview {
  parts?: Record<string, PartReview>
  unclear?: Record<string, { answer: string }>
  complete?: boolean
}
export interface Drawing {
  id: number
  project_id: number
  filename: string
  mime: string
  pages: number
  page_sizes: number[][]
  status: string
  error: string
  extraction: DrawingExtraction | Record<string, never> | null
  review: DrawingReview | null
  ai_meta: Record<string, unknown> | null
  created_at: string
}

// ------------------------------------------------------------------ misc
export interface Job<T = unknown> {
  id: string
  kind: string
  status: 'running' | 'done' | 'error'
  result: T | null
  error: string | null
  code?: string
}
export interface AiStatus { configured: boolean; source: string | null; model: string }
export interface Dashboard {
  projects: number
  by_status: Record<string, number>
  pipeline_net: number
  won_net: number
  open_missing_inputs: number
  recent: ProjectSummary[]
  supplier_prices: number
  ai: AiStatus
  with_actuals: number
}
export interface Supplier {
  id: number
  name: string
  country: string
  contact: string
  lead_time: string
  notes: string
  price_count: number
}
export interface SupplierPrice {
  id: number
  supplier_id: number | null
  supplier_name: string
  category: string
  material: string
  description: string
  thk: number | null
  width: number | null
  length: number | null
  od: number | null
  unit: string
  unit_price: number
  currency: string
  unit_weight: number | null
  quote_date: string
  valid_until: string | null
  source: string
  verified: boolean
  age_days: number | null
}
export interface CalibrationEntry {
  label: string
  n: number
  factor: number | null
  suggested_pct: number | null
  min_ratio?: number
  max_ratio?: number
  stdev?: number
  reliable: boolean
  projects: { project_id: number; job_no: string; estimate: number; actual: number; ratio: number }[]
}
export type Calibration = Record<string, CalibrationEntry>
export interface LearningSuggestion {
  item: number
  heading: string
  category: string
  label: string
  suggested_pct: number
  n: number
  reliable: boolean
  evidence: string[]
}
export interface SimilarProject { project: ProjectSummary; score: number; why: string[] }
export interface ImportCheck {
  key: string
  label: string
  workbook: number | null
  recomputed: number
  match: boolean | null
  note?: string
}
export interface ImportResult { project_id: number; notes: string[]; checks: ImportCheck[] }
export interface CompareRow { item: number | string; heading: string; a: number | null; b: number | null; delta: number }

export interface Factory {
  settings: Settings
  labor_params: LaborParams
  labor_rates: LaborRate[]
  crews: Crew[]
  machine_params: MachineParams
  machines: Machine[]
  materials: Material[]
  service_catalog: Service[]
  price_max_age_days: number
  [k: string]: unknown
}

// AI
export interface CrewSuggestion { role: string; rate_id: string; persons: number; rationale: string }
export interface ProcessSuggestion { part_ref: string; machine: string; hours: number; rationale: string }
export interface ServiceSuggestion {
  group: string
  name: string
  basis: string
  rate?: number | null
  qty?: number | null
  minimum?: number | null
  amount?: number | null
  currency: string
  rationale: string
  evidence: string
}
export interface MaterialNeed {
  sheet: string
  group: string
  material: string
  description: string
  qty: number
  unit_weight_kg?: number | null
  rationale: string
}
export interface EstimateSuggestion {
  crew_days?: number | null
  crew_days_rationale: string
  crew: CrewSuggestion[]
  processes: ProcessSuggestion[]
  services: ServiceSuggestion[]
  material_needs: MaterialNeed[]
  questions: string[]
  confidence_note: string
}
export interface SuggestionPayload { suggestion: EstimateSuggestion; meta: Record<string, unknown>; at?: string }
export interface QuoteDraft {
  title: string
  rows: { kind: RowKind; item_no?: number | null; runs: Run[] }[]
  notes_for_engineer: string[]
}
export interface Questions { for_customer: string[]; for_purchasing: string[]; for_engineering: string[] }
