// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LessonChat } from './LessonChat';
import { TutorBridgeProvider, useTutorBridge } from '@/lib/lessonChat/tutorBridge';

const UPLOADED = `${'c'.repeat(32)}.png`;

vi.mock('@/lib/client/chatImage', () => ({
  prepareChatImage: vi.fn(async (blob: Blob) => blob),
  uploadChatImage: vi.fn(async () => ({ file: UPLOADED, url: `/api/lesson-chat/media/${UPLOADED}` })),
  imagesFromClipboard: vi.fn(() => []),
}));

import { prepareChatImage, uploadChatImage } from '@/lib/client/chatImage';

/** A stand-in widget: publishes live state and offers "Ask tutor". */
function FakeEegWidget({ sectionId, state }: { sectionId: string; state: string }) {
  const tutor = useTutorBridge(sectionId);
  useEffect(() => {
    tutor?.publishState(state);
  }, [tutor, state]);
  if (!tutor) return <p>no tutor</p>;
  return (
    <button
      type="button"
      onClick={() =>
        void tutor
          .askAboutView({
            prompt: 'Co widać na tym fragmencie?',
            image: new Blob(['png-bytes'], { type: 'image/png' }),
          })
          .catch(() => {})
      }
    >
      Ask tutor
    </button>
  );
}

function LessonPage() {
  const [open, setOpen] = useState(false);
  return (
    <TutorBridgeProvider onOpenChat={() => setOpen(true)}>
      <section data-section-id="intro">
        <FakeEegWidget sectionId="intro" state="" />
      </section>
      <section data-section-id="eeg-1">
        <FakeEegWidget sectionId="eeg-1" state="Montage: LB; 10 µV/mm; marks: 12.4 s (F8-T8); submitted: no" />
      </section>
      <LessonChat
        open={open}
        courseSlug="c"
        lessonSlug="l"
        onClose={() => setOpen(false)}
        onToggle={() => setOpen((o) => !o)}
        initialMessages={[]}
      />
    </TutorBridgeProvider>
  );
}

let chatBodies: Array<Record<string, unknown>>;

beforeEach(() => {
  window.localStorage.clear();
  chatBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/lesson-chat') {
        chatBodies.push(JSON.parse(String(init?.body)));
        return new Response('event: token\ndata: {"text":"ok"}\n\nevent: done\ndata: {}\n\n', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return new Response('{}', { status: 200 });
    }),
  );
  // jsdom lacks object URLs (used for attachment previews).
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('LessonChat + TutorBridge', () => {
  it('"Ask tutor" opens the chat, pre-fills and focuses the composer, and attaches the view through the chat image pipeline', async () => {
    render(<LessonPage />);
    expect(screen.getByTestId('lesson-chat').getAttribute('data-open')).toBe('false');

    fireEvent.click(screen.getAllByRole('button', { name: 'Ask tutor' })[1]);

    const textarea = (await screen.findByTestId('lesson-chat-textarea')) as HTMLTextAreaElement;
    expect(screen.getByTestId('lesson-chat').getAttribute('data-open')).toBe('true');
    expect(textarea.value).toBe('Co widać na tym fragmencie?');
    await waitFor(() => expect(document.activeElement).toBe(textarea));

    await waitFor(() => expect(uploadChatImage).toHaveBeenCalledTimes(1));
    const prepared = vi.mocked(prepareChatImage).mock.calls[0][0] as File;
    expect(prepared.type).toBe('image/png');
    expect(prepared.name).toBe('widget-view.png');
    // Nothing is sent automatically.
    expect(chatBodies).toHaveLength(0);
  });

  it('sending after an ask is scoped to the asking section and carries its live state', async () => {
    render(<LessonPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask tutor' })[1]);
    const send = await screen.findByTestId('lesson-chat-send');
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));

    await act(async () => {
      fireEvent.click(send);
    });
    await waitFor(() => expect(chatBodies).toHaveLength(1));
    expect(chatBodies[0]).toMatchObject({
      courseSlug: 'c',
      lessonSlug: 'l',
      sectionId: 'eeg-1',
      message: 'Co widać na tym fragmencie?',
      images: [UPLOADED],
      widgetState: 'Montage: LB; 10 µV/mm; marks: 12.4 s (F8-T8); submitted: no',
    });

    // The asking section also becomes the active one, so follow-ups stay
    // scoped to it (with its latest state) until the scroll observer moves on.
    const textarea = screen.getByTestId('lesson-chat-textarea');
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(true));
    fireEvent.change(textarea, { target: { value: 'And next?' } });
    await waitFor(() => expect((send as HTMLButtonElement).disabled).toBe(false));
    await act(async () => {
      fireEvent.click(send);
    });
    await waitFor(() => expect(chatBodies).toHaveLength(2));
    expect(chatBodies[1]).toMatchObject({ message: 'And next?', sectionId: 'eeg-1' });
    expect(chatBodies[1]).not.toHaveProperty('images');
  });

  it('appends the prompt below a draft the learner already typed', async () => {
    // LessonChat restores the per-lesson draft on mount.
    window.localStorage.setItem('lessonChatDraft:c:l', 'Moje pytanie:');
    render(<LessonPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Ask tutor' })[0]);
    const textarea = (await screen.findByTestId('lesson-chat-textarea')) as HTMLTextAreaElement;
    await waitFor(() =>
      expect(textarea.value).toBe('Moje pytanie:\n\nCo widać na tym fragmencie?'),
    );
  });

  it('widgets see no bridge without a provider (static export)', () => {
    render(<FakeEegWidget sectionId="eeg-1" state="x" />);
    expect(screen.getByText('no tutor')).toBeTruthy();
  });
});
