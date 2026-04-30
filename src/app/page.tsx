'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  type LucideProps,
  Plus,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';

import { ThemeToggle } from '@/components/ThemeToggle';
import type { Course, AccentColor } from '@/lib/schemas/course';
import type { Progress } from '@/lib/schemas/progress';

// ------- accent palette (per course.accentColor) ------------------------------
// Keyed values come from src/styles/tokens.css. We intentionally hardcode hexes
// (rather than pulling from CSS vars at runtime) so each course card can show
// its own distinct color regardless of the global :root[data-accent=…] setting.
const accentPalette: Record<AccentColor, { color: string; bg: string }> = {
  default: { color: '#2563eb', bg: 'color-mix(in srgb, #2563eb 14%, var(--bg-subtle))' },
  indigo: { color: '#5b5bd6', bg: 'color-mix(in srgb, #5b5bd6 14%, var(--bg-subtle))' },
  emerald: { color: '#0d7a5f', bg: 'color-mix(in srgb, #0d7a5f 14%, var(--bg-subtle))' },
  terracotta: { color: '#d97757', bg: 'color-mix(in srgb, #d97757 16%, var(--bg-subtle))' },
  black: { color: '#18171a', bg: 'color-mix(in srgb, #18171a 10%, var(--bg-subtle))' },
};

const STARTER_TOPICS = [
  'Linear algebra basics',
  'How transformers work',
  'Computer vision basics',
  'Bayesian statistics',
] as const;

// ------- helpers --------------------------------------------------------------

interface CourseStats {
  total: number;
  finished: number;
  started: number;
}

function statsFor(course: Course, progress: Progress | null): CourseStats {
  const total = course.modules.reduce((acc, m) => acc + m.lessons.length, 0);
  const courseProgress = progress?.courses?.[course.slug];
  if (!courseProgress) return { total, finished: 0, started: 0 };
  let finished = 0;
  let started = 0;
  for (const lesson of Object.values(courseProgress.lessons ?? {})) {
    if (lesson.status === 'finished') finished += 1;
    else if (lesson.status === 'started') started += 1;
  }
  return { total, finished, started };
}

interface ResumeTarget {
  course: Course;
  lessonSlug: string;
  lessonTitle: string;
  lastVisitedAt: string;
}

function pickResumeTarget(courses: Course[], progress: Progress | null): ResumeTarget | null {
  if (!progress) return null;
  let best: ResumeTarget | null = null;
  for (const course of courses) {
    const cp = progress.courses?.[course.slug];
    if (!cp?.lastVisitedAt || !cp.lastVisitedLessonSlug) continue;
    const lessonRef = course.modules
      .flatMap((m) => m.lessons)
      .find((l) => l.slug === cp.lastVisitedLessonSlug);
    if (!lessonRef) continue;
    if (!best || cp.lastVisitedAt > best.lastVisitedAt) {
      best = {
        course,
        lessonSlug: lessonRef.slug,
        lessonTitle: lessonRef.title,
        lastVisitedAt: cp.lastVisitedAt,
      };
    }
  }
  return best;
}

// ------- styles ---------------------------------------------------------------

const pageStyle: CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text)',
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: 'var(--font-sans)',
};

const headerStyle: CSSProperties = {
  height: 64,
  flexShrink: 0,
  display: 'grid',
  gridTemplateColumns: '1fr minmax(220px, 420px) 1fr',
  alignItems: 'center',
  gap: 'var(--space-5)',
  padding: '0 var(--space-6)',
  borderBottom: '1px solid var(--border)',
  background: 'var(--bg-elevated)',
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const logoStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

const headerLeftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
};

const headerNameStyle: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
};

const headerSearchWrapStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
};

const headerSearchInputStyle: CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px 0 34px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-subtle)',
  color: 'var(--text)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  outline: 'none',
};

const headerRightStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
};

const headerIconBtnStyle: CSSProperties = {
  width: 32,
  height: 32,
  border: 'none',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  borderRadius: 'var(--radius-md)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
};

const avatarStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  background: 'var(--accent-subtle)',
  color: 'var(--accent-text)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  marginLeft: 4,
};

const contentWrapStyle: CSSProperties = {
  maxWidth: 1080,
  width: '100%',
  margin: '0 auto',
  padding: 'var(--space-7) var(--space-6)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-7)',
};

const topRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 'var(--space-4)',
};

const pageTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-xl)',
  fontWeight: 600,
  letterSpacing: '-0.02em',
  fontFamily: 'var(--font-display)',
};

const pageSubtitleStyle: CSSProperties = {
  margin: '4px 0 0',
  color: 'var(--text-tertiary)',
  fontSize: 'var(--fs-sm)',
};

const primaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 16px',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  cursor: 'pointer',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

// ------- subcomponents --------------------------------------------------------

const knownIconNames = new Set<string>(iconNames as readonly string[]);

