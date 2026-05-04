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
} from 'react';
import { Maximize2, Minimize2, Square, X } from 'lucide-react';

import { modLabel } from '@/lib/platform/platform';
import { useIsMacPlatform } from '@/lib/platform/useIsMacPlatform';

interface ChatMessage {
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
}: LessonChatProps) {
  const isMac = useIsMacPlatform();
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  // Temporary fullscreen-overlay expansion. Toggled by the header button;
  // does NOT unmount this component, so messages, draft, and an in-flight
  // streaming request all survive the round-trip back to the side panel.
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const currentRequestIdRef = useRef<string | null>(null);
  const userStoppedRef = useRef<boolean>(false);
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

  return (
    <aside
      data-testid="lesson-chat"
      data-open="true"
      data-expanded={expanded ? 'true' : 'false'}
      data-active-section-id={activeSectionId ?? ''}
      style={composedAsideStyle}
    >
      <style>{lessonChatGlobalKeyframes}</style>
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
              return (
                <li
                  key={m.id}
                  data-role={m.role}
                  data-pending={m.pending ? 'true' : undefined}
                  data-stopped={m.stopped ? 'true' : undefined}
                  style={rowStyle}
                >
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
