'use client';

// "Anki flashcards" block at the top of the course sidebar: one deck for the
// whole course (subdeck per module), downloaded as .apkg — opening the file
// imports it into Anki. The presentational <FlashcardsDeckBlock> is shared
// with the static exporter (tools/static-export), which has no API and just
// links to a pre-built deck file; <FlashcardsTocModule> is the app version
// that fetches the summary and can start / poll on-demand generation.

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { ChevronDown, Download, Layers, Loader2, Sparkles } from 'lucide-react';

import { strings } from '@/lib/i18n/strings';
import type { FlashcardsJobStatus, FlashcardsSummary } from '@/lib/schemas/flashcards';

const t = strings.flashcards;

export interface FlashcardsDeckBodyProps {
  totalCards: number;
  subdecks: number;
  // Modules with lessons but no flashcards yet (app only).
  missingModules?: number;
  // Absent → no deck yet.
  downloadHref?: string;
  // File name for the `download` attribute (the static export serves the
  // deck under an ASCII path but wants the course title as the saved name).
  downloadName?: string;
  job?: FlashcardsJobStatus | null;
  // App-only actions; the static export leaves them out.
  onGenerate?: () => void;
  onRegenerate?: () => void;
  error?: string | null;
  // Sidebar density (default). false → page-sized text and button.
  compact?: boolean;
}

const subtleBtn: CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 'var(--fs-xs, 12px)',
  color: 'var(--text-tertiary)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
};

const primaryBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  height: 32,
  padding: '0 10px',
  border: 'none',
  borderRadius: 'var(--radius-sm, 6px)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent, #fff)',
  fontSize: 'var(--fs-sm, 14px)',
  fontWeight: 600,
  textDecoration: 'none',
  cursor: 'pointer',
};

// Counts + download button + "How to import" — no chrome, so callers can
// put it in the app sidebar or in a static-export module card.
export function FlashcardsDeckBody({
  totalCards,
  subdecks,
  missingModules = 0,
  downloadHref,
  downloadName,
  job,
  onGenerate,
  onRegenerate,
  error,
  compact = true,
}: FlashcardsDeckBodyProps) {
  const [howToOpen, setHowToOpen] = useState(false);
  const button: CSSProperties = compact
    ? primaryBtn
    : { ...primaryBtn, width: 'auto', height: 40, padding: '0 18px', fontSize: 15 };
  const running = job?.state === 'running';
  const hasDeck = Boolean(downloadHref) && totalCards > 0;

  return (
    <div
      data-testid="flashcards-body"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: compact ? 'stretch' : 'flex-start',
        gap: compact ? 8 : 10,
        fontSize: compact ? 'var(--fs-xs, 12px)' : 'var(--fs-sm, 14px)',
        color: 'var(--text-secondary)',
      }}
    >
      {running ? (
        <div data-testid="flashcards-generating" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Loader2 size={13} className="animate-spin" />
          {t.generating(job!.current, job!.total)}
        </div>
      ) : hasDeck ? (
        <>
          <div data-testid="flashcards-counts">
            {t.cards(totalCards)} · {t.subdecks(subdecks)}
          </div>
          <a
            href={downloadHref}
            download={downloadName ?? true}
            data-testid="flashcards-download"
            style={button}
          >
            <Download size={14} strokeWidth={2.25} />
            {t.download}
          </a>
        </>
      ) : (
        <>
          <div>{t.empty}</div>
          {onGenerate && (
            <button
              type="button"
              data-testid="flashcards-generate"
              onClick={onGenerate}
              style={button}
            >
              <Sparkles size={14} strokeWidth={2.25} />
              {t.generate}
            </button>
          )}
        </>
      )}

      {!running && (job?.state === 'error' || error) && (
        <div data-testid="flashcards-error" style={{ color: 'var(--danger)' }}>
          {error ?? job?.message ?? t.failed}
        </div>
      )}

      {hasDeck && !running && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <button
            type="button"
            data-testid="flashcards-howto-toggle"
            aria-expanded={howToOpen}
            onClick={() => setHowToOpen((o) => !o)}
            style={subtleBtn}
          >
            {t.howTo}
          </button>
          {onGenerate && missingModules > 0 && (
            <button
              type="button"
              data-testid="flashcards-generate-missing"
              onClick={onGenerate}
              style={subtleBtn}
            >
              {t.generateMissing(missingModules)}
            </button>
          )}
          {onRegenerate && (
            <button
              type="button"
              data-testid="flashcards-regenerate"
              onClick={() => {
                if (window.confirm(t.regenerateConfirm)) onRegenerate();
              }}
              style={{ ...subtleBtn, marginLeft: 'auto' }}
            >
              {t.regenerate}
            </button>
          )}
        </div>
      )}

      {hasDeck && howToOpen && (
        <ul
          data-testid="flashcards-howto"
          style={{
            margin: 0,
            paddingLeft: 16,
            listStyle: 'disc',
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            lineHeight: 1.4,
          }}
        >
          {t.howToSteps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export interface FlashcardsDeckBlockProps extends FlashcardsDeckBodyProps {
  defaultOpen?: boolean;
}

// Sidebar flavour: a collapsible "module" row above the course modules.
export function FlashcardsDeckBlock({ defaultOpen = true, ...body }: FlashcardsDeckBlockProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div data-testid="toc-flashcards" style={{ marginBottom: 6 }}>
      <button
        type="button"
        data-testid="toc-flashcards-header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px',
          background: 'transparent',
          border: 'none',
          borderRadius: 'var(--radius-sm, 6px)',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text)',
          fontSize: 'var(--fs-sm, 14px)',
          fontWeight: 600,
        }}
      >
        <ChevronDown
          size={12}
          strokeWidth={2.25}
          style={{
            color: 'var(--text-tertiary)',
            transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 120ms ease',
            flexShrink: 0,
          }}
        />
        <Layers size={13} strokeWidth={2} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0 }}>{t.heading}</span>
      </button>

      {open && (
        <div
          style={{
            margin: '2px 0 4px 20px',
            padding: '10px 12px',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md, 8px)',
            background: 'var(--bg)',
          }}
        >
          <FlashcardsDeckBody {...body} />
        </div>
      )}
    </div>
  );
}

