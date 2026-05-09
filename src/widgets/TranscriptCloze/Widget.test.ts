import { describe, expect, it } from 'vitest';

import { TranscriptClozeDataSchema } from './schema';

describe('TranscriptClozeDataSchema', () => {
  const baseTranscript = 'The quick brown fox jumps over the lazy dog';

  it('parses a minimal valid object', () => {
    const parsed = TranscriptClozeDataSchema.parse({
      audioPath: 'lesson.wav',
      transcript: baseTranscript,
      blanks: [
        { wordIndex: 1, answer: 'quick' },
        { wordIndex: 5, answer: 'over' },
      ],
    });
    expect(parsed.audioPath).toBe('lesson.wav');
    expect(parsed.blanks).toHaveLength(2);
  });

  it('parses with optional title, instructions and per-blank hint', () => {
    const parsed = TranscriptClozeDataSchema.parse({
      audioPath: 'lesson.wav',
      transcript: baseTranscript,
      title: 'Listening 1',
      instructions: 'Fill in the missing words.',
      blanks: [{ wordIndex: 1, answer: 'quick', hint: 'speedy' }],
    });
    expect(parsed.title).toBe('Listening 1');
    expect(parsed.instructions).toBe('Fill in the missing words.');
    expect(parsed.blanks[0].hint).toBe('speedy');
  });

  it('rejects missing audioPath', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        transcript: baseTranscript,
        blanks: [],
      }),
    ).toThrow();
  });

  it('rejects empty audioPath', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        audioPath: '',
        transcript: baseTranscript,
        blanks: [],
      }),
    ).toThrow();
  });

  it('rejects empty transcript', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        audioPath: 'a.wav',
        transcript: '',
        blanks: [],
      }),
    ).toThrow();
  });

  it('rejects wordIndex out of range', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        audioPath: 'a.wav',
        transcript: 'one two three',
        blanks: [{ wordIndex: 5, answer: 'x' }],
      }),
    ).toThrow();
  });

  it('rejects wordIndex == word count (exclusive upper bound)', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        audioPath: 'a.wav',
        transcript: 'one two three',
        blanks: [{ wordIndex: 3, answer: 'x' }],
      }),
    ).toThrow();
  });

  it('rejects duplicate wordIndex', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        audioPath: 'a.wav',
        transcript: 'one two three',
        blanks: [
          { wordIndex: 1, answer: 'two' },
          { wordIndex: 1, answer: 'two' },
        ],
      }),
    ).toThrow();
  });

  it('rejects negative wordIndex', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        audioPath: 'a.wav',
        transcript: 'one two three',
        blanks: [{ wordIndex: -1, answer: 'x' }],
      }),
    ).toThrow();
  });

  it('rejects empty answer string', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        audioPath: 'a.wav',
        transcript: 'one two three',
        blanks: [{ wordIndex: 0, answer: '' }],
      }),
    ).toThrow();
  });

  it('accepts an empty blanks array', () => {
    expect(() =>
      TranscriptClozeDataSchema.parse({
        audioPath: 'a.wav',
        transcript: 'one two three',
        blanks: [],
      }),
    ).not.toThrow();
  });
});
