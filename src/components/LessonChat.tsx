'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Maximize2, Minimize2, Pause, Square, Volume2, X } from 'lucide-react';

import { useKeyboardShortcut } from '@/lib/hooks/useKeyboardShortcut';
import { modLabel } from '@/lib/platform/platform';
import { useIsMacPlatform } from '@/lib/platform/useIsMacPlatform';
import { readTtsVoice } from '@/lib/client/ttsVoice';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  pending?: boolean;
  stopped?: boolean;
}

const STOPPED_SUFFIX = '— stopped by user';

interface LessonChatProps {
  open: boolean;
  courseSlug: string;
  lessonSlug: string;
  onClose: () => void;
  /** Toggle the panel open/closed. Bound to Ctrl+Q so it must work in either state. */
  onToggle: () => void;
  /** Current panel width in px — used for aria-valuenow and as the keyboard step base. */
  chatWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  onResize?: (w: number) => void;
  onResizeStart?: () => void;
  onResizeEnd?: (finalWidth: number) => void;
  /** Test-only: seed the messages list so UI states (speak buttons, error
   *  chips, pending rows) can be rendered without the chat-stream round-trip. */
  initialMessages?: ChatMessage[];
}

const LINE_HEIGHT_PX = 20;
const MIN_LINES = 1;
const MAX_LINES = 6;
const TEXTAREA_VERTICAL_PADDING = 16;
const DRAFT_DEBOUNCE_MS = 200;

export function draftStorageKey(courseSlug: string, lessonSlug: string): string {
  return `lessonChatDraft:${courseSlug}:${lessonSlug}`;
}

