// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

import {
  ResumeGenerationBanners,
  type ActiveRunResponse,
} from './ResumeGenerationBanner';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function stubFetch(body: ActiveRunResponse) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/courses/active-run')) {
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not mocked', { status: 500 });
  }) as unknown as typeof fetch;
}

describe('ResumeGenerationBanners — US-195 shared host', () => {
  beforeEach(() => {
    stubFetch({ active: false, queue: [] });
  });

  it('renders nothing (no extra container) when there is no active or resumable run', async () => {
    const { container } = render(
      <ResumeGenerationBanners onNavigateToGeneration={() => undefined} />,
    );
    // Initial render is null while fetch is in flight.
    expect(container.firstChild).toBeNull();
    // Drain the microtask the fake fetch resolves to.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.firstChild).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders the active-run banner when GET /api/courses/active-run reports active', async () => {
    stubFetch({
      active: true,
      slug: 'demo-course',
      name: 'Demo Course',
      stage: 'lesson:one',
      queue: [],
    });
    render(<ResumeGenerationBanners onNavigateToGeneration={() => undefined} />);
    await waitFor(() => {
      expect(screen.getByTestId('resume-banner')).toBeTruthy();
    });
    expect(screen.getByTestId('resume-banner-name').textContent).toBe('Demo Course');
    expect(screen.getByTestId('resume-banner-resume')).toBeTruthy();
    expect(screen.getByTestId('cancel-and-restart-btn')).toBeTruthy();
  });

  it('hides the active banner when hideForSlug matches its slug', async () => {
    stubFetch({
      active: true,
      slug: 'self-course',
      name: 'Self Course',
      stage: 'design',
      queue: [],
    });
    render(
      <ResumeGenerationBanners
        hideForSlug="self-course"
        onNavigateToGeneration={() => undefined}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId('resume-banner')).toBeNull();
  });

  it('renders one ResumableRunBanner per paused entry harvested from `resumable[]`', async () => {
    stubFetch({
      active: false,
      queue: [],
      resumable: [
        {
          slug: 'paused-one',
          name: 'Paused One',
          lessonsDone: 2,
          lessonsTotal: 5,
          initStatus: 'done',
          lastUpdatedAt: new Date().toISOString(),
        },
        {
          slug: 'paused-two',
          name: 'Paused Two',
          lessonsDone: 0,
          lessonsTotal: 0,
          initStatus: 'done',
          lastUpdatedAt: new Date().toISOString(),
        },
      ],
    });
    render(<ResumeGenerationBanners onNavigateToGeneration={() => undefined} />);
    await waitFor(() => {
      expect(screen.getAllByTestId('resumable-run-banner').length).toBe(2);
    });
    expect(screen.queryByTestId('resume-banner')).toBeNull();
  });

  it('honors sticky=false (no sticky positioning on the banner container)', async () => {
    stubFetch({
      active: true,
      slug: 'demo',
      name: 'Demo',
      stage: 'design',
      queue: [],
    });
    render(
      <ResumeGenerationBanners
        sticky={false}
        onNavigateToGeneration={() => undefined}
      />,
    );
    const banner = await screen.findByTestId('resume-banner');
    expect((banner as HTMLElement).style.position).not.toBe('sticky');
  });
});
