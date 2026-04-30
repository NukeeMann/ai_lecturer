import { NextResponse } from 'next/server';
import { ProgressSchema } from '@/lib/schemas/progress';
import { atomicWriteJson } from '@/lib/server/atomic';
import {
  ProgressPatchSchema,
  applyProgressPatch,
  progressFile,
  readOrInitProgress,
} from '@/lib/server/progress';

export const dynamic = 'force-dynamic';

export async function GET() {
  const progress = await readOrInitProgress();
  return NextResponse.json(progress);
}

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ProgressPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid progress patch', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const current = await readOrInitProgress();
  const next = applyProgressPatch(current, parsed.data, new Date().toISOString());

  const validated = ProgressSchema.safeParse(next);
  if (!validated.success) {
    return NextResponse.json(
      { error: 'Patched progress failed validation', issues: validated.error.issues },
      { status: 400 },
    );
  }

  await atomicWriteJson(progressFile(), validated.data);
  return NextResponse.json(validated.data);
}