export function LessonChat({
  open,
  courseSlug,
  lessonSlug,
  onClose,
  onToggle,
  chatWidth = 320,
  minWidth = 280,
  maxWidth = 720,
  onResize,
  onResizeStart,
  onResizeEnd,
  initialMessages,
}: LessonChatProps) {
  const isMac = useIsMacPlatform();
  // Ctrl+Q toggles the panel. Mounted from this component (per US-078 AC) so
  // the binding lives next to the state owner; the hook installs/removes a
  // window-level keydown listener and no-ops while the user is typing.
  // ctrl:true (not mod:true) because ⌘+Q quits the browser on macOS.
  useKeyboardShortcut({ key: 'q', ctrl: true }, onToggle);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialMessages ?? [],
  );
  const [sending, setSending] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  // Temporary fullscreen-overlay expansion. Toggled by the header button;
  // does NOT unmount this component, so messages, draft, and an in-flight
  // streaming request all survive the round-trip back to the side panel.
  const [expanded, setExpanded] = useState(false);
  // Resize-handle visual state. `hovered` paints a faint accent strip;
  // `dragging` paints the full accent and is set while a pointer drag is in
  // flight (also reported upstream so the parent can drop the grid transition).
  const [handleHovered, setHandleHovered] = useState(false);
  const [handleDragging, setHandleDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const userStoppedRef = useRef<boolean>(false);
  // Single shared <audio> element for per-message TTS playback. Mounted once
  // at the panel level; src is swapped between cached blob URLs as the
  // learner clicks different speak buttons.
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  // Per-message blob-URL cache. Keyed by message id; values are object URLs
  // created from the audio Blob returned by /api/tts. Revoked on panel close,
  // unmount, or chat-session change (different course/lesson).
  const ttsCacheRef = useRef<Map<string, string>>(new Map());
  // Per-message error-chip auto-clear timers. Tracked so a fresh click on the
  // same message replaces a stale chip without two timers racing.
  const ttsErrorTimerRef = useRef<Map<string, number>>(new Map());
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  // Tracks whether the shared <audio> is currently producing sound. Distinct
  // from `ttsPlayingId`, which marks the "active" (loaded) message and stays
  // set even when audio is paused — so the resume-from-position click on the
  // speak button keeps working. Icon state derives from `ttsAudioPlaying`:
  // Pause icon only when truly playing, Volume2 (=resume) when paused.
  const [ttsAudioPlaying, setTtsAudioPlaying] = useState<boolean>(false);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [ttsErrorId, setTtsErrorId] = useState<string | null>(null);
  // Message ids whose audio Blob is cached locally — drives speed-slider
  // visibility (slider appears once the system has generated audio for that
  // message, hides when the cache is cleared on panel close).
  const [ttsLoadedIds, setTtsLoadedIds] = useState<Set<string>>(() => new Set());
  // Shared playback rate (0.5x–3x) applied to every TTS playback. The user
  // discovers this slider once any speak button has materialized audio; the
  // chosen rate persists across messages and across panel re-opens within the
  // component's lifetime.
  const [ttsPlaybackRate, setTtsPlaybackRate] = useState<number>(1);
  const draftKey = useMemo(
    () => draftStorageKey(courseSlug, lessonSlug),
    [courseSlug, lessonSlug],
  );

  // Track the section currently nearest the top of the viewport via
  // IntersectionObserver — used to scope the AI tutor's prompt context
  // to the active section. Re-runs when the panel opens or the lesson
  // changes; queries `[data-section-id]` elements rendered by the lesson
  // page. Falls back gracefully (no observer) when nothing matches.
  useEffect(() => {
    if (!open) return;
    if (typeof IntersectionObserver === 'undefined') return;

    // Map the section id → its DOM order index, so when several sections
    // straddle the "active" band at the top of the viewport, we pick the
    // last one (the one the learner has scrolled into).
    const orderById = new Map<string, number>();
    const visible = new Set<string>();
    const observed = new WeakSet<Element>();

    const recompute = () => {
      let bestId: string | null = null;
      let bestOrder = -1;
      for (const id of visible) {
        const order = orderById.get(id) ?? -1;
        if (order > bestOrder) {
          bestOrder = order;
          bestId = id;
        }
      }
      if (bestId !== null) {
        setActiveSectionId(bestId);
      }
    };

    const intersection = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).getAttribute(
            'data-section-id',
          );
          if (id === null) continue;
          if (entry.isIntersecting) {
            visible.add(id);
          } else {
            visible.delete(id);
          }
        }
        recompute();
      },
      // rootMargin biases intersection to a strip near the top of the
      // viewport so the active section is whatever is currently being
      // read, not whatever is biggest.
      { rootMargin: '0px 0px -75% 0px', threshold: 0 },
    );

    const observeAllSections = () => {
      const targets = Array.from(
        document.querySelectorAll<HTMLElement>('[data-section-id]'),
      );
      for (const el of targets) {
        const id = el.getAttribute('data-section-id');
        if (id !== null && !orderById.has(id)) {
          orderById.set(id, orderById.size);
        }
        if (!observed.has(el)) {
          intersection.observe(el);
          observed.add(el);
        }
      }
      // Seed activeSectionId from the current scroll position so the very
      // first message has a sensible sectionId before IO fires.
      const main =
        document.querySelector<HTMLElement>('[data-testid="lesson-content"]') ??
        null;
      if (main && targets.length > 0) {
        const mainTop = main.scrollTop;
        let seedId: string | null = null;
        for (const el of targets) {
          const id = el.getAttribute('data-section-id');
          if (id === null) continue;
          const offset =
            el.getBoundingClientRect().top -
            main.getBoundingClientRect().top +
            main.scrollTop;
          if (offset <= mainTop + 8) {
            seedId = id;
          }
        }
        if (seedId !== null) {
          setActiveSectionId(seedId);
        }
      }
    };

    observeAllSections();

    // Sections may not yet be in the DOM when the panel opens (e.g. the
    // lesson is still loading via fetch). Watch for added section elements
    // and observe them too.
    const mutation = new MutationObserver(() => {
      observeAllSections();
    });
    mutation.observe(document.body, { childList: true, subtree: true });

    return () => {
      intersection.disconnect();
      mutation.disconnect();
    };
  }, [open, lessonSlug, courseSlug]);

  // Restore draft on mount or when slug changes. New mount per panel toggle is
  // fine — `open=false` returns null below so the effect only fires when the
  // panel actually appears.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(draftKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(stored ?? '');
    } catch {
      // localStorage unavailable — start with empty draft.
    }
  }, [draftKey]);

  // Debounced write of the draft to localStorage.
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    debounceRef.current = window.setTimeout(() => {
      try {
        if (draft.length === 0) {
          window.localStorage.removeItem(draftKey);
        } else {
          window.localStorage.setItem(draftKey, draft);
        }
      } catch {
        // Persistence unavailable; in-memory draft still works.
      }
    }, DRAFT_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [draft, draftKey]);

  // Autoresize the textarea: measure scrollHeight, clamp to MAX_LINES.
  // Re-runs when `expanded` flips because the textarea's available width
  // changes between the side panel and the fullscreen overlay, which can
  // alter wrapping and therefore scrollHeight.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = LINE_HEIGHT_PX * MAX_LINES + TEXTAREA_VERTICAL_PADDING;
    const minHeight = LINE_HEIGHT_PX * MIN_LINES + TEXTAREA_VERTICAL_PADDING;
    const next = Math.max(
      minHeight,
      Math.min(maxHeight, el.scrollHeight),
    );
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [draft, expanded]);

  // Auto-scroll to bottom when new messages land.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const trimmedDraft = draft.trim();
  const canSend = trimmedDraft.length > 0 && !sending;

  const finalizeStopped = useCallback((pendingId: string, partialText: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === pendingId
          ? {
              id: pendingId,
              role: 'assistant',
              text: partialText,
              stopped: true,
            }
          : m,
      ),
    );
  }, []);

  const handleSend = useCallback(() => {
    const text = draft.trim();
    if (text.length === 0 || sending) return;
    const stamp = Date.now();
    const userId = `m-${stamp}-u`;
    const pendingId = `m-${stamp}-p`;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text },
      { id: pendingId, role: 'assistant', text: '', pending: true },
    ]);
    setDraft('');
    setSending(true);
    userStoppedRef.current = false;
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // ignore — draft already cleared from in-memory state
    }

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));

    const ac = new AbortController();
    streamAbortRef.current = ac;
    currentRequestIdRef.current = null;

    const setBubbleError = (errText: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === pendingId
            ? { id: pendingId, role: 'error', text: errText }
            : m,
        ),
      );
    };

    void (async () => {
      let res: Response;
      try {
        res = await fetch('/api/lesson-chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify({
            courseSlug,
            lessonSlug,
            sectionId: activeSectionId ?? undefined,
            message: text,
            history,
          }),
          signal: ac.signal,
        });
      } catch (err) {
        if (ac.signal.aborted) {
          finalizeStopped(pendingId, '');
        } else {
          setBubbleError(`AI Tutor error: ${(err as Error).message}`);
        }
        setSending(false);
        streamAbortRef.current = null;
        return;
      }

      if (!res.ok) {
        const json = (await res
          .json()
          .catch(() => ({}))) as { error?: string };
        const errText = json.error ?? `AI Tutor error (status ${res.status})`;
        setBubbleError(errText);
        setSending(false);
        streamAbortRef.current = null;
        return;
      }

      const body = res.body;
      if (!body) {
        setBubbleError('AI Tutor error: empty response');
        setSending(false);
        streamAbortRef.current = null;
        return;
      }

      const reader = body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let accumulated = '';
      let receivedDone = false;
      let receivedError: string | null = null;

      const handleEvent = (event: string, data: string) => {
        let parsed: unknown = {};
        try {
          parsed = data.length > 0 ? JSON.parse(data) : {};
        } catch {
          parsed = {};
        }
        const obj = parsed as { requestId?: string; text?: string; message?: string };
        if (event === 'meta' && typeof obj.requestId === 'string') {
          currentRequestIdRef.current = obj.requestId;
        } else if (event === 'token' && typeof obj.text === 'string') {
          accumulated += obj.text;
          const snapshot = accumulated;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId
                ? { id: pendingId, role: 'assistant', text: snapshot, pending: true }
                : m,
            ),
          );
        } else if (event === 'done') {
          receivedDone = true;
        } else if (event === 'error') {
          receivedError =
            typeof obj.message === 'string'
              ? `AI Tutor error: ${obj.message}`
              : 'AI Tutor error';
        } else if (event === 'aborted') {
          // Server confirmed cancel — handled by userStoppedRef path.
        }
      };

      const flushBufferedEvents = () => {
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (block.length === 0) continue;
          let event = 'message';
          let data = '';
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) {
              data += (data.length > 0 ? '\n' : '') + line.slice(5).trim();
            }
          }
          handleEvent(event, data);
        }
      };

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          flushBufferedEvents();
        }
        // Stream ended — process any final partial frame.
        buf += decoder.decode();
        flushBufferedEvents();
      } catch (err) {
        if (ac.signal.aborted || userStoppedRef.current) {
          finalizeStopped(pendingId, accumulated);
          setSending(false);
          streamAbortRef.current = null;
          return;
        }
        setBubbleError(`AI Tutor error: ${(err as Error).message}`);
        setSending(false);
        streamAbortRef.current = null;
        return;
      }

      if (userStoppedRef.current) {
        finalizeStopped(pendingId, accumulated);
      } else if (receivedError !== null) {
        setBubbleError(receivedError);
      } else if (receivedDone || accumulated.length > 0) {
        const finalText = accumulated;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { id: pendingId, role: 'assistant', text: finalText }
              : m,
          ),
        );
      } else {
        setBubbleError('AI Tutor error: no response');
      }
      setSending(false);
      streamAbortRef.current = null;
    })();
  }, [activeSectionId, courseSlug, draft, draftKey, finalizeStopped, lessonSlug, messages, sending]);

  const clearTtsErrorTimer = useCallback((id: string) => {
    const t = ttsErrorTimerRef.current.get(id);
    if (t !== undefined) {
      window.clearTimeout(t);
      ttsErrorTimerRef.current.delete(id);
    }
  }, []);

  const flagTtsError = useCallback(
    (id: string) => {
      clearTtsErrorTimer(id);
      setTtsErrorId(id);
      const timer = window.setTimeout(() => {
        setTtsErrorId((cur) => (cur === id ? null : cur));
        ttsErrorTimerRef.current.delete(id);
      }, 4000);
      ttsErrorTimerRef.current.set(id, timer);
    },
    [clearTtsErrorTimer],
  );

  // Apply the playback rate to the shared audio element whenever the slider
  // moves, so a mid-playback drag takes effect immediately.
  useEffect(() => {
    const audio = ttsAudioRef.current;
    if (!audio) return;
    audio.playbackRate = ttsPlaybackRate;
  }, [ttsPlaybackRate]);

  const resetTtsCache = useCallback(() => {
    const audio = ttsAudioRef.current;
    if (audio) {
      try {
        audio.pause();
      } catch {
        // ignore — pausing a never-played element is a no-op
      }
    }
    for (const url of ttsCacheRef.current.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore — happens when the URL was already revoked or invalid
      }
    }
    ttsCacheRef.current.clear();
    for (const timer of ttsErrorTimerRef.current.values()) {
      window.clearTimeout(timer);
    }
    ttsErrorTimerRef.current.clear();
    setTtsPlayingId(null);
    setTtsAudioPlaying(false);
    setTtsLoadingId(null);
    setTtsErrorId(null);
    setTtsLoadedIds(new Set());
  }, []);

  const handleSpeak = useCallback(
    (message: ChatMessage) => {
      if (message.role !== 'assistant') return;
      if (message.pending || message.stopped) return;
      const text = message.text.trim();
      if (text.length === 0) return;
      const audio = ttsAudioRef.current;
      if (!audio) return;

      // Same-message click: toggle play/pause. Preserve currentTime on pause,
      // and resume from the paused position on the next click.
      if (ttsPlayingId === message.id) {
        if (audio.paused) {
          void audio.play().catch(() => {
            flagTtsError(message.id);
          });
        } else {
          audio.pause();
        }
        return;
      }

      // Switching messages — pause any current playback before swapping src.
      // Single-playback semantics: playing message B always stops message A.
      if (!audio.paused) {
        audio.pause();
      }

      const startPlayback = (url: string) => {
        audio.src = url;
        // Apply the current speed setting and ask the browser to preserve
        // pitch so 2x / 3x doesn't sound chipmunky. preservesPitch is the
        // standard property; older WebKit / Firefox builds shipped vendor
        // prefixes — set all three so the slider works across browsers.
        audio.playbackRate = ttsPlaybackRate;
        type WithLegacyPitch = HTMLAudioElement & {
          preservesPitch?: boolean;
          mozPreservesPitch?: boolean;
          webkitPreservesPitch?: boolean;
        };
        const a = audio as WithLegacyPitch;
        a.preservesPitch = true;
        a.mozPreservesPitch = true;
        a.webkitPreservesPitch = true;
        setTtsPlayingId(message.id);
        void audio.play().catch(() => {
          flagTtsError(message.id);
          setTtsPlayingId((cur) => (cur === message.id ? null : cur));
        });
      };

      const cachedUrl = ttsCacheRef.current.get(message.id);
      if (cachedUrl) {
        startPlayback(cachedUrl);
        return;
      }

      setTtsLoadingId(message.id);
      const voice = readTtsVoice();
      void (async () => {
        try {
          const res = await fetch('/api/tts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: message.text, voice }),
          });
          if (!res.ok) {
            flagTtsError(message.id);
            return;
          }
          // The AC contract is "audio Blob returned from /api/tts". The real
          // POST handler today returns JSON `{ audioPath, durationMs, cached }`
          // for backward compatibility with TtsDemo (US-158). Branch on the
          // response content type so the test mock (audio/* directly) AND the
          // production two-step flow (JSON pointer → GET /api/tts/audio/<path>)
          // both work without forking the route.
          const contentType = res.headers.get('content-type') ?? '';
          let blob: Blob;
          if (contentType.includes('application/json')) {
            const json = (await res.json()) as { audioPath?: string };
            const audioPath = json.audioPath;
            if (!audioPath) {
              flagTtsError(message.id);
              return;
            }
            const audioRes = await fetch(
              `/api/tts/audio/${audioPath.replace(/^\/+/, '')}`,
            );
            if (!audioRes.ok) {
              flagTtsError(message.id);
              return;
            }
            blob = await audioRes.blob();
          } else {
            blob = await res.blob();
          }
          const url = URL.createObjectURL(blob);
          ttsCacheRef.current.set(message.id, url);
          setTtsLoadedIds((prev) => {
            if (prev.has(message.id)) return prev;
            const next = new Set(prev);
            next.add(message.id);
            return next;
          });
          startPlayback(url);
        } catch {
          flagTtsError(message.id);
        } finally {
          setTtsLoadingId((cur) => (cur === message.id ? null : cur));
        }
      })();
    },
    [flagTtsError, ttsPlayingId, ttsPlaybackRate],
  );

  // Clear cache + revoke object URLs when the panel closes, the chat session
  // changes (different course/lesson slug), or the component unmounts. Each
  // call to resetTtsCache pauses the shared <audio> element first.
  useEffect(() => {
    if (!open) {
      resetTtsCache();
    }
    return () => {
      resetTtsCache();
    };
  }, [open, courseSlug, lessonSlug, resetTtsCache]);

  const handleStop = useCallback(() => {
    if (!sending) return;
    userStoppedRef.current = true;
    const ac = streamAbortRef.current;
    const requestId = currentRequestIdRef.current;
    if (ac) ac.abort();
    if (requestId) {
      void fetch(`/api/lesson-chat/${encodeURIComponent(requestId)}`, {
        method: 'DELETE',
      }).catch(() => {
        // server-side cancel is best-effort; client already aborted the read.
      });
    }
  }, [sending]);

  const handleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key === 'Enter') {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Track the latest width inside event closures so onResizeEnd reports the
  // final value even when the React-prop chatWidth would still be stale.
  const dragWidthRef = useRef<number>(chatWidth);
  useEffect(() => {
    dragWidthRef.current = chatWidth;
  }, [chatWidth]);

  const clampWidth = useCallback(
    (w: number) => Math.min(maxWidth, Math.max(minWidth, w)),
    [minWidth, maxWidth],
  );

  const handlePointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      setHandleDragging(true);
      onResizeStart?.();
    },
    [onResizeStart],
  );

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const newWidth = clampWidth(window.innerWidth - e.clientX);
      dragWidthRef.current = newWidth;
      onResize?.(newWidth);
    },
    [clampWidth, onResize],
  );

  const handlePointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      setHandleDragging(false);
      onResizeEnd?.(dragWidthRef.current);
    },
    [onResizeEnd],
  );

  const handleHandleKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const step = e.shiftKey ? 64 : 16;
      // Handle is on the LEFT edge of the chat: arrow-left moves the edge
      // outwards (panel widens), arrow-right moves it inwards (panel narrows).
      const delta = e.key === 'ArrowLeft' ? step : -step;
      const newWidth = clampWidth(dragWidthRef.current + delta);
      dragWidthRef.current = newWidth;
      onResize?.(newWidth);
      onResizeEnd?.(newWidth);
    },
    [clampWidth, onResize, onResizeEnd],
  );

  if (!open) {
    return (
      <aside
        data-testid="lesson-chat"
        data-open="false"
        aria-hidden
        style={asideHiddenStyle}
      />
    );
  }

  const composedAsideStyle = expanded
    ? { ...asideStyle, ...asideExpandedStyle }
    : asideStyle;
  const composedListStyle = expanded
    ? { ...messageListStyle, ...messageListExpandedStyle }
    : messageListStyle;
  const composedTextareaStyle = expanded
    ? { ...textareaStyle, ...textareaExpandedStyle }
    : textareaStyle;
  const composedComposerControlsStyle = expanded
    ? { ...composerControlsStyle, ...composerControlsExpandedStyle }
    : composerControlsStyle;

  const resizeHandleStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 6,
    cursor: 'col-resize',
    background: handleDragging
      ? 'var(--accent)'
      : handleHovered
        ? 'var(--accent-subtle)'
        : 'transparent',
    zIndex: 1,
    touchAction: 'none',
    transition: 'background 120ms ease',
  };

  return (
    <aside
      data-testid="lesson-chat"
      data-open="true"
      data-expanded={expanded ? 'true' : 'false'}
      data-active-section-id={activeSectionId ?? ''}
      style={{ ...composedAsideStyle, position: expanded ? 'fixed' : 'relative' }}
    >
      <style>{lessonChatGlobalKeyframes}</style>
      <audio
        ref={ttsAudioRef}
        data-testid="lesson-chat-tts-audio"
        preload="auto"
        onPlay={() => setTtsAudioPlaying(true)}
        onPause={() => {
          // Toggle the audible flag so the icon flips Pause → Play (resume)
          // on a manual pause. `ttsPlayingId` stays set so the next click on
          // the same speak button resumes from the current position rather
          // than re-fetching from /api/tts. When playback ends naturally, the
          // onEnded handler below also clears `ttsPlayingId` so the row falls
          // back to its idle Volume2 state.
          setTtsAudioPlaying(false);
        }}
        onEnded={() => {
          setTtsAudioPlaying(false);
          setTtsPlayingId(null);
        }}
        onError={() => {
          if (ttsPlayingId) {
            flagTtsError(ttsPlayingId);
            setTtsPlayingId(null);
          }
          setTtsAudioPlaying(false);
        }}
        style={{ display: 'none' }}
      />
      {!expanded ? (
        <div
          data-testid="lesson-chat-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize AI tutor panel"
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={chatWidth}
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleHandleKeyDown}
          onMouseEnter={() => setHandleHovered(true)}
          onMouseLeave={() => setHandleHovered(false)}
          onFocus={() => setHandleHovered(true)}
          onBlur={() => setHandleHovered(false)}
          style={resizeHandleStyle}
        />
      ) : null}
      <header style={headerStyle}>
        <h2 style={titleStyle}>AI Tutor</h2>
        <div style={headerActionsStyle}>
          <button
            type="button"
            data-testid="lesson-chat-expand-toggle"
            aria-label={expanded ? 'Collapse AI tutor panel' : 'Expand AI tutor panel'}
            aria-pressed={expanded}
            onClick={() => setExpanded((v) => !v)}
            style={iconBtnStyle}
          >
            {expanded ? (
              <Minimize2 size={16} strokeWidth={2} />
            ) : (
              <Maximize2 size={16} strokeWidth={2} />
            )}
          </button>
          <button
            type="button"
            data-testid="lesson-chat-close"
            aria-label="Close AI tutor panel"
            onClick={onClose}
            style={iconBtnStyle}
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>
      </header>

      <div
        ref={messagesRef}
        data-testid="lesson-chat-messages"
        style={messagesStyle}
      >
        {messages.length === 0 ? (
          <p data-testid="lesson-chat-empty" style={emptyStyle}>
            Ask anything about this lesson — I have its content as context.
          </p>
        ) : (
          <ul style={composedListStyle}>
            {messages.map((m) => {
              const rowStyle =
                m.role === 'user' ? userBubbleRowStyle : assistantBubbleRowStyle;
              let bubbleStyle: CSSProperties = assistantBubbleStyle;
              if (m.role === 'user') bubbleStyle = userBubbleStyle;
              else if (m.role === 'error') bubbleStyle = errorBubbleStyle;
              const showTypingDots = m.pending && m.text.length === 0;
              const hasSpeakable =
                m.role === 'assistant' &&
                !m.pending &&
                !m.stopped &&
                m.text.trim().length > 0;
              const isActive = ttsPlayingId === m.id;
              const isPlaying = isActive && ttsAudioPlaying;
              const isPaused = isActive && !ttsAudioPlaying;
              const isLoading = ttsLoadingId === m.id;
              const hasError = ttsErrorId === m.id;
              const hasLoadedAudio = ttsLoadedIds.has(m.id);
              return (
                <li
                  key={m.id}
                  data-role={m.role}
                  data-pending={m.pending ? 'true' : undefined}
                  data-stopped={m.stopped ? 'true' : undefined}
                  style={rowStyle}
                >
                  <div style={assistantColumnStyle}>
                    <div style={bubbleStyle}>
                      {showTypingDots ? <TypingDots /> : m.text}
                      {m.stopped ? (
                        <>
                          {'\n'}
                          <span
                            data-testid="lesson-chat-stopped-suffix"
                            style={stoppedSuffixStyle}
                          >
                            {STOPPED_SUFFIX}
                          </span>
                        </>
                      ) : null}
                    </div>
                    {hasSpeakable ? (
                      <div style={ttsFooterRowStyle}>
                        <button
                          type="button"
                          data-testid={`lesson-chat-tts-${m.id}`}
                          data-state={
                            isLoading
                              ? 'loading'
                              : isPlaying
                                ? 'playing'
                                : isPaused
                                  ? 'paused'
                                  : 'idle'
                          }
                          aria-label={
                            isPlaying
                              ? 'Pause playback'
                              : isPaused
                                ? 'Resume playback'
                                : 'Read message aloud'
                          }
                          disabled={isLoading}
                          onClick={() => handleSpeak(m)}
                          style={ttsBtnStyle}
                        >
                          {isLoading ? (
                            <span
                              data-testid={`lesson-chat-tts-spinner-${m.id}`}
                              style={ttsSpinnerStyle}
                              aria-hidden
                            />
                          ) : isPlaying ? (
                            <Pause size={14} strokeWidth={2} />
                          ) : (
                            <Volume2 size={14} strokeWidth={2} />
                          )}
                        </button>
                        {hasLoadedAudio ? (
                          <label
                            data-testid={`lesson-chat-tts-speed-${m.id}`}
                            style={ttsSpeedRowStyle}
                          >
                            <span style={ttsSpeedLabelStyle} aria-hidden>
                              Speed
                            </span>
                            <input
                              type="range"
                              min={0.5}
                              max={3}
                              step={0.25}
                              value={ttsPlaybackRate}
                              onChange={(e) => {
                                const next = Number(e.target.value);
                                if (Number.isFinite(next)) setTtsPlaybackRate(next);
                              }}
                              aria-label="Playback speed"
                              style={ttsSpeedSliderStyle}
                            />
                            <span
                              data-testid={`lesson-chat-tts-speed-value-${m.id}`}
                              style={ttsSpeedValueStyle}
                            >
                              {ttsPlaybackRate.toFixed(2).replace(/\.?0+$/, '')}×
                            </span>
                          </label>
                        ) : null}
                        {hasError ? (
                          <span
                            data-testid={`lesson-chat-tts-error-${m.id}`}
                            style={ttsErrorChipStyle}
                            role="status"
                          >
                            Couldn&apos;t read message — try again
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer style={footerStyle}>
        <textarea
          ref={textareaRef}
          data-testid="lesson-chat-textarea"
          aria-label="Message AI tutor"
          placeholder="Ask about this lesson…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          style={composedTextareaStyle}
        />
        <div style={composedComposerControlsStyle}>
          <span data-testid="lesson-chat-send-hint" style={hintStyle}>
            {modLabel(isMac)}+Enter to send
          </span>
          <div style={btnGroupStyle}>
            <button
              type="button"
              data-testid="lesson-chat-stop"
              aria-label="Stop response"
              disabled={!sending}
              onClick={handleStop}
              style={sending ? stopBtnActiveStyle : stopBtnStyle}
            >
              <Square size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              data-testid="lesson-chat-send"
              aria-label="Send message"
              disabled={!canSend}
              onClick={handleSend}
              style={canSend ? sendBtnStyle : sendBtnDisabledStyle}
            >
              Send
            </button>
          </div>
        </div>
      </footer>
    </aside>
  );
}

const asideHiddenStyle: CSSProperties = {
  gridColumn: '3 / 4',
  gridRow: '2 / 3',
  display: 'none',
};

const asideStyle: CSSProperties = {
  gridColumn: '3 / 4',
  gridRow: '2 / 3',
  borderLeftWidth: 1,
  borderLeftStyle: 'solid',
  borderLeftColor: 'var(--border)',
  background: 'var(--bg-elevated)',
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--border)',
  flexShrink: 0,
  minHeight: 48,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  color: 'var(--text)',
  lineHeight: 1.2,
};

const headerActionsStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const iconBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'transparent',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
};

// When expanded, the aside leaves the lesson grid and becomes a fullscreen
// overlay anchored to the viewport. The grid still allocates the side-panel
// column underneath (chatOpen is unchanged on the parent), so collapsing
// snaps back into place without the parent having to juggle layout state.
const asideExpandedStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  gridColumn: 'auto',
  gridRow: 'auto',
  borderLeftWidth: 0,
  boxShadow: '0 0 0 1px var(--border), 0 12px 40px rgba(0,0,0,0.18)',
};

// In the overlay we constrain message rows + composer to a comfortable
// reading width centred in the viewport, so long tutor responses don't
// stretch edge-to-edge on wide displays.
const EXPANDED_CONTENT_MAX_WIDTH = 920;

const messageListExpandedStyle: CSSProperties = {
  maxWidth: EXPANDED_CONTENT_MAX_WIDTH,
  marginLeft: 'auto',
  marginRight: 'auto',
  width: '100%',
};

const textareaExpandedStyle: CSSProperties = {
  maxWidth: EXPANDED_CONTENT_MAX_WIDTH,
  marginLeft: 'auto',
  marginRight: 'auto',
};

const composerControlsExpandedStyle: CSSProperties = {
  maxWidth: EXPANDED_CONTENT_MAX_WIDTH,
  marginLeft: 'auto',
  marginRight: 'auto',
  width: '100%',
};

const messagesStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const emptyStyle: CSSProperties = {
  margin: 'auto 0',
  textAlign: 'center',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'var(--font-prose)',
  lineHeight: 1.5,
  padding: '0 var(--space-3)',
};

const messageListStyle: CSSProperties = {
  listStyle: 'none',
  marginTop: 0,
  marginRight: 0,
  marginBottom: 0,
  marginLeft: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const userBubbleRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const assistantBubbleRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-start',
};

const userBubbleStyle: CSSProperties = {
  maxWidth: '88%',
  padding: '8px 12px',
  background: 'var(--accent-subtle)',
  color: 'var(--accent-text)',
  borderRadius: '10px 10px 2px 10px',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
  fontFamily: 'var(--font-prose)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const assistantBubbleStyle: CSSProperties = {
  maxWidth: '94%',
  padding: '8px 12px',
  background: 'var(--bg-subtle)',
  color: 'var(--text)',
  borderRadius: '10px 10px 10px 2px',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
  fontFamily: 'var(--font-prose)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const errorBubbleStyle: CSSProperties = {
  maxWidth: '94%',
  padding: '8px 12px',
  background: 'var(--danger-subtle, #fee2e2)',
  color: 'var(--danger-text, #991b1b)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--danger-border, #fecaca)',
  borderRadius: '10px 10px 10px 2px',
  fontSize: 'var(--fs-sm)',
  lineHeight: 1.5,
  fontFamily: 'var(--font-prose)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const assistantColumnStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  maxWidth: '94%',
  gap: 4,
};

const ttsFooterRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const ttsBtnStyle: CSSProperties = {
  width: 24,
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  padding: 0,
};

const ttsSpinnerStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'var(--border-strong)',
  borderTopColor: 'var(--accent)',
  borderRadius: '50%',
  display: 'inline-block',
  animation: 'lesson-chat-tts-spin 0.8s linear infinite',
};

const ttsErrorChipStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--danger-text, #991b1b)',
  background: 'var(--danger-subtle, #fee2e2)',
  border: '1px solid var(--danger-border, #fecaca)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 6px',
  lineHeight: 1.3,
};

const ttsSpeedRowStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: '11px',
  color: 'var(--text-tertiary)',
  lineHeight: 1.3,
};

const ttsSpeedLabelStyle: CSSProperties = {
  userSelect: 'none',
};

const ttsSpeedSliderStyle: CSSProperties = {
  width: 80,
  margin: 0,
  cursor: 'pointer',
  accentColor: 'var(--accent)',
};

const ttsSpeedValueStyle: CSSProperties = {
  minWidth: 30,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
};

const stoppedSuffixStyle: CSSProperties = {
  display: 'block',
  fontStyle: 'italic',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--fs-sm)',
  marginTop: 4,
};

function TypingDots() {
  return (
    <span
      data-testid="lesson-chat-typing"
      aria-label="AI tutor is typing"
      style={typingDotsStyle}
    >
      <span style={{ ...typingDotStyle, animationDelay: '0ms' }} />
      <span style={{ ...typingDotStyle, animationDelay: '150ms' }} />
      <span style={{ ...typingDotStyle, animationDelay: '300ms' }} />
    </span>
  );
}

const typingDotsStyle: CSSProperties = {
  display: 'inline-flex',
  gap: 4,
  alignItems: 'center',
  height: 12,
  paddingTop: 4,
  paddingBottom: 4,
};

const typingDotStyle: CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'var(--text-tertiary)',
  display: 'inline-block',
  animation: 'lesson-chat-typing-bounce 1s infinite ease-in-out',
};

