'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Upload } from 'lucide-react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import {
  bracketMatching,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
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
  codeRunnerEditorTheme,
  codeRunnerHighlightStyle,
} from '../Code/CodeRunner';
import { PlotImageDataSchema, type PlotImageData } from './schema';

export interface PlotImageEditorProps {
  initial: PlotImageData;
  initialSources?: Source[];
  courseSlug: string;
  onCancel: () => void;
  onSave: (next: PlotImageData, sources?: Source[]) => Promise<void>;
}

function flattenIssues(error: z.ZodError<unknown>): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!out[path]) out[path] = issue.message;
  }
  return out;
}

const cmContainerStyle: CSSProperties = {
  background: 'var(--code-bg)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};

const uploadButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  background: 'transparent',
  border: '1px dashed var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-xs)',
  fontWeight: 500,
  cursor: 'pointer',
  marginTop: 6,
};

const segmentedRowStyle: CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
};

function segmentedButtonStyle(active: boolean): CSSProperties {
  return {
    padding: '4px 12px',
    fontSize: 'var(--fs-xs)',
    fontWeight: 500,
    background: active ? 'var(--accent-subtle)' : 'transparent',
    color: active ? 'var(--accent-text)' : 'var(--text-secondary)',
    border: 'none',
    cursor: 'pointer',
  };
}

interface SourceCodeEditorProps {
  initial: string;
  language: 'python' | 'r';
  onChange: (value: string) => void;
}

function SourceCodeEditor({ initial, language, onChange }: SourceCodeEditorProps) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!parentRef.current) return;
    const langExtensions = language === 'python' ? [python()] : [];
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });
    const view = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(),
          history(),
          indentOnInput(),
          bracketMatching(),
          ...langExtensions,
          syntaxHighlighting(codeRunnerHighlightStyle),
          codeRunnerEditorTheme,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          updateListener,
        ],
      }),
    });
    return () => {
      view.destroy();
    };
    // Re-mount when language changes so the python() extension is added/removed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  return <div ref={parentRef} data-testid="plotimage-edit-source-code" style={cmContainerStyle} />;
}

export function PlotImageEditor({
  initial,
  initialSources,
  courseSlug,
  onCancel,
  onSave,
}: PlotImageEditorProps) {
  const [src, setSrc] = useState(initial.src);
  const [alt, setAlt] = useState(initial.alt);
  const [caption, setCaption] = useState(initial.caption ?? '');
  const [sourceCode, setSourceCode] = useState<string>(initial.sourceCode ?? '');
  const [sourceLanguage, setSourceLanguage] = useState<'python' | 'r'>(
    initial.sourceLanguage ?? 'python',
  );
  const [sources, setSources] = useState<Source[] | undefined>(initialSources);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const current: PlotImageData = useMemo(() => {
    const obj: PlotImageData = { src, alt };
    if (caption.trim()) obj.caption = caption;
    if (sourceCode.trim()) {
      obj.sourceCode = sourceCode;
      obj.sourceLanguage = sourceLanguage;
    }
    return obj;
  }, [src, alt, caption, sourceCode, sourceLanguage]);

  const dirty = useMemo(() => {
    if (JSON.stringify(current) !== JSON.stringify(initial)) return true;
    return JSON.stringify(sources ?? null) !== JSON.stringify(initialSources ?? null);
  }, [current, initial, sources, initialSources]);

  const handleSave = useCallback(async () => {
    if (!dirty || saving) return;
    const result = PlotImageDataSchema.safeParse(current);
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

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      setUploadError(null);
      setUploading(true);
      try {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
        const url = `/api/courses/${encodeURIComponent(courseSlug)}/assets/plots/${encodeURIComponent(safeName)}`;
        const res = await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
          body: file,
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`Upload failed (${res.status}) ${detail}`);
        }
        const body = (await res.json()) as { src: string };
        setSrc(body.src);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [courseSlug],
  );

  const srcError = errors.src;
  const altError = errors.alt;

  return (
    <div
      data-testid="plotimage-editor"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <div style={formBodyStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>Image src (URL or asset path)</span>
          <input
            type="text"
            data-testid="plotimage-edit-src"
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            spellCheck={false}
            style={{
              ...inputStyle,
              fontFamily: 'var(--font-mono)',
              borderColor: srcError ? 'var(--danger-border)' : undefined,
            }}
          />
          {srcError && (
            <div data-testid="plotimage-edit-src-error" style={errorTextStyle}>
              {srcError}
            </div>
          )}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml"
              onChange={(e) => void handleFileChange(e)}
              style={{ display: 'none' }}
              data-testid="plotimage-edit-file-input"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              data-testid="plotimage-edit-upload"
              style={{
                ...uploadButtonStyle,
                cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.7 : 1,
              }}
            >
              <Upload size={12} aria-hidden />
              {uploading ? 'Uploading…' : 'Upload image'}
            </button>
            {uploadError && (
              <div data-testid="plotimage-edit-upload-error" style={errorTextStyle}>
                {uploadError}
              </div>
            )}
          </div>
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Alt text (required)</span>
          <input
            type="text"
            data-testid="plotimage-edit-alt"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            style={{
              ...inputStyle,
              borderColor: altError ? 'var(--danger-border)' : undefined,
            }}
          />
          {altError && (
            <div data-testid="plotimage-edit-alt-error" style={errorTextStyle}>
              {altError}
            </div>
          )}
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>Caption (optional)</span>
          <textarea
            data-testid="plotimage-edit-caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            style={{ ...textareaStyle, minHeight: 60 }}
          />
        </label>

        <div style={fieldStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ ...labelStyle, marginBottom: 0 }}>Source code (optional)</span>
            <div style={segmentedRowStyle} role="tablist" aria-label="Source language">
              <button
                type="button"
                role="tab"
                aria-selected={sourceLanguage === 'python'}
                data-testid="plotimage-edit-lang-python"
                onClick={() => setSourceLanguage('python')}
                style={segmentedButtonStyle(sourceLanguage === 'python')}
              >
                Python
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sourceLanguage === 'r'}
                data-testid="plotimage-edit-lang-r"
                onClick={() => setSourceLanguage('r')}
                style={segmentedButtonStyle(sourceLanguage === 'r')}
              >
                R
              </button>
            </div>
          </div>
          <SourceCodeEditor
            key={sourceLanguage}
            initial={sourceCode}
            language={sourceLanguage}
            onChange={setSourceCode}
          />
        </div>

        <SourcesField sources={sources} onChange={setSources} />
      </div>

      <EditorFormSaveError message={saveError} />
      <EditorFormFooter
        saving={saving}
        saveDisabled={!dirty}
        onCancel={onCancel}
        onSave={() => void handleSave()}
        cancelTestId="plotimage-edit-cancel"
        saveTestId="plotimage-edit-save"
      />
    </div>
  );
}
