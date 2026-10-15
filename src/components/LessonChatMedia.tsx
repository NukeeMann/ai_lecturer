'use client';

/**
 * Media + research-log pieces of the AI Tutor panel (LessonChat).
 *
 * Image policy enforced here, independent of what the model writes:
 * - `/api/lesson-chat/media/<id>.<ext>` (the verified store) renders with a
 *   source caption built from the stored provenance record — the caption
 *   never depends on the model remembering to cite;
 * - `/api/courses/<slug>/assets/…` (lesson illustrations) renders as-is;
 * - anything else (an external or invented URL) is NOT rendered — a notice
 *   with a plain link takes its place.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { AlertTriangle, ExternalLink, Globe, ImageIcon, Loader2, Search, ShieldCheck, X } from 'lucide-react';

import { ZoomableImage } from './ZoomableImage';

export const CHAT_MEDIA_PREFIX = '/api/lesson-chat/media/';
const MEDIA_FILE_RE = /^([a-f0-9]{32})\.(png|jpg|gif|webp)$/;
const LESSON_ASSET_RE = /^\/api\/courses\/[^/]+\/assets\//;

export type ActivityKind = 'search' | 'fetch' | 'image' | 'tool' | 'note';

export interface ChatActivityItem {
  /** Tool-use id for live upserts; absent on persisted entries. */
  id?: string;
  kind: ActivityKind;
  label: string;
  url?: string;
  status?: 'running' | 'ok' | 'error';
  detail?: string;
}

interface MediaMeta {
  origin: 'upload' | 'web';
  sourcePageUrl?: string;
  sourceName?: string;
  description?: string;
  author?: string;
  license?: string;
  reliability?: 'high' | 'medium' | 'low';
  reliabilityNote?: string;
  autoNotes?: string[];
  pageCheck?: 'linked' | 'unlinked' | 'blocked';
}

export function chatMediaUrl(file: string): string {
  return `${CHAT_MEDIA_PREFIX}${file}`;
}

/** `<id>.<ext>` when `src` points into the chat media store, else null. */
export function chatMediaFileFromSrc(src: string): string | null {
  let path = src;
  if (/^https?:\/\//i.test(src)) {
    // The model sometimes absolutises our relative URL; accept same-origin only.
    try {
      const u = new URL(src);
      if (typeof window === 'undefined' || u.origin !== window.location.origin) return null;
      path = u.pathname;
    } catch {
      return null;
    }
  }
  if (!path.startsWith(CHAT_MEDIA_PREFIX)) return null;
  const file = path.slice(CHAT_MEDIA_PREFIX.length);
  return MEDIA_FILE_RE.test(file) ? file : null;
}

// Provenance records never change for a given id → cache per page load.
const metaCache = new Map<string, Promise<MediaMeta | null>>();