const lessonChatGlobalKeyframes = `
@keyframes lesson-chat-typing-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}
@keyframes lesson-chat-tts-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
`;

const footerStyle: CSSProperties = {
  borderTop: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  padding: 'var(--space-3) var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  flexShrink: 0,
};

const textareaStyle: CSSProperties = {
  width: '100%',
  resize: 'none',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border-strong)',
  borderRadius: 'var(--radius-md)',
  padding: '8px 10px',
  fontFamily: 'var(--font-prose)',
  fontSize: 'var(--fs-sm)',
  lineHeight: `${LINE_HEIGHT_PX}px`,
  color: 'var(--text)',
  background: 'var(--bg)',
  outline: 'none',
  boxSizing: 'border-box',
};

const composerControlsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
};

const hintStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-quaternary)',
  fontFamily: 'var(--font-mono)',
};

const btnGroupStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const stopBtnStyle: CSSProperties = {
  width: 28,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-subtle)',
  color: 'var(--text-quaternary)',
  cursor: 'not-allowed',
  opacity: 0.6,
};

const stopBtnActiveStyle: CSSProperties = {
  ...stopBtnStyle,
  borderColor: 'var(--border-strong)',
  background: 'var(--bg)',
  color: 'var(--text)',
  cursor: 'pointer',
  opacity: 1,
};

const sendBtnBase: CSSProperties = {
  height: 28,
  padding: '0 12px',
  borderWidth: 1,
  borderStyle: 'solid',
  borderRadius: 'var(--radius-sm)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'var(--font-sans)',
  fontWeight: 500,
};

const sendBtnStyle: CSSProperties = {
  ...sendBtnBase,
  borderColor: 'var(--accent)',
  background: 'var(--accent)',
  color: 'var(--accent-fg, #ffffff)',
  cursor: 'pointer',
};

const sendBtnDisabledStyle: CSSProperties = {
  ...sendBtnBase,
  borderColor: 'var(--border)',
  background: 'var(--bg-subtle)',
  color: 'var(--text-quaternary)',
  cursor: 'not-allowed',
};
