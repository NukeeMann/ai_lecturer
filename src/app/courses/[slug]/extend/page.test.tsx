// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { Course } from '@/lib/schemas/course';
import ExtendWizardClient from './ExtendWizardClient';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const TEST_COURSE: Course = {
  schemaVersion: 1,
  slug: 'test-course',
  title: 'Test Course',
  description: 'A course for testing the extend wizard.',
  accentColor: 'indigo',
  icon: 'sigma',
  modules: [
    {
      id: 'm1',
      title: 'Module One',
      summary: 'first module',
      lessons: [
        { slug: 'l1', title: 'Lesson 1', estimatedMinutes: 10 },
        { slug: 'l2', title: 'Lesson 2', estimatedMinutes: 12 },
      ],
    },
    {
      id: 'm2',
      title: 'Module Two',
      summary: 'second module',
      lessons: [
        { slug: 'l3', title: 'Lesson 3', estimatedMinutes: 8 },
        { slug: 'l4', title: 'Lesson 4', estimatedMinutes: 11 },
      ],
    },
  ],
  createdAt: '2026-05-13T00:00:00Z',
  updatedAt: '2026-05-13T00:00:00Z',
};

describe('Extend wizard page (US-180 direct-add)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders one Add lesson button per module and exactly one Add module button', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    expect(screen.getByTestId('extend-add-lesson-m1')).toBeTruthy();
    expect(screen.getByTestId('extend-add-lesson-m2')).toBeTruthy();
    expect(screen.queryAllByTestId(/^extend-add-lesson-/)).toHaveLength(2);
    expect(screen.getByTestId('extend-add-module')).toBeTruthy();
  });

  it('+Add buttons render only the Lucide icon (no literal "+" in textContent)', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);

    const addModule = screen.getByTestId('extend-add-module');
    expect(addModule.textContent ?? '').not.toContain('+');
    expect((addModule.textContent ?? '').trim()).toBe('Add module');
    expect(addModule.querySelectorAll('svg')).toHaveLength(1);

    for (const moduleId of ['m1', 'm2']) {
      const addLesson = screen.getByTestId(`extend-add-lesson-${moduleId}`);
      expect(addLesson.textContent ?? '').not.toContain('+');
      expect((addLesson.textContent ?? '').trim()).toMatch(
        /^Add lesson to .+/,
      );
      expect(addLesson.querySelectorAll('svg')).toHaveLength(1);
    }
  });

  it('shows the course title in the heading and a disabled Generate additions button before any additions', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    expect(screen.getByTestId('extend-page-title').textContent).toBe(
      'Extend "Test Course"',
    );
    const generate = screen.getByTestId('extend-generate') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
  });

  it('Module dialog: opens with Title + Details fields and Module labels (US-180)', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));

    const dialog = screen.getByTestId('extend-dialog');
    expect(dialog.getAttribute('data-kind')).toBe('module');

    const titleInput = screen.getByTestId(
      'extend-dialog-title',
    ) as HTMLInputElement;
    const summaryArea = screen.getByTestId(
      'extend-dialog-summary',
    ) as HTMLTextAreaElement;

    expect(titleInput.tagName).toBe('INPUT');
    expect(titleInput.type).toBe('text');
    expect(titleInput.maxLength).toBe(120);
    expect(titleInput.placeholder).toBe('e.g., "Advanced indexing patterns"');

    expect(summaryArea.tagName).toBe('TEXTAREA');
    expect(summaryArea.rows).toBe(3);
    expect(summaryArea.maxLength).toBe(300);
    expect(summaryArea.placeholder).toBe(
      'Mention topics, examples, angles, or which widgets/structure to include…',
    );

    // Module-specific labels — details field is shared label.
    expect(dialog.textContent ?? '').toContain('Module title');
    expect(dialog.textContent ?? '').toContain('Share more details:');
  });

  it('Lesson dialog: shows Lesson title / shared details label and parent context line (US-180)', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-lesson-m1'));

    const dialog = screen.getByTestId('extend-dialog');
    expect(dialog.getAttribute('data-kind')).toBe('lesson');
    expect(dialog.textContent ?? '').toContain('Lesson title');
    expect(dialog.textContent ?? '').toContain('Share more details:');
    expect(dialog.textContent ?? '').toContain(
      'Add a lesson under "Module One"',
    );
  });

  it('Add module directly appends to currentProposed without fetching /extend (US-180)', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'Indexing' },
    });
    fireEvent.change(screen.getByTestId('extend-dialog-summary'), {
      target: { value: 'Tensor slicing and dicing' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));

    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });

    // No /extend agent call.
    expect(fetchMock).not.toHaveBeenCalled();

    const newMod = screen.getByTestId('extend-module-indexing');
    expect(newMod.getAttribute('data-new')).toBe('true');
    expect(newMod.style.borderLeftWidth).toBe('3px');
    expect(
      screen.getByTestId('extend-module-title-indexing').textContent,
    ).toBe('Indexing');
    expect(
      screen.getByTestId('extend-module-summary-indexing').textContent,
    ).toBe('Tensor slicing and dicing');
  });

  it('Add module with empty summary omits the summary section visually (US-180)', async () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'Just A Title' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));

    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });

    expect(screen.getByTestId('extend-module-just-a-title')).toBeTruthy();
    expect(
      screen.queryByTestId('extend-module-summary-just-a-title'),
    ).toBeNull();
  });

  it('Module collision shows inline error and does not add the module (US-180)', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'M1' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));

    // Dialog stays open with inline error; no new module appears.
    expect(screen.getByTestId('extend-dialog')).toBeTruthy();
    const err = screen.getByTestId('extend-dialog-error');
    expect(err.textContent).toBe('A module with this id already exists.');
    // Only the two pre-existing modules.
    expect(screen.queryByTestId('extend-module-m1')).toBeTruthy();
    expect(screen.queryByTestId('extend-module-m2')).toBeTruthy();
    expect(screen.queryByTestId('extend-module-m3')).toBeNull();
    // The slugified collision attempt was for 'M1' → slugify → 'm1'.
    // No new card was added.
    const moduleCards = Array.from(
      document.querySelectorAll('[data-testid^="extend-module-"]'),
    ).filter((el) => {
      const tid = el.getAttribute('data-testid') ?? '';
      return (
        !tid.startsWith('extend-module-title-') &&
        !tid.startsWith('extend-module-summary-')
      );
    });
    expect(moduleCards).toHaveLength(2);
  });

  it('Add lesson directly appends under parent module with summary visible (US-180)', async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-lesson-m1'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'Autograd Deep Dive' },
    });
    fireEvent.change(screen.getByTestId('extend-dialog-summary'), {
      target: { value: 'Trace tensors through .backward()' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));

    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const newLesson = screen.getByTestId('extend-lesson-autograd-deep-dive');
    expect(newLesson.getAttribute('data-new')).toBe('true');
    expect(newLesson.style.borderLeftWidth).toBe('3px');
    expect(newLesson.textContent ?? '').toContain('Autograd Deep Dive');
    expect(newLesson.textContent ?? '').toContain('15 min');
    expect(
      screen.getByTestId('extend-lesson-summary-autograd-deep-dive')
        .textContent,
    ).toBe('Trace tensors through .backward()');
  });

  it('Lesson collision is scoped to the parent module — same slug allowed under a different module (US-180)', async () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);

    // First: add a "Shared Name" lesson under m1.
    fireEvent.click(screen.getByTestId('extend-add-lesson-m1'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'Shared Name' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));
    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });

    // Adding the same slug under m1 again collides.
    fireEvent.click(screen.getByTestId('extend-add-lesson-m1'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'Shared Name' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));
    expect(screen.getByTestId('extend-dialog-error').textContent).toBe(
      'A lesson with this slug already exists in this module.',
    );
    fireEvent.click(screen.getByTestId('extend-dialog-cancel'));

    // But the same slug under m2 is fine.
    fireEvent.click(screen.getByTestId('extend-add-lesson-m2'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'Shared Name' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));
    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });
    // Two lessons with the same slug now exist — one under each module.
    expect(screen.queryAllByTestId('extend-lesson-shared-name')).toHaveLength(2);
  });

  it('Reset proposal: restores original tree, clears highlights and pending counter (US-180)', async () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'Indexing' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));
    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });
    expect(screen.getByTestId('extend-module-indexing')).toBeTruthy();

    fireEvent.click(screen.getByTestId('extend-reset'));
    await waitFor(() => {
      expect(screen.queryByTestId('extend-module-indexing')).toBeNull();
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByTestId('extend-module-m1')).toBeTruthy();
    expect(screen.getByTestId('extend-module-m2')).toBeTruthy();
    // No additions left → Generate disabled, Reset disabled.
    expect(
      (screen.getByTestId('extend-generate') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByTestId('extend-reset') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('Add button stays disabled when Title input is empty / whitespace only (US-180)', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));
    const add = screen.getByTestId('extend-dialog-add') as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    const titleInput = screen.getByTestId(
      'extend-dialog-title',
    ) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: '   ' } });
    expect(add.disabled).toBe(true);

    fireEvent.change(titleInput, { target: { value: 'Real Title' } });
    expect(add.disabled).toBe(false);
  });

  it('Cancel closes the dialog without sending a request (US-180)', () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'nope' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-cancel'));

    expect(screen.queryByTestId('extend-dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Enter in Title input moves focus to Summary textarea (US-180 UX polish)', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));
    const titleInput = screen.getByTestId(
      'extend-dialog-title',
    ) as HTMLInputElement;
    const summaryArea = screen.getByTestId(
      'extend-dialog-summary',
    ) as HTMLTextAreaElement;
    titleInput.focus();
    expect(document.activeElement).toBe(titleInput);
    fireEvent.keyDown(titleInput, { key: 'Enter' });
    expect(document.activeElement).toBe(summaryArea);
  });
});

