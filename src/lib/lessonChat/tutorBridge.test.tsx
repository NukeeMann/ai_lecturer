// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';

import {
  LIVE_STATE_MAX_CHARS,
  TutorBridgeProvider,
  createTutorBridgeStore,
  useTutorBridge,
  useTutorBridgeHost,
  type TutorAsk,
  type TutorBridge,
  type TutorBridgeHost,
} from './tutorBridge';

afterEach(() => {
  cleanup();
});

describe('createTutorBridgeStore — live state', () => {
  it('stores normalised state per section and returns it to the consumer', () => {
    const store = createTutorBridgeStore();
    const owner = {};
    store.publish('s1', '  Montage: LB  ', owner);
    expect(store.getState('s1')).toBe('Montage: LB');
    expect(store.getState('s2')).toBeUndefined();
    expect(store.getState(null)).toBeUndefined();
    expect(store.getState(undefined)).toBeUndefined();
  });

  it(`caps published state at ${LIVE_STATE_MAX_CHARS} chars`, () => {
    const store = createTutorBridgeStore();
    store.publish('s1', 'x'.repeat(LIVE_STATE_MAX_CHARS + 500), {});
    expect(store.getState('s1')).toHaveLength(LIVE_STATE_MAX_CHARS);
  });

  it('publishing an empty string or clearing removes the state, but only for its owner', () => {
    const store = createTutorBridgeStore();
    const a = {};
    const b = {};
    store.publish('s1', 'from a', a);
    store.publish('s1', '', b); // b never owned it
    expect(store.getState('s1')).toBe('from a');
    store.publish('s1', 'from b', b); // latest publisher wins
    store.clear('s1', a); // stale owner (e.g. unmounting old instance)
    expect(store.getState('s1')).toBe('from b');
    store.publish('s1', '   ', b);
    expect(store.getState('s1')).toBeUndefined();
    store.publish('s1', 'again', b);
    store.clear('s1', b);
    expect(store.getState('s1')).toBeUndefined();
  });
});

describe('createTutorBridgeStore — asks', () => {
  const blob = new Blob(['png'], { type: 'image/png' });

  it('opens the chat and delivers the ask to the registered handler', async () => {
    const store = createTutorBridgeStore();
    const openChat = vi.fn();
    store.setOpenChatHandler(openChat);
    const received: TutorAsk[] = [];
    store.registerAskHandler(async (ask) => {
      received.push(ask);
    });
    await store.ask({ sectionId: 's1', prompt: '  What is this?  ', image: blob });
    expect(openChat).toHaveBeenCalledTimes(1);
    expect(received).toEqual([{ sectionId: 's1', prompt: 'What is this?', image: blob }]);
  });

  it('propagates handler failures (sync throw or rejection) as a rejected promise', async () => {
    const store = createTutorBridgeStore();
    store.registerAskHandler(() => {
      throw new Error('sync boom');
    });
    await expect(store.ask({ sectionId: 's1', prompt: 'x' })).rejects.toThrow('sync boom');
    store.registerAskHandler(async () => {
      throw new Error('upload failed');
    });
    await expect(store.ask({ sectionId: 's1', prompt: 'x' })).rejects.toThrow('upload failed');
  });

  it('holds the newest ask until a handler registers; an older pending ask settles quietly', async () => {
    const store = createTutorBridgeStore();
    const first = store.ask({ sectionId: 's1', prompt: 'first' });
    const second = store.ask({ sectionId: 's2', prompt: 'second' });
    await expect(first).resolves.toBeUndefined();
    const handler = vi.fn(async () => {});
    store.registerAskHandler(handler);
    await expect(second).resolves.toBeUndefined();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ sectionId: 's2', prompt: 'second' });
  });

  it('unregistering only removes the handler that is still current', async () => {
    const store = createTutorBridgeStore();
    const old = vi.fn(async () => {});
    const current = vi.fn(async () => {});
    const unregisterOld = store.registerAskHandler(old);
    store.registerAskHandler(current);
    unregisterOld();
    await store.ask({ sectionId: 's1', prompt: 'x' });
    expect(old).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(1);
  });
});

describe('useTutorBridge / useTutorBridgeHost', () => {
  it('returns null without a provider (static export, previews) and without a section id', () => {
    expect(renderHook(() => useTutorBridge('s1')).result.current).toBeNull();
    expect(renderHook(() => useTutorBridgeHost()).result.current).toBeNull();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <TutorBridgeProvider>{children}</TutorBridgeProvider>
    );
    expect(renderHook(() => useTutorBridge(undefined), { wrapper }).result.current).toBeNull();
    expect(renderHook(() => useTutorBridge(''), { wrapper }).result.current).toBeNull();
  });

  function Harness({
    sectionId,
    state,
    onBridge,
    onHost,
  }: {
    sectionId: string;
    state: string;
    onBridge?: (b: TutorBridge | null) => void;
    onHost?: (h: TutorBridgeHost | null) => void;
  }) {
    const bridge = useTutorBridge(sectionId);
    const host = useTutorBridgeHost();
    useEffect(() => {
      bridge?.publishState(state);
    }, [bridge, state]);
    onBridge?.(bridge);
    onHost?.(host);
    return null;
  }

  it('a widget publishes its state and the consumer reads it; unmount clears it', () => {
    let host: TutorBridgeHost | null = null;
    function App({ show, state }: { show: boolean; state: string }) {
      return (
        <TutorBridgeProvider>
          <Harness sectionId="other" state="" onHost={(h) => (host = h)} />
          {show && <Harness sectionId="eeg" state={state} />}
        </TutorBridgeProvider>
      );
    }
    const { rerender } = render(<App show state="Montage: LB" />);
    expect(host!.getState('eeg')).toBe('Montage: LB');
    rerender(<App show state="Montage: TB; marks: 2" />);
    expect(host!.getState('eeg')).toBe('Montage: TB; marks: 2');
    rerender(<App show={false} state="ignored" />);
    expect(host!.getState('eeg')).toBeUndefined();
  });

  it('keeps the bridge object identity stable across re-renders', () => {
    const seen = new Set<TutorBridge | null>();
    function App({ state }: { state: string }) {
      return (
        <TutorBridgeProvider>
          <Harness sectionId="eeg" state={state} onBridge={(b) => seen.add(b)} />
        </TutorBridgeProvider>
      );
    }
    const { rerender } = render(<App state="a" />);
    rerender(<App state="b" />);
    rerender(<App state="c" />);
    expect(seen.size).toBe(1);
  });

  it('askAboutView opens the chat via the provider and reaches the consumer with the section id', async () => {
    const onOpenChat = vi.fn();
    const asks: TutorAsk[] = [];
    let bridge: TutorBridge | null = null;
    function Consumer() {
      const host = useTutorBridgeHost();
      useEffect(
        () =>
          host?.registerAskHandler(async (ask) => {
            asks.push(ask);
          }),
        [host],
      );
      return null;
    }
    render(
      <TutorBridgeProvider onOpenChat={onOpenChat}>
        <Harness sectionId="fig" state="" onBridge={(b) => (bridge = b)} />
        <Consumer />
      </TutorBridgeProvider>,
    );
    const image = new Blob(['x'], { type: 'image/png' });
    await act(async () => {
      await bridge!.askAboutView({ prompt: 'Co tu widać?', image });
    });
    expect(onOpenChat).toHaveBeenCalledTimes(1);
    expect(asks).toEqual([{ sectionId: 'fig', prompt: 'Co tu widać?', image }]);
  });
});
