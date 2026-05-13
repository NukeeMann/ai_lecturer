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
import type { ExtendResponse } from '@/lib/schemas/extend';
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

function buildExtendResponseWithNewModule(): ExtendResponse {
  return {
    proposedSchema: {
      ...TEST_COURSE,
      modules: [
        ...TEST_COURSE.modules,
        {
          id: 'm3',
          title: 'Module Three (new)',
          summary: 'agent-added module',
          lessons: [
            { slug: 'm3-l1', title: 'Intro to advanced indexing', estimatedMinutes: 9 },
          ],
        },
      ],
    },
    additions: {
      newModuleIds: ['m3'],
      newLessonIds: [],
      rationale: 'Added a new module on advanced indexing.',
    },
  };
}

function buildExtendResponseAddNewLessonToModuleOne(prev: ExtendResponse): ExtendResponse {
  return {
    proposedSchema: {
      ...prev.proposedSchema,
      modules: prev.proposedSchema.modules.map((m) =>
        m.id === 'm1'
          ? {
              ...m,
              lessons: [
                ...m.lessons,
                {
                  slug: 'm1-l-new',
                  title: 'Autograd deep dive',
                  estimatedMinutes: 14,
                },
              ],
            }
          : m,
      ),
    },
    additions: {
      newModuleIds: [],
      newLessonIds: [
        {
          moduleId: 'm1',
          lessonSlug: 'm1-l-new',
          lessonTitle: 'Autograd deep dive',
          lessonDescription: 'A deep dive on the autograd engine.',
        },
      ],
      rationale: 'Added a new lesson under module One on autograd.',
    },
  };
}

