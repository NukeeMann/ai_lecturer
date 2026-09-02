# scripts/build/

One-off build helpers that emit committed artifacts living elsewhere in the
repo. These are not part of `next build`; each runs only when its source-of-
truth list changes.

## generate-voice-samples.ts

Pre-bakes the three Settings voice previews into static WAV files under
`public/voice-samples/<voice>.wav`, so SettingsMenu plays a cached static
asset instead of round-tripping the local Coqui TTS backend on each click.

**Run when:** the voice list in `VOICE_OPTIONS` (src/components/SettingsMenu.tsx)
changes — voices added, removed, renamed — or when the sample-phrase template
in `scripts/build/generate-voice-samples.ts` is edited. The committed WAVs
should be regenerated and committed alongside the change.

**Prerequisite:** dev server running on `http://localhost:3000` with the
Coqui TTS backend reachable. Start it with `npm run dev` in another shell.
Override the base URL with `AI_LECTURER_DEV_URL` if needed.

**Run:**

```bash
npm run build:voice-samples
```

**Output:** `public/voice-samples/<voice>.wav` (one per voice). The script
overwrites any existing files. Expected size ~150–250 KB per voice (PCM
16-bit mono 24 kHz, the native Coqui XTTS output format — kept as WAV
because Coqui does not emit MP3 and we don't ship an encoder). One log line
per voice is printed with the resulting byte size.

**Graceful degradation:** if the TTS backend is unreachable the script exits
non-zero. SettingsMenu falls back to the live `/api/tts` preview path
automatically when a sample file is missing, so an out-of-date or unbaked
set of WAVs does not break the preview UX — it just makes the first click
per voice slower.