function AccentIcon({
  iconName,
  accent,
  size = 36,
  glyphSize = 18,
}: {
  iconName: string;
  accent: AccentColor;
  size?: number;
  glyphSize?: number;
}) {
  const palette = accentPalette[accent] ?? accentPalette.default;
  const safeName = knownIconNames.has(iconName) ? (iconName as IconName) : null;
  return (
    <div
      data-accent-icon
      data-accent={accent}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: palette.bg,
        color: palette.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {safeName ? (
        <DynamicIcon
          name={safeName}
          size={glyphSize}
          strokeWidth={2}
          fallback={() => <BookOpen size={glyphSize} strokeWidth={2} />}
        />
      ) : (
        <BookOpen size={glyphSize} strokeWidth={2} />
      )}
    </div>
  );
}

function ContinueLearningHero({ resume }: { resume: ResumeTarget }) {
  const palette = accentPalette[resume.course.accentColor] ?? accentPalette.default;
  return (
    <section
      data-testid="continue-hero"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-6)',
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        alignItems: 'center',
        gap: 'var(--space-6)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -60,
          top: -60,
          width: 240,
          height: 240,
          background: `radial-gradient(circle, ${palette.bg} 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-5)',
          minWidth: 0,
        }}
      >
        <AccentIcon
          iconName={resume.course.icon}
          accent={resume.course.accentColor}
          size={56}
          glyphSize={26}
        />
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: '10.5px',
              color: 'var(--accent-text)',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              fontWeight: 600,
              marginBottom: 6,
            }}
          >
            Continue learning
          </div>
          <div
            style={{
              fontSize: 'var(--fs-sm)',
              color: 'var(--text-tertiary)',
              marginBottom: 4,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {resume.course.title}
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: 'var(--fs-2xl)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              fontFamily: 'var(--font-display)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {resume.lessonTitle}
          </h2>
        </div>
      </div>
      <Link
        data-testid="continue-hero-resume"
        href={`/courses/${resume.course.slug}/lessons/${resume.lessonSlug}`}
        style={{
          ...primaryButtonStyle,
          height: 44,
          padding: '0 22px',
          fontSize: 'var(--fs-md)',
        }}
      >
        Resume
        <ArrowRight size={16} strokeWidth={2} />
      </Link>
    </section>
  );
}

function StatusBadge({ stats }: { stats: CourseStats }) {
  const { total, finished, started } = stats;
  let label: string;
  let bg: string;
  let color: string;
  let border: string;
  if (total > 0 && finished === total) {
    label = 'Completed';
    bg = 'var(--success-subtle)';
    color = 'var(--success)';
    border = 'var(--success-border)';
  } else if (finished === 0 && started === 0) {
    label = 'New';
    bg = 'var(--bg-subtle)';
    color = 'var(--text-tertiary)';
    border = 'var(--border)';
  } else {
    label = `In progress · ${finished}/${total}`;
    bg = 'var(--accent-subtle)';
    color = 'var(--accent-text)';
    border = 'var(--accent-border)';
  }
  return (
    <span
      data-testid="course-card-status"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        height: 20,
        padding: '0 8px',
        borderRadius: 'var(--radius-full)',
        fontSize: '11px',
        fontWeight: 500,
        background: bg,
        color,
        border: `1px solid ${border}`,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function cardHref(course: Course, progress: Progress | null): string {
  const cp = progress?.courses?.[course.slug];
  const firstLesson = course.modules.flatMap((m) => m.lessons)[0]?.slug;
  const target = cp?.lastVisitedLessonSlug ?? firstLesson;
  if (!target) return `/courses/${course.slug}`;
  return `/courses/${course.slug}/lessons/${target}`;
}

function CourseCard({
  course,
  stats,
  href,
}: {
  course: Course;
  stats: CourseStats;
  href: string;
}) {
  const [hover, setHover] = useState(false);
  const completion = stats.total === 0 ? 0 : Math.round((stats.finished / stats.total) * 100);
  return (
    <Link
      data-testid="course-card"
      data-course-slug={course.slug}
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
        background: 'var(--bg-elevated)',
        border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        boxShadow: hover ? 'var(--shadow-sm)' : 'none',
        textDecoration: 'none',
        color: 'inherit',
        cursor: 'pointer',
        transition:
          'border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast)',
        transform: hover ? 'translateY(-1px)' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <AccentIcon iconName={course.icon} accent={course.accentColor} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3
            style={{
              margin: 0,
              fontSize: 'var(--fs-lg)',
              fontWeight: 600,
              letterSpacing: '-0.01em',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {course.title}
          </h3>
        </div>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 'var(--fs-sm)',
          color: 'var(--text-tertiary)',
          lineHeight: 1.5,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {course.description}
      </p>
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <StatusBadge stats={stats} />
      </div>
      <div
        aria-hidden
        style={{
          height: 4,
          width: '100%',
          background: 'var(--bg-subtle)',
          borderRadius: 'var(--radius-full)',
          overflow: 'hidden',
        }}
      >
        <div
          data-testid="course-card-progress"
          data-progress={completion}
          style={{
            width: `${completion}%`,
            height: '100%',
            background:
              completion === 100 ? 'var(--success)' : 'var(--accent)',
            transition: 'width var(--t-base)',
          }}
        />
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div
      data-testid="dashboard-empty"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-9) var(--space-6)',
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
      }}
    >
      <div
        aria-hidden
        style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--accent-subtle)',
          color: 'var(--accent-text)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Sparkles size={24} strokeWidth={2} />
      </div>
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 'var(--fs-2xl)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            fontFamily: 'var(--font-display)',
          }}
        >
          Create your first course
        </h2>
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-sm)',
            maxWidth: 480,
          }}
        >
          Pick a topic — agents draft modules, lessons, and exercises tailored to it.
          Edit anything before learning starts.
        </p>
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 'var(--space-2)',
          justifyContent: 'center',
          marginTop: 'var(--space-3)',
        }}
      >
        {STARTER_TOPICS.map((topic) => (
          <Link
            key={topic}
            data-testid="starter-topic-chip"
            href={`/create?topic=${encodeURIComponent(topic)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 14px',
              borderRadius: 'var(--radius-full)',
              background: 'var(--bg-subtle)',
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--fs-sm)',
              fontFamily: 'inherit',
              textDecoration: 'none',
              cursor: 'pointer',
              transition: 'border-color var(--t-fast), color var(--t-fast)',
            }}
          >
            {topic}
          </Link>
        ))}
      </div>
      <Link
        data-testid="empty-create-cta"
        href="/create"
        style={{
          ...primaryButtonStyle,
          marginTop: 'var(--space-3)',
        }}
      >
        <Plus size={16} strokeWidth={2} />
        Nowy kurs
      </Link>
    </div>
  );
}

