import { z } from 'zod';

export const DataTableColumnTypeSchema = z.enum(['string', 'number', 'boolean']);

export const DataTableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: DataTableColumnTypeSchema.default('string'),
  sortable: z.boolean().default(true),
  filterable: z.boolean().default(false),
});

export const DataTableCellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const DataTableRowSchema = z.record(DataTableCellSchema);

export const DataTableInitialSortSchema = z.object({
  key: z.string().min(1),
  dir: z.enum(['asc', 'desc']),
});

export const DataTableDataSchema = z.object({
  columns: z.array(DataTableColumnSchema).min(1),
  rows: z.array(DataTableRowSchema),
  initialSort: DataTableInitialSortSchema.optional(),
  pageSize: z.number().int().positive().default(25),
});

export type DataTableColumnType = z.infer<typeof DataTableColumnTypeSchema>;
export type DataTableColumn = z.infer<typeof DataTableColumnSchema>;
export type DataTableCell = z.infer<typeof DataTableCellSchema>;
export type DataTableRow = z.infer<typeof DataTableRowSchema>;
export type DataTableInitialSort = z.infer<typeof DataTableInitialSortSchema>;
export type DataTableData = z.infer<typeof DataTableDataSchema>;

export type SortDirection = 'asc' | 'desc' | null;

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface NumberRangeFilter {
  min?: number;
  max?: number;
}

export type ColumnFilter = string | NumberRangeFilter;

export type FilterState = Record<string, ColumnFilter | undefined>;

export function compareCells(
  a: DataTableCell | undefined,
  b: DataTableCell | undefined,
  type: DataTableColumnType,
): number {
  const aMissing = a === undefined || a === null;
  const bMissing = b === undefined || b === null;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  if (type === 'number') {
    const an = typeof a === 'number' ? a : Number(a);
    const bn = typeof b === 'number' ? b : Number(b);
    if (Number.isNaN(an) && Number.isNaN(bn)) return 0;
    if (Number.isNaN(an)) return 1;
    if (Number.isNaN(bn)) return -1;
    return an - bn;
  }
  if (type === 'boolean') {
    const ab = a ? 1 : 0;
    const bb = b ? 1 : 0;
    return ab - bb;
  }
  return String(a).localeCompare(String(b));
}

export interface SortOptions {
  rows: DataTableRow[];
  sort: SortState | null;
  columns: DataTableColumn[];
}

export function sortRows({ rows, sort, columns }: SortOptions): DataTableRow[] {
  if (!sort) return rows.slice();
  const col = columns.find((c) => c.key === sort.key);
  if (!col) return rows.slice();
  const indexed = rows.map((row, idx) => ({ row, idx }));
  indexed.sort((a, b) => {
    const cmp = compareCells(a.row[sort.key], b.row[sort.key], col.type);
    if (cmp !== 0) return sort.dir === 'asc' ? cmp : -cmp;
    return a.idx - b.idx;
  });
  return indexed.map((entry) => entry.row);
}

export interface FilterOptions {
  rows: DataTableRow[];
  filters: FilterState;
  columns: DataTableColumn[];
}

export function filterRows({ rows, filters, columns }: FilterOptions): DataTableRow[] {
  const colByKey = new Map(columns.map((c) => [c.key, c] as const));
  return rows.filter((row) => {
    for (const [key, filter] of Object.entries(filters)) {
      if (filter === undefined) continue;
      const col = colByKey.get(key);
      if (!col || !col.filterable) continue;
      const value = row[key];
      if (col.type === 'number') {
        const range = filter as NumberRangeFilter;
        const hasMin = range.min !== undefined && range.min !== null;
        const hasMax = range.max !== undefined && range.max !== null;
        if (!hasMin && !hasMax) continue;
        if (value === null || value === undefined) return false;
        const num = typeof value === 'number' ? value : Number(value);
        if (Number.isNaN(num)) return false;
        if (hasMin && num < (range.min as number)) return false;
        if (hasMax && num > (range.max as number)) return false;
      } else {
        const text = String(filter ?? '').trim();
        if (!text) continue;
        if (value === null || value === undefined) return false;
        if (!String(value).toLowerCase().includes(text.toLowerCase())) return false;
      }
    }
    return true;
  });
}
