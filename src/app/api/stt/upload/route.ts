// US-159: sibling endpoint to /api/stt that accepts a browser-recorded audio
// blob (multipart/form-data, field "audio"), writes it to a temp file under
// ~/.ai-lecturer/stt-uploads/, and then runs the same whisper.cpp pipeline as
// /api/stt. /api/stt's own contract (audioPath JSON body) is left untouched.

import { NextResponse } from 'next/server';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  SttNotInstalledError,
  SttPathError,
  SttSpawnError,
  processSttRequest,
} from '@/lib/server/stt';
import { aiLecturerHome } from '@/lib/server/tts-cache';

export const dynamic = 'force-dynamic';

const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20MB — generous for 60s of opus

const EXT_BY_MIME: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/webm;codecs=opus': 'webm',
  'audio/ogg': 'ogg',
  'audio/ogg;codecs=opus': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
};

function pickExtension(file: File): string {
  const t = (file.type || '').toLowerCase();
  if (t && EXT_BY_MIME[t]) return EXT_BY_MIME[t];
  const baseType = t.split(';')[0];
  if (baseType && EXT_BY_MIME[baseType]) return EXT_BY_MIME[baseType];
  const fromName = path.extname(file.name || '').replace(/^\./, '').toLowerCase();
  if (fromName && /^[a-z0-9]{2,4}$/.test(fromName)) return fromName;
  return 'webm';
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'Expected multipart/form-data body' },
      { status: 400 },
    );
  }

  const candidate = form.get('audio');
  if (!(candidate instanceof File)) {
    return NextResponse.json(
      { error: 'Missing "audio" file field' },
      { status: 400 },
    );
  }
  if (candidate.size === 0) {
    return NextResponse.json(
      { error: 'Empty audio upload' },
      { status: 400 },
    );
  }
  if (candidate.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (max ${MAX_AUDIO_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const buf = Buffer.from(await candidate.arrayBuffer());
  if (buf.byteLength > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: `Audio too large (max ${MAX_AUDIO_BYTES} bytes)` },
      { status: 413 },
    );
  }

  const uploadsDir = path.join(aiLecturerHome(), 'stt-uploads');
  await fs.mkdir(uploadsDir, { recursive: true });
  const ext = pickExtension(candidate);
  const filename = `rec-${Date.now()}-${randomBytes(6).toString('hex')}.${ext}`;
  const absPath = path.join(uploadsDir, filename);
  await fs.writeFile(absPath, buf);

  try {
    const response = await processSttRequest({
      audioPath: absPath,
      language: 'en',
    });
    // best-effort cleanup; never fail the request if it doesn't unlink
    fs.unlink(absPath).catch(() => {});
    return NextResponse.json(response);
  } catch (err) {
    fs.unlink(absPath).catch(() => {});
    if (err instanceof SttPathError) {
      return NextResponse.json(
        { error: 'invalid-audio-path', message: err.message },
        { status: 400 },
      );
    }
    if (err instanceof SttNotInstalledError) {
      return NextResponse.json(
        {
          error: 'stt-not-installed',
          message: 'Run scripts/setup-stt.sh first.',
        },
        { status: 503 },
      );
    }
    if (err instanceof SttSpawnError) {
      return NextResponse.json(
        { error: 'stt-spawn-failed', message: err.message },
        { status: 500 },
      );
    }
    return NextResponse.json(
      { error: 'Unexpected error', message: String(err) },
      { status: 500 },
    );
  }
}