describe('Extend wizard Generate additions + progress view (US-172, still wired to /apply)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('Generate additions is enabled after one direct-add and POSTs to /extend/apply with the current proposedSchema (US-180)', async () => {
    const applyResp = { enqueuedLessonSlugs: ['indexing'] };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        // POST /extend/apply
        ok: true,
        status: 200,
        json: () => Promise.resolve(applyResp),
      })
      .mockResolvedValue({
        // Subsequent: /generate attach + /active-run polling — harmless empties
        ok: true,
        status: 200,
        json: () => Promise.resolve({ active: false, queue: [] }),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ExtendWizardClient course={TEST_COURSE} />);

    // Generate is disabled when no additions exist.
    expect(
      (screen.getByTestId('extend-generate') as HTMLButtonElement).disabled,
    ).toBe(true);

    // Add a module locally.
    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-title'), {
      target: { value: 'Indexing' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));
    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });
    // No /extend call was made.
    expect(fetchMock).not.toHaveBeenCalled();

    // Now Generate is enabled.
    const generateBtn = screen.getByTestId(
      'extend-generate',
    ) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(false);

    // Click Generate → POST /extend/apply with proposedSchema.
    await act(async () => {
      fireEvent.click(generateBtn);
    });

    await waitFor(() => {
      expect(screen.queryByTestId('extend-progress')).not.toBeNull();
    });

    const applyCall = fetchMock.mock.calls.find(
      ([url]) => url === '/api/courses/test-course/extend/apply',
    );
    expect(applyCall).toBeTruthy();
    const applyInit = applyCall![1] as RequestInit;
    expect(applyInit.method).toBe('POST');
    const applyBody = JSON.parse(String(applyInit.body)) as {
      proposedSchema: Course;
    };
    expect(applyBody.proposedSchema.slug).toBe('test-course');
    expect(
      applyBody.proposedSchema.modules.find((m) => m.id === 'indexing'),
    ).toBeTruthy();

    // Progress view rendered, schema tree replaced.
    expect(screen.queryByTestId('extend-tree')).toBeNull();
    expect(screen.getByTestId('extend-progress-lesson-indexing')).toBeTruthy();
  });

  it('renders read-only mode + banner when initialGenerationActive=true; +Add and Generate are gone', () => {
    render(
      <ExtendWizardClient
        course={TEST_COURSE}
        initialGenerationActive
      />,
    );
    expect(screen.getByTestId('extend-readonly-banner')).toBeTruthy();
    expect(screen.queryByTestId('extend-add-module')).toBeNull();
    expect(screen.queryByTestId('extend-add-lesson-m1')).toBeNull();
    const generate = screen.getByTestId('extend-generate') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
  });
});

