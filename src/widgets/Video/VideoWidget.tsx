'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import {
  VideoDataSchema,
  extractYouTubeId,
  type VideoData,
  type VideoTranscriptSegment,
} from './schema';

export interface VideoWidgetProps {
  data: VideoData;
  /**
   * Called once per mount when an auto-fetched transcript is successfully retrieved
   * for a YouTube video that arrived with no transcript baked in. The caller
   * persists the segments back into the lesson JSON so subsequent renders short-circuit
   * the fetch (cache). Manually-provided transcripts NEVER trigger this callback.
   */
  onTranscriptFetched?: (segments: VideoTranscriptSegment[]) => void;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const playerWrapStyle: CSSProperties = {
  padding: 'var(--space-4) var(--space-5)',
  background: 'var(--bg-subtle)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const aspectStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  aspectRatio: '16 / 9',
  background: '#000',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
  border: '1px solid var(--border)',
};

const playerElStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  border: 'none',
  display: 'block',
};

const titleStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  textAlign: 'center',
  lineHeight: 1.5,
};

const transcriptWrapStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const toggleButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  background: 'transparent',
  border: 'none',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  width: '100%',
  textAlign: 'left',
};

const transcriptListStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  maxHeight: 320,
  overflow: 'auto',
  padding: 'var(--space-2) 0',
  display: 'flex',
  flexDirection: 'column',
};

const segmentBaseStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 'var(--space-3)',
  padding: '6px var(--space-5)',
  background: 'transparent',
  border: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  color: 'var(--text)',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
  width: '100%',
  fontFamily: 'inherit',
};

const segmentTimeStyle: CSSProperties = {
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  width: 56,
  textAlign: 'right',
  paddingTop: 2,
  fontVariantNumeric: 'tabular-nums',
};

const segmentBodyStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
};

const speakerStyle: CSSProperties = {
  display: 'inline-block',
  marginRight: 6,
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
};

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildYouTubeEmbedUrl(videoId: string, opts: { autoplay: boolean; startAt?: number }): string {
  const url = new URL(`https://www.youtube-nocookie.com/embed/${videoId}`);
  url.searchParams.set('enablejsapi', '1');
  url.searchParams.set('rel', '0');
  url.searchParams.set('modestbranding', '1');
  if (opts.autoplay) url.searchParams.set('autoplay', '1');
  if (opts.startAt && opts.startAt > 0) {
    url.searchParams.set('start', String(Math.floor(opts.startAt)));
  }
  return url.toString();
}

function findActiveSegmentIndex(transcript: VideoTranscriptSegment[], time: number): number {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const seg = transcript[i];
    if (time + 0.001 >= seg.tStart) {
      if (seg.tEnd === undefined || time < seg.tEnd) return i;
      const next = transcript[i + 1];
      if (!next) return i;
      if (time < next.tStart) return i;
      return -1;
    }
  }
  return -1;
}

