'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';

import { Callout, type CalloutTone } from '@/components/Callout';
import { MermaidPre } from '@/components/MermaidDiagram';
import { ZoomableImage } from '@/components/ZoomableImage';
import { preprocessMath } from '@/lib/client/mathPreprocess';
import { enqueue, type TtsJobHandle, type TtsJobStatus } from '@/lib/client/ttsQueue';
import { stripForTts } from '@/lib/client/ttsText';
import { readTtsVoice } from '@/lib/client/ttsVoice';

import { remarkCallout } from './remarkCallout';
import type { TheoryData } from './schema';

export interface TheoryWidgetProps {
  data: TheoryData;
}

const VALID_TONES: ReadonlySet<CalloutTone> = new Set(['info', 'insight', 'warning', 'danger']);

function normalizeTone(raw: unknown): CalloutTone {
  if (typeof raw === 'string' && VALID_TONES.has(raw as CalloutTone)) {
    return raw as CalloutTone;
  }
  return 'info';
}

const components: Components = {
  img: (({ src, alt }: { src?: string; alt?: string }) =>
    src ? <ZoomableImage src={src} alt={alt ?? ''} /> : null) as Components['img'],
  // ```mermaid fenced blocks → SVG diagram (lazy-loaded); other fenced blocks
  // fall through to a normal <pre>.
  pre: MermaidPre as Components['pre'],
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

const controlsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  flexWrap: 'wrap',
  width: '100%',
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

const playerWrapStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  height: 32,
  padding: '0 10px 0 6px',
  background: 'var(--bg-subtle)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-full)',
  flex: '1 1 280px',
  minWidth: 220,
  maxWidth: 460,
};

const playerToggleStyle: CSSProperties = {
  width: 24,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-full)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  border: 'none',
  cursor: 'pointer',
  flexShrink: 0,
  padding: 0,
};

const playerTimeStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

const playerSeekStyle: CSSProperties = {
  flex: 1,
  minWidth: 60,
  height: 4,
  accentColor: 'var(--accent)',
  cursor: 'pointer',
  margin: 0,
};

const playerMuteStyle: CSSProperties = {
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-secondary)',
  border: 'none',
  cursor: 'pointer',
  flexShrink: 0,
  padding: 0,
};

const hiddenAudioStyle: CSSProperties = {
  display: 'none',
};

const KEYFRAMES = `
  @keyframes theory-tts-spin { to { transform: rotate(360deg); } }
  .theory-tts-seek { -webkit-appearance: none; appearance: none; background: transparent; }
  .theory-tts-seek::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(
      to right,
      var(--accent) 0,
      var(--accent) var(--theory-tts-progress, 0%),
      var(--border-strong) var(--theory-tts-progress, 0%),
      var(--border-strong) 100%
    );
  }
  .theory-tts-seek::-moz-range-track {
    height: 4px;
    border-radius: 2px;
    background: var(--border-strong);
  }
  .theory-tts-seek::-moz-range-progress {
    height: 4px;
    border-radius: 2px;
    background: var(--accent);
  }
  .theory-tts-seek::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg-elevated);
    box-shadow: var(--shadow-xs);
    cursor: pointer;
  }
  .theory-tts-seek::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    border: 2px solid var(--bg-elevated);
    box-shadow: var(--shadow-xs);
    cursor: pointer;
  }
  .theory-tts-seek:focus-visible {
    outline: none;
    box-shadow: var(--shadow-focus);
    border-radius: var(--radius-full);
  }
`;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type ButtonState = 'idle' | TtsJobStatus;

export function TheoryWidget({ data }: TheoryWidgetProps) {
  const markdown = useMemo(() => preprocessMath(data.markdown), [data.markdown]);
  const [state, setState] = useState<ButtonState>('idle');
  const [queuePos, setQueuePos] = useState<number>(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [muted, setMuted] = useState(false);
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
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
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
  else if (state === 'ready') label = isPlaying ? '❚❚ Pause' : '▶ Replay';
  else label = 'Read ▶';

  const buttonStyle: CSSProperties = {
    ...buttonBaseStyle,
    opacity: state === 'queued' || state === 'generating' ? 0.85 : 1,
    cursor: state === 'queued' || state === 'generating' ? 'progress' : 'pointer',
  };

  const progressPct =
    duration > 0 && Number.isFinite(duration) ? (currentTime / duration) * 100 : 0;
  const seekStyle: CSSProperties = {
    ...playerSeekStyle,
    ['--theory-tts-progress' as string]: `${progressPct}%`,
  };

  function handleSeek(next: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(next)) return;
    try {
      audio.currentTime = next;
    } catch {
      /* ignore */
    }
    setCurrentTime(next);
  }

  function handleToggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    const next = !muted;
    audio.muted = next;
    setMuted(next);
  }

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
        <div style={controlsRowStyle}>
          <button
            type="button"
            data-testid="theory-tts-button"
            aria-label={label}
            data-state={state}
            onClick={handleClick}
            style={buttonStyle}
          >
            {state === 'generating' ? <span style={spinnerStyle} aria-hidden /> : null}
            {state === 'ready' ? (
              isPlaying ? (
                <Pause size={14} strokeWidth={2.5} aria-hidden fill="currentColor" />
              ) : (
                <Play size={14} strokeWidth={2.5} aria-hidden fill="currentColor" />
              )
            ) : null}
            <span>{label}</span>
          </button>
          {state === 'ready' && blobUrl ? (
            <div data-testid="theory-tts-player" style={playerWrapStyle}>
              <button
                type="button"
                data-testid="theory-tts-player-toggle"
                aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
                onClick={handleClick}
                style={playerToggleStyle}
              >
                {isPlaying ? (
                  <Pause size={12} aria-hidden fill="currentColor" />
                ) : (
                  <Play size={12} aria-hidden fill="currentColor" />
                )}
              </button>
              <span style={playerTimeStyle} data-testid="theory-tts-current">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                className="theory-tts-seek"
                data-testid="theory-tts-seek"
                min={0}
                max={Number.isFinite(duration) && duration > 0 ? duration : 0}
                step={0.01}
                value={Number.isFinite(currentTime) ? currentTime : 0}
                onChange={(e) => handleSeek(Number(e.target.value))}
                aria-label="Seek audio position"
                style={seekStyle}
              />
              <span style={playerTimeStyle} data-testid="theory-tts-duration">
                {formatTime(duration)}
              </span>
              <button
                type="button"
                data-testid="theory-tts-mute"
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
                aria-pressed={muted}
                onClick={handleToggleMute}
                style={playerMuteStyle}
              >
                {muted ? (
                  <VolumeX size={14} aria-hidden />
                ) : (
                  <Volume2 size={14} aria-hidden />
                )}
              </button>
              <audio
                ref={audioRef}
                data-testid="theory-tts-audio"
                src={blobUrl}
                style={hiddenAudioStyle}
                onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
                onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime || 0)}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => setIsPlaying(false)}
              />
            </div>
          ) : null}
        </div>
        {error ? (
          <div role="status" data-testid="theory-tts-error" style={errorChipStyle}>
            {error}
          </div>
        ) : null}
      </div>
    </>
  );
}
