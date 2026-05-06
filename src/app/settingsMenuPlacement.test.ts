import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// US-116 — the settings cog must be present in the header of every top-level
// page in the app, not only inside an open lesson. This test reproduces the
// reported bug: before the fix, the course-list and /create pages render an
// inactive <Settings/> icon (or nothing at all) instead of mounting the real
// <SettingsMenu/> dropdown. The test asserts that SettingsMenu is imported
// from '@/components/SettingsMenu' AND rendered as JSX in each page module.

const here = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  { label: 'course list (/)', path: join(here, 'page.tsx') },
  { label: 'course generation (/create)', path: join(here, 'create', 'page.tsx') },
  {
    label: 'lesson (/courses/[slug]/lessons/[lessonSlug])',
    path: join(here, 'courses', '[slug]', 'lessons', '[lessonSlug]', 'page.tsx'),
  },
];

describe('US-116 — Settings cog mounted on every top-level page', () => {
  for (const page of PAGES) {
    it(`mounts <SettingsMenu/> on ${page.label}`, () => {
      const source = readFileSync(page.path, 'utf-8');
      expect(
        source,
        `${page.label} must import SettingsMenu from @/components/SettingsMenu`,
      ).toMatch(/from\s+['"]@\/components\/SettingsMenu['"]/);
      expect(
        source,
        `${page.label} must render <SettingsMenu .../> in JSX so the dropdown opens on click`,
      ).toMatch(/<SettingsMenu[\s/>]/);
    });
  }
});
