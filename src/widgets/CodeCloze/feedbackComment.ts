export type ClozeLanguage = 'python' | 'javascript' | 'typescript';

export type LineSegment =
  | { kind: 'text'; content: string }
  | { kind: 'slot'; slotId: string };

export function commentPrefix(language: string | undefined): string {
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'js':
    case 'ts':
      return '//';
    case 'python':
    case 'py':
    case undefined:
    default:
      return '#';
  }
}

export function findExistingCommentStart(
  line: string,
  prefix: string,
): number | null {
  let inStr: string | null = null;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (inStr) {
      if (c === '\\' && i + 1 < line.length) {
        i += 2;
        continue;
      }
      if (c === inStr) {
        inStr = null;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = c;
      i++;
      continue;
    }
    if (line.startsWith(prefix, i)) {
      return i;
    }
    i++;
  }
  return null;
}

export function formatFeedbackComment(
  hints: string[],
  prefix: string,
  hasExistingComment: boolean,
): string {
  const cleaned = hints.map((h) => h.trim()).filter((h) => h.length > 0);
  if (cleaned.length === 0) return '';
  const joined = cleaned.join('; ');
  if (hasExistingComment) {
    return `; ${joined}`;
  }
  return `  ${prefix} ${joined}`;
}

export function groupSegmentsIntoLines(
  segments: LineSegment[],
): LineSegment[][] {
  const lines: LineSegment[][] = [[]];
  for (const seg of segments) {
    if (seg.kind === 'slot') {
      lines[lines.length - 1].push(seg);
      continue;
    }
    const parts = seg.content.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].length > 0) {
        lines[lines.length - 1].push({ kind: 'text', content: parts[i] });
      }
      if (i < parts.length - 1) {
        lines.push([]);
      }
    }
  }
  return lines;
}

export function lineHasExistingComment(
  lineSegments: LineSegment[],
  prefix: string,
): boolean {
  const text = lineSegments
    .map((s) => (s.kind === 'text' ? s.content : '__SLOT__'))
    .join('');
  return findExistingCommentStart(text, prefix) !== null;
}
