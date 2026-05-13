// US-182: on-the-fly preview alias used as a graceful fallback by
// SettingsMenu when the pre-baked /voice-samples/<voice>.mp3 file is missing
// or fails to decode. Thin wrapper around the existing /api/tts handler so
// the fallback flow doesn't have to re-implement validation, caching, or
// error mapping.

import { POST as ttsPost } from '@/app/api/tts/route';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  return ttsPost(req);
}
