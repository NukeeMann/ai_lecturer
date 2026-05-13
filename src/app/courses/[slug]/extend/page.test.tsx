// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import type { Course } from '@/lib/schemas/course';
import ExtendWizardClient from './ExtendWizardClient';

afterEach(() => cleanup());

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

describe('Extend wizard page (US-170)', () => {
  it('renders one + Add lesson button per module and exactly one + Add module button', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    expect(screen.getByTestId('extend-add-lesson-m1')).toBeTruthy();
    expect(screen.getByTestId('extend-add-lesson-m2')).toBeTruthy();
    expect(screen.queryAllByTestId(/^extend-add-lesson-/)).toHaveLength(2);
    expect(screen.getByTestId('extend-add-module')).toBeTruthy();
  });

  it('shows the course title in the heading and a disabled Generate additions button', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    expect(screen.getByTestId('extend-page-title').textContent).toBe(
      'Extend "Test Course"',
    );
    const generate = screen.getByTestId('extend-generate') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(generate.getAttribute('title')).toBe(
      'Wire-up coming in next iteration',
    );
  });

  it('+ Add module opens dialog, Add appends a pending-module placeholder, Discard removes it', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-module'));
    const dialog = screen.getByTestId('extend-dialog');
    expect(dialog.getAttribute('data-kind')).toBe('module');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Add a module to "Test Course"',
    );

    const textarea = screen.getByTestId(
      'extend-dialog-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'advanced indexing module' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));

    // Dialog closes; pending module appears.
    expect(screen.queryByTestId('extend-dialog')).toBeNull();
    const pendingModules = screen.queryAllByTestId('extend-pending-module');
    expect(pendingModules).toHaveLength(1);
    expect(pendingModules[0].textContent).toContain('(pending)');
    expect(pendingModules[0].textContent).toContain(
      'advanced indexing module',
    );

    // Discard removes it.
    fireEvent.click(screen.getAllByTestId('extend-discard')[0]);
    expect(screen.queryAllByTestId('extend-pending-module')).toHaveLength(0);
  });

  it('+ Add lesson under a specific module attaches the pending lesson to that module', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);

    fireEvent.click(screen.getByTestId('extend-add-lesson-m2'));
    const dialog = screen.getByTestId('extend-dialog');
    expect(dialog.getAttribute('data-kind')).toBe('lesson');
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(
      'Add a lesson to "Module Two"',
    );

    const textarea = screen.getByTestId(
      'extend-dialog-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'autograd deep dive' },
    });
    fireEvent.click(screen.getByTestId('extend-dialog-add'));

    const pendingLessons = screen.queryAllByTestId('extend-pending-lesson');
    expect(pendingLessons).toHaveLength(1);
    expect(pendingLessons[0].getAttribute('data-module-id')).toBe('m2');
    expect(pendingLessons[0].textContent).toContain('autograd deep dive');

    // Discard removes it.
    fireEvent.click(screen.getAllByTestId('extend-discard')[0]);
    expect(screen.queryAllByTestId('extend-pending-lesson')).toHaveLength(0);
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

  it('Cancel closes the dialog without appending', () => {
    render(<ExtendWizardClient course={TEST_COURSE} />);
    fireEvent.click(screen.getByTestId('extend-add-module'));
    const textarea = screen.getByTestId(
      'extend-dialog-textarea',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'nope' } });
    fireEvent.click(screen.getByTestId('extend-dialog-cancel'));

    expect(screen.queryByTestId('extend-dialog')).toBeNull();
    expect(screen.queryAllByTestId('extend-pending-module')).toHaveLength(0);
  });
});
