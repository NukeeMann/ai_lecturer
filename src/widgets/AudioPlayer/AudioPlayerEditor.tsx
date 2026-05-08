'use client';

import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from 'react';
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

import { AudioPlayerDataSchema, type AudioPlayerData } from './schema';

export interface AudioPlayerEditorProps {
  initial: AudioPlayerData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: AudioPlayerData, sources?: Source[]) => Promise<void>;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

const checkLabelStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
};

const helpTextStyle: CSSProperties = {
  marginTop: 4,
  fontSize: '11.5px',
  color: 'var(--text-tertiary)',
  lineHeight: 1.4,
};

export function AudioPlayerEditor({
  initial,
  initialSources,
  onCancel,
  onSave,
}: AudioPlayerEditorProps) {
  const [audioPath, setAudioPath] = useState(initial.audioPath);
  const [title, setTitle] = useState(initial.title ?? '');
  const [autoplay, setAutoplay] = useState(initial.autoplay ?? false);
  const [transcript, setTranscript] = useState(initial.transcript ?? '');
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const current: AudioPlayerData = useMemo(() => {
    const out: AudioPlayerData = {
      audioPath: audioPath.trim(),
      autoplay,
    };
    if (title.trim()) out.title = title.trim();
    if (transcript.trim()) out.transcript = transcript;
    return out;
  }, [audioPath, title, autoplay, transcript]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    const result = AudioPlayerDataSchema.safeParse(current);
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
  }, [current, onSave, saving, sources]);

  return (
    <div
      data-testid="audio-player-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Audio file path</span>
          <input
            type="text"
            data-testid="audio-player-edit-path"
            value={audioPath}
            onChange={(e) => setAudioPath(e.target.value)}
            spellCheck={false}
            placeholder="e.g. lesson-01.wav"
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              borderColor: errors.audioPath ? 'var(--danger-border)' : undefined,
            }}
          />
          <div style={helpTextStyle}>
            Path relative to <code>courses/&lt;slug&gt;/assets/audio/</code>. Place the file
            on disk before saving (mp3, wav, or ogg).
          </div>
          {errors.audioPath && (
            <div data-testid="audio-player-edit-path-error" style={errorTextStyle}>
              {errors.audioPath}
            </div>
          )}
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Title (optional)</span>
          <input
            type="text"
            data-testid="audio-player-edit-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
          />
        </label>

        <div style={fieldStyle}>
          <label style={checkLabelStyle}>
            <input
              type="checkbox"
              data-testid="audio-player-edit-autoplay"
              checked={autoplay}
              onChange={(e) => setAutoplay(e.target.checked)}
            />
            Autoplay
          </label>
        </div>

        <label style={fieldStyle}>
          <span style={labelStyle}>Transcript (optional)</span>
          <textarea
            data-testid="audio-player-edit-transcript"
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Plain-text transcript shown in a collapsible Show transcript section."
            style={{ ...textareaStyle, minHeight: 140 }}
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
        cancelTestId="audio-player-edit-cancel"
        saveTestId="audio-player-edit-save"
      />
    </div>
  );
}
