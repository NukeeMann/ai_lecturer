import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  CollectionNotFoundError,
  deleteCollection,
  renameCollection,
} from '@/lib/server/collections';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;
const ID_PATTERN = /^[A-Za-z0-9-]{8,}$/;

type RouteCtx = { params: Promise<{ id: string }> };

const PatchBodySchema = z.object({
  name: z.string().min(1).max(80).optional(),
});

function badId(id: string) {
  return NextResponse.json(
    { error: `Invalid collection id: ${JSON.stringify(id)}` },
    { status: 400, headers: NO_STORE },
  );
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const { id } = await params;
  if (!ID_PATTERN.test(id)) return badId(id);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = PatchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid patch body', issues: parsed.error.issues },
      { status: 400, headers: NO_STORE },
    );
  }

  if (parsed.data.name === undefined) {
    return NextResponse.json(
      { error: 'No supported fields to patch' },
      { status: 400, headers: NO_STORE },
    );
  }

  try {
    const updated = await renameCollection(id, parsed.data.name);
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

export async function DELETE(_req: Request, { params }: RouteCtx) {
  const { id } = await params;
  if (!ID_PATTERN.test(id)) return badId(id);

  await deleteCollection(id);
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}
