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
  VideoDataSchema,
  type VideoData,
  type VideoKind,
  type VideoTranscriptSegment,
} from './schema';

export interface VideoEditorProps {
  initial: VideoData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: VideoData, sources?: Source[]) => Promise<void>;
}

interface TranscriptRow extends VideoTranscriptSegment {
  rowId: string;
}

function makeRowId(): string {
  return `t-${Math.random().toString(36).slice(2, 9)}`;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

const segmentedRowStyle: CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};

function segmentedButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '6px 14px',
    fontSize: 'var(--fs-xs)',
    fontWeight: 500,
    background: active ? 'var(--accent-subtle)' : 'transparent',
    color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
    border: 'none',
    cursor: 'pointer',
  };
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
  alignItems: 'flex-start',
};

const checkLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
};

function parseOptionalNumber(text: string): { ok: true; value: number | undefined } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: undefined };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) {
    return { ok: false, error: 'Must be a non-negative number' };
  }
  return { ok: true, value: n };
}

export function VideoEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: VideoEditorProps) {
  const [kind, setKind] = useState<VideoKind>(initial.kind);
  const [src, setSrc] = useState(initial.src);
  const [title, setTitle] = useState(initial.title ?? '');
  const [durationSecondsText, setDurationSecondsText] = useState(
    initial.durationSeconds !== undefined ? String(initial.durationSeconds) : '',
  );
  const [startAtText, setStartAtText] = useState(
    initial.startAt !== undefined ? String(initial.startAt) : '',
  );
  const [autoplay, setAutoplay] = useState(initial.autoplay ?? false);
  const [transcript, setTranscript] = useState<TranscriptRow[]>(() =>
    (initial.transcript ?? []).map((seg) => ({ ...seg, rowId: makeRowId() })),
  );
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const durationParse = useMemo(() => parseOptionalNumber(durationSecondsText), [durationSecondsText]);
  const startAtParse = useMemo(() => parseOptionalNumber(startAtText), [startAtText]);

  const current: VideoData | null = useMemo(() => {
    if (!durationParse.ok || !startAtParse.ok) return null;
    const out: VideoData = {
      kind,
      src,
      autoplay,
    };
    if (title.trim()) out.title = title.trim();
    if (durationParse.value !== undefined) out.durationSeconds = durationParse.value;
    if (startAtParse.value !== undefined) out.startAt = startAtParse.value;
    if (transcript.length > 0) {
      out.transcript = transcript.map((row) => {
        const seg: VideoTranscriptSegment = { tStart: row.tStart, text: row.text };
        if (row.tEnd !== undefined) seg.tEnd = row.tEnd;
        if (row.speaker && row.speaker.trim()) seg.speaker = row.speaker.trim();
        return seg;
      });
    }
    return out;
  }, [kind, src, title, autoplay, durationParse, startAtParse, transcript]);

  const dirty = useMemo(() => {
    if (!current) return true;
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    if (!durationParse.ok) {
      setErrors({ durationSeconds: durationParse.error });
      return;
    }
    if (!startAtParse.ok) {
      setErrors({ startAt: startAtParse.error });
      return;
    }
    if (!current) return;
    const result = VideoDataSchema.safeParse(current);
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
  }, [current, durationParse, onSave, saving, sources, startAtParse]);

  const addSegment = useCallback(() => {
    setTranscript((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        tStart: prev.length > 0 ? (prev[prev.length - 1].tEnd ?? prev[prev.length - 1].tStart + 5) : 0,
        text: '',
      },
    ]);
  }, []);

  const updateSegment = useCallback((rowId: string, patch: Partial<TranscriptRow>) => {
    setTranscript((prev) =>
      prev.map((seg) => (seg.rowId === rowId ? { ...seg, ...patch } : seg)),
    );
  }, []);

  const removeSegment = useCallback((rowId: string) => {
    setTranscript((prev) => prev.filter((seg) => seg.rowId !== rowId));
  }, []);

  return (
    <div
      data-testid="video-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <div style={fieldStyle}>
          <span style={labelStyle}>Source kind</span>
          <div style={segmentedRowStyle} role="tablist" aria-label="Video kind">
            <button
              type="button"
              role="tab"
              aria-selected={kind === 'youtube'}
              data-testid="video-edit-kind-youtube"
              onClick={() => setKind('youtube')}
              style={segmentedButtonStyle(kind === 'youtube')}
            >
              YouTube
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kind === 'mp4'}
              data-testid="video-edit-kind-mp4"
              onClick={() => setKind('mp4')}
              style={segmentedButtonStyle(kind === 'mp4')}
            >
              MP4
            </button>
          </div>
        </div>

        <label style={fieldStyle}>
          <span style={labelStyle}>
            {kind === 'youtube' ? 'YouTube URL or video ID' : 'MP4 src (URL or asset path)'}
          </span>
          <input
            type="text"
            data-testid="video-edit-src"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            spellCheck={false}
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              borderColor: errors.src ? 'var(--danger-border)' : undefined,
            }}
          />
          {errors.src && (
            <div data-testid="video-edit-src-error" style={errorTextStyle}>
              {errors.src}
            </div>
          )}
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Title (optional)</span>
          <input
            type="text"
            data-testid="video-edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>

        <div style={{ ...inlineRowStyle, marginBottom: 'var(--space-4)' }}>
          <label style={{ ...fieldStyle, marginBottom: 0 }}>
            <span style={labelStyle}>Duration (s)</span>
            <input
              type="number"
              min={0}
              data-testid="video-edit-duration"
              value={durationSecondsText}
              onChange={(e) => setDurationSecondsText(e.target.value)}
              style={{ ...inputStyle, width: 120 }}
              placeholder="(none)"
            />
            {!durationParse.ok && (
              <div style={errorTextStyle}>{durationParse.error}</div>
            )}
          </label>
          <label style={{ ...fieldStyle, marginBottom: 0 }}>
            <span style={labelStyle}>Start at (s)</span>
            <input
              type="number"
              min={0}
              data-testid="video-edit-start-at"
              value={startAtText}
              onChange={(e) => setStartAtText(e.target.value)}
              style={{ ...inputStyle, width: 120 }}
              placeholder="(none)"
            />
            {!startAtParse.ok && (
              <div style={errorTextStyle}>{startAtParse.error}</div>
            )}
          </label>
          <label style={{ ...checkLabelStyle, marginTop: 24 }}>
            <input
              type="checkbox"
              data-testid="video-edit-autoplay"
              checked={autoplay}
              onChange={(e) => setAutoplay(e.target.checked)}
            />
            Autoplay
          </label>
        </div>

        <div style={fieldStyle}>
          <span style={labelStyle}>Transcript (optional)</span>
          <div data-testid="video-edit-transcript">
            {transcript.map((seg, i) => (
              <div key={seg.rowId} style={cardStyle} data-test-seg-index={i}>
                <div style={cardHeaderStyle}>
                  <label style={{ flex: '0 0 auto' }}>
                    <span style={subLabelStyle}>tStart (s)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      data-testid={`video-edit-seg-tstart-${i}`}
                      value={seg.tStart}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (Number.isFinite(n) && n >= 0) {
                          updateSegment(seg.rowId, { tStart: n });
                        }
                      }}
                      style={{ ...inputStyle, width: 100 }}
                    />
                  </label>
                  <label style={{ flex: '0 0 auto' }}>
                    <span style={subLabelStyle}>tEnd (s)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      data-testid={`video-edit-seg-tend-${i}`}
                      value={seg.tEnd ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === '') {
                          updateSegment(seg.rowId, { tEnd: undefined });
                          return;
                        }
                        const n = Number(v);
                        if (Number.isFinite(n) && n >= 0) {
                          updateSegment(seg.rowId, { tEnd: n });
                        }
                      }}
                      style={{ ...inputStyle, width: 100 }}
                      placeholder="(none)"
                    />
                  </label>
                  <label style={{ flex: 1, minWidth: 120 }}>
                    <span style={subLabelStyle}>Speaker (optional)</span>
                    <input
                      type="text"
                      data-testid={`video-edit-seg-speaker-${i}`}
                      value={seg.speaker ?? ''}
                      onChange={(e) =>
                        updateSegment(seg.rowId, { speaker: e.target.value })
                      }
                      style={inputStyle}
                    />
                  </label>
                  <button
                    type="button"
                    data-testid={`video-edit-seg-remove-${i}`}
                    onClick={() => removeSegment(seg.rowId)}
                    aria-label={`Remove segment ${i + 1}`}
                    style={removeButtonStyle}
                  >
                    <Trash2 size={13} aria-hidden />
                  </button>
                </div>
                <label>
                  <span style={subLabelStyle}>Text</span>
                  <textarea
                    data-testid={`video-edit-seg-text-${i}`}
                    value={seg.text}
                    onChange={(e) =>
                      updateSegment(seg.rowId, { text: e.target.value })
                    }
                    style={{ ...textareaStyle, minHeight: 60 }}
                  />
                </label>
              </div>
            ))}
          </div>
          <button
            type="button"
            data-testid="video-edit-add-segment"
            onClick={addSegment}
            style={addButtonStyle}
          >
            <Plus size={12} aria-hidden /> Add segment
          </button>
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
        cancelTestId="video-edit-cancel"
        saveTestId="video-edit-save"
      />
    </div>
  );
}
