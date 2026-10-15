'use client';

/**
 * TutorBridge: the live channel between interactive widgets and the AI tutor
 * (LessonChat) on the lesson page.
 *
 * The lesson JSON is static, so the tutor would otherwise never know what a
 * widget shows right now (montage, filters, the learner's marks, whether they
 * already submitted). Two things flow through the bridge:
 *
 *  1. Live state. A widget publishes a short plain-text description of its
 *     current view. When the learner sends a chat message, LessonChat
 *     includes the state of the active section, and the chat route adds it
 *     to the prompt (see liveState.ts / context.ts).
 *  2. "Ask the tutor about this view". A widget hands over a prompt and,
 *     optionally, an image (canvas PNG, figure crop). The bridge opens the
 *     chat dock, pre-fills the composer and attaches the image through the
 *     regular chat image pipeline (prepareChatImage → uploadChatImage). It
 *     never sends on its own: the learner reviews the message and presses
 *     Send.
 *
 * Widget usage:
 *
 *   const tutor = useTutorBridge(progressKey?.sectionId);
 *   // describeView: the widget's own pure function → plain text ≤ 2000 chars
 *   useEffect(() => { tutor?.publishState(describeView(view)); }, [tutor, view]);
 *   {tutor && (
 *     <button onClick={async () => {
 *       const image = await new Promise<Blob | null>((resolve) =>
 *         canvasRef.current?.toBlob(resolve, 'image/png') ?? resolve(null));
 *       await tutor
 *         .askAboutView({ prompt: 'Co widać w tym fragmencie?', image: image ?? undefined })
 *         .catch(() => {}); // the chat already shows upload errors
 *     }}>Ask tutor</button>
 *   )}
 *
 * `useTutorBridge` returns null when no provider is mounted (static export,
 * editor previews, the dev gallery, tests) or without a section id. Widgets
 * then hide their "Ask tutor" UI and skip publishing.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { normalizeLiveState } from './liveState';

export { LIVE_STATE_MAX_CHARS } from './liveState';

export interface TutorAskOptions {
  /** Text pre-filled into the chat composer (the learner can edit it). It is
   *  appended below any draft the learner had already typed. */
  prompt: string;
  /** Image of the current view: PNG, JPEG, WebP or GIF. It is downscaled and
   *  uploaded like a pasted image (≤ 2048 px long edge, ≤ 3.6 MB). */
  image?: Blob;
}

/** What `useTutorBridge(sectionId)` gives a widget. */
export interface TutorBridge {
  /**
   * Replace this widget's live description: plain text, ≤ LIVE_STATE_MAX_CHARS
   * (2000) chars, longer text is truncated, '' clears it. Cheap: no network,
   * no re-render. Call it from an effect whenever the view changes; the
   * value is read only when the learner sends a chat message. It is cleared
   * automatically when the widget unmounts.
   */
  publishState(text: string): void;
  /**
   * Open the chat dock, pre-fill `prompt` and attach `image`. Resolves once
   * the composer is filled and the image (if any) is uploaded and attached.
   * Rejects if the image could not be attached; the chat also shows the
   * error on the attachment chip, so a widget may simply `void` the call.
   */
  askAboutView(opts: TutorAskOptions): Promise<void>;
}

/** A widget's request as LessonChat receives it. */
export interface TutorAsk extends TutorAskOptions {
  sectionId: string;
}

export type TutorAskHandler = (ask: TutorAsk) => Promise<void>;

/** The consumer side, used by LessonChat. */
export interface TutorBridgeHost {
  /** Live state published for `sectionId`, or undefined. */
  getState(sectionId: string | null | undefined): string | undefined;
  /**
   * Receive asks. Only the most recently registered handler is active. An ask
   * made while no handler is registered is held (only the newest one) and
   * delivered on registration. Returns an unregister function.
   */
  registerAskHandler(handler: TutorAskHandler): () => void;
}

