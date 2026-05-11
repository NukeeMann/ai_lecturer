'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Loader2, Volume2 } from 'lucide-react';

import { TtsDemoDataSchema, type TtsDemoData } from './schema';

export interface TtsDemoWidgetProps {
  data: TtsDemoData;
}

interface ErrorState {
  status: number;
  message: string;
  showSetupHint: boolean;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const bodyStyle: CSSProperties = {
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const labelStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 100,
  padding: '10px 12px',
  fontFamily: 'var(--font-prose)',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
  color: 'var(--text)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  resize: 'vertical',
  outline: 'none',
  boxSizing: 'border-box',
};

const controlsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  flexWrap: 'wrap',
};

const generateButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--accent-border)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  cursor: 'pointer',
  flexShrink: 0,
};

const generateButtonDisabledStyle: CSSProperties = {
  ...generateButtonStyle,
  opacity: 0.55,
  cursor: 'not-allowed',
};

const hintStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  flex: 1,
};

const spinnerStyle: CSSProperties = {
  animation: 'tts-demo-spin 1s linear infinite',
};

const errorBoxStyle: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--danger-subtle)',
  border: '1px solid var(--danger-border)',
  color: 'var(--danger)',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.4,
};

const setupHintStyle: CSSProperties = {
  marginTop: 4,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--danger)',
  opacity: 0.85,
};

const audioStyle: CSSProperties = {
  width: '100%',
};

const spinKeyframes = `@keyframes tts-demo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;

function buildAudioUrl(audioPath: string): string {
  const trimmed = audioPath.replace(/^\/+/, '');
  const segments = trimmed
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  return `/api/tts/audio/${segments.join('/')}`;
}

export function TtsDemoWidget({ data: rawData }: TtsDemoWidgetProps) {
  const data = useMemo(() => TtsDemoDataSchema.parse(rawData), [rawData]);
  const [text, setText] = useState(data.defaultText ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Per-instance cache keyed by exact input text → object URL.
  const cacheRef = useRef<Map<string, string>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    };
  }, []);

  const playCurrent = useCallback(() => {
    window.setTimeout(() => {
      const el = audioRef.current;
      if (!el) return;
      try {
        el.currentTime = 0;
      } catch {
        /* ignore */
      }
      void el.play().catch(() => {
        /* autoplay policy may block — controls remain available */
      });
    }, 0);
  }, []);

  const handleGenerate = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    setError(null);

    const cached = cacheRef.current.get(text);
    if (cached) {
      setAudioUrl(cached);
      playCurrent();
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        let detail = '';
        let errCode = '';
        try {
          const payload = (await res.json()) as {
            error?: string;
            message?: string;
            detail?: string;
          };
          errCode = payload.error ?? '';
          detail = payload.message ?? payload.detail ?? '';
        } catch {
          /* response wasn't JSON */
        }
        if (res.status === 503) {
          setError({
            status: 503,
            message: 'TTS is not installed in this environment.',
            showSetupHint: true,
          });
        } else if (res.status === 500) {
          setError({
            status: 500,
            message:
              detail || errCode || 'TTS engine failed to synthesise audio.',
            showSetupHint: false,
          });
        } else {
          setError({
            status: res.status,
            message:
              detail ||
              errCode ||
              `Unexpected response (HTTP ${res.status}).`,
            showSetupHint: false,
          });
        }
        return;
      }

      const payload = (await res.json()) as { audioPath?: string };
      const audioPath = payload.audioPath ?? '';
      if (!audioPath) {
        setError({
          status: 500,
          message: 'TTS response did not include audioPath.',
          showSetupHint: false,
        });
        return;
      }
      const audioRes = await fetch(buildAudioUrl(audioPath));
      if (!audioRes.ok) {
        setError({
          status: audioRes.status,
          message: `Could not load synthesised audio (HTTP ${audioRes.status}).`,
          showSetupHint: false,
        });
        return;
      }
      const blob = await audioRes.blob();
      const url = URL.createObjectURL(blob);
      cacheRef.current.set(text, url);
      setAudioUrl(url);
      playCurrent();
    } catch (err) {
      setError({
        status: 0,
        message:
          err instanceof Error ? err.message : 'Network error reaching /api/tts.',
        showSetupHint: false,
      });
    } finally {
      setLoading(false);
    }
  }, [text, loading, playCurrent]);

  const trimmedText = text.trim();
  const canGenerate = trimmedText.length > 0 && !loading;

  return (
    <div data-tts-demo-widget data-testid="tts-demo-widget" style={wrapStyle}>
      <style>{spinKeyframes}</style>
      <div style={bodyStyle}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={labelStyle}>Text to synthesise</span>
          <textarea
            data-testid="tts-demo-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={data.placeholderText ?? 'Type a phrase to hear it spoken…'}
            spellCheck
            maxLength={2000}
            style={textareaStyle}
          />
        </label>
        <div style={controlsRowStyle}>
          <button
            type="button"
            data-testid="tts-demo-generate"
            onClick={() => void handleGenerate()}
            disabled={!canGenerate}
            aria-busy={loading}
            style={canGenerate ? generateButtonStyle : generateButtonDisabledStyle}
          >
            {loading ? (
              <Loader2
                size={14}
                aria-hidden
                style={spinnerStyle}
                data-testid="tts-demo-spinner"
              />
            ) : (
              <Volume2 size={14} aria-hidden />
            )}
            <span>{loading ? 'Generating…' : 'Generate audio'}</span>
          </button>
          <span style={hintStyle}>
            {text.length}/2000 characters
          </span>
        </div>
        {error && (
          <div
            data-testid="tts-demo-error"
            data-error-status={error.status}
            role="alert"
            style={errorBoxStyle}
          >
            <div>{error.message}</div>
            {error.showSetupHint && (
              <div
                data-testid="tts-demo-error-setup-hint"
                style={setupHintStyle}
              >
                Run <code>scripts/setup-tts.sh</code> to install Coqui XTTS.
              </div>
            )}
          </div>
        )}
        {audioUrl && (
          <audio
            ref={audioRef}
            data-testid="tts-demo-audio"
            src={audioUrl}
            controls
            preload="auto"
            style={audioStyle}
          />
        )}
      </div>
    </div>
  );
}
