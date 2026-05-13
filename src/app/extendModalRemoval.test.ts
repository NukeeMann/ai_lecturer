import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// US-172 — the US-144 / US-145 Extend modal is removed; the three-dots
// "Extend" menu item now routes to /courses/<slug>/extend instead of
// opening a modal. These are static-source assertions so the rule survives
// future edits to the dashboard.

const here = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(join(here, 'page.tsx'), 'utf-8');

describe('US-172 — Extend modal removal', () => {
  it('dashboard no longer defines the modal components from US-144/US-145', () => {
    expect(dashboardSrc).not.toMatch(/function\s+ExtendCourseDialog\b/);
    expect(dashboardSrc).not.toMatch(/function\s+ExtendInputForm\b/);
    expect(dashboardSrc).not.toMatch(/function\s+ExtendPreview\b/);
    expect(dashboardSrc).not.toMatch(/function\s+ExtendChatPanel\b/);
  });

  it('dashboard no longer renders <ExtendCourseDialog .../>', () => {
    expect(dashboardSrc).not.toMatch(/<ExtendCourseDialog[\s/>]/);
  });

  it('dashboard no longer holds modal-target state', () => {
    expect(dashboardSrc).not.toMatch(/extendTarget/);
    expect(dashboardSrc).not.toMatch(/setExtendTarget/);
  });

  it('handleRequestExtend navigates to /courses/<slug>/extend (router.push, not a modal open)', () => {
    expect(dashboardSrc).toMatch(
      /router\.push\(\s*`\/courses\/\$\{encodeURIComponent\(course\.slug\)\}\/extend`/,
    );
  });

  it('keeps the three-dots Extend menu testid for continuity with US-142 tests', () => {
    // data-testid={`course-menu-extend-${course.slug}`}
    expect(dashboardSrc).toMatch(/data-testid=\{`course-menu-extend-\$\{course\.slug\}`\}/);
  });
});
