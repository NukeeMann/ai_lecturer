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
import { Square, X } from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  text: string;
  pending?: boolean;
}

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
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const debounceRef = useRef<number | null>(null);
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
  }, [draft]);

  // Auto-scroll to bottom when new messages land.
  useEffect(() => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const trimmedDraft = draft.trim();
  const canSend = trimmedDraft.length > 0 && !sending;

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
    try {
      window.localStorage.removeItem(draftKey);
    } catch {
      // ignore — draft already cleared from in-memory state
    }

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .filter((m) => !m.pending)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.text }));

    void (async () => {
      try {
        const res = await fetch('/api/lesson-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            courseSlug,
            lessonSlug,
            sectionId: activeSectionId ?? undefined,
            message: text,
            history,
          }),
        });
        const json = (await res
          .json()
          .catch(() => ({}))) as { assistant?: string; error?: string };
        if (!res.ok) {
          const errText =
            json.error ?? `AI Tutor error (status ${res.status})`;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId
                ? { id: pendingId, role: 'error', text: errText }
                : m,
            ),
          );
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === pendingId
                ? {
                    id: pendingId,
                    role: 'assistant',
                    text: json.assistant ?? '',
                  }
                : m,
            ),
          );
        }
      } catch (err) {
        const errText = `AI Tutor error: ${(err as Error).message}`;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === pendingId
              ? { id: pendingId, role: 'error', text: errText }
              : m,
          ),
        );
      } finally {
        setSending(false);
      }
    })();
  }, [activeSectionId, courseSlug, draft, draftKey, lessonSlug, messages, sending]);

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

  return (
    <aside
      data-testid="lesson-chat"
      data-open="true"
      data-active-section-id={activeSectionId ?? ''}
      style={asideStyle}
    >
      <header style={headerStyle}>
        <h2 style={titleStyle}>AI Tutor</h2>
        <button
          type="button"
          data-testid="lesson-chat-close"
          aria-label="Close AI tutor panel"
          onClick={onClose}
          style={closeBtnStyle}
        >
          <X size={16} strokeWidth={2} />
        </button>
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
          <ul style={messageListStyle}>
            {messages.map((m) => {
              const rowStyle =
                m.role === 'user' ? userBubbleRowStyle : assistantBubbleRowStyle;
              let bubbleStyle: CSSProperties = assistantBubbleStyle;
              if (m.role === 'user') bubbleStyle = userBubbleStyle;
              else if (m.role === 'error') bubbleStyle = errorBubbleStyle;
              return (
                <li
                  key={m.id}
                  data-role={m.role}
                  data-pending={m.pending ? 'true' : undefined}
                  style={rowStyle}
                >
                  <div style={bubbleStyle}>
                    {m.pending ? <TypingDots /> : m.text}
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
          style={textareaStyle}
        />
        <div style={composerControlsStyle}>
          <span style={hintStyle}>⌘+Enter to send</span>
          <div style={btnGroupStyle}>
            <button
              type="button"
              data-testid="lesson-chat-stop"
              aria-label="Stop response"
              disabled
              style={stopBtnStyle}
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
  borderLeft: '1px solid var(--border)',
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

const closeBtnStyle: CSSProperties = {
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
  margin: 0,
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
      <style>{typingKeyframes}</style>
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

const typingKeyframes = `
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