function mockFetchOnce(response: unknown, status = 200): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn().mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
  } as unknown as Response);
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe('Extend wizard page (US-171)', () => {
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

  it('US-176: +Add buttons render only the Lucide icon (no literal "+" in textContent)', () => {
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

  it('Add module dialog: posts expected instruction, reflects response in tree with data-new highlight', async () => {
    const response = buildExtendResponseWithNewModule();
    const fetchMock = mockFetchOnce(response);
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-module'));
    expect(screen.getByTestId('extend-dialog').getAttribute('data-kind')).toBe(
      'module',
    );

    const textarea = screen.getByTestId(
      'extend-dialog-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'advanced indexing module' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-dialog-add'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });

    // Fetch call payload assertions.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/courses/test-course/extend');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as {
      instruction: string;
      refinements?: unknown;
    };
    expect(body.instruction).toBe(
      'Add a new module: advanced indexing module',
    );
    expect(body.refinements).toBeUndefined();

    // The new module is rendered with data-new + highlight.
    const newMod = await screen.findByTestId('extend-module-m3');
    expect(newMod.getAttribute('data-new')).toBe('true');
    expect(newMod.style.borderLeftWidth).toBe('3px');
    // Existing modules are NOT highlighted.
    expect(
      screen.getByTestId('extend-module-m1').getAttribute('data-new'),
    ).toBeNull();
  });

  it('Add lesson dialog: second call sends prior instruction as refinement; new lesson highlighted', async () => {
    const firstResp = buildExtendResponseWithNewModule();
    const secondResp = buildExtendResponseAddNewLessonToModuleOne(firstResp);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(firstResp),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(secondResp),
      });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ExtendWizardClient course={TEST_COURSE} />);

    // First call: add a module.
    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-textarea'), {
      target: { value: 'advanced indexing module' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-dialog-add'));
    });
    await screen.findByTestId('extend-module-m3');

    // Second call: add a lesson under module One.
    fireEvent.click(screen.getByTestId('extend-add-lesson-m1'));
    fireEvent.change(screen.getByTestId('extend-dialog-textarea'), {
      target: { value: 'autograd deep dive' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-dialog-add'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });

    // Second call payload contains refinements with the prior instruction.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, secondInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const body = JSON.parse(String(secondInit.body)) as {
      instruction: string;
      refinements: Array<{ role: 'user'; content: string }>;
    };
    expect(body.instruction).toBe(
      'Add a new lesson under module "Module One" (id: m1): autograd deep dive',
    );
    expect(body.refinements).toEqual([
      { role: 'user', content: 'Add a new module: advanced indexing module' },
    ]);

    // The new lesson appears under m1 with data-new highlight.
    const newLesson = await screen.findByTestId('extend-lesson-m1-l-new');
    expect(newLesson.getAttribute('data-new')).toBe('true');
    expect(newLesson.style.borderLeftWidth).toBe('3px');
    // The previously added module remains highlighted (accumulation).
    expect(
      screen.getByTestId('extend-module-m3').getAttribute('data-new'),
    ).toBe('true');
  });

  it('409 busy: shows toast, closes dialog, does not mutate currentProposed or additions', async () => {
    const fetchMock = mockFetchOnce(
      { error: 'busy', message: 'Cannot extend while generation is active' },
      409,
    );
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-textarea'), {
      target: { value: 'whatever' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-dialog-add'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('extend-dialog')).toBeNull();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const toast = await screen.findByTestId('extend-toast');
    expect(toast.textContent).toBe(
      'Cannot extend while generation is active.',
    );

    // No state mutation — original modules are present and no new highlight.
    expect(screen.getByTestId('extend-module-m1')).toBeTruthy();
    expect(screen.getByTestId('extend-module-m2')).toBeTruthy();
    expect(screen.queryByTestId('extend-module-m3')).toBeNull();
    expect(
      screen.getByTestId('extend-module-m1').getAttribute('data-new'),
    ).toBeNull();
  });

  it('422 unparseable: shows toast, dialog stays open with textarea preserved', async () => {
    const fetchMock = mockFetchOnce(
      { error: 'agent-output-invalid', message: 'parse error' },
      422,
    );
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-module'));
    const textarea = screen.getByTestId(
      'extend-dialog-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'something to add' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-dialog-add'));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Dialog stays open + textarea preserved.
    const dialog = await screen.findByTestId('extend-dialog');
    expect(dialog).toBeTruthy();
    expect(
      (screen.getByTestId('extend-dialog-textarea') as HTMLTextAreaElement)
        .value,
    ).toBe('something to add');

    const toast = await screen.findByTestId('extend-toast');
    expect(toast.textContent).toBe("Couldn't add — please rephrase.");
  });

  it('Reset proposal: restores original tree and clears highlights', async () => {
    const response = buildExtendResponseWithNewModule();
    mockFetchOnce(response);
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-textarea'), {
      target: { value: 'advanced indexing module' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-dialog-add'));
    });
    await screen.findByTestId('extend-module-m3');

    // Reset proposal.
    fireEvent.click(screen.getByTestId('extend-reset'));
    await waitFor(() => {
      expect(screen.queryByTestId('extend-module-m3')).toBeNull();
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByTestId('extend-module-m1')).toBeTruthy();
    expect(screen.getByTestId('extend-module-m2')).toBeTruthy();
  });

  it('Add button stays disabled when textarea is empty / whitespace only', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));
    const add = screen.getByTestId('extend-dialog-add') as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    const textarea = screen.getByTestId(
      'extend-dialog-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(add.disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: 'real instruction' } });
    expect(add.disabled).toBe(false);
  });

  it('Cancel closes the dialog without sending a request', () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));
    const textarea = screen.getByTestId(
      'extend-dialog-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('extend-dialog-cancel'));

    expect(screen.queryByTestId('extend-dialog')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Extend wizard Generate additions + progress view (US-172)', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('Generate additions is enabled after one addition and POSTs to /extend/apply with the current proposedSchema', async () => {
    const extendResp = buildExtendResponseWithNewModule();
    const applyResp = {
      enqueuedLessonSlugs: ['m3-l1'],
    };

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        // First call: POST /extend (Add module)
        ok: true,
        status: 200,
        json: () => Promise.resolve(extendResp),
      })
      .mockResolvedValueOnce({
        // Second call: POST /extend/apply
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

    // Add a module.
    fireEvent.click(screen.getByTestId('extend-add-module'));
    fireEvent.change(screen.getByTestId('extend-dialog-textarea'), {
      target: { value: 'advanced indexing module' },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('extend-dialog-add'));
    });
    await screen.findByTestId('extend-module-m3');

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

    // Find the apply call.
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
    // The proposed schema includes the new module.
    expect(applyBody.proposedSchema.modules.find((m) => m.id === 'm3')).toBeTruthy();

    // Progress view rendered, schema tree replaced.
    expect(screen.queryByTestId('extend-tree')).toBeNull();
    expect(screen.getByTestId('extend-progress-lesson-m3-l1')).toBeTruthy();
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
