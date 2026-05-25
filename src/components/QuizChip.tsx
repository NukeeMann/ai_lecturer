// US-193 — small "Quiz" pill rendered on courses whose `course.tags`
// includes `'quiz'`. Used by the dashboard CourseCard header and the
// Continue-learning resume banner so quiz-only courses are visually
// distinguishable from full theory+practice courses at a glance.
//
// Styling uses the existing `--widget-quiz` token from src/styles/tokens.css
// so the chip auto-tracks every theme variant (light, dark, sunset, +
// accent overrides). The token's foreground colour is paired with a
// 14%-tinted background of the same colour for legibility against
// `--bg-elevated`, plus a 1px border so the chip is still visible on
// elevated surfaces that share the chip's mid-light hues.

export function QuizChip() {
  return (
    <span
      data-testid="course-card-quiz-badge"
      aria-label="Quiz-only course"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontSize: '10.5px',
        fontWeight: 600,
        letterSpacing: '0.02em',
        padding: '2px 6px',
        borderRadius: 'var(--radius-full)',
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: 'var(--widget-quiz)',
        background:
          'color-mix(in srgb, var(--widget-quiz) 14%, transparent)',
        color: 'var(--widget-quiz)',
        lineHeight: 1.2,
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      Quiz
    </span>
  );
}

export function CourseQuizChip({ tags }: { tags?: readonly string[] }) {
  if (!tags?.includes('quiz')) return null;
  return <QuizChip />;
}
