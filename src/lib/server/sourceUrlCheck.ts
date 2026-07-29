// Server-only source-URL liveness gate for the generation pipeline.
//
// Why: `lesson.sources` / `section.sources` URLs come straight out of the
// authoring agent's head — sampling the two most recently generated real
// courses found ~2/80 citations dead on arrival (one of them an invented
// DOI that was never registered). The asset gate (lessonAssets.ts) already
// protects image references; this module gives the runner the same
// protection for cited sources.
//
// Classification is deliberately asymmetric:
//   - HTTP 404 / 410 → hard issue. The link will never work; the agent must
//     replace it, so the runner fails the attempt and feeds the URL list
//     into the retry brief (same pattern as formatAssetIssuesError).
//   - Everything else that isn't a clean 2xx/3xx (403 anti-bot walls, 429,
//     5xx, DNS failures, timeouts) → warning only. Those URLs are usually
//     reachable from a real browser or merely transient, and failing a
//     multi-minute Opus lesson run on them would cost more than it saves.

import type { Lesson } from '@/lib/schemas/lesson';

export interface SourceUrlRef {
  url: string;
  origin: string;
}

export interface SourceUrlIssue {
  url: string;
  status: number;
  origins: string[];
}

export interface SourceUrlWarning {
  url: string;
  detail: string;
  origins: string[];
}

export interface SourceUrlCheckResult {
  issues: SourceUrlIssue[];
  warnings: SourceUrlWarning[];
}

export type UrlProbeResult =
  | { kind: 'status'; status: number }
  | { kind: 'unreachable'; detail: string };

export type UrlProbe = (url: string) => Promise<UrlProbeResult>;

const HTTP_URL_REGEX = /^https?:\/\//i;

/** Statuses that mean "this URL is permanently dead" — the only hard fails. */
const DEAD_STATUSES = new Set([404, 410]);

/**
 * Walk every `lesson.sources[*].url` and `sections[*].sources[*].url` and
 * return one ref per occurrence (duplicates included — the prober dedupes,
 * but the origins of every occurrence are kept for the retry brief).
 */
export function collectSourceUrls(lesson: Lesson): SourceUrlRef[] {
  const refs: SourceUrlRef[] = [];
  (lesson.sources ?? []).forEach((s, i) => {
    if (HTTP_URL_REGEX.test(s.url)) {
      refs.push({ url: s.url, origin: `lesson.sources[${i}] (${JSON.stringify(s.title)})` });
    }
  });
  lesson.sections.forEach((section, si) => {
    (section.sources ?? []).forEach((s, i) => {
      if (HTTP_URL_REGEX.test(s.url)) {
        refs.push({
          url: s.url,
          origin: `sections[${si}] (id=${section.id}).sources[${i}] (${JSON.stringify(s.title)})`,
        });
      }
    });
  });
  return refs;
}

// A real-browser UA keeps the false-positive rate down — several academic
// hosts (doi.org resolvers, publisher landing pages) answer 403 to obvious
// bot agents but resolve fine with a browser string.
const PROBE_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/**
 * Build the default prober: HEAD first (cheap), falling back to GET whenever
 * HEAD errors or returns >= 400 — some servers reject HEAD outright (405) and
 * some misconfigured ones 403/404 it while GET works, so a hard verdict is
 * only ever taken from the GET response. Redirects are followed; the verdict
 * is the final status.
 */
export function makeFetchProbe(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
): UrlProbe {
  const attempt = async (url: string, method: 'HEAD' | 'GET'): Promise<UrlProbeResult> => {
    try {
      const res = await fetchImpl(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': PROBE_USER_AGENT, accept: '*/*' },
      });
      // Drain nothing — we only need the status. Cancel the body so the
      // connection is released promptly on GETs of large pages.
      try {
        await res.body?.cancel();
      } catch {
        /* body may already be consumed/locked — irrelevant to the verdict */
      }
      return { kind: 'status', status: res.status };
    } catch (err) {
      return {
        kind: 'unreachable',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return async (url: string) => {
    const head = await attempt(url, 'HEAD');
    if (head.kind === 'status' && head.status < 400) return head;
    return attempt(url, 'GET');
  };
}

/**
 * Probe every distinct source URL in the lesson and classify the results.
 * `probe` is injectable for tests; production callers use `makeFetchProbe()`.
 * Probing never throws — a prober crash degrades to an `unreachable` warning.
 */
export async function findDeadSourceUrls(
  lesson: Lesson,
  probe: UrlProbe = makeFetchProbe(),
  opts: { concurrency?: number } = {},
): Promise<SourceUrlCheckResult> {
  const refs = collectSourceUrls(lesson);
  const byUrl = new Map<string, string[]>();
  for (const ref of refs) {
    const origins = byUrl.get(ref.url);
    if (origins) origins.push(ref.origin);
    else byUrl.set(ref.url, [ref.origin]);
  }

  const urls = [...byUrl.keys()];
  const concurrency = Math.max(1, opts.concurrency ?? 8);
  const results = new Map<string, UrlProbeResult>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < urls.length) {
      const url = urls[cursor];
      cursor += 1;
      let result: UrlProbeResult;
      try {
        result = await probe(url);
      } catch (err) {
        result = {
          kind: 'unreachable',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
      results.set(url, result);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, urls.length) }, () => worker()),
  );

  const issues: SourceUrlIssue[] = [];
  const warnings: SourceUrlWarning[] = [];
  for (const [url, origins] of byUrl) {
    const result = results.get(url);
    if (!result) continue;
    if (result.kind === 'unreachable') {
      warnings.push({ url, detail: result.detail, origins });
      continue;
    }
    if (DEAD_STATUSES.has(result.status)) {
      issues.push({ url, status: result.status, origins });
    } else if (result.status >= 400) {
      warnings.push({ url, detail: `HTTP ${result.status}`, origins });
    }
  }
  return { issues, warnings };
}

/**
 * Render the hard issues as a retry brief the agent can act on without
 * guessing — same contract as `formatAssetIssuesError`.
 */
export function formatSourceUrlIssuesError(issues: SourceUrlIssue[]): string {
  const lines = issues.map(
    (i) =>
      `- DEAD URL (HTTP ${i.status}): ${i.url} (referenced by ${i.origins.join(', ')})`,
  );
  return (
    `Lesson cites ${issues.length} dead source URL(s) that block marking it done:\n` +
    lines.join('\n') +
    `\nReplace each dead reference with a live, credible source covering the same material ` +
    `(prefer DOI / arxiv / en.wikipedia.org / official project docs), and VERIFY the replacement ` +
    `actually resolves — fetch it (WebFetch, or \`curl -sIL --max-time 10 "<url>"\`) before writing ` +
    `it into the lesson. Do NOT invent DOIs or URLs from memory.`
  );
}
