// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTtsQueueForTests,
  enqueue,
  type TtsJobUpdate,
} from './ttsQueue';

let urlCounter = 0;

beforeEach(() => {
  __resetTtsQueueForTests();
  urlCounter = 0;
  // jsdom has no URL.createObjectURL — stub it with a deterministic factory.
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: (_blob: Blob) => `blob:fake-${++urlCounter}`,
      revokeObjectURL: () => undefined,
    }),
  );
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetTtsQueueForTests();
});

describe('ttsQueue (US-186) — FIFO serialised TTS worker', () => {
  it('serialises generation across multiple enqueues, completes in order, never two in-flight', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const completionOrder: string[] = [];

    const fetchMock = vi.fn(
      async (input: RequestInfo | URL): Promise<Response> => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (!url.endsWith('/api/tts')) {
          throw new Error(`Unexpected fetch: ${url}`);
        }
        inFlight += 1;
        if (inFlight > maxInFlight) maxInFlight = inFlight;
        return await new Promise<Response>((resolve) => {
          setTimeout(() => {
            inFlight -= 1;
            resolve(
              new Response(new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), {
                status: 200,
                headers: { 'Content-Type': 'audio/wav' },
              }),
            );
          }, 100);
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    const handles = [
      enqueue('first text', 'en-female-warm'),
      enqueue('second text', 'en-female-warm'),
      enqueue('third text', 'en-female-warm'),
    ];

    for (const handle of handles) {
      handle.subscribe((update: TtsJobUpdate) => {
        if (update.status === 'ready') completionOrder.push(handle.id);
      });
    }

    // Drive the queue forward step-by-step. Each tick of 100ms resolves the
    // currently in-flight fetch; the worker then kicks off the next one.
    // We drain by running pending microtasks between timer advances.
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(100);
    }

    expect(maxInFlight).toBe(1);
    expect(completionOrder).toEqual([handles[0].id, handles[1].id, handles[2].id]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
