'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { Loader2, Mic, Square } from 'lucide-react';

import { SttDemoDataSchema, type SttDemoData } from './schema';

// UX choice: a single click-to-toggle button (start → stop). One affordance,
// one keyboard target — matches the AC and avoids the discoverability cost of
// separate Record / Stop buttons. A red-dot indicator + mm:ss timer makes the
// "recording in progress" state unambiguous; the recorder also auto-stops at
// maxDurationSeconds so the user never has to stop a runaway capture.

export interface SttDemoWidgetProps {
  data?: SttDemoData | unknown;
}

type Phase = 'idle' | 'recording' | 'uploading' | 'transcribed' | 'error';

interface StoredError {
  kind: 'mic-permission' | 'not-installed' | 'spawn' | 'other';
  message: string;
}

const wrapStyle: CSSProperties = {
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const promptStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  lineHeight: 1.5,
};

const controlsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  flexWrap: 'wrap',
};

function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 36,
    padding: '0 var(--space-4)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--fs-sm)',
    fontWeight: 500,
    background: disabled ? 'var(--bg-active)' : 'var(--accent)',
    color: disabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
    border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.75 : 1,
  };
}

const recordingIndicatorRowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
};

const redDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
  background: '#dc2626',
  animation: 'sttDemoBlink 1s steps(2, start) infinite',
  flexShrink: 0,
};

const helperTextStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
};

const transcriptStyle: CSSProperties = {
  padding: 'var(--space-3) var(--space-4)',
  background: 'var(--bg-subtle)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--border)',
  whiteSpace: 'pre-wrap',
  fontFamily: 'var(--font-prose)',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.55,
  color: 'var(--text)',
};

function errorBlockStyle(): CSSProperties {
  return {
    padding: 'var(--space-3) var(--space-4)',
    background: 'var(--danger-subtle, rgba(220,38,38,0.08))',
    border: '1px solid var(--danger-border, rgba(220,38,38,0.35))',
    borderRadius: 'var(--radius-md)',
    color: 'var(--danger, #dc2626)',
    fontSize: 'var(--fs-sm)',
    lineHeight: 1.5,
  };
}

