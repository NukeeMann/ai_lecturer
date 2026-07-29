// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import { LessonChat, type ChatMessage } from './LessonChat';
import { TTS_VOICE_STORAGE_KEY } from '@/lib/client/ttsVoice';

const FIXTURE: ChatMessage[] = [
  { id: 'm-1', role: 'user', text: 'hello' },
  { id: 'm-2', role: 'assistant', text: 'first reply' },
  { id: 'm-3', role: 'user', text: 'follow up' },
  { id: 'm-4', role: 'assistant', text: '', pending: true },
  { id: 'm-5', role: 'error', text: 'AI Tutor error: boom' },
  { id: 'm-6', role: 'assistant', text: 'second reply' },
];

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LessonChat (US-183) — speak button per assistant message', () => {
  it('renders a speak button only on non-pending, non-stopped, non-empty assistant messages', () => {
    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
        initialMessages={FIXTURE}
      />,
    );

    // Exactly two speak buttons — one per "speakable" assistant message.
    const buttons = screen
      .queryAllByRole('button')
      .filter((b) => (b.getAttribute('data-testid') ?? '').startsWith('lesson-chat-tts-'));
    expect(buttons.length).toBe(2);

    // The two we expect.
    expect(screen.getByTestId('lesson-chat-tts-m-2')).not.toBeNull();
    expect(screen.getByTestId('lesson-chat-tts-m-6')).not.toBeNull();

    // The ones we DON'T expect — user, pending assistant, error.
    expect(screen.queryByTestId('lesson-chat-tts-m-1')).toBeNull();
    expect(screen.queryByTestId('lesson-chat-tts-m-3')).toBeNull();
    expect(screen.queryByTestId('lesson-chat-tts-m-4')).toBeNull();
    expect(screen.queryByTestId('lesson-chat-tts-m-5')).toBeNull();

    // aria-label starts in idle state.
    expect(
      screen.getByTestId('lesson-chat-tts-m-2').getAttribute('aria-label'),
    ).toBe('Read message aloud');
  });

  it('fetches /api/tts on first click, uses cache on re-click, and re-fetches for a different message', async () => {
    // Seed the user's selected voice so handleSpeak reads it via readTtsVoice.
    window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, 'en-male-neutral');

    const fakeMp3 = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], {
      type: 'audio/mpeg',
    });
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.endsWith('/api/tts')) {
          return new Response(fakeMp3, {
            status: 200,
            headers: { 'Content-Type': 'audio/mpeg' },
          });
        }
        throw new Error(`Unexpected fetch: ${url}`);
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    // Deterministic blob URLs so cache assertions are unambiguous.
    let urlCounter = 0;
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => `blob:mock://${++urlCounter}`);
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {
        /* no-op */
      });

    // jsdom's HTMLMediaElement.play is unimplemented and throws. Stub it.
    const playSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(async function (this: HTMLMediaElement) {
        // Mimic the browser flipping `paused` from true → false.
        Object.defineProperty(this, 'paused', {
          configurable: true,
          get: () => false,
        });
      });
    const pauseSpy = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', {
          configurable: true,
          get: () => true,
        });
      });

    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
        initialMessages={FIXTURE}
      />,
    );

    const buttonA = screen.getByTestId('lesson-chat-tts-m-2');
    const buttonB = screen.getByTestId('lesson-chat-tts-m-6');

    // First click on A — fetches /api/tts.
    await act(async () => {
      fireEvent.click(buttonA);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [firstCallInput, firstCallInit] = fetchMock.mock.calls[0]!;
    const firstUrl =
      typeof firstCallInput === 'string'
        ? firstCallInput
        : (firstCallInput as Request).url;
    expect(firstUrl).toBe('/api/tts');
    const firstBody = JSON.parse(String(firstCallInit?.body ?? '{}')) as {
      text?: string;
      voice?: string;
    };
    expect(firstBody.text).toBe('first reply');
    expect(firstBody.voice).toBe('en-male-neutral');

    // Second click on A — cached, NO new fetch.
    await act(async () => {
      fireEvent.click(buttonA);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Re-click A again to resume — still no new fetch.
    await act(async () => {
      fireEvent.click(buttonA);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Click B — different message → new fetch fires.
    await act(async () => {
      fireEvent.click(buttonB);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [secondCallInput, secondCallInit] = fetchMock.mock.calls[1]!;
    const secondUrl =
      typeof secondCallInput === 'string'
        ? secondCallInput
        : (secondCallInput as Request).url;
    expect(secondUrl).toBe('/api/tts');
    const secondBody = JSON.parse(String(secondCallInit?.body ?? '{}')) as {
      text?: string;
    };
    expect(secondBody.text).toBe('second reply');

    createSpy.mockRestore();
    revokeSpy.mockRestore();
    playSpy.mockRestore();
    pauseSpy.mockRestore();
  });
});

describe('LessonChat TTS — pause/play icon state', () => {
  it('flips Pause icon back to Play when audio pauses; click again resumes without re-fetching', async () => {
    const fakeMp3 = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], {
      type: 'audio/mpeg',
    });
    const fetchMock = vi.fn(async () => {
      return new Response(fakeMp3, {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:mock://1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    // play()/pause() stubs that ALSO dispatch the matching DOM event the way
    // real <audio> does — this is what drives onPlay/onPause in the component.
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
      async function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, get: () => false });
        this.dispatchEvent(new Event('play'));
      },
    );
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, 'paused', { configurable: true, get: () => true });
      this.dispatchEvent(new Event('pause'));
    });

    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
        initialMessages={FIXTURE}
      />,
    );

    const btn = screen.getByTestId('lesson-chat-tts-m-2');

    // First click → fetch + play → icon is Pause.
    await act(async () => {
      fireEvent.click(btn);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(btn.getAttribute('data-state')).toBe('playing');
    expect(btn.getAttribute('aria-label')).toBe('Pause playback');

    // Second click → pause → icon flips back to Volume2 (paused state, not
    // idle), aria-label hints at "Resume" so the row reflects that the audio
    // is loaded but on hold.
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute('data-state')).toBe('paused');
    expect(btn.getAttribute('aria-label')).toBe('Resume playback');

    // Third click → resume from same position → icon back to Pause, NO new
    // fetch (cache hit).
    await act(async () => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute('data-state')).toBe('playing');
    expect(btn.getAttribute('aria-label')).toBe('Pause playback');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    createSpy.mockRestore();
  });
});