function loadMeta(id: string): Promise<MediaMeta | null> {
  let p = metaCache.get(id);
  if (!p) {
    p = fetch(`${CHAT_MEDIA_PREFIX}${id}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<MediaMeta>) : null))
      .catch(() => null);
    metaCache.set(id, p);
  }
  return p;
}

function useMediaMeta(id: string): MediaMeta | null | undefined {
  const [meta, setMeta] = useState<MediaMeta | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    void loadMeta(id).then((m) => {
      if (!cancelled) setMeta(m);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return meta;
}

function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** react-markdown `img` override for tutor messages. */
export function ChatMarkdownImage({ src, alt }: { src?: unknown; alt?: string }) {
  const s = typeof src === 'string' ? src : '';
  const file = chatMediaFileFromSrc(s);
  if (file) return <VerifiedImageFigure file={file} alt={alt ?? ''} />;
  if (LESSON_ASSET_RE.test(s)) {
    return (
      <span style={figureStyle} data-testid="chat-image-lesson">
        <ZoomableImage src={s} alt={alt ?? ''} style={figureImgStyle} />
        <span style={captionStyle}>Illustration from this lesson</span>
      </span>
    );
  }
  const href = safeHref(s);
  return (
    <span style={blockedStyle} role="note" data-testid="chat-image-blocked">
      <AlertTriangle size={14} strokeWidth={2} aria-hidden style={iconInline} />
      <span>
        Image not shown — it did not pass the tutor&apos;s image verification
        {alt ? <> (&ldquo;{alt}&rdquo;)</> : null}.
        {href ? (
          <>
            {' '}
            <a href={href} target="_blank" rel="noopener noreferrer">
              Open the link yourself
            </a>{' '}
            and treat it as unverified.
          </>
        ) : null}
      </span>
    </span>
  );
}

function VerifiedImageFigure({ file, alt }: { file: string; alt: string }) {
  const id = file.slice(0, 32);
  const meta = useMediaMeta(id);
  const reliability = meta?.origin === 'web' ? meta.reliability ?? 'low' : undefined;
  return (
    <span
      style={figureStyle}
      data-testid="chat-image-verified"
      data-reliability={reliability ?? (meta === null ? 'unknown' : undefined)}
    >
      <ZoomableImage src={chatMediaUrl(file)} alt={alt} style={figureImgStyle} />
      <span style={captionStyle} data-testid="chat-image-caption">
        {meta === undefined ? (
          <span>Loading source…</span>
        ) : meta === null ? (
          <span style={{ color: 'var(--danger)' }}>
            Source record missing — treat this image as unverified.
          </span>
        ) : meta.origin === 'upload' ? (
          <span>Image attached in this chat</span>
        ) : (
          <WebImageCaption meta={meta} />
        )}
      </span>
    </span>
  );
}

function WebImageCaption({ meta }: { meta: MediaMeta }) {
  const href = safeHref(meta.sourcePageUrl);
  const reliability = meta.reliability ?? 'low';
  const notes = [meta.reliabilityNote, ...(meta.autoNotes ?? [])].filter(
    (n): n is string => typeof n === 'string' && n.length > 0,
  );
  return (
    <>
      <span>
        Source:{' '}
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {meta.sourceName ?? href}
          </a>
        ) : (
          (meta.sourceName ?? 'unknown')
        )}
        {meta.author ? <> · {meta.author}</> : null}
        {meta.license ? <> · {meta.license}</> : null}
      </span>
      <span style={badgeRowStyle}>
        <span style={reliabilityBadgeStyle[reliability]} data-testid="chat-image-reliability">
          {reliability === 'high' ? (
            <ShieldCheck size={12} strokeWidth={2} aria-hidden style={iconInline} />
          ) : (
            <AlertTriangle size={12} strokeWidth={2} aria-hidden style={iconInline} />
          )}
          {RELIABILITY_LABEL[reliability]}
        </span>
        {meta.pageCheck === 'linked' ? <span>source page links this file ✓</span> : null}
      </span>
      {notes.map((n, i) => (
        <span key={i} style={noteStyle}>
          {n}
        </span>
      ))}
    </>
  );
}

const RELIABILITY_LABEL = {
  high: 'Reliable source',
  medium: 'Medium reliability',
  low: 'Low reliability — last resort',
} as const;

// ---------------------------------------------------------------------------
// Learner images
// ---------------------------------------------------------------------------

export function UserImages({ files }: { files: string[] }) {
  if (files.length === 0) return null;
  return (
    <span style={userImagesStyle} data-testid="lesson-chat-user-images">
      {files.map((f) => (
        <ZoomableImage key={f} src={chatMediaUrl(f)} alt="Attached image" style={userImageStyle} />
      ))}
    </span>
  );
}

export interface ComposerAttachment {
  localId: string;
  previewUrl: string;
  status: 'uploading' | 'ready' | 'error';
  file?: string;
  error?: string;
}

export function AttachmentStrip({
  attachments,
  onRemove,
  style,
}: {
  attachments: ComposerAttachment[];
  onRemove: (localId: string) => void;
  style?: CSSProperties;
}) {
  if (attachments.length === 0) return null;
  return (
    <div style={style ? { ...stripStyle, ...style } : stripStyle} data-testid="lesson-chat-attachments">
      {attachments.map((a) => (
        <div
          key={a.localId}
          style={a.status === 'error' ? thumbErrorStyle : thumbStyle}
          data-status={a.status}
          title={a.error ?? undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.previewUrl} alt="Attachment preview" style={thumbImgStyle} />
          {a.status === 'uploading' ? (
            <span style={thumbOverlayStyle} aria-label="Uploading">
              <Loader2 size={16} strokeWidth={2} style={spinStyle} aria-hidden />
            </span>
          ) : null}
          {a.status === 'error' ? (
            <span style={thumbOverlayStyle} aria-label={a.error ?? 'Upload failed'}>
              <AlertTriangle size={16} strokeWidth={2} aria-hidden />
            </span>
          ) : null}
          <button
            type="button"
            aria-label="Remove attachment"
            data-testid="lesson-chat-attachment-remove"
            onClick={() => onRemove(a.localId)}
            style={thumbRemoveStyle}
          >
            <X size={10} strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Research log
// ---------------------------------------------------------------------------

const KIND_VERB: Record<ActivityKind, string> = {
  search: 'Searching',
  fetch: 'Reading',
  image: 'Verifying image',
  tool: 'Using',
  note: 'Note',
};

function KindIcon({ kind }: { kind: ActivityKind }) {
  const props = { size: 12, strokeWidth: 2, 'aria-hidden': true, style: iconInline } as const;
  if (kind === 'search') return <Search {...props} />;
  if (kind === 'fetch') return <Globe {...props} />;
  if (kind === 'image') return <ImageIcon {...props} />;
  return <ExternalLink {...props} />;
}

/** One-line live status under the typing indicator while the tutor works. */
export function ActivityStatus({ activity }: { activity: ChatActivityItem[] }) {
  const running = [...activity].reverse().find((a) => a.kind !== 'note' && a.status === 'running');
  const last = running ?? [...activity].reverse().find((a) => a.kind !== 'note');
  if (!last) return null;
  return (
    <span style={statusLineStyle} data-testid="lesson-chat-activity-status" role="status">
      <KindIcon kind={last.kind} />
      <span style={statusTextStyle}>
        {KIND_VERB[last.kind]}: {last.label}
      </span>
    </span>
  );
}

export function ResearchLog({ activity }: { activity: ChatActivityItem[] }) {
  const steps = activity.filter((a) => a.kind !== 'note');
  if (activity.length === 0) return null;
  const count = (k: ActivityKind) => steps.filter((a) => a.kind === k).length;
  const parts = [
    count('search') ? `${count('search')} search${count('search') === 1 ? '' : 'es'}` : null,
    count('fetch') ? `${count('fetch')} page${count('fetch') === 1 ? '' : 's'} read` : null,
    count('image') ? `${count('image')} image check${count('image') === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return (
    <details style={logStyle} data-testid="lesson-chat-research-log">
      <summary style={logSummaryStyle}>Research log{parts.length > 0 ? ` — ${parts.join(', ')}` : ''}</summary>
      <ol style={logListStyle}>
        {activity.map((a, i) => {
          const href = safeHref(a.url);
          return (
            <li key={a.id ?? i} style={logItemStyle} data-status={a.status}>
              <KindIcon kind={a.kind} />
              <span>
                <span style={{ color: 'var(--text-tertiary)' }}>{KIND_VERB[a.kind]}:</span>{' '}
                {href && a.kind !== 'search' ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {a.label}
                  </a>
                ) : (
                  a.label
                )}
                {a.status === 'error' ? (
                  <span style={{ color: 'var(--danger)' }}> — failed{a.detail ? `: ${a.detail}` : ''}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const iconInline: CSSProperties = { flexShrink: 0, verticalAlign: '-2px' };

const figureStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  margin: 'var(--space-2) 0',
  maxWidth: '100%',
};

const figureImgStyle: CSSProperties = {
  maxHeight: 360,
  objectFit: 'contain',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border)',
  background: '#ffffff',
};

const captionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: '11px',
  lineHeight: 1.4,
  color: 'var(--text-secondary)',
};

const badgeRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
};

const badgeBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 6px',
  borderRadius: 'var(--radius-sm)',
  borderWidth: 1,
  borderStyle: 'solid',
  fontWeight: 500,
};

const reliabilityBadgeStyle: Record<'high' | 'medium' | 'low', CSSProperties> = {
  high: { ...badgeBase, background: 'var(--success-subtle)', borderColor: 'var(--success-border)', color: 'var(--success)' },
  medium: { ...badgeBase, background: 'var(--warning-subtle)', borderColor: 'var(--warning-border)', color: 'var(--warning)' },
  low: { ...badgeBase, background: 'var(--danger-subtle)', borderColor: 'var(--danger-border)', color: 'var(--danger)' },
};

const noteStyle: CSSProperties = {
  fontStyle: 'italic',
  color: 'var(--text-tertiary)',
};

const blockedStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'flex-start',
  margin: 'var(--space-2) 0',
  padding: '6px 8px',
  fontSize: '12px',
  lineHeight: 1.4,
  background: 'var(--warning-subtle)',
  border: '1px solid var(--warning-border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text)',
};

const userImagesStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginBottom: 6,
};

const userImageStyle: CSSProperties = {
  maxWidth: 180,
  maxHeight: 140,
  objectFit: 'cover',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--accent-border, var(--border))',
};

const stripStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const thumbStyle: CSSProperties = {
  position: 'relative',
  width: 56,
  height: 56,
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-strong)',
  overflow: 'hidden',
  background: 'var(--bg-subtle)',
  flexShrink: 0,
};

const thumbErrorStyle: CSSProperties = {
  ...thumbStyle,
  borderColor: 'var(--danger-border)',
};

const thumbImgStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
};

const thumbOverlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0,0,0,0.35)',
  color: '#ffffff',
};

const thumbRemoveStyle: CSSProperties = {
  position: 'absolute',
  top: 2,
  right: 2,
  width: 16,
  height: 16,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '999px',
  border: 'none',
  background: 'rgba(0,0,0,0.6)',
  color: '#ffffff',
  cursor: 'pointer',
};

const spinStyle: CSSProperties = {
  animation: 'lesson-chat-tts-spin 0.8s linear infinite',
};

const statusLineStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 4,
  fontSize: '11px',
  color: 'var(--text-tertiary)',
  minWidth: 0,
};

const statusTextStyle: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const logStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-tertiary)',
  maxWidth: '100%',
};

const logSummaryStyle: CSSProperties = {
  cursor: 'pointer',
  userSelect: 'none',
};

const logListStyle: CSSProperties = {
  margin: '4px 0 0',
  padding: '0 0 0 4px',
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const logItemStyle: CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'flex-start',
  lineHeight: 1.4,
  wordBreak: 'break-word',
};
