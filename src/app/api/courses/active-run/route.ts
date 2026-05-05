import { NextResponse } from 'next/server';

import { getActiveRunSummary } from '@/lib/server/generation';

export const dynamic = 'force-dynamic';

// US-106: lets /create detect that a generation is still running (in-memory
// or surviving a server restart) so it can render the resume banner.
export async function GET() {
  const summary = await getActiveRunSummary();
  return NextResponse.json(summary);
}
