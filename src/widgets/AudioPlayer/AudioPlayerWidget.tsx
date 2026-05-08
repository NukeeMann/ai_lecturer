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
import {
  Headphones,
  Pause,
  Play,
  Volume2,
  VolumeX,
} from 'lucide-react';

import {
  AudioPlayerDataSchema,
  buildAudioUrl,
  type AudioPlayerData,
} from './schema';

export interface AudioPlayerWidgetProps {
  data: AudioPlayerData;
  courseSlug: string;
}

const PLAYBACK_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
type PlaybackRate = (typeof PLAYBACK_RATES)[number];

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

const titleRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 600,
  color: 'var(--text)',
};

const controlsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  flexWrap: 'wrap',
};

const playButtonStyle: CSSProperties = {
  width: 40,
  height: 40,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-full)',
  border: '1px solid var(--accent-border)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  cursor: 'pointer',
  flexShrink: 0,
};

const seekRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  flex: '1 1 280px',
};

const timeStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-tertiary)',
  fontVariantNumeric: 'tabular-nums',
  flexShrink: 0,
  whiteSpace: 'nowrap',
};

const sliderStyle: CSSProperties = {
  flex: 1,
  accentColor: 'var(--accent)',
  cursor: 'pointer',
};

const muteButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  flexShrink: 0,
};

const volumeRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
};

const volumeSliderStyle: CSSProperties = {
  width: 90,
  accentColor: 'var(--accent)',
  cursor: 'pointer',
};

const speedSelectStyle: CSSProperties = {
  height: 28,
  padding: '0 8px',
  fontSize: 'var(--fs-xs)',
  fontFamily: 'var(--font-mono)',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  flexShrink: 0,
};

const transcriptDetailsStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
};

const transcriptSummaryStyle: CSSProperties = {
  padding: '8px var(--space-5)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  listStyle: 'none',
};

const transcriptBodyStyle: CSSProperties = {
  padding: '0 var(--space-5) var(--space-4)',
  fontFamily: 'var(--font-prose)',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.6,
  color: 'var(--text)',
  whiteSpace: 'pre-wrap',
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function AudioPlayerWidget({ data: rawData, courseSlug }: AudioPlayerWidgetProps) {
  const data = useMemo(() => AudioPlayerDataSchema.parse(rawData), [rawData]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reactId = useId();
  const transcriptId = `audio-transcript-${reactId}`;

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<PlaybackRate>(1);

  const audioUrl = useMemo(
    () => buildAudioUrl(courseSlug, data.audioPath),
    [courseSlug, data.audioPath],
  );

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.playbackRate = playbackRate;
  }, [playbackRate, audioUrl]);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted]);

  const handlePlayPause = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {
        /* ignore — autoplay policy or aborted load */
      });
    } else {
      el.pause();
    }
  }, []);

  const handleSeekChange = useCallback((next: number) => {
    const el = audioRef.current;
    if (!el) return;
    if (!Number.isFinite(next)) return;
    try {
      el.currentTime = next;
    } catch {
      /* ignore */
    }
    setCurrentTime(next);
  }, []);

  const seekDelta = useCallback((delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    const next = Math.max(0, Math.min((el.duration || 0), el.currentTime + delta));
    try {
      el.currentTime = next;
    } catch {
      /* ignore */
    }
    setCurrentTime(next);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      // Don't hijack typing in form fields (e.g. transcript readers, future inputs).
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (event.key === ' ' || event.code === 'Space') {
        event.preventDefault();
        handlePlayPause();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekDelta(-5);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekDelta(5);
      }
    },
    [handlePlayPause, seekDelta],
  );

  const VolumeIcon = muted || volume === 0 ? VolumeX : Volume2;

  return (
    <div
      ref={containerRef}
      data-audio-player-widget
      data-testid="audio-player-widget"
      style={wrapStyle}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      role="region"
      aria-label={data.title ? `Audio player: ${data.title}` : 'Audio player'}
    >
      <div style={playerWrapStyle}>
        {data.title && (
          <div style={titleRowStyle} data-testid="audio-player-title">
            <Headphones size={14} aria-hidden />
            <span>{data.title}</span>
          </div>
        )}
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          autoPlay={data.autoplay}
          controls={false}
          data-testid="audio-player-audio"
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration || 0);
          }}
          onTimeUpdate={(e) => {
            setCurrentTime(e.currentTarget.currentTime || 0);
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onVolumeChange={(e) => {
            setVolume(e.currentTarget.volume);
            setMuted(e.currentTarget.muted);
          }}
        />
        <div style={controlsRowStyle}>
          <button
            type="button"
            data-testid="audio-player-play-toggle"
            onClick={handlePlayPause}
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
            aria-pressed={isPlaying}
            style={playButtonStyle}
          >
            {isPlaying ? (
              <Pause size={16} aria-hidden fill="currentColor" />
            ) : (
              <Play size={16} aria-hidden fill="currentColor" />
            )}
          </button>
          <div style={seekRowStyle}>
            <span style={timeStyle} data-testid="audio-player-current-time">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              data-testid="audio-player-seek"
              min={0}
              max={Number.isFinite(duration) && duration > 0 ? duration : 0}
              step={0.01}
              value={Number.isFinite(currentTime) ? currentTime : 0}
              onChange={(e) => handleSeekChange(Number(e.target.value))}
              aria-label="Seek audio position"
              style={sliderStyle}
            />
            <span style={timeStyle} data-testid="audio-player-duration">
              {formatTime(duration)}
            </span>
          </div>
          <div style={volumeRowStyle}>
            <button
              type="button"
              data-testid="audio-player-mute-toggle"
              onClick={() => setMuted((v) => !v)}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              aria-pressed={muted}
              style={muteButtonStyle}
            >
              <VolumeIcon size={16} aria-hidden />
            </button>
            <input
              type="range"
              data-testid="audio-player-volume"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const next = Number(e.target.value);
                setVolume(next);
                if (next > 0 && muted) setMuted(false);
              }}
              aria-label="Audio volume"
              style={volumeSliderStyle}
            />
          </div>
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 'var(--fs-xs)',
              color: 'var(--text-tertiary)',
            }}
          >
            <span>Speed</span>
            <select
              data-testid="audio-player-speed"
              value={String(playbackRate)}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (PLAYBACK_RATES.includes(n as PlaybackRate)) {
                  setPlaybackRate(n as PlaybackRate);
                }
              }}
              aria-label="Playback speed"
              style={speedSelectStyle}
            >
              {PLAYBACK_RATES.map((r) => (
                <option key={r} value={String(r)}>
                  {r}x
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      {data.transcript && data.transcript.trim().length > 0 && (
        <details style={transcriptDetailsStyle} data-testid="audio-player-transcript">
          <summary
            style={transcriptSummaryStyle}
            data-testid="audio-player-transcript-summary"
            aria-controls={transcriptId}
          >
            Show transcript
          </summary>
          <div
            id={transcriptId}
            style={transcriptBodyStyle}
            data-testid="audio-player-transcript-body"
          >
            {data.transcript}
          </div>
        </details>
      )}
    </div>
  );
}
