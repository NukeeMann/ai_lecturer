'use client';

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';

import {
  EditorFormFooter,
  EditorFormSaveError,
  errorTextStyle,
  fieldStyle,
  formBodyStyle,
  inputStyle,
  labelStyle,
  textareaStyle,
  type FieldErrors,
} from '@/components/EditorForm';
import { SourcesField } from '@/components/Sources';
import type { Source } from '@/lib/schemas/lesson';

import {
  DataTableDataSchema,
  type DataTableColumn,
  type DataTableColumnType,
  type DataTableData,
  type DataTableRow,
} from './schema';

export interface DataTableEditorProps {
  initial: DataTableData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: DataTableData, sources?: Source[]) => Promise<void>;
}

interface ColumnRow extends DataTableColumn {
  rowId: string;
}

function makeRowId(): string {
  return `r-${Math.random().toString(36).slice(2, 9)}`;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

const cardStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  background: 'var(--bg-elevated)',
  marginBottom: 6,
};

const cardHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
};

const removeButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  flexShrink: 0,
};

const addButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  background: 'transparent',
  border: '1px dashed var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  padding: '6px 10px',
  cursor: 'pointer',
  marginTop: 4,
};

const subLabelStyle: CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: 'var(--text-tertiary)',
  marginBottom: 4,
};

const inlineRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-3)',
  alignItems: 'center',
};

const checkLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
};

const selectStyle: CSSProperties = {
  ...inputStyle,
  width: 'auto',
  paddingRight: 24,
};

