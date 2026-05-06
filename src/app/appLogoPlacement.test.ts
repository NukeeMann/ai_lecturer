import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// US-120 — the AI Lecturer logo (AppLogoLink) must persist in the top-left of
// the global app shell on every top-level page. Before the fix, /create
// renders a header with an EMPTY left slot (`<div style={headerSlotStyle} />`)
// instead of `<AppLogoLink />`, so users on the wizard have no quick way to
// jump back to the course list. This test mirrors the static-source-check
// pattern from `settingsMenuPlacement.test.ts` (US-116) and asserts that each
// page imports AppLogoLink from '@/components/AppLogo' AND renders it in JSX.

const here = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  { label: 'course list (/)', path: join(here, 'page.tsx') },
  { label: 'course generation (/create)', path: join(here, 'create', 'page.tsx') },
  {
    label: 'lesson (/courses/[slug]/lessons/[lessonSlug])',
    path: join(here, 'courses', '[slug]', 'lessons', '[lessonSlug]', 'page.tsx'),
  },
];

describe('US-120 — AI Lecturer logo mounted on every top-level page', () => {
  for (const page of PAGES) {
    it(`mounts <AppLogoLink/> on ${page.label}`, () => {
      const source = readFileSync(page.path, 'utf-8');
      expect(
        source,
        `${page.label} must import AppLogoLink from @/components/AppLogo`,
      ).toMatch(/from\s+['"]@\/components\/AppLogo['"]/);
      expect(
        source,
        `${page.label} must render <AppLogoLink .../> in JSX so the top-left logo links back to the course list`,
      ).toMatch(/<AppLogoLink[\s/>]/);
    });
  }
});
