// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsMenu, THEME_STORAGE_KEY } from './SettingsMenu';
import { TTS_VOICE_STORAGE_KEY } from '@/lib/client/ttsVoice';
import { SETTINGS_CHANGE_EVENT } from './SettingsMenu';

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.setAttribute('data-theme', 'light');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsMenu (US-134) — Sunset theme option', () => {
  it('exposes Sunset as a Theme option and applies data-theme="sunset" when selected', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    const sunsetOpt = screen.getByTestId('settings-theme-sunset');
    expect(sunsetOpt).not.toBeNull();
    expect(sunsetOpt.textContent).toBe('Sunset');

    fireEvent.click(sunsetOpt);
    expect(document.documentElement.getAttribute('data-theme')).toBe('sunset');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('sunset');
  });

  it('still surfaces light/dark/system alongside sunset', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    expect(screen.getByTestId('settings-theme-light')).not.toBeNull();
    expect(screen.getByTestId('settings-theme-dark')).not.toBeNull();
    expect(screen.getByTestId('settings-theme-sunset')).not.toBeNull();
    expect(screen.getByTestId('settings-theme-system')).not.toBeNull();
  });
});

describe('SettingsMenu (US-177) — panel stays within viewport on short screens', () => {
  it('panel inline style caps height and scrolls internally', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    const panel = screen.getByTestId('settings-menu') as HTMLElement;
    // React's CSSProperties writes `overflowY` to the DOM `style` attribute as
    // the `overflow-y` longhand. Same for `maxHeight` → `max-height`.
    expect(panel.style.overflowY).toBe('auto');
    expect(panel.style.maxHeight).not.toBe('');
    // Confirm the literal style attribute carries the expected longhands so
    // the AC's "inline style includes `overflow-y: auto` and a `max-height`"
    // check holds against raw CSS text.
    const styleAttr = panel.getAttribute('style') ?? '';
    expect(styleAttr).toMatch(/overflow-y:\s*auto/);
    expect(styleAttr).toMatch(/max-height:/);
    expect(styleAttr).toMatch(/overscroll-behavior:\s*contain/);
  });
});

describe('SettingsMenu (US-166) — Voice picker', () => {
  it('renders all three voice pills with the persisted selection highlighted', () => {
    window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, 'en-male-neutral');
    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    const warm = screen.getByTestId('settings-voice-pill-en-female-warm');
    const neutral = screen.getByTestId('settings-voice-pill-en-male-neutral');
    const bright = screen.getByTestId('settings-voice-pill-en-female-bright');

    expect(warm).not.toBeNull();
    expect(neutral).not.toBeNull();
    expect(bright).not.toBeNull();

    expect(warm.getAttribute('data-selected')).toBe('false');
    expect(neutral.getAttribute('data-selected')).toBe('true');
    expect(bright.getAttribute('data-selected')).toBe('false');

    // Each pill has its own play icon button.
    expect(screen.getByTestId('settings-voice-play-en-female-warm')).not.toBeNull();
    expect(screen.getByTestId('settings-voice-play-en-male-neutral')).not.toBeNull();
    expect(screen.getByTestId('settings-voice-play-en-female-bright')).not.toBeNull();
  });

  it('writes localStorage and dispatches settings-change when a different pill is clicked', () => {
    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    const events: Event[] = [];
    const handler = (e: Event) => events.push(e);
    window.addEventListener(SETTINGS_CHANGE_EVENT, handler);

    fireEvent.click(screen.getByTestId('settings-voice-en-male-neutral'));

    expect(window.localStorage.getItem(TTS_VOICE_STORAGE_KEY)).toBe('en-male-neutral');
    expect(events.length).toBeGreaterThanOrEqual(1);

    window.removeEventListener(SETTINGS_CHANGE_EVENT, handler);
  });

  it('clicking a play icon points an <audio> element at /voice-samples/<voice>.wav (no /api/tts call)', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      throw new Error(`Unexpected fetch on static-sample path: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const createdAudioEls: HTMLAudioElement[] = [];
    const originalCreate = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string, options?: ElementCreationOptions) => {
        const el = originalCreate(tag, options);
        if (tag.toLowerCase() === 'audio') {
          const audioEl = el as HTMLAudioElement;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (audioEl as any).play = vi.fn(async () => {
            /* no-op */
          });
          createdAudioEls.push(audioEl);
        }
        return el;
      });

    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-voice-play-en-male-neutral'));
    });
    await act(async () => {
      await Promise.resolve();
    });

    // The static-WAV path makes no /api/tts request.
    expect(fetchMock).not.toHaveBeenCalled();

    expect(createdAudioEls.length).toBeGreaterThanOrEqual(1);
    const audioEl = createdAudioEls[createdAudioEls.length - 1]!;
    expect(audioEl.getAttribute('data-voice')).toBe('en-male-neutral');
    expect(audioEl.getAttribute('data-source')).toBe('static');
    expect(audioEl.src).toMatch(
      /\/voice-samples\/en-male-neutral\.wav$/,
    );

    createSpy.mockRestore();
  });

  it('falls back to /api/tts/preview when the static sample errors', async () => {
    const audioBlob = new Blob([new Uint8Array([1, 2, 3, 4])], {
      type: 'audio/wav',
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('/api/tts/preview')) {
        return new Response(
          JSON.stringify({
            audioPath: 'tts-cache/stub.wav',
            durationMs: 1000,
            cached: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      if (url.includes('/api/tts/audio/')) {
        return new Response(audioBlob, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const createdAudioEls: HTMLAudioElement[] = [];
    const originalCreate = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string, options?: ElementCreationOptions) => {
        const el = originalCreate(tag, options);
        if (tag.toLowerCase() === 'audio') {
          const audioEl = el as HTMLAudioElement;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (audioEl as any).play = vi.fn(async () => {
            /* no-op */
          });
          createdAudioEls.push(audioEl);
        }
        return el;
      });

    const createObjectSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => 'blob:mock://0');
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {
        /* no-op */
      });

    const warnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {
        /* swallow */
      });

    render(<SettingsMenu />);
    fireEvent.click(screen.getByTestId('settings-menu-trigger'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('settings-voice-play-en-female-warm'));
    });
    expect(createdAudioEls.length).toBeGreaterThanOrEqual(1);
    const staticEl = createdAudioEls[0]!;
    // Fire the error event so onVoicePreview triggers the fallback.
    await act(async () => {
      staticEl.dispatchEvent(new Event('error'));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const previewCall = fetchMock.mock.calls.find((args) => {
      const u = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url;
      return u.includes('/api/tts/preview');
    });
    expect(previewCall).toBeDefined();
    expect(warnSpy).toHaveBeenCalled();

    const fallbackEl = createdAudioEls.find(
      (el) => el.getAttribute('data-source') === 'fallback',
    );
    expect(fallbackEl).toBeDefined();

    createSpy.mockRestore();
    createObjectSpy.mockRestore();
    revokeSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
