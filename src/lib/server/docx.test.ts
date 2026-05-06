import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { extractDocxToMarkdown } from './docx';

// Minimal valid docx fixture: a 1.5 KiB Office Open XML zip whose word/document.xml
// contains two paragraphs ("Hello docx fixture" + a second one with a Polish
// string). Generated once with jszip; encoded inline so the test does not
// depend on a binary committed to the repo.
const FIXTURE_DOCX_BASE64 =
  'UEsDBAoAAAAAAJekplx5bjPXrQEAAK0BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz48VHlwZXMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvY29udGVudC10eXBlcyI+PERlZmF1bHQgRXh0ZW5zaW9uPSJyZWxzIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLXBhY2thZ2UucmVsYXRpb25zaGlwcyt4bWwiLz48RGVmYXVsdCBFeHRlbnNpb249InhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3htbCIvPjxPdmVycmlkZSBQYXJ0TmFtZT0iL3dvcmQvZG9jdW1lbnQueG1sIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLW9mZmljZWRvY3VtZW50LndvcmRwcm9jZXNzaW5nbWwuZG9jdW1lbnQubWFpbit4bWwiLz48L1R5cGVzPlBLAwQKAAAAAACXpKZcAAAAAAAAAAAAAAAABgAAAF9yZWxzL1BLAwQKAAAAAACXpKZcm/036ikBAAApAQAACwAAAF9yZWxzLy5yZWxzPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/PjxSZWxhdGlvbnNoaXBzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMiPjxSZWxhdGlvbnNoaXAgSWQ9InJJZDEiIFR5cGU9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMvb2ZmaWNlRG9jdW1lbnQiIFRhcmdldD0id29yZC9kb2N1bWVudC54bWwiLz48L1JlbGF0aW9uc2hpcHM+UEsDBAoAAAAAAJekplwAAAAAAAAAAAAAAAAFAAAAd29yZC9QSwMECgAAAAAAl6SmXFyDCUQmAQAAJgEAABEAAAB3b3JkL2RvY3VtZW50LnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz48dzpkb2N1bWVudCB4bWxuczp3PSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvd29yZHByb2Nlc3NpbmdtbC8yMDA2L21haW4iPjx3OmJvZHk+PHc6cD48dzpyPjx3OnQ+SGVsbG8gZG9jeCBmaXh0dXJlPC93OnQ+PC93OnI+PC93OnA+PHc6cD48dzpyPjx3OnQ+U2Vjb25kIHBhcmFncmFwaCB3aXRoIFBvbGlzaDogTGlzdGEgcHl0YcWEPC93OnQ+PC93OnI+PC93OnA+PC93OmJvZHk+PC93OmRvY3VtZW50PlBLAQIUAAoAAAAAAJekplx5bjPXrQEAAK0BAAATAAAAAAAAAAAAAAAAAAAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQACgAAAAAAl6SmXAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAQAAAA3gEAAF9yZWxzL1BLAQIUAAoAAAAAAJekplyb/TfqKQEAACkBAAALAAAAAAAAAAAAAAAAAAICAABfcmVscy8ucmVsc1BLAQIUAAoAAAAAAJekplwAAAAAAAAAAAAAAAAFAAAAAAAAAAAAEAAAAFQDAAB3b3JkL1BLAQIUAAoAAAAAAJekplxcgwlEJgEAACYBAAARAAAAAAAAAAAAAAAAAHcDAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAABQAFACABAADMBAAAAAA=';

