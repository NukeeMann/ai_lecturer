// Static export has no server. The real widget components still issue their
// own fetch() calls (progress persistence, course asset URLs, STT/TTS demos).
// We monkeypatch window.fetch ONCE so those calls resolve sensibly offline:
//
//   GET  /api/progress                       -> localStorage progress doc
//   PATCH/POST /api/progress                 -> merge into localStorage, 200
//   /api/courses/<slug>/assets/<path>        -> the copied static file
//   /api/stt* /api/tts* /api/video-transcript*
//   /api/demo-images* /api/lesson-chat*      -> graceful 503 (widget degrades)
//
// Anything else passes through untouched. This file has NO React imports so
// it can be imported for its side effect before the widget graph loads.

import { readPayload } from './payload';
import { readProgressDoc, applyProgressPatch } from './progressStore';

let installed = false;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function installApiShim(): void {
  if (installed) return;
  installed = true;

  const payload = readPayload();
  const courseSlug = payload.courseSlug;
  const assetBase = payload.courseAssetBase; // e.g. "../assets/course/"
  const realFetch = window.fetch.bind(window);

  // Endpoints that genuinely need the running app (live STT/TTS, AI, server
  // transcription). In a static export they degrade to a clear "unavailable".
  const UNAVAILABLE = [
    '/api/stt',
    '/api/tts',
    '/api/video-transcript',
    '/api/demo-images',
    '/api/lesson-chat',
  ];

  window.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let url = '';
    if (typeof input === 'string') url = input;
    else if (input instanceof URL) url = input.toString();
    else if (input instanceof Request) url = input.url;

    let pathname = url;
    try {
      pathname = new URL(url, window.location.href).pathname;
    } catch {
      /* relative/odd URL — fall back to raw string matching */
    }

    const method = (init?.method ?? 'GET').toUpperCase();

    // --- /api/progress -----------------------------------------------------
    if (pathname === '/api/progress' || pathname.startsWith('/api/progress')) {
      if (method === 'GET') {
        return json(readProgressDoc(courseSlug));
      }
      // PATCH/POST/PUT — merge whatever the widget sent.
      try {
        const bodyText =
          typeof init?.body === 'string'
            ? init.body
            : input instanceof Request
              ? await input.clone().text()
              : '';
        if (bodyText) applyProgressPatch(JSON.parse(bodyText));
      } catch {
        /* ignore — persistence is best-effort offline */
      }
      return json({ ok: true });
    }

    // --- /api/courses/<slug>/assets/<path> --------------------------------
    const assetMatch = pathname.match(
      /^\/api\/courses\/[^/]+\/assets\/(.+)$/,
    );
    if (assetMatch) {
      const rel = assetMatch[1];
      return realFetch(assetBase + rel, init);
    }

    // --- server-only features --------------------------------------------
    if (UNAVAILABLE.some((p) => pathname.startsWith(p))) {
      return json(
        {
          error:
            'This feature requires the full AI Lecturer app and is not available in the static export.',
        },
        503,
      );
    }

    // --- everything else: passthrough ------------------------------------
    return realFetch(input as RequestInfo, init);
  };
}
