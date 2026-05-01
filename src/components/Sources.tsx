'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  BookOpen,
  ChevronDown,
  FileText,
  Link as LinkIcon,
  Newspaper,
  Plus,
  Trash2,
  Video,
  type LucideIcon,
} from 'lucide-react';

import {
  errorTextStyle,
  fieldStyle,
  inputStyle,
  labelStyle,
} from '@/components/EditorForm';
import type { Source, SourceKind } from '@/lib/schemas/lesson';

export const SOURCE_KIND_OPTIONS: SourceKind[] = ['paper', 'video', 'article', 'book'];

const kindIcon: Record<SourceKind, LucideIcon> = {
  paper: FileText,
  video: Video,
  article: Newspaper,
  book: BookOpen,
};

const kindLabel: Record<SourceKind, string> = {
  paper: 'Paper',
  video: 'Video',
  article: 'Article',
  book: 'Book',
};

interface SourceCardProps {
  source: Source;
  testId?: string;
}

const cardStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  textDecoration: 'none',
  color: 'var(--text)',
  transition: 'background-color 120ms, border-color 120ms',
};

const kindIconWrapStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-subtle)',
  color: 'var(--text-secondary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

export function SourceCard({ source, testId }: SourceCardProps) {
  const Icon = kindIcon[source.kind];
  const meta = [source.author, source.year ? String(source.year) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId ?? 'source-card'}
      data-source-kind={source.kind}
      style={cardStyle}
    >
      <div style={kindIconWrapStyle}>
        <Icon size={16} aria-hidden />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--fs-sm)',
            fontWeight: 600,
            color: 'var(--text)',
            lineHeight: 1.35,
          }}
        >
          {source.title}
        </div>
        {meta && (
          <div
            style={{
              marginTop: 2,
              fontSize: '12px',
              color: 'var(--text-secondary)',
              lineHeight: 1.4,
            }}
          >
            {meta}
          </div>
        )}
        <div
          style={{
            marginTop: 4,
            fontSize: '11.5px',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={source.url}
        >
          {source.url}
        </div>
      </div>
    </a>
  );
}

interface LessonSourcesPanelProps {
  sources: Source[];
}