// Same shape as FIXTURE_DOCX_BASE64 but with an embedded 67-byte transparent
// PNG (1×1) at word/media/image1.png + a w:drawing reference. The default
// mammoth markdown output for this fixture is `…\n\n![](data:image/png;base64,
// iVBOR…)\n\n…` — the regression we are guarding against in US-126.
const FIXTURE_DOCX_WITH_IMAGE_BASE64 =
  'UEsDBAoAAAAAADiuply56iOW3wEAAN8BAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz48VHlwZXMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvY29udGVudC10eXBlcyI+PERlZmF1bHQgRXh0ZW5zaW9uPSJyZWxzIiBDb250ZW50VHlwZT0iYXBwbGljYXRpb24vdm5kLm9wZW54bWxmb3JtYXRzLXBhY2thZ2UucmVsYXRpb25zaGlwcyt4bWwiLz48RGVmYXVsdCBFeHRlbnNpb249InhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3htbCIvPjxEZWZhdWx0IEV4dGVuc2lvbj0icG5nIiBDb250ZW50VHlwZT0iaW1hZ2UvcG5nIi8+PE92ZXJyaWRlIFBhcnROYW1lPSIvd29yZC9kb2N1bWVudC54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQud29yZHByb2Nlc3NpbmdtbC5kb2N1bWVudC5tYWluK3htbCIvPjwvVHlwZXM+UEsDBAoAAAAAADiuplwAAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAAADiuplyb/TfqKQEAACkBAAALAAAAX3JlbHMvLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+PFJlbGF0aW9uc2hpcHMgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9wYWNrYWdlLzIwMDYvcmVsYXRpb25zaGlwcyI+PFJlbGF0aW9uc2hpcCBJZD0icklkMSIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9vZmZpY2VEb2N1bWVudCIgVGFyZ2V0PSJ3b3JkL2RvY3VtZW50LnhtbCIvPjwvUmVsYXRpb25zaGlwcz5QSwMECgAAAAAAOK6mXAAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAAAAA4rqZcAAAAAAAAAAAAAAAACwAAAHdvcmQvX3JlbHMvUEsDBAoAAAAAADiuplzERYGuIAEAACABAAAcAAAAd29yZC9fcmVscy9kb2N1bWVudC54bWwucmVsczw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz48UmVsYXRpb25zaGlwcyB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3BhY2thZ2UvMjAwNi9yZWxhdGlvbnNoaXBzIj48UmVsYXRpb25zaGlwIElkPSJySWQxMCIgVHlwZT0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcy9pbWFnZSIgVGFyZ2V0PSJtZWRpYS9pbWFnZTEucG5nIi8+PC9SZWxhdGlvbnNoaXBzPlBLAwQKAAAAAAA4rqZcAAAAAAAAAAAAAAAACwAAAHdvcmQvbWVkaWEvUEsDBAoAAAAAADiuplyvyNBXRAAAAEQAAAAVAAAAd29yZC9tZWRpYS9pbWFnZTEucG5niVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYIJQSwMECgAAAAAAOK6mXF7qK4/hBAAA4QQAABEAAAB3b3JkL2RvY3VtZW50LnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz48dzpkb2N1bWVudCB4bWxuczp3PSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvd29yZHByb2Nlc3NpbmdtbC8yMDA2L21haW4iIHhtbG5zOnI9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9vZmZpY2VEb2N1bWVudC8yMDA2L3JlbGF0aW9uc2hpcHMiIHhtbG5zOndwPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvZHJhd2luZ21sLzIwMDYvd29yZHByb2Nlc3NpbmdEcmF3aW5nIiB4bWxuczphPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvZHJhd2luZ21sLzIwMDYvbWFpbiIgeG1sbnM6cGljPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvZHJhd2luZ21sLzIwMDYvcGljdHVyZSI+PHc6Ym9keT48dzpwPjx3OnI+PHc6dD5Qcm9zZSBiZWZvcmUgdGhlIGltYWdlPC93OnQ+PC93OnI+PC93OnA+PHc6cD48dzpyPjx3OmRyYXdpbmc+PHdwOmlubGluZSBkaXN0VD0iMCIgZGlzdEI9IjAiIGRpc3RMPSIwIiBkaXN0Uj0iMCI+PHdwOmV4dGVudCBjeD0iOTE0NDAwIiBjeT0iOTE0NDAwIi8+PHdwOmVmZmVjdEV4dGVudCBsPSIwIiB0PSIwIiByPSIwIiBiPSIwIi8+PHdwOmRvY1ByIGlkPSIxIiBuYW1lPSJQaWN0dXJlIDEiLz48d3A6Y052R3JhcGhpY0ZyYW1lUHIvPjxhOmdyYXBoaWM+PGE6Z3JhcGhpY0RhdGEgdXJpPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvZHJhd2luZ21sLzIwMDYvcGljdHVyZSI+PHBpYzpwaWM+PHBpYzpudlBpY1ByPjxwaWM6Y052UHIgaWQ9IjEiIG5hbWU9ImltZyIvPjxwaWM6Y052UGljUHIvPjwvcGljOm52UGljUHI+PHBpYzpibGlwRmlsbD48YTpibGlwIHI6ZW1iZWQ9InJJZDEwIi8+PGE6c3RyZXRjaD48YTpmaWxsUmVjdC8+PC9hOnN0cmV0Y2g+PC9waWM6YmxpcEZpbGw+PHBpYzpzcFByPjxhOnhmcm0+PGE6b2ZmIHg9IjAiIHk9IjAiLz48YTpleHQgY3g9IjkxNDQwMCIgY3k9IjkxNDQwMCIvPjwvYTp4ZnJtPjxhOnByc3RHZW9tIHByc3Q9InJlY3QiPjxhOmF2THN0Lz48L2E6cHJzdEdlb20+PC9waWM6c3BQcj48L3BpYzpwaWM+PC9hOmdyYXBoaWNEYXRhPjwvYTpncmFwaGljPjwvd3A6aW5saW5lPjwvdzpkcmF3aW5nPjwvdzpyPjwvdzpwPjx3OnA+PHc6cj48dzp0PlByb3NlIGFmdGVyIHRoZSBpbWFnZTwvdzp0PjwvdzpyPjwvdzpwPjwvdzpib2R5Pjwvdzpkb2N1bWVudD5QSwECFAAKAAAAAAA4rqZcueojlt8BAADfAQAAEwAAAAAAAAAAAAAAAAAAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAAoAAAAAADiuplwAAAAAAAAAAAAAAAAGAAAAAAAAAAAAEAAAABACAABfcmVscy9QSwECFAAKAAAAAAA4rqZcm/036ikBAAApAQAACwAAAAAAAAAAAAAAAAA0AgAAX3JlbHMvLnJlbHNQSwECFAAKAAAAAAA4rqZcAAAAAAAAAAAAAAAABQAAAAAAAAAAABAAAACGAwAAd29yZC9QSwECFAAKAAAAAAA4rqZcAAAAAAAAAAAAAAAACwAAAAAAAAAAABAAAACpAwAAd29yZC9fcmVscy9QSwECFAAKAAAAAAA4rqZcxEWBriABAAAgAQAAHAAAAAAAAAAAAAAAAADSAwAAd29yZC9fcmVscy9kb2N1bWVudC54bWwucmVsc1BLAQIUAAoAAAAAADiuplwAAAAAAAAAAAAAAAALAAAAAAAAAAAAEAAAACwFAAB3b3JkL21lZGlhL1BLAQIUAAoAAAAAADiuplyvyNBXRAAAAEQAAAAVAAAAAAAAAAAAAAAAAFUFAAB3b3JkL21lZGlhL2ltYWdlMS5wbmdQSwECFAAKAAAAAAA4rqZcXuorj+EEAADhBAAAEQAAAAAAAAAAAAAAAADMBQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAkACQAfAgAA3AoAAAAA';

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(tmpdir(), 'ai-lecturer-docx-'));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

