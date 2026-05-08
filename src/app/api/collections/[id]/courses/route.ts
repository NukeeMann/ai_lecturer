import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  CollectionNotFoundError,
  addCourseToCollection,
  removeCourseFromCollection,
} from '@/lib/server/collections';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const ID_PATTERN = /^[A-Za-z0-9-]{8,}$/;
const SLUG_PATTERN = /^[a-z0-9-]+$/;

type RouteCtx = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  courseSlug: z.string().min(1),
});

function badId(id: string) {
  return NextResponse.json(
    { error: `Invalid collection id: ${JSON.stringify(id)}` },
    { status: 400, headers: NO_STORE },
  );
}

function badSlug(slug: string) {
  return NextResponse.json(
    { error: `Invalid courseSlug: ${JSON.stringify(slug)}` },
    { status: 400, headers: NO_STORE },
  );
}

async function parseBody(
  req: Request,
): Promise<
  | { ok: true; courseSlug: string }
  | { ok: false; response: NextResponse }
> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400, headers: NO_STORE },
      ),
    };
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Invalid body', issues: parsed.error.issues },
        { status: 400, headers: NO_STORE },
      ),
    };
  }
  if (!SLUG_PATTERN.test(parsed.data.courseSlug)) {
    return { ok: false, response: badSlug(parsed.data.courseSlug) };
  }
  return { ok: true, courseSlug: parsed.data.courseSlug };
}

export async function POST(req: Request, { params }: RouteCtx) {
  const { id } = await params;
  if (!ID_PATTERN.test(id)) return badId(id);

  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  try {
    const updated = await addCourseToCollection(id, parsed.courseSlug);
    return NextResponse.json(updated, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof CollectionNotFoundError) {
      return NextResponse.json(
        { error: err.message },
        { status: 404, headers: NO_STORE },
      );
    }
    throw err;
  }
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const { id } = await params;
  if (!ID_PATTERN.test(id)) return badId(id);

  const parsed = await parseBody(req);
  if (!parsed.ok) return parsed.response;

  try {
    const updated = await removeCourseFromCollection(id, parsed.courseSlug);
    return NextResponse.json(updated, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof CollectionNotFoundError) {
      return NextResponse.json(
        { error: err.message },
        { status: 404, headers: NO_STORE },
      );
    }
    throw err;
  }
}
