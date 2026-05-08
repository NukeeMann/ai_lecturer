// US-153: Per-lesson PDF export.
//
// GET /api/courses/<slug>/lessons/<lessonSlug>/export/pdf
//   200 application/pdf — body is the rendered A4 PDF.
//   400 invalid slug.
//   404 lesson missing on disk.
//   503 dev server not running (the print page needs a live HTTP server
//        to render against, since puppeteer drives a real browser).
//   500 unexpected failure during page.pdf().

import { promises as fs } from 'node:fs';
import { NextResponse } from 'next/server';

import { lessonFile, InvalidSlugError } from '@/lib/server/paths';
import { getBrowser } from '@/lib/server/pdfBrowser';

export const dynamic = 'force-dynamic';

type RouteCtx = {
  params: Promise<{ slug: string; lessonSlug: string }>;
};

const FETCH_RETRY_DELAY_MS = 500;

function activePort(req: Request): number {
  const envPort = process.env.PORT;
  if (envPort && /^\d+$/.test(envPort)) return parseInt(envPort, 10);
  // Try to read the active port from the incoming request URL — when the
  // dev server boots on a non-default port, env.PORT may not reflect it.
  try {
    const url = new URL(req.url);
    const port = url.port;
    if (port && /^\d+$/.test(port)) return parseInt(port, 10);
  } catch {
    // fall through to default
  }
  return 3000;
}

async function gotoWithRetry(
  page: import('puppeteer-core').Page,
  url: string,
): Promise<{ ok: true } | { ok: false; reason: 'econnrefused' | 'other'; detail: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isConnRefused =
        msg.includes('ECONNREFUSED') ||
        msg.includes('ERR_CONNECTION_REFUSED') ||
        msg.includes('net::ERR_CONNECTION_REFUSED');
      if (!isConnRefused) {
        return { ok: false, reason: 'other', detail: msg };
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS));
        continue;
      }
      return { ok: false, reason: 'econnrefused', detail: msg };
    }
  }
  return { ok: false, reason: 'other', detail: 'unreachable' };
}

export async function GET(req: Request, { params }: RouteCtx) {
  const { slug, lessonSlug } = await params;

  let file: string;
  try {
    file = lessonFile(slug, lessonSlug);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  // 404 fast if lesson.json is missing — saves spinning up Chromium.
  try {
    await fs.access(file);
  } catch {
    return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
  }

  const port = activePort(req);
  const printUrl = `http://localhost:${port}/courses/${encodeURIComponent(
    slug,
  )}/lessons/${encodeURIComponent(lessonSlug)}/print`;

  let browser: import('puppeteer-core').Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'pdf-launch-failed', message: msg },
      { status: 500 },
    );
  }

  let page: import('puppeteer-core').Page;
  try {
    page = await browser.newPage();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'pdf-page-failed', message: msg },
      { status: 500 },
    );
  }

  try {
    const navResult = await gotoWithRetry(page, printUrl);
    if (!navResult.ok) {
      if (navResult.reason === 'econnrefused') {
        return NextResponse.json(
          {
            error: 'dev-server-unreachable',
            message: 'Dev server not running — start it before exporting PDF.',
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: 'pdf-navigation-failed', message: navResult.detail },
        { status: 500 },
      );
    }

    // The print page rendered a 404 (Next's not-found page). Detect by
    // status — `page.goto` already followed redirects and the final
    // response's status reflects the resolved page.
    const responseStatus = await page
      .evaluate(() => document.querySelector('[data-testid="lesson-print-root"]') !== null)
      .catch(() => false);
    if (!responseStatus) {
      return NextResponse.json({ error: 'Lesson not found' }, { status: 404 });
    }

    let pdfBytes: Uint8Array;
    try {
      const pdf = await page.pdf({
        format: 'A4',
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
        printBackground: true,
      });
      pdfBytes = pdf instanceof Uint8Array ? pdf : new Uint8Array(pdf);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: 'pdf-render-failed', message: msg },
        { status: 500 },
      );
    }

    const safeName = lessonSlug.replace(/[^a-zA-Z0-9._-]/g, '_');
    // Wrap the Uint8Array in a fresh ArrayBuffer view so TS's lib.dom.d.ts
    // recognises it as BodyInit (the strict ArrayBufferLike vs ArrayBuffer
    // mismatch in @types/node trips up `new Response(uint8)`).
    const ab = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(ab).set(pdfBytes);
    return new Response(ab, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } finally {
    try {
      await page.close();
    } catch {
      // best-effort
    }
  }
}