describe('LessonChat TTS — playback-speed slider', () => {
  it('shows the speed slider once audio is loaded and applies the chosen rate to the audio element', async () => {
    const fakeMp3 = new Blob([new Uint8Array([0xff, 0xfb, 0x90, 0x00])], {
      type: 'audio/mpeg',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(fakeMp3, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        }),
      ),
    );
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:mock://1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(
      async function (this: HTMLMediaElement) {
        Object.defineProperty(this, 'paused', { configurable: true, get: () => false });
        this.dispatchEvent(new Event('play'));
      },
    );
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (
      this: HTMLMediaElement,
    ) {
      Object.defineProperty(this, 'paused', { configurable: true, get: () => true });
      this.dispatchEvent(new Event('pause'));
    });

    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
        initialMessages={FIXTURE}
      />,
    );

    // Slider is NOT in the DOM before the user has generated any audio.
    expect(screen.queryByTestId('lesson-chat-tts-speed-m-2')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByTestId('lesson-chat-tts-m-2'));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // After audio has been generated for m-2, the slider appears next to it.
    const sliderWrap = screen.getByTestId('lesson-chat-tts-speed-m-2');
    const slider = sliderWrap.querySelector('input[type="range"]') as HTMLInputElement;
    expect(slider).not.toBeNull();
    expect(slider.value).toBe('1');
    expect(slider.min).toBe('0.5');
    expect(slider.max).toBe('3');

    // Initial readout is "1×".
    expect(screen.getByTestId('lesson-chat-tts-speed-value-m-2').textContent).toBe('1×');

    // Drag to 2.5× → audio element picks up the new rate live.
    await act(async () => {
      fireEvent.change(slider, { target: { value: '2.5' } });
    });
    const audioEl = screen.getByTestId('lesson-chat-tts-audio') as HTMLAudioElement;
    expect(audioEl.playbackRate).toBeCloseTo(2.5);
    expect(screen.getByTestId('lesson-chat-tts-speed-value-m-2').textContent).toBe(
      '2.5×',
    );

    // 3× is the upper cap.
    await act(async () => {
      fireEvent.change(slider, { target: { value: '3' } });
    });
    expect(audioEl.playbackRate).toBeCloseTo(3);
    expect(screen.getByTestId('lesson-chat-tts-speed-value-m-2').textContent).toBe('3×');
  });
});

