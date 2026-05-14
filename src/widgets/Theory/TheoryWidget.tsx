'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Play } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';

import { Callout, type CalloutTone } from '@/components/Callout';
import { ZoomableImage } from '@/components/ZoomableImage';
import { enqueue, type TtsJobHandle, type TtsJobStatus } from '@/lib/client/ttsQueue';
import { stripForTts } from '@/lib/client/ttsText';
import { readTtsVoice } from '@/lib/client/ttsVoice';

import { remarkCallout } from './remarkCallout';
import type { TheoryData } from './schema';

export interface TheoryWidgetProps {
  data: TheoryData;
}

const VALID_TONES: ReadonlySet<CalloutTone> = new Set(['info', 'insight', 'warning', 'danger']);

function preprocessMath(markdown: string): string {
  return markdown
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `$$\n${body}\n$$`)
    .replace(/\$\$([^\n$]+?)\$\$/g, (_, body: string) => `$$\n${body}\n$$`);
}

function normalizeTone(raw: unknown): CalloutTone {
  if (typeof raw === 'string' && VALID_TONES.has(raw as CalloutTone)) {
    return raw as CalloutTone;
  }
  return 'info';
}

const components: Components = {
  img: (({ src, alt }: { src?: string; alt?: string }) =>
    src ? <ZoomableImage src={src} alt={alt ?? ''} /> : null) as Components['img'],
  // Custom directive output ('callout' is not a standard HTML tag — react-markdown
  // accepts string keys at runtime; the cast keeps TypeScript happy).
  ...({
    callout: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const tone = normalizeTone(props['data-tone']);
      const titleAttr = props['data-title'];
      const title =
        typeof titleAttr === 'string' && titleAttr.length > 0 ? titleAttr : undefined;
      return (
        <Callout tone={tone} title={title}>
          {children}
        </Callout>
      );
    },
  } as Partial<Components>),
};

const footerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 'var(--space-2)',
  padding: 'var(--space-3) var(--space-5)',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const buttonBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 var(--space-4)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  border: '1px solid transparent',
  cursor: 'pointer',
  transition: 'background-color 120ms, opacity 120ms',
};

const spinnerStyle: CSSProperties = {
  display: 'inline-block',
  width: 12,
  height: 12,
  borderRadius: '50%',
  border: '2px solid currentColor',
  borderTopColor: 'transparent',
  animation: 'theory-tts-spin 800ms linear infinite',
};

const errorChipStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--danger-subtle)',
  color: 'var(--danger)',
  fontSize: 'var(--fs-xs)',
  border: '1px solid var(--danger-border, var(--danger))',
};

const audioStyle: CSSProperties = {
  width: '100%',
  maxWidth: 360,
  height: 36,
};

const KEYFRAMES = '@keyframes theory-tts-spin { to { transform: rotate(360deg); } }';

type ButtonState = 'idle' | TtsJobStatus;

export function TheoryWidget({ data }: TheoryWidgetProps) {
  const markdown = useMemo(() => preprocessMath(data.markdown), [data.markdown]);
  const [state, setState] = useState<ButtonState>('idle');
  const [queuePos, setQueuePos] = useState<number>(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const autoplayedUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current();
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, []);

  // Invalidate widget-local audio when the underlying markdown changes — the
  // ttsQueue cache will naturally miss for the new text + voice combo, so the
  // next press refetches.
  useEffect(() => {
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
    setState('idle');
    setBlobUrl(null);
    setError(null);
    autoplayedUrlRef.current = null;
  }, [data.markdown]);

  // Auto-play exactly once per blobUrl transition to 'ready'.
  useEffect(() => {
    if (state !== 'ready' || !blobUrl) return;
    const audio = audioRef.current;
    if (!audio) return;
    if (autoplayedUrlRef.current === blobUrl) return;
    autoplayedUrlRef.current = blobUrl;
    audio.play().catch(() => {
      // Browsers may block autoplay without user interaction. Surfacing the
      // controls UI is enough — user can hit play manually.
    });
  }, [state, blobUrl]);

  function clearErrorTimer() {
    if (errorTimerRef.current) {
      clearTimeout(errorTimerRef.current);
      errorTimerRef.current = null;
    }
  }

  function handleClick() {
    // Ready: toggle the existing audio element (pause/resume).
    if (state === 'ready') {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) {
        audio.play().catch(() => undefined);
      } else {
        audio.pause();
      }
      return;
    }

    if (state === 'queued' || state === 'generating') return;

    clearErrorTimer();
    setError(null);

    const text = stripForTts(data.markdown).trim();
    if (text.length === 0) {
      setError('Nothing to read.');
      errorTimerRef.current = setTimeout(() => {
        setError(null);
        errorTimerRef.current = null;
      }, 6000);
      return;
    }

    const voice = readTtsVoice();
    const handle: TtsJobHandle = enqueue(text, voice);
    if (unsubRef.current) unsubRef.current();

    unsubRef.current = handle.subscribe((update) => {
      if (update.status === 'queued') {
        setState('queued');
        setQueuePos(update.queuePosition ?? 1);
        return;
      }
      if (update.status === 'generating') {
        setState('generating');
        return;
      }
      if (update.status === 'ready') {
        setState('ready');
        setBlobUrl(update.blobUrl ?? null);
        return;
      }
      if (update.status === 'error') {
        setState('idle');
        setError(update.message ?? 'TTS failed');
        clearErrorTimer();
        errorTimerRef.current = setTimeout(() => {
          setError(null);
          errorTimerRef.current = null;
        }, 6000);
      }
    });
  }

  let label: string;
  if (state === 'queued') label = `Queued (${queuePos})`;
  else if (state === 'generating') label = 'Generating…';
  else if (state === 'ready') label = '▶ Replay';
  else label = 'Read ▶';

  const buttonStyle: CSSProperties = {
    ...buttonBaseStyle,
    opacity: state === 'queued' || state === 'generating' ? 0.85 : 1,
    cursor: state === 'queued' || state === 'generating' ? 'progress' : 'pointer',
  };

  return (
    <>
      <style>{KEYFRAMES}</style>
      <div data-theory-body>
        <ReactMarkdown
          remarkPlugins={[remarkDirective, remarkCallout, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      </div>
      <div style={footerStyle}>
        <button
          type="button"
          data-testid="theory-tts-button"
          aria-label={label}
          data-state={state}
          onClick={handleClick}
          style={buttonStyle}
        >
          {state === 'generating' ? <span style={spinnerStyle} aria-hidden /> : null}
          {state === 'ready' ? <Play size={14} strokeWidth={2.5} aria-hidden /> : null}
          <span>{label}</span>
        </button>
        {error ? (
          <div role="status" data-testid="theory-tts-error" style={errorChipStyle}>
            {error}
          </div>
        ) : null}
        {state === 'ready' && blobUrl ? (
          <audio
            ref={audioRef}
            controls
            data-testid="theory-tts-audio"
            src={blobUrl}
            style={audioStyle}
          />
        ) : null}
      </div>
    </>
  );
}
