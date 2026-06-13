import { describe, expect, it } from 'vitest';

import {
  MERMAID_LOADER_JS,
  lessonHasMermaid,
  renderLessonHtml,
} from './staticRender';
import type { Course } from '@/lib/schemas/course';
import type { Lesson } from '@/lib/schemas/lesson';

function lessonWith(markdown: string): Lesson {
  return {
    schemaVersion: 1,
    slug: 'mermaid-lesson',
    courseSlug: 'c',
    moduleId: 'm1',
    title: 'Mermaid lesson',
    eyebrow: 'Module 1',
    description: 'd',
    estimatedMinutes: 5,
    sections: [
      {
        id: 's1',
        title: 'Diagram',
        type: 'theory',
        data: { markdown },
      },
    ],
  } as unknown as Lesson;
}

const course = {
  schemaVersion: 1,
  slug: 'c',
  title: 'Course',
  description: 'd',
  modules: [],
} as unknown as Course;

const MERMAID_MD =
  '## Pipeline\n\n```mermaid\nflowchart TD\n    A[Load] --> B[Train]\n```\n';

describe('US-216 — static export mermaid support', () => {
  it('lessonHasMermaid detects a fenced mermaid block', () => {
    expect(lessonHasMermaid(lessonWith(MERMAID_MD))).toBe(true);
  });

  it('lessonHasMermaid is false for ordinary fenced code', () => {
    expect(
      lessonHasMermaid(lessonWith('```python\nprint(1)\n```\n')),
    ).toBe(false);
  });

  it('renderLessonHtml emits a <pre class="mermaid"> with the diagram source', () => {
    const html = renderLessonHtml({
      lesson: lessonWith(MERMAID_MD),
      course,
      prev: null,
      next: null,
    });
    expect(html).toContain('class="mermaid"');
    expect(html).toContain('data-mermaid');
    expect(html).toContain('flowchart TD');
    expect(html).toContain('A[Load] --&gt; B[Train]');
  });

  it('renderLessonHtml includes the mermaid loader script only when a diagram is present', () => {
    const withDiagram = renderLessonHtml({
      lesson: lessonWith(MERMAID_MD),
      course,
      prev: null,
      next: null,
    });
    expect(withDiagram).toContain('assets/mermaid-loader.js');

    const without = renderLessonHtml({
      lesson: lessonWith('# Just text, no diagram.\n'),
      course,
      prev: null,
      next: null,
    });
    expect(without).not.toContain('assets/mermaid-loader.js');
  });

  it('MERMAID_LOADER_JS imports mermaid from the pinned CDN and runs on .mermaid', () => {
    expect(MERMAID_LOADER_JS).toMatch(
      /import mermaid from 'https:\/\/cdn\.jsdelivr\.net\/npm\/mermaid@/,
    );
    expect(MERMAID_LOADER_JS).toContain("querySelector: '.mermaid'");
    expect(MERMAID_LOADER_JS).toContain('themeVariables');
  });
});
