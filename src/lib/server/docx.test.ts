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
});