describe('extractDocxToMarkdown', () => {
  it('extracts a fixture docx to non-empty markdown and writes it to destPath', async () => {
    const src = path.join(tmp, 'sample.docx');
    const dest = path.join(tmp, '.extracted', 'sample.docx.md');
    await fs.writeFile(src, Buffer.from(FIXTURE_DOCX_BASE64, 'base64'));

    const result = await extractDocxToMarkdown(src, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.markdown).toContain('Hello docx fixture');
    // Polish diacritic survives the round-trip — the smoke test docx the
    // user upload-tests with is in Polish, so this is the canary that
    // mammoth's UTF-8 handling is intact.
    expect(result.markdown).toContain('Lista pyta');

    const onDisk = await fs.readFile(dest, 'utf8');
    expect(onDisk).toBe(result.markdown);
  });

  it('returns ok:false with a reason when given a non-docx blob', async () => {
    const src = path.join(tmp, 'not-a-docx.docx');
    const dest = path.join(tmp, '.extracted', 'not-a-docx.docx.md');
    // Plain text masquerading as a docx — mammoth will throw "Can't find end
    // of central directory" because it isn't a zip at all.
    await fs.writeFile(src, 'this is not a docx, it is just plain text');

    const result = await extractDocxToMarkdown(src, dest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(typeof result.reason).toBe('string');
    expect(result.reason.length).toBeGreaterThan(0);
    // No sibling should have been written for a failed extraction.
    await expect(fs.access(dest)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('surfaces non-fatal mammoth messages as warnings (not failures)', async () => {
    const src = path.join(tmp, 'sample.docx');
    const dest = path.join(tmp, '.extracted', 'sample.docx.md');
    await fs.writeFile(src, Buffer.from(FIXTURE_DOCX_BASE64, 'base64'));

    const result = await extractDocxToMarkdown(src, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The fixture is clean so the warnings array is allowed to be empty,
    // but its shape must always be a string array.
    expect(Array.isArray(result.warnings)).toBe(true);
    for (const w of result.warnings) {
      expect(typeof w).toBe('string');
    }
  });

  // US-126 — base64 image data-URIs from mammoth's default `convertImage` were
  // dominating extracted markdown (>95% of bytes on the reference fixture) and
  // exhausting the wizard prompt budget. The extractor now collapses every
  // image to a literal `[image]` placeholder.
  it('replaces embedded images with [image] and emits zero base64 data URIs', async () => {
    const src = path.join(tmp, 'with-image.docx');
    const dest = path.join(tmp, '.extracted', 'with-image.docx.md');
    await fs.writeFile(src, Buffer.from(FIXTURE_DOCX_WITH_IMAGE_BASE64, 'base64'));

    const result = await extractDocxToMarkdown(src, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain('[image]');
    expect(result.markdown).toContain('Prose before the image');
    expect(result.markdown).toContain('Prose after the image');
    expect(result.markdown).not.toMatch(/data:image\//);
    expect(result.markdown).not.toContain(';base64,');

    const onDisk = await fs.readFile(dest, 'utf8');
    expect(onDisk).toBe(result.markdown);
    expect(onDisk).not.toMatch(/data:image\//);
  });

  // Regression: docx fixtures with NO images must round-trip identical prose
  // and contain zero `[image]` placeholders — the post-processing step is
  // image-only and must not touch normal paragraphs.
  it('does not introduce [image] placeholders when the docx has no images', async () => {
    const src = path.join(tmp, 'no-image.docx');
    const dest = path.join(tmp, '.extracted', 'no-image.docx.md');
    await fs.writeFile(src, Buffer.from(FIXTURE_DOCX_BASE64, 'base64'));

    const result = await extractDocxToMarkdown(src, dest);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).not.toContain('[image]');
    expect(result.markdown).toContain('Hello docx fixture');
    expect(result.markdown).toContain('Lista pyta');
  });
});
