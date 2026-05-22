'use client';

import {
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';

import { MarkdownInline } from '@/components/MarkdownInline';

import {
  DataTableDataSchema,
  filterRows,
  sortRows,
  type DataTableCell,
  type DataTableColumn,
  type DataTableData,
  type FilterState,
  type NumberRangeFilter,
  type SortState,
} from './schema';

export interface DataTableWidgetProps {
  data: DataTableData;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-5)',
};

const tableContainerStyle: CSSProperties = {
  position: 'relative',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  maxHeight: '60vh',
  overflow: 'auto',
};

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'separate',
  borderSpacing: 0,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
};

const theadStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  background: 'var(--bg-subtle)',
};

const thBaseStyle: CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  borderBottom: '1px solid var(--border-strong)',
  background: 'var(--bg-subtle)',
  whiteSpace: 'nowrap',
};

const tdBaseStyle: CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
  verticalAlign: 'top',
  lineHeight: 1.4,
};

const sortButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: 'none',
  padding: 0,
  margin: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
  letterSpacing: 'inherit',
  textTransform: 'inherit',
};

const filterRowStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
};

const filterCellStyle: CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--border)',
};

const filterInputStyle: CSSProperties = {
  width: '100%',
  padding: '4px 6px',
  fontSize: 'var(--fs-xs)',
  fontFamily: 'inherit',
  color: 'var(--text)',
  background: 'var(--bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  outline: 'none',
  boxSizing: 'border-box',
};

const numberFilterRowStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
};

const paginationStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-3)',
  paddingTop: 'var(--space-2)',
};

const pageButtonStyle = (disabled: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  height: 30,
  padding: '0 12px',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  background: 'transparent',
  color: disabled ? 'var(--text-quaternary)' : 'var(--text-secondary)',
  border: '1px solid var(--border-strong)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
});

const pageIndicatorStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  minWidth: 100,
  textAlign: 'center',
};

const summaryStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
};

function formatCell(value: DataTableCell | undefined, type: DataTableColumn['type']): string {
  if (value === null || value === undefined) return '—';
  if (type === 'number') {
    const num = typeof value === 'number' ? value : Number(value);
    if (Number.isNaN(num)) return String(value);
    return num.toLocaleString();
  }
  if (type === 'boolean') {
    return value ? '✓' : '—';
  }
  return String(value);
}

function nextSort(current: SortState | null, key: string): SortState | null {
  if (!current || current.key !== key) return { key, dir: 'asc' };
  if (current.dir === 'asc') return { key, dir: 'desc' };
  return null;
}

