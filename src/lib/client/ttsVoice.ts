// US-166: client-side store for the user-selected TTS voice.
//
// Persists the chosen voice in localStorage so widgets that hit /api/tts at
// runtime (TtsDemo, future audio-generation flows) can read the user's
// preference instead of hard-coding a value.
//
// Cross-component coordination piggybacks on the existing
// `aiLecturer:settings-change` custom event dispatched by SettingsMenu.

import {
  DEFAULT_TTS_VOICE,
  TTS_VOICE_VALUES,
  type TtsVoice,
} from '@/lib/schemas/tts';

export const TTS_VOICE_STORAGE_KEY = 'aiLecturer.ttsVoice';

export function isTtsVoice(v: unknown): v is TtsVoice {
  return typeof v === 'string' && (TTS_VOICE_VALUES as readonly string[]).includes(v);
}

export function readTtsVoice(): TtsVoice {
  if (typeof window === 'undefined') return DEFAULT_TTS_VOICE;
  try {
    const v = window.localStorage.getItem(TTS_VOICE_STORAGE_KEY);
    return isTtsVoice(v) ? v : DEFAULT_TTS_VOICE;
  } catch {
    return DEFAULT_TTS_VOICE;
  }
}

export function writeTtsVoice(voice: TtsVoice): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TTS_VOICE_STORAGE_KEY, voice);
  } catch {
    // localStorage unavailable; in-memory selection still works.
  }
}
