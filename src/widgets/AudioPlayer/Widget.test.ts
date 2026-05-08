import { describe, expect, it } from 'vitest';

import {
  AudioPlayerDataSchema,
  buildAudioUrl,
  isSupportedAudioPath,
} from './schema';

describe('AudioPlayerDataSchema', () => {
  it('parses a minimal valid object and defaults autoplay=false', () => {
    const parsed = AudioPlayerDataSchema.parse({ audioPath: 'lesson-01.wav' });
    expect(parsed.audioPath).toBe('lesson-01.wav');
    expect(parsed.autoplay).toBe(false);
    expect(parsed.title).toBeUndefined();
    expect(parsed.transcript).toBeUndefined();
  });

  it('parses a full object with title + transcript + autoplay', () => {
    const parsed = AudioPlayerDataSchema.parse({
      audioPath: 'lesson-01.mp3',
      title: 'Lesson 1',
      transcript: 'Hello, welcome.',
      autoplay: true,
    });
    expect(parsed.title).toBe('Lesson 1');
    expect(parsed.transcript).toBe('Hello, welcome.');
    expect(parsed.autoplay).toBe(true);
  });

  it('rejects missing audioPath', () => {
    expect(() => AudioPlayerDataSchema.parse({})).toThrow();
  });

  it('rejects empty audioPath', () => {
    expect(() => AudioPlayerDataSchema.parse({ audioPath: '' })).toThrow();
  });
});

describe('buildAudioUrl', () => {
  it('joins courseSlug + audioPath under /api/courses/<slug>/assets/audio/', () => {
    expect(buildAudioUrl('audio-test', 'lesson-01.wav')).toBe(
      '/api/courses/audio-test/assets/audio/lesson-01.wav',
    );
  });

  it('encodes path segments individually (does not encode slashes)', () => {
    expect(buildAudioUrl('audio-test', 'sub dir/file name.wav')).toBe(
      '/api/courses/audio-test/assets/audio/sub%20dir/file%20name.wav',
    );
  });

  it('strips leading slashes from audioPath', () => {
    expect(buildAudioUrl('a', '/foo.mp3')).toBe(
      '/api/courses/a/assets/audio/foo.mp3',
    );
  });
});

describe('isSupportedAudioPath', () => {
  it('accepts mp3, wav, ogg (case-insensitive)', () => {
    expect(isSupportedAudioPath('a.mp3')).toBe(true);
    expect(isSupportedAudioPath('a.WAV')).toBe(true);
    expect(isSupportedAudioPath('a.Ogg')).toBe(true);
  });

  it('rejects other extensions', () => {
    expect(isSupportedAudioPath('a.txt')).toBe(false);
    expect(isSupportedAudioPath('a.flac')).toBe(false);
    expect(isSupportedAudioPath('noext')).toBe(false);
  });
});
