// US-184: hybrid speech-to-text capture for the LessonChat mic button.
//
// Two backends, picked at start time:
//
//   1. Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`) when
//      available. Final transcripts accumulate locally; only finals are
//      delivered to the caller — interim text would flicker the textarea.
//   2. MediaRecorder + POST `/api/stt/upload` as a fallback, mirroring the
//      shape used by src/widgets/SttDemo/SttDemoWidget.tsx (same mimeType
//      probe, same FormData field name, same release-tracks-on-stop dance).
//
// Web Speech errors map directly to user-visible error messages — we don't
// switch to MediaRecorder mid-session for `not-allowed`, since that almost
// always means the OS-level mic permission was denied and MediaRecorder
// would fail with the same error.

export type SttCaptureState = 'recording' | 'uploading' | 'idle';

export interface SttCaptureOptions {
  /** Fires once with the final transcript when capture finishes successfully. */
  onTranscript: (text: string) => void;
  /** Fires with a user-facing error message (already localized to product copy). */
  onError: (message: string) => void;
  /** Fires whenever the capture lifecycle transitions. */
  onStateChange: (state: SttCaptureState) => void;
}

export interface SttCaptureSession {
  /** User-triggered stop. Triggers transcript delivery or upload. */
  stop(): void;
  /** Tear down without delivering a transcript (for unmount). */
  dispose(): void;
}

type SpeechRecognitionResult = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type SpeechRecognitionEvent = {
  results?: ArrayLike<SpeechRecognitionResult>;
};

type SpeechRecognitionErrorEvent = {
  error?: string;
};

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function pickSttMimeType(): string | undefined {
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

async function safeJson(
  res: Response,
): Promise<{ text?: string; transcript?: string; message?: string } | null> {
  try {
    return (await res.json()) as {
      text?: string;
      transcript?: string;
      message?: string;
    };
  } catch {
    return null;
  }
}

export function startSttCapture(opts: SttCaptureOptions): SttCaptureSession {
  const SR = getSpeechRecognitionCtor();
  if (SR) {
    return startWebSpeechCapture(SR, opts);
  }
  return startMediaRecorderCapture(opts);
}

function startWebSpeechCapture(
  SR: SpeechRecognitionCtor,
  opts: SttCaptureOptions,
): SttCaptureSession {
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  const lang =
    (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
  rec.lang = lang;

  let finalBuffer = '';
  let delivered = false;
  let disposed = false;
  let errored = false;

  const deliverTranscript = () => {
    if (delivered || errored || disposed) return;
    delivered = true;
    opts.onStateChange('idle');
    const trimmed = finalBuffer.trim();
    if (trimmed.length > 0) {
      opts.onTranscript(trimmed);
    }
  };

  rec.onresult = (event) => {
    if (disposed) return;
    const results = event.results;
    if (!results) return;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (!r || !r.isFinal) continue;
      const alt = r[0];
      const t = alt?.transcript;
      if (typeof t === 'string') finalBuffer += t;
    }
  };

  rec.onerror = (event) => {
    if (disposed || errored || delivered) return;
    errored = true;
    const code = event.error ?? 'unknown';
    let msg: string;
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      msg = 'Microphone access denied';
    } else if (code === 'network') {
      msg = "Couldn't transcribe — try again";
    } else if (code === 'no-speech') {
      msg = "Couldn't transcribe — try again";
    } else {
      msg = "Couldn't transcribe — try again";
    }
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
    opts.onStateChange('idle');
    opts.onError(msg);
  };

  rec.onend = () => {
    deliverTranscript();
  };

  try {
    rec.start();
    opts.onStateChange('recording');
  } catch (err) {
    errored = true;
    opts.onStateChange('idle');
    opts.onError((err as Error)?.message ?? "Couldn't start voice input");
  }

  return {
    stop: () => {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      // Some implementations only fire onend asynchronously after `.stop()`;
      // deliver immediately so the textarea updates without an extra tick.
      deliverTranscript();
    },
    dispose: () => {
      disposed = true;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    },
  };
}

function startMediaRecorderCapture(opts: SttCaptureOptions): SttCaptureSession {
  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  const chunks: BlobPart[] = [];
  let mimeType: string | undefined;
  let disposed = false;
  let userStopRequested = false;

  const releaseStream = () => {
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
      stream = null;
    }
  };

  const emitError = (msg: string) => {
    if (disposed) return;
    opts.onStateChange('idle');
    opts.onError(msg);
  };

  const uploadAndTranscribe = async (blob: Blob) => {
    if (disposed) return;
    opts.onStateChange('uploading');
    try {
      const form = new FormData();
      const ext = extFromMime(mimeType);
      form.append('audio', blob, `recording.${ext}`);
      const res = await fetch('/api/stt/upload', {
        method: 'POST',
        body: form,
      });
      if (disposed) return;
      if (res.status === 503) {
        const detail = await safeJson(res);
        emitError(detail?.message ?? 'whisper.cpp is not installed');
        return;
      }
      if (!res.ok) {
        const detail = await safeJson(res);
        emitError(detail?.message ?? "Couldn't transcribe — try again");
        return;
      }
      const payload = await safeJson(res);
      // AC names `{ text }` as the expected response shape; the real
      // /api/stt/upload returns `{ transcript }`. Accept either so the
      // literal-AC test mock and production both deliver a transcript.
      const text =
        typeof payload?.text === 'string'
          ? payload.text
          : typeof payload?.transcript === 'string'
            ? payload.transcript
            : '';
      opts.onStateChange('idle');
      const trimmed = text.trim();
      if (trimmed.length > 0) opts.onTranscript(trimmed);
    } catch (err) {
      emitError((err as Error)?.message ?? "Couldn't transcribe — try again");
    }
  };

  void (async () => {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      emitError('Microphone capture is not supported in this browser');
      return;
    }
    let acquired: MediaStream;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const isNotAllowed =
        typeof DOMException !== 'undefined' &&
        err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      emitError(
        isNotAllowed
          ? 'Microphone access denied'
          : ((err as Error)?.message ?? 'Microphone error'),
      );
      return;
    }
    stream = acquired;
    if (disposed) {
      releaseStream();
      return;
    }
    if (userStopRequested) {
      releaseStream();
      opts.onStateChange('idle');
      return;
    }
    mimeType = pickSttMimeType();
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      releaseStream();
      emitError((err as Error)?.message ?? 'Recorder error');
      return;
    }
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      const localRecorder = recorder;
      const blob = new Blob(chunks, {
        type: mimeType ?? localRecorder?.mimeType ?? 'audio/webm',
      });
      releaseStream();
      if (disposed) return;
      if (!userStopRequested) return;
      void uploadAndTranscribe(blob);
    };
    try {
      recorder.start();
      opts.onStateChange('recording');
    } catch (err) {
      releaseStream();
      emitError((err as Error)?.message ?? 'Recorder error');
    }
  })();

  return {
    stop: () => {
      userStopRequested = true;
      if (!recorder) {
        // getUserMedia hasn't resolved yet — abort before any recording starts.
        disposed = true;
        releaseStream();
        opts.onStateChange('idle');
        return;
      }
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
    },
    dispose: () => {
      disposed = true;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          /* ignore */
        }
      }
      releaseStream();
    },
  };
}