export function LessonSourcesPanel({ sources }: LessonSourcesPanelProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (sources.length === 0) return null;

  return (
    <section
      data-testid="lesson-sources-panel"
      data-open={open ? 'true' : 'false'}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        data-testid="lesson-sources-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          padding: 'var(--space-4) var(--space-5)',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          color: 'var(--text)',
        }}
      >
        <LinkIcon size={16} aria-hidden style={{ color: 'var(--text-secondary)' }} />
        <span
          style={{
            flex: 1,
            fontSize: 'var(--fs-md)',
            fontWeight: 600,
            color: 'var(--text)',
          }}
        >
          Źródła / Sources
        </span>
        <span
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-tertiary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {sources.length}
        </span>
        <ChevronDown
          size={14}
          aria-hidden
          style={{
            color: 'var(--text-tertiary)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 120ms ease',
            flexShrink: 0,
          }}
        />
      </button>
      {open && (
        <div
          id={panelId}
          data-testid="lesson-sources-list"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-5) var(--space-4)',
            borderTop: '1px solid var(--border)',
          }}
        >
          {sources.map((source, i) => (
            <SourceCard
              key={`${source.url}-${i}`}
              source={source}
              testId="lesson-source-card"
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface SectionSourcesPopoverProps {
  sources: Source[];
  sectionId: string;
}

export function SectionSourcesPopover({
  sources,
  sectionId,
}: SectionSourcesPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (sources.length === 0) return null;

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        data-testid="section-sources-trigger"
        data-section-id={sectionId}
        aria-label={`View ${sources.length} source${sources.length === 1 ? '' : 's'} for this section`}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        style={{
          width: 28,
          height: 28,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid transparent',
          background: open ? 'var(--bg-active)' : 'transparent',
          color: open ? 'var(--text)' : 'var(--text-tertiary)',
          cursor: 'pointer',
        }}
      >
        <LinkIcon size={16} aria-hidden />
      </button>
      {open && (
        <div
          data-testid="section-sources-popover"
          role="dialog"
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 6,
            width: 320,
            maxWidth: 'calc(100vw - 24px)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md, 0 8px 24px rgba(0, 0, 0, 0.12))',
            padding: 'var(--space-3)',
            zIndex: 30,
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          <div
            style={{
              fontSize: 'var(--fs-xs)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 600,
              color: 'var(--text-tertiary)',
              padding: '2px 4px',
            }}
          >
            Sources
          </div>
          {sources.map((source, i) => (
            <SourceCard
              key={`${source.url}-${i}`}
              source={source}
              testId="section-source-card"
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface SourceRow extends Source {
  rowId: string;
}

function makeRowId(): string {
  return `src-${Math.random().toString(36).slice(2, 9)}`;
}

function rowsFromSources(sources: Source[] | undefined): SourceRow[] {
  return (sources ?? []).map((s) => ({ ...s, rowId: makeRowId() }));
}

function rowToSource(row: SourceRow): Source {
  const out: Source = {
    url: row.url.trim(),
    title: row.title.trim(),
    kind: row.kind,
  };
  if (row.author && row.author.trim()) out.author = row.author.trim();
  if (row.year !== undefined && Number.isFinite(row.year)) out.year = row.year;
  return out;
}

export function rowsToSources(rows: SourceRow[]): Source[] {
  return rows
    .filter((r) => r.url.trim() !== '' || r.title.trim() !== '')
    .map(rowToSource);
}

interface SourcesFieldProps {
  sources: Source[] | undefined;
  onChange: (next: Source[] | undefined) => void;
  testId?: string;
  label?: string;
}

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

const rowContainerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-3)',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  marginBottom: 6,
};

const smallInputStyle: CSSProperties = {
  ...inputStyle,
  padding: '6px 8px',
  fontSize: '12.5px',
};

export function SourcesField({ sources, onChange, testId, label }: SourcesFieldProps) {
  const [rows, setRows] = useState<SourceRow[]>(() => rowsFromSources(sources));
  const onChangeRef = useRef(onChange);
  const initialRef = useRef(sources);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Re-sync from prop only when prop reference changes externally (e.g. parent
  // resets to a different section). Avoid clobbering user edits during typing.
  useEffect(() => {
    if (sources !== initialRef.current) {
      initialRef.current = sources;
      setRows(rowsFromSources(sources));
    }
  }, [sources]);

  const emit = useCallback((next: SourceRow[]) => {
    const normalised = rowsToSources(next);
    onChangeRef.current(normalised.length === 0 ? undefined : normalised);
  }, []);

  const handleAdd = useCallback(() => {
    setRows((prev) => {
      const next: SourceRow[] = [
        ...prev,
        { rowId: makeRowId(), url: '', title: '', kind: 'article' },
      ];
      emit(next);
      return next;
    });
  }, [emit]);

  const handleRemove = useCallback(
    (rowId: string) => {
      setRows((prev) => {
        const next = prev.filter((r) => r.rowId !== rowId);
        emit(next);
        return next;
      });
    },
    [emit],
  );

  const handleEdit = useCallback(
    (rowId: string, patch: Partial<SourceRow>) => {
      setRows((prev) => {
        const next = prev.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r));
        emit(next);
        return next;
      });
    },
    [emit],
  );

  return (
    <div style={fieldStyle} data-testid={testId ?? 'sources-field'}>
      <span style={labelStyle}>{label ?? 'Sources (optional)'}</span>
      <div data-testid="sources-field-rows">
        {rows.map((row) => (
          <SourceRowEditor
            key={row.rowId}
            row={row}
            onEdit={(patch) => handleEdit(row.rowId, patch)}
            onRemove={() => handleRemove(row.rowId)}
          />
        ))}
      </div>
      <button
        type="button"
        data-testid="sources-field-add"
        onClick={handleAdd}
        style={addButtonStyle}
      >
        <Plus size={12} aria-hidden /> Add source
      </button>
    </div>
  );
}

interface SourceRowEditorProps {
  row: SourceRow;
  onEdit: (patch: Partial<SourceRow>) => void;
  onRemove: () => void;
}

function SourceRowEditor({ row, onEdit, onRemove }: SourceRowEditorProps) {
  const urlError = row.url.trim() !== '' && !isLikelyUrl(row.url);
  const titleError = row.url.trim() !== '' && row.title.trim() === '';
  return (
    <div data-testid="sources-field-row" style={rowContainerStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <input
          type="text"
          data-testid="source-edit-title"
          value={row.title}
          onChange={(e) => onEdit({ title: e.target.value })}
          placeholder="Title"
          style={{
            ...smallInputStyle,
            flex: 1,
            borderColor: titleError ? 'var(--danger-border)' : undefined,
          }}
        />
        <select
          data-testid="source-edit-kind"
          value={row.kind}
          onChange={(e) => onEdit({ kind: e.target.value as SourceKind })}
          style={{ ...smallInputStyle, width: 110, cursor: 'pointer' }}
        >
          {SOURCE_KIND_OPTIONS.map((k) => (
            <option key={k} value={k}>
              {kindLabel[k]}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="source-edit-remove"
          onClick={onRemove}
          aria-label="Remove source"
          style={removeButtonStyle}
        >
          <Trash2 size={13} aria-hidden />
        </button>
      </div>
      <input
        type="text"
        data-testid="source-edit-url"
        value={row.url}
        onChange={(e) => onEdit({ url: e.target.value })}
        placeholder="https://…"
        style={{
          ...smallInputStyle,
          fontFamily: 'var(--font-mono)',
          borderColor: urlError ? 'var(--danger-border)' : undefined,
        }}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 90px',
          gap: 'var(--space-2)',
        }}
      >
        <input
          type="text"
          data-testid="source-edit-author"
          value={row.author ?? ''}
          onChange={(e) => onEdit({ author: e.target.value })}
          placeholder="Author (optional)"
          style={smallInputStyle}
        />
        <input
          type="number"
          data-testid="source-edit-year"
          value={row.year !== undefined ? String(row.year) : ''}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onEdit({ year: undefined });
            const n = Number(raw);
            if (Number.isFinite(n)) onEdit({ year: Math.trunc(n) });
          }}
          placeholder="Year"
          style={smallInputStyle}
        />
      </div>
      {urlError && (
        <div data-testid="source-edit-url-error" style={errorTextStyle}>
          URL must look like https://…
        </div>
      )}
      {titleError && (
        <div data-testid="source-edit-title-error" style={errorTextStyle}>
          Title required when URL is set
        </div>
      )}
    </div>
  );
}

function isLikelyUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