function LogoMark(props: LucideProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M2 4h6M2 8h12M2 12h8" />
    </svg>
  );
}

// ------- main page ------------------------------------------------------------

export default function DashboardPage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [coursesRes, progressRes] = await Promise.all([
        fetch('/api/courses', { cache: 'no-store' }),
        fetch('/api/progress', { cache: 'no-store' }),
      ]);
      if (!coursesRes.ok) throw new Error(`GET /api/courses → ${coursesRes.status}`);
      if (!progressRes.ok) throw new Error(`GET /api/progress → ${progressRes.status}`);
      const coursesJson = (await coursesRes.json()) as Course[];
      const progressJson = (await progressRes.json()) as Progress;
      setCourses(coursesJson);
      setProgress(progressJson);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // setState calls only fire after the async fetch resolves (i.e. as a
    // subscriber callback), not synchronously inside the effect body — the
    // lint rule can't see that through the `void loadData()` call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadData();
    const onFocus = () => void loadData();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadData]);

  const resume = useMemo(
    () => (courses && progress ? pickResumeTarget(courses, progress) : null),
    [courses, progress],
  );

  const enriched = useMemo(() => {
    if (!courses) return [];
    return courses.map((c) => ({
      course: c,
      stats: statsFor(c, progress),
      href: cardHref(c, progress),
    }));
  }, [courses, progress]);

  return (
    <div style={pageStyle}>
      <header data-testid="dashboard-header" style={headerStyle}>
        <div style={headerLeftStyle}>
          <div style={logoStyle} aria-hidden>
            <LogoMark />
          </div>
          <span style={headerNameStyle}>AI Lecturer</span>
        </div>
        <div style={headerSearchWrapStyle}>
          <Search
            size={14}
            strokeWidth={2}
            style={{
              position: 'absolute',
              left: 12,
              color: 'var(--text-tertiary)',
              pointerEvents: 'none',
            }}
          />
          <input
            type="search"
            placeholder="Search courses, lessons…"
            style={headerSearchInputStyle}
            aria-label="Search (decorative)"
          />
        </div>
        <div style={headerRightStyle}>
          <button type="button" aria-label="Settings" style={headerIconBtnStyle}>
            <Settings size={16} strokeWidth={2} />
          </button>
          <ThemeToggle />
          <div style={avatarStyle} aria-label="Account">
            U
          </div>
        </div>
      </header>

      <main style={contentWrapStyle}>
        {error && (
          <div
            role="alert"
            style={{
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--danger-subtle)',
              border: '1px solid var(--danger-border)',
              color: 'var(--danger)',
              fontSize: 'var(--fs-sm)',
            }}
          >
            Failed to load: {error}
          </div>
        )}

        {resume && <ContinueLearningHero resume={resume} />}

        <div style={topRowStyle}>
          <div>
            <h1 style={pageTitleStyle}>My courses</h1>
            <p style={pageSubtitleStyle}>
              {courses === null
                ? 'Loading…'
                : courses.length === 0
                  ? 'No courses yet — create one to get started.'
                  : `${courses.length} course${courses.length === 1 ? '' : 's'}`}
            </p>
          </div>
          {courses && courses.length > 0 && (
            <Link
              data-testid="new-course-cta"
              href="/create"
              style={primaryButtonStyle}
            >
              <Plus size={16} strokeWidth={2} />
              Nowy kurs
            </Link>
          )}
        </div>

        {courses === null ? null : courses.length === 0 ? (
          <EmptyState />
        ) : (
          <div
            data-testid="course-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
              gap: 'var(--space-5)',
            }}
          >
            {enriched.map(({ course, stats, href }) => (
              <CourseCard key={course.slug} course={course} stats={stats} href={href} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