export function DataTableWidget({ data: rawData }: DataTableWidgetProps) {
  const data = useMemo(() => DataTableDataSchema.parse(rawData), [rawData]);

  const initialSort: SortState | null = data.initialSort
    ? { key: data.initialSort.key, dir: data.initialSort.dir }
    : null;

  const [sort, setSort] = useState<SortState | null>(initialSort);
  const [filters, setFilters] = useState<FilterState>({});
  const [page, setPage] = useState(0);

  const filtered = useMemo(
    () => filterRows({ rows: data.rows, filters, columns: data.columns }),
    [data.rows, data.columns, filters],
  );

  const sorted = useMemo(
    () => sortRows({ rows: filtered, sort, columns: data.columns }),
    [filtered, sort, data.columns],
  );

  const pageSize = data.pageSize;
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const showPagination = data.rows.length > pageSize;

  const clampedPage = Math.min(page, totalPages - 1);
  const start = clampedPage * pageSize;
  const visibleRows = sorted.slice(start, start + pageSize);

  const updateTextFilter = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  };

  const updateRangeFilter = (key: string, side: 'min' | 'max', value: string) => {
    setFilters((prev) => {
      const existing = (prev[key] as NumberRangeFilter | undefined) ?? {};
      const next: NumberRangeFilter = { ...existing };
      if (value === '') {
        delete next[side];
      } else {
        const num = Number(value);
        if (Number.isNaN(num)) return prev;
        next[side] = num;
      }
      return { ...prev, [key]: next };
    });
    setPage(0);
  };

  const handleHeaderClick = (col: DataTableColumn) => {
    if (col.sortable === false) return;
    setSort((current) => nextSort(current, col.key));
  };

  const anyFilterable = data.columns.some((c) => c.filterable);

  return (
    <div data-datatable-body style={wrapStyle}>
      <div style={tableContainerStyle} data-testid="datatable-scroll">
        <table style={tableStyle} data-testid="datatable">
          <thead style={theadStyle}>
            <tr>
              {data.columns.map((col) => {
                const isSorted = sort?.key === col.key;
                const dir = isSorted ? sort?.dir : null;
                const sortable = col.sortable !== false;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    style={thBaseStyle}
                    data-testid={`datatable-th-${col.key}`}
                    data-sort={isSorted ? dir : 'none'}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        onClick={() => handleHeaderClick(col)}
                        style={sortButtonStyle}
                        data-testid={`datatable-sort-${col.key}`}
                        aria-label={`Sort by ${col.label}`}
                      >
                        <span><MarkdownInline>{col.label}</MarkdownInline></span>
                        {dir === 'asc' && (
                          <ChevronUp size={12} aria-hidden />
                        )}
                        {dir === 'desc' && (
                          <ChevronDown size={12} aria-hidden />
                        )}
                        {!dir && (
                          <ChevronsUpDown
                            size={12}
                            aria-hidden
                            style={{ opacity: 0.4 }}
                          />
                        )}
                      </button>
                    ) : (
                      <span><MarkdownInline>{col.label}</MarkdownInline></span>
                    )}
                  </th>
                );
              })}
            </tr>
            {anyFilterable && (
              <tr style={filterRowStyle}>
                {data.columns.map((col) => {
                  if (!col.filterable) {
                    return (
                      <td
                        key={col.key}
                        style={filterCellStyle}
                        aria-hidden
                      />
                    );
                  }
                  if (col.type === 'number') {
                    const range =
                      (filters[col.key] as NumberRangeFilter | undefined) ?? {};
                    return (
                      <td key={col.key} style={filterCellStyle}>
                        <div style={numberFilterRowStyle}>
                          <input
                            type="number"
                            placeholder="min"
                            value={range.min ?? ''}
                            onChange={(e) =>
                              updateRangeFilter(col.key, 'min', e.target.value)
                            }
                            style={filterInputStyle}
                            data-testid={`datatable-filter-${col.key}-min`}
                            aria-label={`Filter ${col.label} minimum`}
                          />
                          <input
                            type="number"
                            placeholder="max"
                            value={range.max ?? ''}
                            onChange={(e) =>
                              updateRangeFilter(col.key, 'max', e.target.value)
                            }
                            style={filterInputStyle}
                            data-testid={`datatable-filter-${col.key}-max`}
                            aria-label={`Filter ${col.label} maximum`}
                          />
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={col.key} style={filterCellStyle}>
                      <input
                        type="text"
                        placeholder="Filter…"
                        value={(filters[col.key] as string | undefined) ?? ''}
                        onChange={(e) =>
                          updateTextFilter(col.key, e.target.value)
                        }
                        style={filterInputStyle}
                        data-testid={`datatable-filter-${col.key}`}
                        aria-label={`Filter ${col.label}`}
                      />
                    </td>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={data.columns.length}
                  style={{
                    ...tdBaseStyle,
                    textAlign: 'center',
                    color: 'var(--text-tertiary)',
                    fontStyle: 'italic',
                  }}
                  data-testid="datatable-empty"
                >
                  No matching rows
                </td>
              </tr>
            ) : (
              visibleRows.map((row, i) => (
                <tr
                  key={start + i}
                  data-testid={`datatable-row-${start + i}`}
                >
                  {data.columns.map((col) => (
                    <td
                      key={col.key}
                      style={{
                        ...tdBaseStyle,
                        textAlign: col.type === 'number' ? 'right' : 'left',
                        fontVariantNumeric:
                          col.type === 'number' ? 'tabular-nums' : 'normal',
                      }}
                      data-testid={`datatable-cell-${start + i}-${col.key}`}
                    >
                      <MarkdownInline>
                        {formatCell(row[col.key], col.type)}
                      </MarkdownInline>
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div style={summaryStyle} data-testid="datatable-summary">
        Showing {sorted.length === 0 ? 0 : start + 1}
        –{Math.min(start + pageSize, sorted.length)} of {sorted.length}
        {sorted.length !== data.rows.length && ` (filtered from ${data.rows.length})`}
      </div>

      {showPagination && (
        <div style={paginationStyle} data-testid="datatable-pagination">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, Math.min(p, totalPages - 1) - 1))}
            disabled={clampedPage === 0}
            style={pageButtonStyle(clampedPage === 0)}
            data-testid="datatable-page-prev"
            aria-label="Previous page"
          >
            Prev
          </button>
          <span style={pageIndicatorStyle} data-testid="datatable-page-indicator">
            Page {clampedPage + 1} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() =>
              setPage((p) => Math.min(totalPages - 1, p + 1))
            }
            disabled={clampedPage >= totalPages - 1}
            style={pageButtonStyle(clampedPage >= totalPages - 1)}
            data-testid="datatable-page-next"
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