export function DataTableEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: DataTableEditorProps) {
  const [columns, setColumns] = useState<ColumnRow[]>(() =>
    initial.columns.map((c) => ({
      ...c,
      type: c.type ?? 'string',
      sortable: c.sortable !== false,
      filterable: c.filterable === true,
      rowId: makeRowId(),
    })),
  );
  const [rowsText, setRowsText] = useState<string>(() =>
    JSON.stringify(initial.rows, null, 2),
  );
  const [pageSize, setPageSize] = useState<string>(() =>
    String(initial.pageSize ?? 25),
  );
  const [initialSortKey, setInitialSortKey] = useState<string>(
    initial.initialSort?.key ?? '',
  );
  const [initialSortDir, setInitialSortDir] = useState<'asc' | 'desc'>(
    initial.initialSort?.dir ?? 'asc',
  );
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const rowsParse = useMemo(() => {
    try {
      const parsed = JSON.parse(rowsText) as unknown;
      if (!Array.isArray(parsed)) {
        return { ok: false as const, error: 'Rows must be a JSON array' };
      }
      return { ok: true as const, value: parsed as DataTableRow[] };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      };
    }
  }, [rowsText]);

  const pageSizeParse = useMemo(() => {
    const trimmed = pageSize.trim();
    if (!trimmed) return { ok: false as const, error: 'Page size required' };
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false as const, error: 'Page size must be a positive integer' };
    }
    return { ok: true as const, value: n };
  }, [pageSize]);

  const current: DataTableData | null = useMemo(() => {
    if (!rowsParse.ok || !pageSizeParse.ok) return null;
    const out: DataTableData = {
      columns: columns.map((c) => ({
        key: c.key,
        label: c.label,
        type: c.type,
        sortable: c.sortable,
        filterable: c.filterable,
      })),
      rows: rowsParse.value,
      pageSize: pageSizeParse.value,
    };
    if (initialSortKey.trim()) {
      out.initialSort = { key: initialSortKey.trim(), dir: initialSortDir };
    }
    return out;
  }, [columns, rowsParse, pageSizeParse, initialSortKey, initialSortDir]);

  const dirty = useMemo(() => {
    if (!current) return true;
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    if (!rowsParse.ok) {
      setErrors({ rows: rowsParse.error });
      return;
    }
    if (!pageSizeParse.ok) {
      setErrors({ pageSize: pageSizeParse.error });
      return;
    }
    if (!current) return;
    const result = DataTableDataSchema.safeParse(current);
    if (!result.success) {
      setErrors(flattenIssues(result.error));
      return;
    }
    setErrors({});
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(result.data, sources);
      setSaving(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [current, onSave, pageSizeParse, rowsParse, saving, sources]);

  const addColumn = useCallback(() => {
    setColumns((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        key: '',
        label: '',
        type: 'string',
        sortable: true,
        filterable: false,
      },
    ]);
  }, []);

  const updateColumn = useCallback((rowId: string, patch: Partial<ColumnRow>) => {
    setColumns((prev) =>
      prev.map((c) => (c.rowId === rowId ? { ...c, ...patch } : c)),
    );
  }, []);

  const removeColumn = useCallback((rowId: string) => {
    setColumns((prev) => prev.filter((c) => c.rowId !== rowId));
  }, []);

  return (
    <div
      data-testid="data-table-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <div style={fieldStyle}>
          <span style={labelStyle}>Columns</span>
          <div data-testid="datatable-edit-columns">
            {columns.map((col, i) => (
              <div key={col.rowId} style={cardStyle} data-test-col-index={i}>
                <div style={cardHeaderStyle}>
                  <input
                    type="text"
                    data-testid={`datatable-edit-col-key-${i}`}
                    value={col.key}
                    placeholder="key"
                    onChange={(e) => updateColumn(col.rowId, { key: e.target.value })}
                    style={{
                      ...inputStyle,
                      flex: 1,
                      minWidth: 0,
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12.5px',
                    }}
                  />
                  <button
                    type="button"
                    data-testid={`datatable-edit-col-remove-${i}`}
                    onClick={() => removeColumn(col.rowId)}
                    aria-label={`Remove column ${i + 1}`}
                    style={removeButtonStyle}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
                <label>
                  <span style={subLabelStyle}>Label</span>
                  <input
                    type="text"
                    data-testid={`datatable-edit-col-label-${i}`}
                    value={col.label}
                    onChange={(e) => updateColumn(col.rowId, { label: e.target.value })}
                    style={inputStyle}
                  />
                </label>
                <div style={inlineRowStyle}>
                  <label>
                    <span style={subLabelStyle}>Type</span>
                    <select
                      data-testid={`datatable-edit-col-type-${i}`}
                      value={col.type}
                      onChange={(e) =>
                        updateColumn(col.rowId, {
                          type: e.target.value as DataTableColumnType,
                        })
                      }
                      style={selectStyle}
                    >
                      <option value="string">string</option>
                      <option value="number">number</option>
                      <option value="boolean">boolean</option>
                    </select>
                  </label>
                  <label style={checkLabelStyle}>
                    <input
                      type="checkbox"
                      data-testid={`datatable-edit-col-sortable-${i}`}
                      checked={col.sortable !== false}
                      onChange={(e) =>
                        updateColumn(col.rowId, { sortable: e.target.checked })
                      }
                    />
                    Sortable
                  </label>
                  <label style={checkLabelStyle}>
                    <input
                      type="checkbox"
                      data-testid={`datatable-edit-col-filterable-${i}`}
                      checked={col.filterable === true}
                      onChange={(e) =>
                        updateColumn(col.rowId, { filterable: e.target.checked })
                      }
                    />
                    Filterable
                  </label>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="datatable-edit-add-column"
            onClick={addColumn}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add column
          </button>
        </div>

        <label style={fieldStyle}>
          <span style={labelStyle}>Rows (JSON array)</span>
          <textarea
            data-testid="datatable-edit-rows"
            value={rowsText}
            onChange={(e) => setRowsText(e.target.value)}
            style={{
              ...textareaStyle,
              minHeight: 160,
              fontFamily: 'var(--font-mono)',
              fontSize: '12.5px',
            }}
            spellCheck={false}
          />
          {!rowsParse.ok && (
            <div style={errorTextStyle} data-testid="datatable-edit-rows-error">
              {rowsParse.error}
            </div>
          )}
          {errors.rows && rowsParse.ok && (
            <div style={errorTextStyle}>{errors.rows}</div>
          )}
        </label>

        <div style={inlineRowStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Page size</span>
            <input
              type="number"
              min={1}
              data-testid="datatable-edit-page-size"
              value={pageSize}
              onChange={(e) => setPageSize(e.target.value)}
              style={{ ...inputStyle, width: 96 }}
            />
            {!pageSizeParse.ok && (
              <div style={errorTextStyle}>{pageSizeParse.error}</div>
            )}
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Initial sort key (optional)</span>
            <input
              type="text"
              data-testid="datatable-edit-sort-key"
              value={initialSortKey}
              onChange={(e) => setInitialSortKey(e.target.value)}
              style={{ ...inputStyle, width: 160 }}
              placeholder="(none)"
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Initial sort direction</span>
            <select
              data-testid="datatable-edit-sort-dir"
              value={initialSortDir}
              onChange={(e) =>
                setInitialSortDir(e.target.value as 'asc' | 'desc')
              }
              style={selectStyle}
            >
              <option value="asc">asc</option>
              <option value="desc">desc</option>
            </select>
          </label>
        </div>

        <SourcesField sources={sources} onChange={setSources} />

        {errors._root && <div style={errorTextStyle}>{errors._root}</div>}
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="datatable-edit-cancel"
        saveTestId="datatable-edit-save"
      />
    </div>
  );
}