/** Framework-free state behind the provider. Exported for tests. */
export interface TutorBridgeStore extends TutorBridgeHost {
  /** `owner` identifies the publishing hook instance, so an unmounting
   *  instance never clears state a newer instance published for the same id. */
  publish(sectionId: string, text: string, owner: object): void;
  clear(sectionId: string, owner: object): void;
  ask(ask: TutorAsk): Promise<void>;
  /** Called on every ask before it is delivered, e.g. to open the chat dock. */
  setOpenChatHandler(handler: (() => void) | null): void;
}

export function createTutorBridgeStore(): TutorBridgeStore {
  const states = new Map<string, { text: string; owner: object }>();
  let openChat: (() => void) | null = null;
  let askHandler: TutorAskHandler | null = null;
  let pending: {
    ask: TutorAsk;
    resolve: () => void;
    reject: (err: unknown) => void;
  } | null = null;

  // async → a handler that throws synchronously still yields a rejection.
  const run = async (handler: TutorAskHandler, ask: TutorAsk) => handler(ask);

  return {
    publish(sectionId, text, owner) {
      const normalized = normalizeLiveState(text);
      if (normalized.length > 0) {
        states.set(sectionId, { text: normalized, owner });
      } else if (states.get(sectionId)?.owner === owner) {
        states.delete(sectionId);
      }
    },

    clear(sectionId, owner) {
      if (states.get(sectionId)?.owner === owner) states.delete(sectionId);
    },

    getState(sectionId) {
      if (!sectionId) return undefined;
      return states.get(sectionId)?.text;
    },

    ask(request) {
      const ask: TutorAsk = {
        sectionId: request.sectionId,
        prompt: typeof request.prompt === 'string' ? request.prompt.trim() : '',
        ...(request.image ? { image: request.image } : {}),
      };
      openChat?.();
      if (askHandler) return run(askHandler, ask);
      return new Promise<void>((resolve, reject) => {
        // A newer ask supersedes one still waiting for the chat to mount; the
        // older one settles quietly instead of failing the first click.
        pending?.resolve();
        pending = { ask, resolve, reject };
      });
    },

    registerAskHandler(handler) {
      askHandler = handler;
      if (pending) {
        const { ask, resolve, reject } = pending;
        pending = null;
        run(handler, ask).then(resolve, reject);
      }
      return () => {
        if (askHandler === handler) askHandler = null;
      };
    },

    setOpenChatHandler(handler) {
      openChat = handler;
    },
  };
}

const TutorBridgeContext = createContext<TutorBridgeStore | null>(null);

export function TutorBridgeProvider({
  onOpenChat,
  children,
}: {
  /** Opens the chat dock; called on every `askAboutView`. */
  onOpenChat?: () => void;
  children: ReactNode;
}) {
  const [store] = useState(createTutorBridgeStore);
  useEffect(() => {
    store.setOpenChatHandler(onOpenChat ?? null);
    return () => store.setOpenChatHandler(null);
  }, [store, onOpenChat]);
  return (
    <TutorBridgeContext.Provider value={store}>
      {children}
    </TutorBridgeContext.Provider>
  );
}

/**
 * Widget-side hook. Returns null without a provider or without a section id.
 * The returned object keeps its identity while `sectionId` stays the same,
 * so it is safe in effect dependency lists.
 */
export function useTutorBridge(
  sectionId: string | null | undefined,
): TutorBridge | null {
  const store = useContext(TutorBridgeContext);
  // One identity per hook instance (see TutorBridgeStore.publish).
  const [owner] = useState<object>(() => ({}));

  const bridge = useMemo<TutorBridge | null>(() => {
    if (!store || !sectionId) return null;
    return {
      publishState: (text) => store.publish(sectionId, text, owner),
      askAboutView: ({ prompt, image }) =>
        store.ask({ sectionId, prompt, ...(image ? { image } : {}) }),
    };
  }, [store, sectionId, owner]);

  useEffect(() => {
    if (!store || !sectionId) return undefined;
    return () => store.clear(sectionId, owner);
  }, [store, sectionId, owner]);

  return bridge;
}

/** LessonChat-side hook: null outside the lesson page's provider. */
export function useTutorBridgeHost(): TutorBridgeHost | null {
  return useContext(TutorBridgeContext);
}
