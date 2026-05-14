// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

type TtsJobUpdate = import('@/lib/client/ttsQueue').TtsJobUpdate;
type TtsJobListener = (update: TtsJobUpdate) => void;

interface MockHandle {
  id: string;
  resolve: (blobUrl: string) => void;
  reject: (message: string) => void;
}

// Controllable mock of the ttsQueue: each enqueue creates a queued job; the
// worker mock only advances one job at a time.
let nextId = 0;
const mockJobs: Array<{
  id: string;
  status: 'queued' | 'generating' | 'ready' | 'error';
  text: string;
  voice: string;
  listeners: Set<TtsJobListener>;
  blobUrl?: string;
  message?: string;
}> = [];
const mockHandles: MockHandle[] = [];

function emitMockJob(job: (typeof mockJobs)[number]) {
  const update: TtsJobUpdate = { status: job.status };
  if (job.status === 'queued') {
    const queuedSiblings = mockJobs.filter((j) => j.status === 'queued');
    const idx = queuedSiblings.findIndex((j) => j.id === job.id);
    update.queuePosition = idx >= 0 ? idx + 1 : 1;
  }
  if (job.status === 'ready' && job.blobUrl) update.blobUrl = job.blobUrl;
  if (job.status === 'error' && job.message) update.message = job.message;
  for (const listener of job.listeners) {
    try {
      listener(update);
    } catch {
      /* ignore */
    }
  }
}

function advanceMockWorker() {
  // Promote the first queued job to generating if none is generating.
  const generating = mockJobs.find((j) => j.status === 'generating');
  if (generating) return;
  const next = mockJobs.find((j) => j.status === 'queued');
  if (!next) return;
  next.status = 'generating';
  emitMockJob(next);
  // Re-emit positions for remaining queued jobs.
  for (const j of mockJobs) {
    if (j.status === 'queued') emitMockJob(j);
  }
}

vi.mock('@/lib/client/ttsQueue', () => {
  return {
    enqueue: (text: string, voice: string) => {
      const id = `job-${++nextId}`;
      const job: (typeof mockJobs)[number] = {
        id,
        status: 'queued',
        text,
        voice,
        listeners: new Set<TtsJobListener>(),
      };
      mockJobs.push(job);

      mockHandles.push({
        id,
        resolve: (blobUrl: string) => {
          job.status = 'ready';
          job.blobUrl = blobUrl;
          emitMockJob(job);
          advanceMockWorker();
        },
        reject: (message: string) => {
          job.status = 'error';
          job.message = message;
          emitMockJob(job);
          advanceMockWorker();
        },
      });

      // Synchronously promote the first queued job to generating (mirroring
      // the real worker's behaviour on enqueue).
      advanceMockWorker();

      return {
        id,
        subscribe(listener: TtsJobListener) {
          job.listeners.add(listener);
          // Emit current state immediately (snapshot semantics).
          const update: TtsJobUpdate = { status: job.status };
          if (job.status === 'queued') {
            const queuedSiblings = mockJobs.filter((j) => j.status === 'queued');
            const idx = queuedSiblings.findIndex((j) => j.id === job.id);
            update.queuePosition = idx >= 0 ? idx + 1 : 1;
          }
          listener(update);
          return () => {
            job.listeners.delete(listener);
          };
        },
      };
    },
    __resetTtsQueueForTests: () => undefined,
  };
});

vi.mock('@/lib/client/ttsVoice', () => ({
  readTtsVoice: () => 'en-female-warm',
  writeTtsVoice: () => undefined,
  isTtsVoice: () => true,
  TTS_VOICE_STORAGE_KEY: 'aiLecturer.ttsVoice',
}));

import { TheoryWidget } from './TheoryWidget';

beforeEach(() => {
  nextId = 0;
  mockJobs.length = 0;
  mockHandles.length = 0;
  // jsdom: stub HTMLMediaElement play
  Object.defineProperty(HTMLMediaElement.prototype, 'play', {
    configurable: true,
    value: vi.fn(() => Promise.resolve()),
  });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TheoryWidget (US-186) — Read button + queue integration', () => {
  it('two widgets clicked in sequence: second stays Queued (1) until first finishes', () => {
    const { getAllByTestId } = render(
      <div>
        <TheoryWidget data={{ markdown: '# A\n\nFirst widget text.' }} />
        <TheoryWidget data={{ markdown: '# B\n\nSecond widget text.' }} />
      </div>,
    );

    const buttons = getAllByTestId('theory-tts-button');
    expect(buttons.length).toBe(2);

    act(() => {
      fireEvent.click(buttons[0]);
    });
    act(() => {
      fireEvent.click(buttons[1]);
    });

    // First widget is generating; second is queued at position 1.
    expect(buttons[0].textContent).toMatch(/Generating/);
    expect(buttons[1].textContent).toMatch(/Queued \(1\)/);

    // Resolve first job → first becomes ▶ Replay, second becomes Generating.
    act(() => {
      mockHandles[0].resolve('blob:fake-1');
    });
    expect(buttons[0].textContent).toMatch(/Replay/);
    expect(buttons[1].textContent).toMatch(/Generating/);

    // Resolve second job → both ready.
    act(() => {
      mockHandles[1].resolve('blob:fake-2');
    });
    expect(buttons[0].textContent).toMatch(/Replay/);
    expect(buttons[1].textContent).toMatch(/Replay/);

    // Audio elements render with the testid.
    expect(screen.getAllByTestId('theory-tts-audio').length).toBe(2);
  });
});