function formatTimer(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function extFromMime(mime: string | undefined): string {
  if (!mime) return 'webm';
  if (mime.startsWith('audio/webm')) return 'webm';
  if (mime.startsWith('audio/ogg')) return 'ogg';
  if (mime.startsWith('audio/mp4')) return 'm4a';
  if (mime.startsWith('audio/wav')) return 'wav';
  return 'webm';
}

export function SttDemoWidget({ data: rawData }: SttDemoWidgetProps) {
  const data: SttDemoData = useMemo(() => {
    const parsed = SttDemoDataSchema.safeParse(rawData ?? {});
    return parsed.success
      ? parsed.data
      : SttDemoDataSchema.parse({});
  }, [rawData]);

  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<StoredError | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedAtRef = useRef<number>(0);

  const stopRecorderTimers = useCallback(() => {
    if (tickIntervalRef.current !== null) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (autoStopTimeoutRef.current !== null) {
      clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const track of s.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
    streamRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopRecorderTimers();
      releaseStream();
      const r = recorderRef.current;
      if (r && r.state !== 'inactive') {
        try {
          r.stop();
        } catch {
          /* ignore */
        }
      }
      recorderRef.current = null;
    };
  }, [stopRecorderTimers, releaseStream]);

  const uploadAndTranscribe = useCallback(
    async (blob: Blob, mime: string | undefined) => {
      setPhase('uploading');
      try {
        const form = new FormData();
        const ext = extFromMime(mime);
        form.append('audio', blob, `recording.${ext}`);
        const res = await fetch('/api/stt/upload', {
          method: 'POST',
          body: form,
        });
        if (res.status === 503) {
          const detail = await safeJson(res);
          setError({
            kind: 'not-installed',
            message:
              detail?.message ??
              'whisper.cpp is not installed. Run scripts/setup-stt.sh to install it.',
          });
          setPhase('error');
          return;
        }
        if (res.status === 500) {
          const detail = await safeJson(res);
          setError({
            kind: 'spawn',
            message:
              detail?.message ??
              detail?.detail ??
              'whisper.cpp failed to run. Check the dev server logs for the spawn error.',
          });
          setPhase('error');
          return;
        }
        if (!res.ok) {
          const detail = await safeJson(res);
          setError({
            kind: 'other',
            message:
              detail?.message ??
              `Upload failed with HTTP ${res.status}`,
          });
          setPhase('error');
          return;
        }
        const payload = await safeJson(res);
        const text =
          typeof payload?.transcript === 'string' ? payload.transcript : '';
        setTranscript(text);
        setPhase('transcribed');
      } catch (err) {
        setError({
          kind: 'other',
          message: err instanceof Error ? err.message : String(err),
        });
        setPhase('error');
      }
    },
    [],
  );

  const stopRecording = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') {
      try {
        r.stop();
      } catch {
        /* ignore */
      }
    }
    stopRecorderTimers();
  }, [stopRecorderTimers]);

  const startRecording = useCallback(async () => {
    setError(null);
    setTranscript(null);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError({
        kind: 'other',
        message: 'Microphone capture is not supported in this browser.',
      });
      setPhase('error');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const isNotAllowed =
        typeof DOMException !== 'undefined' &&
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setError({
        kind: isNotAllowed ? 'mic-permission' : 'other',
        message: isNotAllowed
          ? 'Microphone permission denied. Allow microphone access in your browser settings and try again.'
          : err instanceof Error
          ? err.message
          : String(err),
      });
      setPhase('error');
      return;
    }
    streamRef.current = stream;

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      releaseStream();
      setError({
        kind: 'other',
        message: err instanceof Error ? err.message : String(err),
      });
      setPhase('error');
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: mimeType ?? recorder.mimeType ?? 'audio/webm',
      });
      chunksRef.current = [];
      releaseStream();
      void uploadAndTranscribe(blob, mimeType ?? recorder.mimeType);
    };

    setPhase('recording');
    setElapsedSeconds(0);
    startedAtRef.current = Date.now();
    try {
      recorder.start();
    } catch (err) {
      releaseStream();
      setError({
        kind: 'other',
        message: err instanceof Error ? err.message : String(err),
      });
      setPhase('error');
      return;
    }
    tickIntervalRef.current = setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsedSeconds(seconds);
    }, 200);
    autoStopTimeoutRef.current = setTimeout(() => {
      stopRecording();
    }, data.maxDurationSeconds * 1000);
  }, [
    data.maxDurationSeconds,
    releaseStream,
    stopRecording,
    uploadAndTranscribe,
  ]);

  const handleToggle = useCallback(() => {
    if (phase === 'recording') {
      stopRecording();
    } else if (phase === 'uploading') {
      // ignore — wait for response
    } else {
      void startRecording();
    }
  }, [phase, startRecording, stopRecording]);

  const buttonDisabled = phase === 'uploading';

  let buttonLabel = 'Start recording';
  let ButtonIcon: typeof Mic = Mic;
  if (phase === 'recording') {
    buttonLabel = 'Stop recording';
    ButtonIcon = Square;
  } else if (phase === 'uploading') {
    buttonLabel = 'Transcribing…';
    ButtonIcon = Loader2;
  } else if (phase === 'transcribed' || phase === 'error') {
    buttonLabel = 'Record again';
    ButtonIcon = Mic;
  }

  return (
    <div
      data-testid="stt-demo-widget"
      data-stt-phase={phase}
      style={wrapStyle}
    >
      <style>{'@keyframes sttDemoBlink { 50% { opacity: 0.25; } }'}</style>
      {data.prompt && <div style={promptStyle}>{data.prompt}</div>}
      <div style={controlsRowStyle}>
        <button
          type="button"
          data-testid="stt-demo-toggle"
          onClick={handleToggle}
          disabled={buttonDisabled}
          aria-pressed={phase === 'recording'}
          aria-label={buttonLabel}
          style={primaryButtonStyle(buttonDisabled)}
        >
          <ButtonIcon
            size={16}
            aria-hidden
            style={
              phase === 'uploading'
                ? { animation: 'spin 1s linear infinite' }
                : undefined
            }
          />
          <span>{buttonLabel}</span>
        </button>
        {phase === 'recording' && (
          <div
            style={recordingIndicatorRowStyle}
            data-testid="stt-demo-recording-indicator"
            role="status"
            aria-live="polite"
          >
            <span style={redDotStyle} aria-hidden />
            <span>REC</span>
            <span data-testid="stt-demo-timer">
              {formatTimer(elapsedSeconds)}
            </span>
            <span style={helperTextStyle}>
              / {formatTimer(data.maxDurationSeconds)} max
            </span>
          </div>
        )}
        {phase === 'uploading' && (
          <span
            style={helperTextStyle}
            data-testid="stt-demo-uploading"
            role="status"
            aria-live="polite"
          >
            Sending to whisper.cpp…
          </span>
        )}
      </div>
      {phase === 'transcribed' && transcript !== null && (
        <div data-testid="stt-demo-transcript" style={transcriptStyle}>
          {transcript.length > 0 ? transcript : '(empty transcript)'}
        </div>
      )}
      {phase === 'error' && error && (
        <div
          data-testid="stt-demo-error"
          data-stt-error-kind={error.kind}
          role="alert"
          style={errorBlockStyle()}
        >
          {error.message}
        </div>
      )}
    </div>
  );
}

async function safeJson(res: Response): Promise<
  | { message?: string; transcript?: string; detail?: string; error?: string }
  | null
> {
  try {
    return (await res.json()) as {
      message?: string;
      transcript?: string;
      detail?: string;
      error?: string;
    };
  } catch {
    return null;
  }
}