// US-184: STT mic button with hybrid Web Speech / `/api/stt/upload` fallback.
//
// Tests below avoid any router/network round-trips by feeding `initialMessages`
// and stubbing the global capture backends per test.

interface FakeRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface FakeRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { results: FakeRecognitionResult[] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: ((event: Event) => void) | null;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function buildFakeSpeechRecognition(): {
  ctor: () => FakeRecognitionInstance;
  instances: FakeRecognitionInstance[];
} {
  const instances: FakeRecognitionInstance[] = [];
  const ctor = vi.fn(function FakeRecognition(
    this: FakeRecognitionInstance,
  ): FakeRecognitionInstance {
    const inst: FakeRecognitionInstance = {
      continuous: false,
      interimResults: false,
      lang: '',
      onresult: null,
      onerror: null,
      onend: null,
      start: vi.fn(),
      stop: vi.fn(),
    };
    instances.push(inst);
    return inst;
  }) as unknown as () => FakeRecognitionInstance;
  return { ctor, instances };
}

describe('LessonChat (US-184) — Web Speech mic path', () => {
  it('appends the final transcript to the textarea on click → result → click', async () => {
    const { ctor, instances } = buildFakeSpeechRecognition();
    vi.stubGlobal('SpeechRecognition', ctor);
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
      />,
    );

    const mic = screen.getByTestId('lesson-chat-stt-toggle');
    expect(mic.getAttribute('aria-label')).toBe('Start voice input');

    // First click → recognition.start() called, mic flips to 'recording'.
    await act(async () => {
      fireEvent.click(mic);
    });
    expect(instances.length).toBe(1);
    const rec = instances[0]!;
    expect(rec.start).toHaveBeenCalledTimes(1);
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(mic.getAttribute('aria-label')).toBe('Stop voice input');
    expect(screen.getByTestId('lesson-chat-stt-recording')).not.toBeNull();

    // Fire a synthetic FINAL onresult event with text `hello world`.
    await act(async () => {
      rec.onresult?.({
        results: [
          { isFinal: true, 0: { transcript: 'hello world' } },
        ],
      });
    });

    // Second click → recognition.stop() called, transcript appended.
    await act(async () => {
      fireEvent.click(mic);
    });
    expect(rec.stop).toHaveBeenCalledTimes(1);

    const textarea = screen.getByTestId('lesson-chat-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('hello world');

    // /api/stt/upload was NOT called — Web Speech path stays purely client-side.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('LessonChat (US-184) — MediaRecorder fallback path', () => {
  it('uploads to /api/stt/upload and appends the returned text when SpeechRecognition is absent', async () => {
    // Remove both Web Speech globals so the fallback branch fires.
    const w = window as unknown as Record<string, unknown>;
    delete w.SpeechRecognition;
    delete w.webkitSpeechRecognition;

    // Fake stream with a track whose .stop() we can observe.
    const trackStop = vi.fn();
    const fakeTrack = { stop: trackStop } as unknown as MediaStreamTrack;
    const fakeStream = {
      getTracks: () => [fakeTrack],
    } as unknown as MediaStream;

    const getUserMedia = vi.fn(async () => fakeStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    // Controllable fake MediaRecorder.
    let activeRecorder: FakeMediaRecorder | null = null;
    interface FakeMediaRecorder {
      state: 'inactive' | 'recording';
      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null;
      onstop: (() => void) | null;
      start: ReturnType<typeof vi.fn>;
      stop: () => void;
    }
    const ctor = vi.fn(function FakeMediaRecorder(
      this: FakeMediaRecorder,
      _stream: MediaStream,
      _opts?: { mimeType?: string },
    ) {
      this.state = 'inactive';
      this.mimeType = _opts?.mimeType ?? 'audio/webm';
      this.ondataavailable = null;
      this.onstop = null;
      this.start = vi.fn(() => {
        this.state = 'recording';
      });
      this.stop = () => {
        this.state = 'inactive';
        // Synthesize a single data chunk, then fire onstop.
        this.ondataavailable?.({
          data: new Blob(['fake-audio'], { type: this.mimeType }),
        } as BlobEvent);
        this.onstop?.();
      };
      activeRecorder = this;
    });
    // Static helper on the ctor — our helper probes this.
    (
      ctor as unknown as { isTypeSupported: (m: string) => boolean }
    ).isTypeSupported = () => true;
    vi.stubGlobal('MediaRecorder', ctor);

    const fetchMock = vi.fn(
      async (
        _input: RequestInfo | URL,
        _init?: RequestInit,
      ): Promise<Response> => {
        return new Response(JSON.stringify({ text: 'fallback text' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
      />,
    );

    const mic = screen.getByTestId('lesson-chat-stt-toggle');

    // First click → getUserMedia + MediaRecorder.start().
    await act(async () => {
      fireEvent.click(mic);
    });
    await act(async () => {
      // Let the async getUserMedia / start chain settle.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(activeRecorder).not.toBeNull();
    expect(activeRecorder!.start).toHaveBeenCalledTimes(1);

    // Second click → recorder.stop() → onstop → uploadAndTranscribe.
    await act(async () => {
      fireEvent.click(mic);
    });
    await act(async () => {
      // Drain the upload promise chain.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // FormData posted to /api/stt/upload.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0]!;
    expect(calledUrl).toBe('/api/stt/upload');
    expect(calledInit?.method).toBe('POST');
    expect(calledInit?.body).toBeInstanceOf(FormData);
    const body = calledInit!.body as FormData;
    const audioField = body.get('audio');
    expect(audioField).toBeInstanceOf(Blob);

    // Stream track released.
    expect(trackStop).toHaveBeenCalledTimes(1);

    const textarea = screen.getByTestId('lesson-chat-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toContain('fallback text');
  });
});

describe('LessonChat (US-187) — markdown + math + code rendering', () => {
  it('renders bold, KaTeX, and highlighted code fences in both user and assistant bubbles', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u-1',
        role: 'user',
        text: "**bold** $x^2$\n\n```python\nprint('y')\n```",
      },
      {
        id: 'a-1',
        role: 'assistant',
        text: "Sure! Here is **the answer**: $E=mc^2$ and:\n\n```js\nconst x = 1;\n```",
      },
    ];

    const { container } = render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
        initialMessages={messages}
      />,
    );

    const userBubble = container.querySelector(
      'li[data-role="user"]',
    ) as HTMLElement;
    const assistantBubble = container.querySelector(
      'li[data-role="assistant"]',
    ) as HTMLElement;
    expect(userBubble).not.toBeNull();
    expect(assistantBubble).not.toBeNull();

    // Bold rendered as <strong> on both sides.
    expect(userBubble.querySelector('strong')?.textContent).toBe('bold');
    expect(assistantBubble.querySelector('strong')?.textContent).toBe(
      'the answer',
    );

    // KaTeX nodes appear in both bubbles.
    expect(userBubble.querySelector('.katex')).not.toBeNull();
    expect(assistantBubble.querySelector('.katex')).not.toBeNull();

    // Code fence in the assistant bubble gets rehype-highlight's language
    // class applied to the inner <code>, wrapped in <pre>.
    const assistantPre = assistantBubble.querySelector('pre');
    expect(assistantPre).not.toBeNull();
    const assistantCode = assistantPre!.querySelector('code');
    expect(assistantCode?.className ?? '').toMatch(/language-js/);
    expect(assistantPre!.textContent ?? '').toContain('const x = 1');

    // User-side code fence also renders inside a <pre>.
    const userPre = userBubble.querySelector('pre');
    expect(userPre).not.toBeNull();
    expect(userPre!.textContent ?? '').toContain("print('y')");
  });

  it('does NOT render markdown for error messages', () => {
    const messages: ChatMessage[] = [
      { id: 'e-1', role: 'error', text: '**not bold** $E=mc^2$' },
    ];
    const { container } = render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
        initialMessages={messages}
      />,
    );
    const errorBubble = container.querySelector(
      'li[data-role="error"]',
    ) as HTMLElement;
    expect(errorBubble).not.toBeNull();
    expect(errorBubble.querySelector('strong')).toBeNull();
    expect(errorBubble.querySelector('.katex')).toBeNull();
    expect(errorBubble.textContent ?? '').toContain('**not bold**');
  });
});

describe('LessonChat (US-184) — Web Speech permission-denied error', () => {
  it('renders the error chip with a microphone-access-denied message and leaves draft untouched', async () => {
    const { ctor, instances } = buildFakeSpeechRecognition();
    vi.stubGlobal('SpeechRecognition', ctor);

    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l"
        onClose={() => {}}
        onToggle={() => {}}
      />,
    );

    const mic = screen.getByTestId('lesson-chat-stt-toggle');
    const textarea = screen.getByTestId('lesson-chat-textarea') as HTMLTextAreaElement;

    // Seed an existing draft to confirm it is NOT overwritten on error.
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'preserved draft' } });
    });
    expect(textarea.value).toBe('preserved draft');

    await act(async () => {
      fireEvent.click(mic);
    });
    const rec = instances[0]!;

    // Fire the permission-denied error.
    await act(async () => {
      rec.onerror?.({ error: 'not-allowed' });
    });

    const chip = screen.getByTestId('lesson-chat-stt-error');
    expect(chip.textContent ?? '').toMatch(/microphone access denied/i);
    // Draft preserved.
    expect(textarea.value).toBe('preserved draft');
  });
});

describe('LessonChat (US-211) — history hydration + Clear history', () => {
  const HISTORY = {
    schemaVersion: 1,
    messages: [
      { role: 'user', content: 'earlier question', createdAt: '2026-06-13T10:00:00.000Z' },
      { role: 'assistant', content: 'earlier answer', createdAt: '2026-06-13T10:00:01.000Z' },
    ],
  };

  function mockChatsFetch(history: unknown = HISTORY) {
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url, method });
      if (url.includes('/api/chats/')) {
        if (method === 'GET') {
          return new Response(JSON.stringify(history), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // PUT / DELETE
        return new Response(null, { status: method === 'DELETE' ? 204 : 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, calls };
  }

  it('hydrates the transcript from the per-module store when opened', async () => {
    mockChatsFetch();
    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l1"
        moduleId="m1"
        onClose={() => {}}
        onToggle={() => {}}
      />,
    );

    expect(await screen.findByText('earlier answer')).not.toBeNull();
    expect(screen.getByText('earlier question')).not.toBeNull();
  });

  it('Clear history asks for confirmation, then clears the view and DELETEs the file', async () => {
    const { calls } = mockChatsFetch();
    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l1"
        moduleId="m1"
        onClose={() => {}}
        onToggle={() => {}}
      />,
    );

    // Wait for hydration so the Clear button (gated on messages.length) shows.
    await screen.findByText('earlier answer');
    const clearBtn = screen.getByTestId('lesson-chat-clear');

    // First click arms the confirm step — nothing deleted yet.
    await act(async () => {
      fireEvent.click(clearBtn);
    });
    expect(screen.getByTestId('lesson-chat-clear-confirm')).not.toBeNull();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);

    // Confirm — view clears and a DELETE is issued.
    await act(async () => {
      fireEvent.click(screen.getByTestId('lesson-chat-clear-confirm'));
    });
    expect(screen.queryByText('earlier answer')).toBeNull();
    expect(screen.getByTestId('lesson-chat-empty')).not.toBeNull();
    expect(
      calls.some((c) => c.method === 'DELETE' && c.url.includes('/api/chats/c/m1')),
    ).toBe(true);
  });

  it('cancelling the Clear confirm leaves the transcript intact', async () => {
    mockChatsFetch();
    render(
      <LessonChat
        open
        courseSlug="c"
        lessonSlug="l1"
        moduleId="m1"
        onClose={() => {}}
        onToggle={() => {}}
      />,
    );

    await screen.findByText('earlier answer');
    await act(async () => {
      fireEvent.click(screen.getByTestId('lesson-chat-clear'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('lesson-chat-clear-cancel'));
    });
    expect(screen.getByText('earlier answer')).not.toBeNull();
  });
});