describe('Extend wizard schema tree summaries (US-179)', () => {
  it('renders module summary and lesson summary below each title when present', () => {
    const course: Course = {
      ...TEST_COURSE,
      modules: [
        {
          id: 'm1',
          title: 'Module One',
          summary: 'Module One covers fundamentals and core concepts.',
          lessons: [
            {
              slug: 'l1',
              title: 'Lesson 1',
              estimatedMinutes: 10,
              summary: 'Walks through the introduction in detail.',
            },
            {
              slug: 'l2',
              title: 'Lesson 2',
              estimatedMinutes: 12,
            },
          ],
        },
      ],
    };
    render(<ExtendWizardClient course={course} />);
    expect(
      screen.getByText('Module One covers fundamentals and core concepts.'),
    ).toBeTruthy();
    expect(
      screen.getByText('Walks through the introduction in detail.'),
    ).toBeTruthy();
    // Title + minutes still on first row of l1, summary on second row.
    const lessonRow = screen.getByTestId('extend-lesson-l1');
    expect(lessonRow.textContent ?? '').toContain('Lesson 1');
    expect(lessonRow.textContent ?? '').toContain('10 min');
    expect(lessonRow.textContent ?? '').toContain(
      'Walks through the introduction in detail.',
    );
    // l2 has no summary → no summary testid present.
    expect(screen.queryByTestId('extend-lesson-summary-l2')).toBeNull();
  });

  it('renders no empty <p> elements when summaries are missing or empty strings', () => {
    const course: Course = {
      ...TEST_COURSE,
      modules: [
        {
          id: 'm1',
          title: 'Module One',
          summary: '',
          lessons: [
            {
              slug: 'l1',
              title: 'Lesson 1',
              estimatedMinutes: 10,
              summary: '',
            },
            {
              slug: 'l2',
              title: 'Lesson 2',
              estimatedMinutes: 12,
            },
            {
              slug: 'l3',
              title: 'Lesson 3',
              estimatedMinutes: 9,
              summary: '   ',
            },
          ],
        },
      ],
    };
    const { container } = render(<ExtendWizardClient course={course} />);
    expect(container.querySelectorAll('p:empty').length).toBe(0);
    expect(screen.queryByTestId('extend-module-summary-m1')).toBeNull();
    expect(screen.queryByTestId('extend-lesson-summary-l1')).toBeNull();
    expect(screen.queryByTestId('extend-lesson-summary-l2')).toBeNull();
    expect(screen.queryByTestId('extend-lesson-summary-l3')).toBeNull();
  });

  it('read-only mode (initialGenerationActive) still renders summaries', () => {
    const course: Course = {
      ...TEST_COURSE,
      modules: [
        {
          id: 'm1',
          title: 'Module One',
          summary: 'Read-only summary stays visible.',
          lessons: [
            {
              slug: 'l1',
              title: 'Lesson 1',
              estimatedMinutes: 10,
              summary: 'Lesson summary stays visible too.',
            },
          ],
        },
      ],
    };
    render(<ExtendWizardClient course={course} initialGenerationActive />);
    expect(screen.getByTestId('extend-readonly-banner')).toBeTruthy();
    expect(screen.getByText('Read-only summary stays visible.')).toBeTruthy();
    expect(screen.getByText('Lesson summary stays visible too.')).toBeTruthy();
  });
});
