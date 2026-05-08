// US-153: Headless Chromium singleton for PDF export.
//
// One puppeteer-core Browser instance is reused across export calls so we
// don't pay the ~3s Chromium boot cost per request. After 5 minutes of
// inactivity the browser is closed; the next call re-launches it.
//
// The Chromium binary is resolved from:
//   1. process.env.PUPPETEER_EXECUTABLE_PATH (explicit override)
//   2. process.env.PLAYWRIGHT_BROWSERS_PATH (custom playwright cache dir)
//   3. ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome
//      ~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux*/chrome-headless-shell
//   4. /usr/bin/chromium / /usr/bin/google-chrome (system fallback)

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Browser } from 'puppeteer-core';

const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

interface PuppeteerLauncher {
  launch(opts: {
    executablePath: string;
    headless: boolean;
    args?: string[];
  }): Promise<Browser>;
}

let cachedLauncher: PuppeteerLauncher | null = null;
function getLauncher(): PuppeteerLauncher {
  if (!cachedLauncher) {
    // Lazy require dodges Turbopack's static import scan; aligns with how
    // src/lib/export/staticRender.tsx loads `react-dom/server`.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('puppeteer-core') as { default?: PuppeteerLauncher } & PuppeteerLauncher;
    cachedLauncher = (mod.default ?? mod) as PuppeteerLauncher;
  }
  return cachedLauncher;
}

let browserPromise: Promise<Browser> | null = null;
let browserRef: Browser | null = null;
let idleTimer: NodeJS.Timeout | null = null;

function clearIdleTimer() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function scheduleIdleClose() {
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    void closeBrowser();
  }, IDLE_TIMEOUT_MS);
  // Don't keep the Node process alive just for the idle timer.
  if (typeof idleTimer.unref === 'function') idleTimer.unref();
}

export async function closeBrowser(): Promise<void> {
  clearIdleTimer();
  const b = browserRef;
  browserRef = null;
  browserPromise = null;
  if (b) {
    try {
      await b.close();
    } catch {
      // best-effort; the next launch will start fresh.
    }
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function searchPlaywrightCache(rootCandidates: string[]): Promise<string | null> {
  for (const root of rootCandidates) {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    // Prefer full chromium over headless_shell (PDF works on both).
    const fullDirs = entries.filter((e) => e.startsWith('chromium-'));
    const shellDirs = entries.filter((e) => e.startsWith('chromium_headless_shell-'));
    for (const dir of [...fullDirs, ...shellDirs]) {
      const dirPath = path.join(root, dir);
      let inner: string[];
      try {
        inner = await fs.readdir(dirPath);
      } catch {
        continue;
      }
      for (const sub of inner) {
        // chrome-linux64 / chrome-linux / chrome-headless-shell-linux64
        if (!sub.startsWith('chrome-')) continue;
        const candidate1 = path.join(dirPath, sub, 'chrome');
        if (await fileExists(candidate1)) return candidate1;
        const candidate2 = path.join(dirPath, sub, 'chrome-headless-shell');
        if (await fileExists(candidate2)) return candidate2;
      }
    }
  }
  return null;
}

export async function resolveChromiumExecutable(): Promise<string | null> {
  const envOverride = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (envOverride && (await fileExists(envOverride))) return envOverride;

  const playwrightOverride = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const candidates = [
    ...(playwrightOverride ? [playwrightOverride] : []),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ];
  const found = await searchPlaywrightCache(candidates);
  if (found) return found;

  for (const sys of ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']) {
    if (await fileExists(sys)) return sys;
  }
  return null;
}

async function launchBrowser(): Promise<Browser> {
  const exec = await resolveChromiumExecutable();
  if (!exec) {
    throw new Error(
      'No Chromium binary found. Install playwright (run `npm install --no-audit --no-fund && npx playwright install chromium` inside scripts/ralph/skills/playwright-skill) or set PUPPETEER_EXECUTABLE_PATH.',
    );
  }
  const launcher = getLauncher();
  const b = await launcher.launch({
    executablePath: exec,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'],
  });
  b.on('disconnected', () => {
    if (browserRef === b) {
      browserRef = null;
      browserPromise = null;
      clearIdleTimer();
    }
  });
  return b;
}

export async function getBrowser(): Promise<Browser> {
  if (browserRef && browserRef.connected) {
    scheduleIdleClose();
    return browserRef;
  }
  if (browserPromise) {
    const b = await browserPromise;
    scheduleIdleClose();
    return b;
  }
  browserPromise = (async () => {
    const b = await launchBrowser();
    browserRef = b;
    scheduleIdleClose();
    return b;
  })();
  try {
    return await browserPromise;
  } catch (err) {
    browserPromise = null;
    browserRef = null;
    throw err;
  }
}

// Test-only hook for swapping in a fake puppeteer-core launcher.
export function __setLauncherForTesting(l: PuppeteerLauncher | null): void {
  cachedLauncher = l;
}

export function __resetForTesting(): void {
  browserRef = null;
  browserPromise = null;
  clearIdleTimer();
}
