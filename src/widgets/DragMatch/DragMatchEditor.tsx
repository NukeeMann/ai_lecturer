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
  DragMatchDataSchema,
  type DragMatchData,
  type DragMatchItem,
  type DragMatchZone,
} from './schema';

export interface DragMatchEditorProps {
  initial: DragMatchData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: DragMatchData, sources?: Source[]) => Promise<void>;
}

interface ItemRow extends DragMatchItem {
  rowId: string;
}

interface ZoneRow extends DragMatchZone {
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

const acceptsListStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
};

const chipStyle = (active: boolean): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--fs-xs)',
  border: '1px solid',
  borderColor: active ? 'var(--accent)' : 'var(--border-strong)',
  background: active ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
  color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
  cursor: 'pointer',
});

const toggleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
};

export function DragMatchEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: DragMatchEditorProps) {
  const [prompt, setPrompt] = useState<string>(initial.prompt);
  const [items, setItems] = useState<ItemRow[]>(() =>
    initial.items.map((i) => ({ ...i, rowId: makeRowId() })),
  );
  const [zones, setZones] = useState<ZoneRow[]>(() =>
    initial.zones.map((z) => ({ ...z, rowId: makeRowId() })),
  );
  const [multipleItemsPerZone, setMultipleItemsPerZone] = useState<boolean>(
    initial.multipleItemsPerZone ?? false,
  );
  const [requireAll, setRequireAll] = useState<boolean>(
    initial.requireAll ?? true,
  );
  const [explanation, setExplanation] = useState<string>(initial.explanation ?? '');
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current: DragMatchData = useMemo(() => {
    const obj: DragMatchData = {
      prompt,
      items: items.map((i) => ({ id: i.id, label: i.label })),
      zones: zones.map((z) => ({ id: z.id, label: z.label, accepts: z.accepts })),
      multipleItemsPerZone,
      requireAll,
    };
    if (explanation.trim()) obj.explanation = explanation;
    return obj;
  }, [prompt, items, zones, multipleItemsPerZone, requireAll, explanation]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    const result = DragMatchDataSchema.safeParse(current);
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
  }, [current, dirty, onSave, saving, sources]);

  const addItem = useCallback(() => {
    setItems((prev) => [
      ...prev,
      { rowId: makeRowId(), id: '', label: '' },
    ]);
  }, []);

  const updateItem = useCallback((rowId: string, patch: Partial<ItemRow>) => {
    setItems((prev) =>
      prev.map((i) => (i.rowId === rowId ? { ...i, ...patch } : i)),
    );
  }, []);

  const removeItem = useCallback((rowId: string) => {
    const removed = items.find((i) => i.rowId === rowId);
    setItems((prev) => prev.filter((i) => i.rowId !== rowId));
    if (removed) {
      setZones((prev) =>
        prev.map((z) => ({
          ...z,
          accepts: z.accepts.filter((id) => id !== removed.id),
        })),
      );
    }
  }, [items]);

  const addZone = useCallback(() => {
    setZones((prev) => [
      ...prev,
      { rowId: makeRowId(), id: '', label: '', accepts: [] },
    ]);
  }, []);

  const updateZone = useCallback((rowId: string, patch: Partial<ZoneRow>) => {
    setZones((prev) =>
      prev.map((z) => (z.rowId === rowId ? { ...z, ...patch } : z)),
    );
  }, []);

  const removeZone = useCallback((rowId: string) => {
    setZones((prev) => prev.filter((z) => z.rowId !== rowId));
  }, []);

  const toggleAccepts = useCallback(
    (rowId: string, itemId: string) => {
      setZones((prev) =>
        prev.map((z) => {
          if (z.rowId !== rowId) return z;
          const has = z.accepts.includes(itemId);
          return {
            ...z,
            accepts: has
              ? z.accepts.filter((id) => id !== itemId)
              : [...z.accepts, itemId],
          };
        }),
      );
    },
    [],
  );

  return (
    <div
      data-testid="drag-match-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Prompt</span>
          <input
            type="text"
            data-testid="dragmatch-edit-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            style={inputStyle}
          />
          {errors.prompt && <div style={errorTextStyle}>{errors.prompt}</div>}
        </label>

        <div style={fieldStyle}>
          <span style={labelStyle}>Items</span>
          <div data-testid="dragmatch-edit-items">
            {items.map((item, i) => (
              <div key={item.rowId} style={cardStyle} data-test-item-index={i}>
                <div style={cardHeaderStyle}>
                  <input
                    type="text"
                    data-testid={`dragmatch-edit-item-id-${i}`}
                    value={item.id}
                    placeholder="itemId"
                    onChange={(e) =>
                      updateItem(item.rowId, { id: e.target.value })
                    }
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
                    data-testid={`dragmatch-edit-item-remove-${i}`}
                    onClick={() => removeItem(item.rowId)}
                    aria-label={`Remove item ${i + 1}`}
                    style={removeButtonStyle}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
                <label>
                  <span style={subLabelStyle}>Label</span>
                  <input
                    type="text"
                    data-testid={`dragmatch-edit-item-label-${i}`}
                    value={item.label}
                    onChange={(e) =>
                      updateItem(item.rowId, { label: e.target.value })
                    }
                    style={inputStyle}
                  />
                </label>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="dragmatch-edit-add-item"
            onClick={addItem}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add item
          </button>
        </div>

        <div style={fieldStyle}>
          <span style={labelStyle}>Zones</span>
          <div data-testid="dragmatch-edit-zones">
            {zones.map((zone, i) => (
              <div key={zone.rowId} style={cardStyle} data-test-zone-index={i}>
                <div style={cardHeaderStyle}>
                  <input
                    type="text"
                    data-testid={`dragmatch-edit-zone-id-${i}`}
                    value={zone.id}
                    placeholder="zoneId"
                    onChange={(e) =>
                      updateZone(zone.rowId, { id: e.target.value })
                    }
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
                    data-testid={`dragmatch-edit-zone-remove-${i}`}
                    onClick={() => removeZone(zone.rowId)}
                    aria-label={`Remove zone ${i + 1}`}
                    style={removeButtonStyle}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
                <label>
                  <span style={subLabelStyle}>Label</span>
                  <input
                    type="text"
                    data-testid={`dragmatch-edit-zone-label-${i}`}
                    value={zone.label}
                    onChange={(e) =>
                      updateZone(zone.rowId, { label: e.target.value })
                    }
                    style={inputStyle}
                  />
                </label>
                <div>
                  <span style={subLabelStyle}>Accepts (click items)</span>
                  <div style={acceptsListStyle}>
                    {items.length === 0 ? (
                      <span style={{ ...subLabelStyle, marginBottom: 0 }}>
                        Add items first
                      </span>
                    ) : (
                      items.map((it, j) => {
                        const active = zone.accepts.includes(it.id);
                        return (
                          <button
                            key={it.rowId}
                            type="button"
                            data-testid={`dragmatch-edit-accepts-${i}-${j}`}
                            data-active={active ? 'true' : 'false'}
                            onClick={() => toggleAccepts(zone.rowId, it.id)}
                            style={chipStyle(active)}
                            disabled={!it.id}
                          >
                            {it.label || it.id || `(item ${j + 1})`}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="dragmatch-edit-add-zone"
            onClick={addZone}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add zone
          </button>
        </div>

        <label style={{ ...fieldStyle, ...toggleRowStyle }}>
          <input
            type="checkbox"
            data-testid="dragmatch-edit-multiple"
            checked={multipleItemsPerZone}
            onChange={(e) => setMultipleItemsPerZone(e.target.checked)}
          />
          <span>Allow multiple items per zone (ordering matters)</span>
        </label>

        <label style={{ ...fieldStyle, ...toggleRowStyle }}>
          <input
            type="checkbox"
            data-testid="dragmatch-edit-require-all"
            checked={requireAll}
            onChange={(e) => setRequireAll(e.target.checked)}
          />
          <span>
            Require every item to be placed before Submit (uncheck to allow
            distractor items in the bank)
          </span>
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Explanation (optional)</span>
          <textarea
            data-testid="dragmatch-edit-explanation"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            style={{ ...textareaStyle, minHeight: 70 }}
          />
        </label>

        <SourcesField sources={sources} onChange={setSources} />

        {errors._root && <div style={errorTextStyle}>{errors._root}</div>}
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="dragmatch-edit-cancel"
        saveTestId="dragmatch-edit-save"
      />
    </div>
  );
}
