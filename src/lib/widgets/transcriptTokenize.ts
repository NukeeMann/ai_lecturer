/**
 * Transcript tokenizer used by the TranscriptCloze widget (US-156).
 *
 * Whitespace-splits a transcript into tokens, then strips leading and trailing
 * punctuation from each token (tracking whether the token is "all punctuation"
 * separately). Contractions like "don't" are intentionally kept as one token
 * because the apostrophe is interior, not leading/trailing.
 */

export interface TranscriptToken {
  /** 0-based whitespace-split position. Stable across edits to leading/trailing punctuation. */
  index: number;
  /** Raw token (with surrounding punctuation preserved). Used for rendering. */
  raw: string;
  /** Token with surrounding punctuation stripped. Empty for pure-punctuation tokens. */
  text: string;
  /** True when raw consists entirely of punctuation (then `text === ''`). */
  isPunctuation: boolean;
}

const PUNCT_RE = /[\p{P}\p{S}]/u;

function isPunctChar(c: string): boolean {
  return PUNCT_RE.test(c);
}

function stripSurroundingPunct(raw: string): string {
  let start = 0;
  let end = raw.length;
  while (start < end && isPunctChar(raw[start])) start++;
  while (end > start && isPunctChar(raw[end - 1])) end--;
  return raw.slice(start, end);
}

export function tokenize(transcript: string): TranscriptToken[] {
  if (!transcript) return [];
  const parts = transcript.split(/\s+/).filter((p) => p.length > 0);
  return parts.map((raw, index) => {
    const stripped = stripSurroundingPunct(raw);
    const isPunctuation = stripped.length === 0;
    return {
      index,
      raw,
      text: stripped,
      isPunctuation,
    };
  });
}

/**
 * Case-insensitive, surrounding-punctuation-stripped equality used by the
 * widget when grading user input against a stored answer.
 */
export function answersMatch(expected: string, actual: string): boolean {
  return (
    stripSurroundingPunct(expected).toLowerCase() ===
    stripSurroundingPunct(actual).toLowerCase()
  );
}