// Collapsed sidebar: a single icon that downloads the deck.
export function FlashcardsDeckIcon({ downloadHref }: { downloadHref: string }) {
  return (
    <a
      href={downloadHref}
      download
      data-testid="toc-flashcards-icon"
      title={`${t.heading} — ${t.download}`}
      aria-label={`${t.heading} — ${t.download}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 24,
        height: 24,
        borderRadius: 'var(--radius-sm)',
        color: 'var(--accent)',
      }}
    >
      <Layers size={14} strokeWidth={2} />
    </a>
  );
}

const POLL_MS = 3000;

export function useFlashcardsSummary(courseSlug: string) {
  const [summary, setSummary] = useState<FlashcardsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseSlug}/flashcards`, { cache: 'no-store' });
      if (!res.ok) return;
      setSummary((await res.json()) as FlashcardsSummary);
    } catch {
      /* offline / server restarting — keep the last summary */
    }
  }, [courseSlug]);

  useEffect(() => {
    // Fetch-on-mount: setState only runs after the awaited response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const running = summary?.job?.state === 'running';
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [running, refresh]);

  const start = useCallback(
    async (regenerate: boolean) => {
      setError(null);
      try {
        const res = await fetch(`/api/courses/${courseSlug}/flashcards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ regenerate }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          setError(body.message ?? body.error ?? `HTTP ${res.status}`);
        }
      } catch (err) {
        setError(String(err));
      }
      await refresh();
    },
    [courseSlug, refresh],
  );

  return { summary, error, start };
}

export function FlashcardsTocModule({
  courseSlug,
  collapsed = false,
}: {
  courseSlug: string;
  collapsed?: boolean;
}) {
  const { summary, error, start } = useFlashcardsSummary(courseSlug);
  if (!summary) return null;
  const downloadHref = summary.available ? `/api/courses/${courseSlug}/flashcards/apkg` : undefined;
  if (collapsed) return downloadHref ? <FlashcardsDeckIcon downloadHref={downloadHref} /> : null;
  return (
    <FlashcardsDeckBlock
      totalCards={summary.totalCards}
      subdecks={summary.modules.filter((m) => m.cards > 0).length}
      missingModules={summary.missingModules}
      downloadHref={downloadHref}
      job={summary.job}
      error={error}
      onGenerate={() => void start(false)}
      onRegenerate={() => void start(true)}
    />
  );
}
