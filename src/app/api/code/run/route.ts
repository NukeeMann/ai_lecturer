// US-201: execute a single cell on the per-lesson IPython kernel and return the
// aggregated result as a one-line NDJSON `final` event (the shape the
// `useKernel` client folds into a `RunResult`). Optional lesson `inputs` are
// fetched server-side and written into `/inputs/<name>` in a preceding cell so
// the user's traceback line numbers stay clean.

import { NextResponse } from 'next/server';

import { CodeRunSchema } from '@/lib/schemas/codeRun';
import { kernelManager } from '@/lib/server/kernelManager';
import {
  buildInputsMountCode,
  resolveInputsDir,
  rewriteInputsPath,
  toCodeRunFinal,
  type MountableInput,
} from '@/lib/server/codeRun';
import { mapKernelError } from '@/lib/server/codeRunHttp';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function ndjson(line: object): Response {
  return new Response(JSON.stringify(line) + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CodeRunSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid run request', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { courseSlug, lessonSlug, code, inputs } = parsed.data;

  // The host kernel runs as the (non-root) dev-server user, so the virtual
  // `/inputs` root can't live at the filesystem root — map it to a real
  // writable dir and rewrite the path in both the mount cell and user code.
  const mountDir = resolveInputsDir(courseSlug, lessonSlug);

  try {
    // Mount lesson-provided files into the kernel session first.
    if (inputs && inputs.length > 0) {
      const origin = new URL(req.url).origin;
      const files: MountableInput[] = await Promise.all(
        inputs.map(async (input) => {
          const url = new URL(input.src, origin);
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Failed to fetch input "${input.filename}" (${res.status})`);
          }
          const buf = Buffer.from(await res.arrayBuffer());
          return { filename: input.filename, b64: buf.toString('base64') };
        }),
      );
      const mount = await kernelManager.execute(
        courseSlug,
        lessonSlug,
        buildInputsMountCode(files, mountDir),
      );
      if (mount.status !== 'ok') {
        // Mounting failed — surface it as the run.
        return ndjson(toCodeRunFinal(mount));
      }
    }

    const result = await kernelManager.execute(
      courseSlug,
      lessonSlug,
      rewriteInputsPath(code, mountDir),
    );
    return ndjson(toCodeRunFinal(result));
  } catch (err) {
    const { status, body: errBody } = mapKernelError(err);
    return NextResponse.json(errBody, { status });
  }
}
