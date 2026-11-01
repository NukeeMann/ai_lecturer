import { NextResponse, type NextRequest } from 'next/server';

/**
 * Read-only mode (`AI_LECTURER_READ_ONLY=1`), used by the packaged macOS app
 * (tools/mac-app). The learner can read courses and use the AI tutor, but
 * nothing that creates, edits, regenerates or deletes course content gets
 * through. Off by default: without the env var this proxy is a no-op.
 *
 * It is an allowlist for write verbs — every non-GET/HEAD API request is
 * rejected unless it only touches learner state (progress, chat history, tutor
 * turns, chat images). New write routes are therefore blocked by default.
 */
const WRITE_ALLOWLIST: ReadonlyArray<RegExp> = [
  /^\/api\/lesson-chat(\/|$)/,
  /^\/api\/progress$/,
  /^\/api\/chats\//,
];

// Authoring screens: send the learner back to the dashboard.
const BLOCKED_PAGES: ReadonlyArray<RegExp> = [
  /^\/create(\/|$)/,
  /^\/courses\/[^/]+\/extend(\/|$)/,
];

export function proxy(req: NextRequest) {
  if (process.env.AI_LECTURER_READ_ONLY !== '1') return NextResponse.next();

  const { pathname } = req.nextUrl;

  if (pathname.startsWith('/api/')) {
    const safe = req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS';
    if (!safe && !WRITE_ALLOWLIST.some((re) => re.test(pathname))) {
      return NextResponse.json(
        { error: 'This copy of AI Lecturer is read-only.' },
        { status: 403 },
      );
    }
    return NextResponse.next();
  }

  if (BLOCKED_PAGES.some((re) => re.test(pathname))) {
    return NextResponse.redirect(new URL('/', req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*', '/create/:path*', '/courses/:slug/extend/:path*'],
};
