// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { CourseQuizChip } from './QuizChip';

afterEach(() => {
  cleanup();
});

describe('CourseQuizChip — US-193 dashboard quiz badge', () => {
  it("renders the chip when course.tags includes 'quiz'", () => {
    render(<CourseQuizChip tags={['quiz']} />);
    expect(
      screen.getByTestId('course-card-quiz-badge'),
    ).toBeTruthy();
    expect(screen.getByText('Quiz')).toBeTruthy();
  });

  it('renders nothing when course has no tags field', () => {
    const { container } = render(<CourseQuizChip />);
    expect(
      container.querySelector('[data-testid="course-card-quiz-badge"]'),
    ).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders nothing when course.tags is empty', () => {
    const { container } = render(<CourseQuizChip tags={[]} />);
    expect(
      container.querySelector('[data-testid="course-card-quiz-badge"]'),
    ).toBeNull();
    expect(container.textContent).toBe('');
  });

  it("renders nothing when tags contains other entries but not 'quiz'", () => {
    const { container } = render(
      <CourseQuizChip tags={['marketing', 'beginner']} />,
    );
    expect(
      container.querySelector('[data-testid="course-card-quiz-badge"]'),
    ).toBeNull();
  });
});
