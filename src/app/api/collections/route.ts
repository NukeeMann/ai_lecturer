import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  createCollection,
  readCollections,
} from '@/lib/server/collections';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

export async function GET() {
  const file = await readCollections();
  return NextResponse.json(file, { headers: NO_STORE });
}

const CreateBodySchema = z.object({
  name: z.string().min(1).max(80),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: NO_STORE },
    );
  }

  const parsed = CreateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid create-collection body', issues: parsed.error.issues },
      { status: 400, headers: NO_STORE },
    );
  }

  const collection = await createCollection(parsed.data.name);
  return NextResponse.json(collection, { status: 201, headers: NO_STORE });
}
