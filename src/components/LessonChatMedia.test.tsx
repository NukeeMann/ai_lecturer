// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/client/chatImage', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/client/chatImage')>();
  return {
    ...actual,
    // jsdom has no image decoding; the canvas path is browser-only.
    prepareChatImage: vi.fn(async (blob: Blob) => blob),
  };
});

import { LessonChat, type ChatMessage } from './LessonChat';

const WEB_ID = 'e'.repeat(32);
const UPLOADED = `${'f'.repeat(32)}.png`;

function renderChat(initialMessages: ChatMessage[]) {
  return render(
    <LessonChat
      open
      courseSlug="c"
      lessonSlug="l"
      onClose={() => {}}
      onToggle={() => {}}
      initialMessages={initialMessages}
    />,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  // jsdom lacks object URLs; previews only need a string.
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LessonChat image policy', () => {
  it('does not render external image URLs from the tutor', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderChat([
      { id: 'a', role: 'assistant', text: 'Look: ![POSTS](https://random-blog.example/posts.png)' },
    ]);
    expect(screen.getByTestId('chat-image-blocked').textContent).toMatch(/did not pass the tutor's image verification/);
    expect(document.querySelector('img[src="https://random-blog.example/posts.png"]')).toBeNull();
    const link = screen.getByRole('link', { name: /Open the link yourself/ });
    expect(link.getAttribute('href')).toBe('https://random-blog.example/posts.png');
  });

  it('renders a verified web image with the stored source and reliability', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(`/api/lesson-chat/media/${WEB_ID}.json`);
      return new Response(
        JSON.stringify({
          origin: 'web',
          sourceName: 'Wikimedia Commons',
          sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Vertex_waves_EEG.png',
          author: 'Argarrett',
          license: 'CC BY-SA 4.0',
          reliability: 'medium',
          reliabilityNote: 'Community upload, not peer reviewed.',
          pageCheck: 'linked',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    renderChat([
      { id: 'a', role: 'assistant', text: `![Vertex waves](/api/lesson-chat/media/${WEB_ID}.png)` },
    ]);
    const figure = screen.getByTestId('chat-image-verified');
    expect(figure.querySelector('img')?.getAttribute('src')).toBe(`/api/lesson-chat/media/${WEB_ID}.png`);
    await waitFor(() => expect(screen.getByTestId('chat-image-reliability').textContent).toMatch(/Medium reliability/));
    const source = screen.getByRole('link', { name: 'Wikimedia Commons' });
    expect(source.getAttribute('href')).toBe('https://commons.wikimedia.org/wiki/File:Vertex_waves_EEG.png');
    expect(screen.getByTestId('chat-image-caption').textContent).toMatch(/Argarrett · CC BY-SA 4.0/);
    expect(screen.getByTestId('chat-image-caption').textContent).toMatch(/Community upload, not peer reviewed/);
  });

  it('keeps rendering lesson illustrations', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderChat([
      { id: 'a', role: 'assistant', text: '![Spindle](/api/courses/c/assets/images/spindle.png)' },
    ]);
    const figure = screen.getByTestId('chat-image-lesson');
    expect(figure.querySelector('img')?.getAttribute('src')).toBe('/api/courses/c/assets/images/spindle.png');
  });

  it('shows learner images in the user bubble and the research log under the answer', () => {
    vi.stubGlobal('fetch', vi.fn());
    renderChat([
      { id: 'u', role: 'user', text: '', images: [UPLOADED] },
      {
        id: 'a',
        role: 'assistant',
        text: 'These are vertex waves.',
        activity: [
          { kind: 'search', label: 'vertex sharp waves EEG', status: 'ok' },
          { kind: 'fetch', label: 'example.org/eeg', url: 'https://example.org/eeg', status: 'error', detail: 'HTTP 403' },
        ],
      },
    ]);
    const imgs = screen.getByTestId('lesson-chat-user-images').querySelectorAll('img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toBe(`/api/lesson-chat/media/${UPLOADED}`);
    const log = screen.getByTestId('lesson-chat-research-log');
    expect(log.textContent).toMatch(/1 search, 1 page read/);
    expect(log.textContent).toMatch(/failed: HTTP 403/);
  });
});

describe('LessonChat image attachments', () => {
  function sseResponse(frames: string[]): Response {
    const enc = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const f of frames) controller.enqueue(enc.encode(f));
          controller.close();
        },
      }),
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }

  it('uploads a pasted image and sends it with the message; tool preambles go to the log', async () => {
    let chatBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/lesson-chat/media') {
        return new Response(JSON.stringify({ file: UPLOADED, url: `/api/lesson-chat/media/${UPLOADED}` }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url === '/api/lesson-chat') {
        chatBody = JSON.parse(String(init?.body));
        return sseResponse([
          'event: meta\ndata: {"requestId":"r1"}\n\n',
          'event: token\ndata: {"text":"Let me check a source."}\n\n',
          'event: interim\ndata: {}\n\n',
          'event: activity\ndata: {"id":"t1","kind":"search","label":"POSTS EEG","status":"ok"}\n\n',
          'event: token\ndata: {"text":"These look like POSTS."}\n\n',
          'event: done\ndata: {}\n\n',
        ]);
      }
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderChat([]);

    const textarea = screen.getByTestId('lesson-chat-textarea');
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'eeg.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.paste(textarea, {
        clipboardData: { files: [file], getData: () => '', types: ['Files'] },
      });
    });
    await waitFor(() =>
      expect(screen.getByTestId('lesson-chat-attachments').querySelector('[data-status="ready"]')).not.toBeNull(),
    );

    fireEvent.change(textarea, { target: { value: 'What is this?' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('lesson-chat-send'));
    });

    await waitFor(() => expect(screen.getByTestId('lesson-chat-research-log')).toBeTruthy());
    expect(chatBody?.images).toEqual([UPLOADED]);
    expect(chatBody?.message).toBe('What is this?');
    expect(screen.queryByTestId('lesson-chat-attachments')).toBeNull();
    const assistant = document.querySelector('li[data-role="assistant"]');
    expect(assistant?.textContent).toMatch(/These look like POSTS\./);
    expect(assistant?.textContent).not.toMatch(/These look like POSTS\.Let me/);
    const log = screen.getByTestId('lesson-chat-research-log');
    expect(log.textContent).toMatch(/Let me check a source\./);
    expect(log.textContent).toMatch(/POSTS EEG/);
  });

  it('ignores pasted images when the clipboard also carries text', async () => {
    vi.stubGlobal('fetch', vi.fn());
    renderChat([]);
    const file = new File([new Uint8Array([1])], 'cells.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.paste(screen.getByTestId('lesson-chat-textarea'), {
        clipboardData: { files: [file], getData: (t: string) => (t === 'text/plain' ? 'a\tb' : ''), types: ['text/plain', 'Files'] },
      });
    });
    expect(screen.queryByTestId('lesson-chat-attachments')).toBeNull();
  });

  it('blocks sending while an attachment failed to upload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'Image too large' }), { status: 413 })),
    );
    renderChat([]);
    const textarea = screen.getByTestId('lesson-chat-textarea');
    const file = new File([new Uint8Array([1])], 'big.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.paste(textarea, { clipboardData: { files: [file], getData: () => '', types: ['Files'] } });
    });
    await waitFor(() => expect(screen.getByTestId('lesson-chat-attach-error').textContent).toMatch(/Image too large/));
    fireEvent.change(textarea, { target: { value: 'hi' } });
    expect((screen.getByTestId('lesson-chat-send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('lesson-chat-attachment-remove'));
    expect((screen.getByTestId('lesson-chat-send') as HTMLButtonElement).disabled).toBe(false);
  });
});
