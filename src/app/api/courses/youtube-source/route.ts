import { NextResponse } from 'next/server';

import {
  InvalidDraftIdError,
  assertSafeDraftId,
  courseSourcesDir,
  draftSourcesDir,
  makeDraftId,
} from '@/lib/server/sources';
import { InvalidSlugError, assertSafeSlug } from '@/lib/server/paths';
import { addYouTubeSource } from '@/lib/server/youtubeSource';

export const dynamic = 'force-dynamic';

interface YouTubeSourceBody {
  url?: unknown;
  draftId?: unknown;
  slug?: unknown;
}

function resolveTarget(body: YouTubeSourceBody):
  | { ok: true; draftId?: string; slug?: string; targetDir: string }
  | { ok: false; status: number; error: string } {
  const slugField = body.slug;
  const draftIdField = body.draftId;
  if (typeof slugField === 'string' && slugField.length > 0) {
    try {
      assertSafeSlug(slugField);
    } catch (err) {
      if (err instanceof InvalidSlugError) {
        return { ok: false, status: 400, error: err.message };
      }
      throw err;
    }
    return { ok: true, slug: slugField, targetDir: courseSourcesDir(slugField) };
  }
  let draftId: string;
  if (typeof draftIdField === 'string' && draftIdField.length > 0) {
    try {
      assertSafeDraftId(draftIdField);
    } catch (err) {
      if (err instanceof InvalidDraftIdError) {
        return { ok: false, status: 400, error: err.message };
      }
      throw err;
    }
    draftId = draftIdField;
  } else {
    draftId = makeDraftId();
  }
  return { ok: true, draftId, targetDir: draftSourcesDir(draftId) };
}

// US-215 — POST a YouTube URL (or bare videoId); we fetch its transcript and
// persist it under the same /sources/ dir uploads use, as a `.md` file that
// then flows through the wizard pipeline like any text document.
export async function POST(req: Request) {
  let body: YouTubeSourceBody;
  try {
    body = (await req.json()) as YouTubeSourceBody;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) {
    return NextResponse.json(
      { error: 'Missing "url" — paste a YouTube link or video ID' },
      { status: 400 },
    );
  }

  const target = resolveTarget(body);
  if (!target.ok) {
    return NextResponse.json({ error: target.error }, { status: target.status });
  }

  const result = await addYouTubeSource(target.targetDir, url);
  if (!result.ok) {
    // Unparseable link or `source: 'none'` (no captions, no description). No
    // file was written — surface the reason at the field. 422 distinguishes
    // "valid request, but this video can't be used" from a 400 bad request.
    return NextResponse.json({ error: result.reason }, { status: 422 });
  }

  const file = {
    originalName: result.url,
    sanitizedName: result.filename,
    size: result.size,
    type: 'text/markdown',
    transcriptSource: result.source,
  };
  const resBody: {
    draftId?: string;
    slug?: string;
    file: typeof file;
  } = { file };
  if (target.draftId) resBody.draftId = target.draftId;
  if (target.slug) resBody.slug = target.slug;
  return NextResponse.json(resBody, { status: 201 });
}
