import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { extractPdfToMarkdown } from './pdf';

// Minimal hand-rolled 2-page PDF (≈830 bytes) — generated once with a
// helper script (see scripts/ralph/progress.txt under US-127). Page 1
// contains "Hello page one fixture", page 2 "Hello page two fixture".
// The stems are intentionally distinct so the page-separator order is
// observable in the joined markdown.
const FIXTURE_PDF_BASE64 =
  'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PgplbmRvYmoKMiAwIG9iago8PC9UeXBlL1BhZ2VzL0tpZHNbMyAwIFIgNSAwIFJdL0NvdW50IDI+PgplbmRvYmoKMyAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDIgMCBSL01lZGlhQm94WzAgMCA2MTIgNzkyXS9Db250ZW50cyA0IDAgUi9SZXNvdXJjZXM8PC9Gb250PDwvRjEgNyAwIFI+Pj4+Pj4KZW5kb2JqCjQgMCBvYmoKPDwvTGVuZ3RoIDU0Pj4Kc3RyZWFtCkJUIC9GMSAyNCBUZiAxMDAgNzAwIFRkIChIZWxsbyBwYWdlIG9uZSBmaXh0dXJlKSBUaiBFVAplbmRzdHJlYW0KZW5kb2JqCjUgMCBvYmoKPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgNjEyIDc5Ml0vQ29udGVudHMgNiAwIFIvUmVzb3VyY2VzPDwvRm9udDw8L0YxIDcgMCBSPj4+Pj4+CmVuZG9iago2IDAgb2JqCjw8L0xlbmd0aCA1ND4+CnN0cmVhbQpCVCAvRjEgMjQgVGYgMTAwIDcwMCBUZCAoSGVsbG8gcGFnZSB0d28gZml4dHVyZSkgVGogRVQKZW5kc3RyZWFtCmVuZG9iago3IDAgb2JqCjw8L1R5cGUvRm9udC9TdWJ0eXBlL1R5cGUxL0Jhc2VGb250L0hlbHZldGljYT4+CmVuZG9iagp4cmVmCjAgOAowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMDAwMTUgMDAwMDAgbiAKMDAwMDAwMDA2MCAwMDAwMCBuIAowMDAwMDAwMTE3IDAwMDAwIG4gCjAwMDAwMDAyMjkgMDAwMDAgbiAKMDAwMDAwMDMzMSAwMDAwMCBuIAowMDAwMDAwNDQzIDAwMDAwIG4gCjAwMDAwMDA1NDUgMDAwMDAgbiAKdHJhaWxlcgo8PC9TaXplIDgvUm9vdCAxIDAgUj4+CnN0YXJ0eHJlZgo2MDgKJSVFT0YK';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-pdf-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('extractPdfToMarkdown', () => {
  it('extracts a fixture pdf to non-empty markdown, writes destPath, reports pages > 0', async () => {
    const src = path.join(tmp, 'sample.pdf');
    const dest = path.join(tmp, '.extracted', 'sample.pdf.md');
    await fs.writeFile(src, Buffer.from(FIXTURE_PDF_BASE64, 'base64'));

    const result = await extractPdfToMarkdown(src, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.pages).toBeGreaterThan(0);
    expect(result.pages).toBe(2);
    expect(Array.isArray(result.warnings)).toBe(true);
    // Both page bodies survived the round-trip and the page separators are
    // present in document order.
    expect(result.markdown).toContain('Hello page one fixture');
    expect(result.markdown).toContain('Hello page two fixture');
    expect(result.markdown).toContain('--- page 1 ---');
    expect(result.markdown).toContain('--- page 2 ---');
    expect(result.markdown.indexOf('--- page 1 ---')).toBeLessThan(
      result.markdown.indexOf('--- page 2 ---'),
    );

    const onDisk = await fs.readFile(dest, 'utf8');
    expect(onDisk).toBe(result.markdown);
  });

  it('returns ok:false with a reason when given a non-pdf blob', async () => {
    const src = path.join(tmp, 'not-a-pdf.pdf');
    const dest = path.join(tmp, '.extracted', 'not-a-pdf.pdf.md');
    // Plain text masquerading as a PDF — pdf-parse throws InvalidPDFException
    // because the structure is missing the %PDF header / xref table.
    await fs.writeFile(src, 'this is not a pdf, it is just plain text');

    const result = await extractPdfToMarkdown(src, dest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
    // No sibling should have been written for a failed extraction.
    await expect(fs.access(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