export function VideoWidget({ data: rawData, onTranscriptFetched }: VideoWidgetProps) {
  const data = useMemo(() => VideoDataSchema.parse(rawData), [rawData]);
  const reactId = useId();
  const transcriptId = `video-transcript-${reactId}`;
  const [transcriptOpen, setTranscriptOpen] = useState(true);
  const [currentTime, setCurrentTime] = useState(data.startAt ?? 0);
  const [autoTranscript, setAutoTranscript] = useState<VideoTranscriptSegment[] | null>(null);
  const autoFetchAttemptedRef = useRef(false);
  const onTranscriptFetchedRef = useRef(onTranscriptFetched);
  useEffect(() => {
    onTranscriptFetchedRef.current = onTranscriptFetched;
  }, [onTranscriptFetched]);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytPollIntervalRef = useRef<number | null>(null);
  const pendingYtSeekRef = useRef<number | null>(null);

  const youtubeId = data.kind === 'youtube' ? extractYouTubeId(data.src) : null;
  const youtubeEmbedUrl = useMemo(() => {
    if (data.kind !== 'youtube' || !youtubeId) return null;
    return buildYouTubeEmbedUrl(youtubeId, {
      autoplay: data.autoplay ?? false,
      startAt: data.startAt,
    });
  }, [data.kind, youtubeId, data.autoplay, data.startAt]);

  const postYouTubeCommand = useCallback((command: string, args: unknown[] = []) => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage(
      JSON.stringify({ event: 'command', func: command, args }),
      '*',
    );
  }, []);

  useEffect(() => {
    if (data.kind !== 'youtube') return;
    function onMessage(event: MessageEvent) {
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;
      const raw = event.data;
      if (typeof raw !== 'string') return;
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      const obj = payload as { event?: string; info?: unknown };
      if (obj.event === 'onReady') {
        postYouTubeCommand('addEventListener', ['onStateChange']);
        if (pendingYtSeekRef.current !== null) {
          postYouTubeCommand('seekTo', [pendingYtSeekRef.current, true]);
          pendingYtSeekRef.current = null;
        }
        if (ytPollIntervalRef.current === null) {
          ytPollIntervalRef.current = window.setInterval(() => {
            const w = iframeRef.current?.contentWindow;
            if (!w) return;
            w.postMessage(
              JSON.stringify({ event: 'listening', id: 'ai-lecturer-time' }),
              '*',
            );
            postYouTubeCommand('getCurrentTime');
          }, 250);
        }
      } else if (obj.event === 'infoDelivery') {
        const info = obj.info as { currentTime?: number } | undefined;
        if (info && typeof info.currentTime === 'number') {
          setCurrentTime(info.currentTime);
        }
      }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      if (ytPollIntervalRef.current !== null) {
        clearInterval(ytPollIntervalRef.current);
        ytPollIntervalRef.current = null;
      }
    };
  }, [data.kind, postYouTubeCommand]);

  useEffect(() => {
    if (data.kind !== 'mp4') return;
    const el = videoRef.current;
    if (!el) return;
    if (data.startAt && data.startAt > 0) {
      try {
        el.currentTime = data.startAt;
      } catch {
        /* ignore */
      }
    }
  }, [data.kind, data.startAt]);

  const handleMp4TimeUpdate = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setCurrentTime(el.currentTime);
  }, []);

  const seekTo = useCallback(
    (seconds: number) => {
      if (data.kind === 'youtube') {
        const win = iframeRef.current?.contentWindow;
        if (!win) {
          pendingYtSeekRef.current = seconds;
          return;
        }
        postYouTubeCommand('seekTo', [seconds, true]);
        postYouTubeCommand('playVideo');
        setCurrentTime(seconds);
      } else {
        const el = videoRef.current;
        if (!el) return;
        try {
          el.currentTime = seconds;
        } catch {
          /* ignore */
        }
        setCurrentTime(seconds);
        if (el.paused) {
          void el.play().catch(() => {
            /* ignore */
          });
        }
      }
    },
    [data.kind, postYouTubeCommand],
  );

  const manualTranscript = data.transcript;
  const hasManualTranscript = !!manualTranscript && manualTranscript.length > 0;
  const transcript = hasManualTranscript
    ? manualTranscript!
    : autoTranscript ?? [];
  const activeIndex = transcript.length
    ? findActiveSegmentIndex(transcript, currentTime)
    : -1;

  useEffect(() => {
    // Manual transcript wins; never auto-fetch when one is already on disk.
    if (hasManualTranscript) return;
    if (data.kind !== 'youtube' || !youtubeId) return;
    if (autoFetchAttemptedRef.current) return;
    autoFetchAttemptedRef.current = true;
    // No cancel-on-unmount flag: in React StrictMode the cleanup pass would
    // cancel the in-flight fetch from the first setup, and the ref guard
    // would then short-circuit the second setup — leaving the transcript
    // stuck. Tolerate orphan setStates instead (React 18+ no longer warns).
    void (async () => {
      try {
        const res = await fetch(
          `/api/video-transcript?videoId=${encodeURIComponent(youtubeId)}`,
          { method: 'GET' },
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          segments?: VideoTranscriptSegment[];
          source?: string;
        };
        const segs = Array.isArray(body.segments) ? body.segments : [];
        if (segs.length === 0) return;
        setAutoTranscript(segs);
        onTranscriptFetchedRef.current?.(segs);
      } catch {
        // Silent — transcript stays blank. No error UI per AC.
      }
    })();
  }, [data.kind, youtubeId, hasManualTranscript]);

  return (
    <div data-video-widget data-video-kind={data.kind} style={wrapStyle}>
      <div style={playerWrapStyle}>
        <div style={aspectStyle} data-testid="video-player-frame">
          {data.kind === 'youtube' ? (
            youtubeEmbedUrl ? (
              <iframe
                ref={iframeRef}
                title={data.title ?? 'YouTube video'}
                src={youtubeEmbedUrl}
                style={playerElStyle}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                data-testid="video-iframe"
                data-yt-id={youtubeId ?? ''}
              />
            ) : (
              <div
                data-testid="video-error"
                style={{
                  ...playerElStyle,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-on-accent, #fff)',
                  fontSize: 'var(--fs-sm)',
                  padding: '0 var(--space-4)',
                  textAlign: 'center',
                }}
              >
                Could not parse YouTube ID from <code>{data.src}</code>
              </div>
            )
          ) : (
            <video
              ref={videoRef}
              src={data.src}
              controls
              autoPlay={data.autoplay}
              preload="metadata"
              onTimeUpdate={handleMp4TimeUpdate}
              onLoadedMetadata={handleMp4TimeUpdate}
              style={playerElStyle}
              data-testid="video-mp4"
            />
          )}
        </div>
        {data.title && (
          <div style={titleStyle} data-testid="video-title">
            {data.title}
          </div>
        )}
      </div>
      {transcript.length > 0 && (
        <div style={transcriptWrapStyle}>
          <button
            type="button"
            data-testid="video-transcript-toggle"
            aria-expanded={transcriptOpen}
            aria-controls={transcriptId}
            onClick={() => setTranscriptOpen((v) => !v)}
            style={toggleButtonStyle}
          >
            {transcriptOpen ? (
              <ChevronDown size={14} aria-hidden />
            ) : (
              <ChevronRight size={14} aria-hidden />
            )}
            {transcriptOpen ? 'Hide transcript' : 'Show transcript'}
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-tertiary)',
              }}
            >
              {transcript.length} segment{transcript.length === 1 ? '' : 's'}
            </span>
          </button>
          {transcriptOpen && (
            <div
              id={transcriptId}
              data-testid="video-transcript-list"
              style={transcriptListStyle}
            >
              {transcript.map((seg, i) => {
                const active = i === activeIndex;
                const segStyle: CSSProperties = active
                  ? {
                      ...segmentBaseStyle,
                      background: 'var(--accent-subtle)',
                      color: 'var(--accent-text)',
                    }
                  : segmentBaseStyle;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => seekTo(seg.tStart)}
                    style={segStyle}
                    data-testid={`video-transcript-seg-${i}`}
                    data-active={active ? 'true' : 'false'}
                    aria-label={`Jump to ${formatTimestamp(seg.tStart)}: ${seg.text}`}
                  >
                    <span style={segmentTimeStyle}>{formatTimestamp(seg.tStart)}</span>
                    <span style={segmentBodyStyle}>
                      {seg.speaker && <span style={speakerStyle}>{seg.speaker}</span>}
                      {seg.text}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
