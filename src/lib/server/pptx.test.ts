import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { extractPptxToMarkdown } from './pptx';

// Minimal hand-rolled 3-slide .pptx (≈3 KiB) generated once with jszip (see
// scripts/ralph/progress.txt under US-213). Encoded inline so the test does
// not depend on a binary committed to the repo:
//   - slide1: title "Wprowadzenie do SAR" + bullet "Radar z syntetyczną
//     aperturą" + a speaker-notes part "To jest notatka prelegenta o żaglówce."
//   - slide2: plain text "Drugi slajd treści", no notes
//   - slide3: empty spTree (no <a:t>) — must be skipped per the AC
const FIXTURE_PPTX_BASE64 =
  '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';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-pptx-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('extractPptxToMarkdown', () => {
  it('extracts slide text + speaker notes, writes destPath, reports slides > 0', async () => {
    const src = path.join(tmp, 'sample.pptx');
    const dest = path.join(tmp, '.extracted', 'sample.pptx.md');
    await fs.writeFile(src, Buffer.from(FIXTURE_PPTX_BASE64, 'base64'));

    const result = await extractPptxToMarkdown(src, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(Array.isArray(result.warnings)).toBe(true);

    // Slide bodies survived the round-trip, including Polish diacritics — the
    // smoke-test deck the user uploads is in Polish.
    expect(result.markdown).toContain('Wprowadzenie do SAR');
    expect(result.markdown).toContain('Radar z syntetyczną aperturą');
    expect(result.markdown).toContain('Drugi slajd treści');

    // Speaker notes are attached for slide 1.
    expect(result.markdown).toContain('To jest notatka prelegenta o żaglówce.');

    const onDisk = await fs.readFile(dest, 'utf8');
    expect(onDisk).toBe(result.markdown);
  });

  it('emits ## Slajd N headers in slide order and skips text-less slides', async () => {
    const src = path.join(tmp, 'sample.pptx');
    const dest = path.join(tmp, '.extracted', 'sample.pptx.md');
    await fs.writeFile(src, Buffer.from(FIXTURE_PPTX_BASE64, 'base64'));

    const result = await extractPptxToMarkdown(src, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Slides 1 and 2 have text; slide 3 is empty and must be skipped.
    expect(result.markdown).toContain('## Slajd 1');
    expect(result.markdown).toContain('## Slajd 2');
    expect(result.markdown).not.toContain('## Slajd 3');
    expect(result.slides).toBe(2);

    // Document order is preserved.
    expect(result.markdown.indexOf('## Slajd 1')).toBeLessThan(
      result.markdown.indexOf('## Slajd 2'),
    );
  });

  it('returns ok:false with a reason when given a non-pptx blob', async () => {
    const src = path.join(tmp, 'not-a-pptx.pptx');
    const dest = path.join(tmp, '.extracted', 'not-a-pptx.pptx.md');
    // Plain text masquerading as a pptx — unzipper throws because it is not a
    // valid zip / has no central directory.
    await fs.writeFile(src, 'this is not a pptx, it is just plain text');

    const result = await extractPptxToMarkdown(src, dest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
    // No sibling should have been written for a failed extraction.
    await expect(fs.access(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
