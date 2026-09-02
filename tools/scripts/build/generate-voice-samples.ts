// US-182: pre-bake a static MP3 sample per Settings voice so the Settings
// preview button plays an instantly-cached static file instead of waking up
// the local TTS backend each time.
//
// Run from the repo root with a dev server up on http://localhost:3000 and
// the Coqui TTS backend reachable (`npm run build:voice-samples`). The
// script POSTs each voice's sample phrase to /api/tts, fetches the resulting
// audio bytes via /api/tts/audio/<path>, and writes them to
// public/voice-samples/<voice>.wav (overwriting any existing file).

import { promises as fs } from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.AI_LECTURER_DEV_URL ?? 'http://localhost:3000';

// Mirrors VOICE_OPTIONS in src/components/SettingsMenu.tsx. Re-stating the
// list here (instead of importing it) keeps the script free of React / Next
// build-time entanglement so it can run via `tsx`.
const VOICE_OPTIONS: { value: string; label: string }[] = [
  { value: 'en-female-warm', label: 'Warm' },
  { value: 'en-male-neutral', label: 'Neutral' },
  { value: 'en-female-bright', label: 'Bright' },
];

// Strip a trailing " (...)" parenthetical so labels like "Aria (warm)" become
// "Aria" inside the spoken sentence.
function nameFromLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function sampleText(label: string): string {
  return `Hi, I'm ${nameFromLabel(label)}. Let's learn together.`;
}

function audioUrlFromAudioPath(audioPath: string): string {
  const trimmed = audioPath.replace(/^\/+/, '');
  const segments = trimmed
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) => encodeURIComponent(s));
  return `${BASE_URL}/api/tts/audio/${segments.join('/')}`;
}

async function generateOne(voice: string, label: string): Promise<number> {
  const text = sampleText(label);
  const res = await fetch(`${BASE_URL}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(
      `POST /api/tts failed for ${voice}: HTTP ${res.status}${bodyText ? ` — ${bodyText.slice(0, 200)}` : ''}`,
    );
  }
  const payload = (await res.json()) as { audioPath?: string };
  if (!payload.audioPath) {
    throw new Error(`POST /api/tts returned no audioPath for ${voice}`);
  }
  const audioRes = await fetch(audioUrlFromAudioPath(payload.audioPath));
  if (!audioRes.ok) {
    throw new Error(
      `GET ${payload.audioPath} failed for ${voice}: HTTP ${audioRes.status}`,
    );
  }
  const bytes = new Uint8Array(await audioRes.arrayBuffer());

  const outDir = path.resolve(process.cwd(), 'public', 'voice-samples');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${voice}.wav`);
  // Coqui XTTS produces WAV (PCM 16-bit). The downstream <audio> element
  // plays the file directly, so we keep the native format and the .wav
  // extension — labelling these .mp3 (as the original US-182 AC suggested)
  // would mislead the static-file MIME negotiation.
  await fs.writeFile(outFile, bytes);
  return bytes.byteLength;
}

async function main(): Promise<void> {
  let failures = 0;
  for (const opt of VOICE_OPTIONS) {
    try {
      const bytes = await generateOne(opt.value, opt.label);
      console.log(`[voice-samples] ${opt.value}.wav — ${bytes} bytes`);
    } catch (err) {
      failures += 1;
      console.error(`[voice-samples] FAILED ${opt.value}: ${(err as Error).message}`);
    }
  }
  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[voice-samples] unexpected error:', err);
  process.exit(1);
});
