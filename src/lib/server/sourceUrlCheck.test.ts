import { describe, expect, it, vi } from 'vitest';

import type { Lesson } from '@/lib/schemas/lesson';
import {
  collectSourceUrls,
  findDeadSourceUrls,
  formatSourceUrlIssuesError,
  makeFetchProbe,
  type UrlProbe,
} from '@/lib/server/sourceUrlCheck';

function makeLesson(opts: {
  lessonSources?: { url: string; title: string }[];
  sectionSources?: { url: string; title: string }[];
}): Lesson {
  return {
    schemaVersion: 1,
    slug: 'lesson1',
    courseSlug: 'demo',
    moduleId: 'm1',
    title: 'Lesson 1',
    eyebrow: 'STUB',
    description: 'Stub',
    estimatedMinutes: 5,
    sections: [
      {
        id: 's1',
        title: 'Read',
        type: 'theory',
        data: { markdown: 'Stub.' },
        ...(opts.sectionSources
          ? {
              sources: opts.sectionSources.map((s) => ({
                ...s,
                kind: 'article' as const,
              })),
            }
          : {}),
      },
    ],
    ...(opts.lessonSources
      ? {
          sources: opts.lessonSources.map((s) => ({
            ...s,
            kind: 'article' as const,
          })),
        }
      : {}),
  } as Lesson;
}

describe('collectSourceUrls', () => {
  it('collects lesson-level and section-level sources with origins', () => {
    const lesson = makeLesson({
      lessonSources: [{ url: 'https://a.example/one', title: 'A' }],
      sectionSources: [{ url: 'https://b.example/two', title: 'B' }],
    });
    const refs = collectSourceUrls(lesson);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      url: 'https://a.example/one',
      origin: 'lesson.sources[0] ("A")',
    });
    expect(refs[1].url).toBe('https://b.example/two');
    expect(refs[1].origin).toContain('sections[0] (id=s1).sources[0]');
  });

  it('returns an empty list when the lesson cites nothing', () => {
    expect(collectSourceUrls(makeLesson({}))).toEqual([]);
  });
});

describe('findDeadSourceUrls', () => {
  const status = (n: number) => ({ kind: 'status' as const, status: n });

  it('flags 404 and 410 as hard issues, keeps every origin', async () => {
    const lesson = makeLesson({
      lessonSources: [
        { url: 'https://dead.example/x', title: 'Dead' },
        { url: 'https://live.example/y', title: 'Live' },
      ],
      sectionSources: [{ url: 'https://dead.example/x', title: 'Dead again' }],
    });
    const probe: UrlProbe = async (url) =>
      url.includes('dead') ? status(404) : status(200);
    const result = await findDeadSourceUrls(lesson, probe);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].url).toBe('https://dead.example/x');
    expect(result.issues[0].status).toBe(404);
    expect(result.issues[0].origins).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it('classifies 403 / 429 / 5xx and unreachable hosts as warnings, not issues', async () => {
    const lesson = makeLesson({
      lessonSources: [
        { url: 'https://walled.example/a', title: 'Walled' },
        { url: 'https://flaky.example/b', title: 'Flaky' },
        { url: 'https://gone.example/c', title: 'Gone host' },
      ],
    });
    const probe: UrlProbe = async (url) => {
      if (url.includes('walled')) return status(403);
      if (url.includes('flaky')) return status(503);
      return { kind: 'unreachable', detail: 'getaddrinfo ENOTFOUND' };
    };
    const result = await findDeadSourceUrls(lesson, probe);
    expect(result.issues).toEqual([]);
    expect(result.warnings).toHaveLength(3);
    expect(result.warnings.map((w) => w.detail)).toEqual(
      expect.arrayContaining(['HTTP 403', 'HTTP 503', 'getaddrinfo ENOTFOUND']),
    );
  });

  it('probes each distinct URL exactly once', async () => {
    const lesson = makeLesson({
      lessonSources: [
        { url: 'https://same.example/x', title: 'One' },
        { url: 'https://same.example/x', title: 'Two' },
      ],
    });
    const probe = vi.fn(async () => status(200));
    await findDeadSourceUrls(lesson, probe);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('degrades a throwing prober to an unreachable warning', async () => {
    const lesson = makeLesson({
      lessonSources: [{ url: 'https://boom.example/x', title: 'Boom' }],
    });
    const probe: UrlProbe = async () => {
      throw new Error('prober crashed');
    };
    const result = await findDeadSourceUrls(lesson, probe);
    expect(result.issues).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].detail).toBe('prober crashed');
  });
});

describe('makeFetchProbe', () => {
  function fakeResponse(statusCode: number): Response {
    return { status: statusCode, body: null } as unknown as Response;
  }

  it('returns the HEAD status when it is < 400', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200));
    const probe = makeFetchProbe(fetchImpl as unknown as typeof fetch);
    await expect(probe('https://x.example/')).resolves.toEqual({
      kind: 'status',
      status: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((fetchImpl.mock.calls[0] as unknown[])[1]).toMatchObject({ method: 'HEAD' });
  });

  it('falls back to GET when HEAD returns >= 400 — the GET verdict wins', async () => {
    // Server that rejects HEAD (405) but serves GET fine.
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      fakeResponse(init?.method === 'HEAD' ? 405 : 200),
    );
    const probe = makeFetchProbe(fetchImpl as unknown as typeof fetch);
    await expect(probe('https://x.example/')).resolves.toEqual({
      kind: 'status',
      status: 200,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('confirms a hard 404 via GET before reporting it', async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(404));
    const probe = makeFetchProbe(fetchImpl as unknown as typeof fetch);
    await expect(probe('https://x.example/')).resolves.toEqual({
      kind: 'status',
      status: 404,
    });
    const methods = fetchImpl.mock.calls.map(
      (c) => ((c as unknown[])[1] as RequestInit).method,
    );
    expect(methods).toEqual(['HEAD', 'GET']);
  });

  it('reports unreachable when both HEAD and GET throw', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const probe = makeFetchProbe(fetchImpl as unknown as typeof fetch);
    await expect(probe('https://x.example/')).resolves.toEqual({
      kind: 'unreachable',
      detail: 'fetch failed',
    });
  });
});

describe('formatSourceUrlIssuesError', () => {
  it('lists every dead URL with its origins and ends with actionable guidance', () => {
    const msg = formatSourceUrlIssuesError([
      {
        url: 'https://dead.example/x',
        status: 404,
        origins: ['lesson.sources[0] ("Dead")', 'sections[2] (id=s3).sources[0] ("Dead")'],
      },
    ]);
    expect(msg).toContain('1 dead source URL(s)');
    expect(msg).toContain('DEAD URL (HTTP 404): https://dead.example/x');
    expect(msg).toContain('lesson.sources[0] ("Dead")');
    expect(msg).toContain('sections[2] (id=s3).sources[0]');
    expect(msg).toContain('Do NOT invent DOIs');
  });
});
