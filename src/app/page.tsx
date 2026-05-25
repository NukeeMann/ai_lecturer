'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  Check,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Upload,
} from 'lucide-react';
import { DynamicIcon, iconNames, type IconName } from 'lucide-react/dynamic';

import { AppLogoLink } from '@/components/AppLogo';
import { AvatarMenu } from '@/components/AvatarMenu';
import { ThemeToggle } from '@/components/ThemeToggle';
import { SettingsMenu, applyAccent } from '@/components/SettingsMenu';
import { CourseQuizChip } from '@/components/QuizChip';
import { ResumeGenerationBanners } from '@/components/ResumeGenerationBanner';
import type { Course, AccentColor } from '@/lib/schemas/course';
import type { Progress } from '@/lib/schemas/progress';
import type { Collection } from '@/lib/schemas/collection';
import { allCoursesComplete, searchEnterTarget } from '@/lib/dashboard';
import { strings } from '@/lib/i18n/strings';

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

// US-133 — first-run seed. These slugs name the bundled widget-demo courses;
// on a fresh dashboard they get tucked into a "Widget Demos" collection so the
// real courses sit at the top of the list. Once the seed has run (or has been
// deliberately skipped), the localStorage flag below prevents it ever
// running again, including after the user deletes the collection.
const DEMO_COURSE_SLUGS: ReadonlySet<string> = new Set([
  'cloze-test',
  'datatable-test',
  'dragmatch-test',
  'gauss-basics',
  'histogram-test',
  'image-test',
  'pexp-test',
  'plotimage-test',
  'quiz-test',
  'smoke-test',
  'theory-test',
  'tts-stt-test',
  'video-test',
  'widget-dev-guide',
]);
const SEED_FLAG_KEY = 'aiLecturer.collectionsSeeded';

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

const headerLeftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minWidth: 0,
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
  flexWrap: 'wrap',
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

const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 16px',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-subtle)',
  color: 'var(--text)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  cursor: 'pointer',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
};

const courseGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
  gap: 'var(--space-5)',
};

const sectionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
};

const sectionHeaderRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-3)',
};

const sectionHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: 'var(--fs-lg)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
  fontFamily: 'var(--font-display)',
};

const iconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  padding: 0,
};

// Bare three-dots overflow trigger — no border, no background. Used in the
// upper-right of each course card so the dots blend visually with the card
// rather than reading as a separate boxed control.
const cardOverflowButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  padding: 0,
};

const popoverStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 5,
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  boxShadow: 'var(--shadow-md)',
  padding: 'var(--space-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 180,
};

const popoverItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 32,
  padding: '0 10px',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  background: 'transparent',
  color: 'var(--text)',
  fontSize: 'var(--fs-sm)',
  fontFamily: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  whiteSpace: 'nowrap',
};

const popoverSectionLabelStyle: CSSProperties = {
  padding: '6px 10px 2px',
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-tertiary)',
};

const popoverDividerStyle: CSSProperties = {
  height: 1,
  margin: '4px 0',
  background: 'var(--border)',
};

// US-161 — invisible same-width slot for non-selected move-target menu items.
// The selected entry renders a 14×14 lucide `Check` glyph; non-selected entries
// reserve the identical 14px column so the menu's text column doesn't jitter
// horizontally as the user opens the menu on different cards.
const moveTargetCheckSlotStyle: CSSProperties = {
  display: 'inline-block',
  width: 14,
  height: 14,
  flexShrink: 0,
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
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
              marginBottom: 4,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: 'var(--fs-sm)',
                color: 'var(--text-tertiary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {resume.course.title}
            </span>
            <CourseQuizChip tags={resume.course.tags} />
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
          // Without an explicit position, the static button paints below its
          // absolutely-positioned radial-gradient overlay sibling and the
          // overlay covers the right edge of the label. Joining the
          // positioned painting tier puts the button on top via tree order.
          position: 'relative',
        }}
      >
        Resume
        <ArrowRight size={16} strokeWidth={2} />
      </Link>
    </section>
  );
}

function CreateNewCourseHero() {
  const router = useRouter();
  const [idea, setIdea] = useState('');

  const submit = () => {
    const trimmed = idea.trim();
    if (trimmed.length === 0) {
      router.push('/create');
    } else {
      router.push(`/create?idea=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <section
      data-testid="all-complete-hero"
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        padding: 'var(--space-7) var(--space-6)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 'var(--space-4)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          right: -80,
          top: -80,
          width: 280,
          height: 280,
          background:
            'radial-gradient(circle, var(--accent-subtle) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
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
          position: 'relative',
        }}
      >
        <Sparkles size={24} strokeWidth={2} />
      </div>
      <div style={{ position: 'relative' }}>
        <h2
          data-testid="all-complete-heading"
          style={{
            margin: 0,
            fontSize: 'var(--fs-2xl)',
            fontWeight: 600,
            letterSpacing: '-0.02em',
            fontFamily: 'var(--font-display)',
          }}
        >
          What do you want to learn next?
        </h2>
        <p
          style={{
            margin: '8px 0 0',
            color: 'var(--text-tertiary)',
            fontSize: 'var(--fs-sm)',
            maxWidth: 520,
          }}
        >
          You finished every lesson. Tell us a topic and we&apos;ll spin up a
          fresh course.
        </p>
      </div>
      <form
        data-testid="all-complete-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 560,
          display: 'flex',
          gap: 8,
        }}
      >
        <input
          type="text"
          data-testid="all-complete-input"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="e.g. How transformers work"
          aria-label="Course idea"
          style={{
            flex: 1,
            height: 44,
            padding: '0 14px',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--bg)',
            color: 'var(--text)',
            fontSize: 'var(--fs-md)',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          data-testid="all-complete-submit"
          style={{
            ...primaryButtonStyle,
            height: 44,
            padding: '0 22px',
            fontSize: 'var(--fs-md)',
          }}
        >
          <Sparkles size={16} strokeWidth={2} />
          Create course
        </button>
      </form>
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

function AutoFitTitle({
  text,
  maxFontSize,
  minFontSize = 11,
  style,
}: {
  text: string;
  maxFontSize: number;
  minFontSize?: number;
  style?: CSSProperties;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      let size = maxFontSize;
      el.style.fontSize = `${size}px`;
      // shrink until it fits on one line (scrollWidth fits in clientWidth)
      while (el.scrollWidth > el.clientWidth + 0.5 && size > minFontSize) {
        size -= 0.5;
        el.style.fontSize = `${size}px`;
      }
      setFontSize(size);
    };
    fit();
    const target = el.parentElement ?? el;
    const ro = new ResizeObserver(fit);
    ro.observe(target);
    return () => ro.disconnect();
  }, [text, maxFontSize, minFontSize]);

  return (
    <h3
      ref={ref}
      style={{
        ...style,
        fontSize: `${fontSize}px`,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {text}
    </h3>
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
  dimmed = false,
  fading = false,
}: {
  course: Course;
  stats: CourseStats;
  href: string;
  dimmed?: boolean;
  fading?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const completion = stats.total === 0 ? 0 : Math.round((stats.finished / stats.total) * 100);
  const linkStyle: CSSProperties = {
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
    cursor: dimmed ? 'wait' : 'pointer',
    transition:
      'border-color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast), opacity 200ms',
    transform: hover && !dimmed ? 'translateY(-1px)' : 'none',
    opacity: fading ? 0 : dimmed ? 0.55 : 1,
    pointerEvents: dimmed ? 'none' : 'auto',
  };
  return (
    <Link
      data-testid="course-card"
      data-course-slug={course.slug}
      href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      aria-busy={dimmed || undefined}
      style={linkStyle}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <AccentIcon iconName={course.icon} accent={course.accentColor} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              flexWrap: 'wrap',
            }}
          >
            <AutoFitTitle
              text={course.title}
              maxFontSize={18}
              minFontSize={11}
              style={{
                margin: 0,
                fontWeight: 600,
                letterSpacing: '-0.01em',
                lineHeight: 1.3,
                minWidth: 0,
                flex: 1,
              }}
            />
          </div>
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
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <StatusBadge stats={stats} />
        <CourseQuizChip tags={course.tags} />
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

// US-142: per-course three-dots overflow menu in the upper-right corner of
// each card. Single horizontal-dots trigger that bundles every per-card
// action (Extend, Export ZIP/HTML, Move-to-collection, Delete) so users see
// only one control. The trigger is bare (no border/background) and lives at
// the default stacking level so the header's SettingsMenu dropdown can
// render above it.
function CourseCardWithMenu({
  course,
  stats,
  href,
  collections,
  sourceCollectionId,
  menuOpen,
  onToggleMenu,
  onCloseMenu,
  onRequestDelete,
  onRequestExportZip,
  onRequestExportHtml,
  onRequestExtend,
  onPickMoveTarget,
  dimmed,
  fading,
}: {
  course: Course;
  stats: CourseStats;
  href: string;
  collections: Collection[];
  sourceCollectionId: string | null;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
  onRequestDelete: () => void;
  onRequestExportZip: () => void;
  onRequestExportHtml: () => void;
  onRequestExtend: () => void;
  onPickMoveTarget: (targetId: string | null) => void;
  dimmed: boolean;
  fading: boolean;
}) {
  return (
    <div data-popover-host style={{ position: 'relative' }}>
      <CourseCard course={course} stats={stats} href={href} dimmed={dimmed} fading={fading} />
      <button
        type="button"
        data-testid={`course-menu-btn-${course.slug}`}
        aria-label={`Course actions for ${course.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={dimmed}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggleMenu();
        }}
        style={{
          ...cardOverflowButtonStyle,
          position: 'absolute',
          top: 10,
          right: 10,
        }}
      >
        <MoreHorizontal size={16} strokeWidth={2} />
      </button>
      {menuOpen && (
        <div
          role="menu"
          data-testid={`course-menu-${course.slug}`}
          style={{ ...popoverStyle, top: 40, right: 10 }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid={`course-menu-extend-${course.slug}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCloseMenu();
              onRequestExtend();
            }}
            style={popoverItemStyle}
          >
            Extend
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid={`course-menu-export-zip-${course.slug}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCloseMenu();
              onRequestExportZip();
            }}
            style={popoverItemStyle}
          >
            Export as ZIP
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid={`course-menu-export-html-${course.slug}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCloseMenu();
              onRequestExportHtml();
            }}
            style={popoverItemStyle}
          >
            Export as static HTML
          </button>
          <div role="separator" style={popoverDividerStyle} />
          <div role="presentation" style={popoverSectionLabelStyle}>
            Collection
          </div>
          <button
            type="button"
            role="menuitem"
            data-testid={`move-target-uncategorized-${course.slug}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCloseMenu();
              onPickMoveTarget(null);
            }}
            style={{ ...popoverItemStyle, color: 'var(--text-tertiary)' }}
            disabled={sourceCollectionId === null}
          >
            {sourceCollectionId === null ? (
              <Check size={14} strokeWidth={2} aria-hidden />
            ) : (
              <span aria-hidden style={moveTargetCheckSlotStyle} />
            )}
            None
          </button>
          {collections.map((c) => (
            <button
              key={c.id}
              type="button"
              role="menuitem"
              data-testid={`move-target-${c.id}-${course.slug}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCloseMenu();
                onPickMoveTarget(c.id);
              }}
              style={popoverItemStyle}
              disabled={sourceCollectionId === c.id}
            >
              {sourceCollectionId === c.id ? (
                <Check size={14} strokeWidth={2} aria-hidden />
              ) : (
                <span aria-hidden style={moveTargetCheckSlotStyle} />
              )}
              {c.name}
            </button>
          ))}
          <div role="separator" style={popoverDividerStyle} />
          <button
            type="button"
            role="menuitem"
            data-testid={`course-menu-delete-${course.slug}`}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCloseMenu();
              onRequestDelete();
            }}
            style={{ ...popoverItemStyle, color: 'var(--danger)' }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function CollectionSection({
  title,
  collectionId,
  items,
  collections,
  sourceCollectionId,
  collection,
  actionsOpen,
  onToggleActions,
  onRename,
  onDelete,
  onPickMoveTarget,
  menuOpenSlug,
  onToggleMenu,
  onCloseMenu,
  onRequestDelete,
  onRequestExportZip,
  onRequestExportHtml,
  onRequestExtend,
  deletingSlug,
  fadingSlug,
}: {
  title: string;
  collectionId: string;
  items: Array<{ course: Course; stats: CourseStats; href: string }>;
  collections: Collection[];
  sourceCollectionId: string | null;
  collection: Collection | null;
  actionsOpen: boolean;
  onToggleActions: () => void;
  onRename: () => void;
  onDelete: () => void;
  onPickMoveTarget: (slug: string, targetId: string | null) => void;
  menuOpenSlug: string | null;
  onToggleMenu: (slug: string) => void;
  onCloseMenu: () => void;
  onRequestDelete: (course: Course) => void;
  onRequestExportZip: (course: Course) => void;
  onRequestExportHtml: (course: Course) => void;
  onRequestExtend: (course: Course) => void;
  deletingSlug: string | null;
  fadingSlug: string | null;
}) {
  return (
    <section
      data-testid="course-section"
      data-collection-id={collectionId}
      style={sectionStyle}
    >
      {collection && (
        <div style={sectionHeaderRowStyle}>
          <h2 style={sectionHeadingStyle}>{title}</h2>
          <div data-popover-host style={{ position: 'relative' }}>
            <button
              type="button"
              data-testid={`collection-actions-${collection.id}`}
              aria-label={`Actions for ${collection.name}`}
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              onClick={onToggleActions}
              style={iconButtonStyle}
            >
              <MoreHorizontal size={16} strokeWidth={2} />
            </button>
            {actionsOpen && (
              <div
                role="menu"
                style={{ ...popoverStyle, top: 36, right: 0 }}
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`collection-rename-${collection.id}`}
                  onClick={onRename}
                  style={popoverItemStyle}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`collection-delete-${collection.id}`}
                  onClick={onDelete}
                  style={{ ...popoverItemStyle, color: 'var(--danger)' }}
                >
                  Delete
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      <div style={courseGridStyle}>
        {items.map(({ course, stats, href }) => (
          <CourseCardWithMenu
            key={course.slug}
            course={course}
            stats={stats}
            href={href}
            collections={collections}
            sourceCollectionId={sourceCollectionId}
            menuOpen={menuOpenSlug === course.slug}
            onToggleMenu={() => onToggleMenu(course.slug)}
            onCloseMenu={onCloseMenu}
            onRequestDelete={() => onRequestDelete(course)}
            onRequestExportZip={() => onRequestExportZip(course)}
            onRequestExportHtml={() => onRequestExportHtml(course)}
            onRequestExtend={() => onRequestExtend(course)}
            onPickMoveTarget={(targetId) => onPickMoveTarget(course.slug, targetId)}
            dimmed={deletingSlug === course.slug}
            fading={fadingSlug === course.slug}
          />
        ))}
      </div>
    </section>
  );
}

// US-151 — drag-and-drop import card. Always rendered as the final tile in
// the explorer so users can drop a US-150 export ZIP onto it. The click path
// opens the native file picker (accept=".zip"). The drag-drop path POSTs
// directly to /api/courses/import.
function ImportCourseCard({
  onImported,
  showToast,
}: {
  onImported: () => Promise<void> | void;
  showToast: (message: string, opts?: { href?: string; linkLabel?: string }) => void;
}) {
  const [hover, setHover] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith('.zip')) {
        showToast('Only .zip files are supported.');
        return;
      }
      setLoading(true);
      const fd = new FormData();
      fd.append('file', file);
      let res: Response;
      try {
        res = await fetch('/api/courses/import', { method: 'POST', body: fd });
      } catch (err) {
        setLoading(false);
        showToast(
          `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      if (res.status === 200) {
        let body: { slug?: string; lessonCount?: number; title?: string } = {};
        try {
          body = (await res.json()) as typeof body;
        } catch {
          /* ignore */
        }
        const title = body.title ?? body.slug ?? 'course';
        showToast(`Imported ${title}`);
        await onImported();
        setLoading(false);
        return;
      }
      setLoading(false);
      if (res.status === 409) {
        let body: { existingSlug?: string } = {};
        try {
          body = (await res.json()) as typeof body;
        } catch {
          /* ignore */
        }
        const slug = body.existingSlug ?? '';
        showToast(
          `A course with slug "${slug}" already exists. Delete or rename it first.`,
        );
        return;
      }
      if (res.status === 400) {
        let body: { reason?: string } = {};
        try {
          body = (await res.json()) as typeof body;
        } catch {
          /* ignore */
        }
        showToast(`Invalid course archive: ${body.reason ?? 'unknown'}`);
        return;
      }
      showToast(`Import failed (${res.status})`);
    },
    [onImported, showToast],
  );

  const onPick = () => {
    if (loading) return;
    inputRef.current?.click();
  };

  const baseBg = 'var(--bg-muted, var(--bg-subtle))';
  const dragBg = 'var(--accent-soft, var(--accent-subtle))';
  const borderColor =
    dragOver || hover ? 'var(--accent)' : 'var(--text-tertiary)';
  const borderStyle: CSSProperties['borderStyle'] = dragOver || hover ? 'solid' : 'dashed';
  const opacity = hover && !dragOver ? 0.8 : 1;
  const background = dragOver ? dragBg : baseBg;

  return (
    <div
      data-testid="import-course-card"
      data-drag-over={dragOver || undefined}
      role="button"
      tabIndex={0}
      aria-label="Import course from ZIP"
      aria-busy={loading || undefined}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onPick();
        }
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragEnter={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void handleFile(file);
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-2)',
        background,
        borderWidth: 2,
        borderStyle,
        borderColor,
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-5)',
        cursor: loading ? 'wait' : 'pointer',
        transition:
          'border-color var(--t-fast), background var(--t-fast), opacity var(--t-fast)',
        opacity,
        textAlign: 'center',
        minHeight: 168,
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip"
        data-testid="import-course-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = '';
        }}
      />
      <Upload size={28} strokeWidth={2} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
      <div style={{ fontSize: 'var(--fs-md)', fontWeight: 500, color: 'var(--text)' }}>
        Drop course ZIP here
      </div>
      <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-tertiary)' }}>
        or click to browse
      </div>
    </div>
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
        {strings.dashboard.newCourse}
      </Link>
    </div>
  );
}

// ------- main page ------------------------------------------------------------

export default function DashboardPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionsOpenId, setActionsOpenId] = useState<string | null>(null);
  const [menuOpenSlug, setMenuOpenSlug] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ slug: string; title: string } | null>(null);
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [fadingSlug, setFadingSlug] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    message: string;
    href?: string;
    linkLabel?: string;
  } | null>(null);
  const seedAttempted = useRef(false);

  const loadData = useCallback(async () => {
    try {
      const [coursesRes, progressRes, collectionsRes] = await Promise.all([
        fetch('/api/courses', { cache: 'no-store' }),
        fetch('/api/progress', { cache: 'no-store' }),
        fetch('/api/collections', { cache: 'no-store' }),
      ]);
      if (!coursesRes.ok) throw new Error(`GET /api/courses → ${coursesRes.status}`);
      if (!progressRes.ok) throw new Error(`GET /api/progress → ${progressRes.status}`);
      if (!collectionsRes.ok)
        throw new Error(`GET /api/collections → ${collectionsRes.status}`);
      const coursesJson = (await coursesRes.json()) as Course[];
      const progressJson = (await progressRes.json()) as Progress;
      const collectionsJson = (await collectionsRes.json()) as {
        collections: Collection[];
      };
      setCourses(coursesJson);
      setProgress(progressJson);
      setCollections(collectionsJson.collections);
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

  // Reset the global accent when the dashboard mounts (US-076). The lesson
  // route normally restores 'default' on unmount, but this guards the case
  // where the user lands here directly and an `aiLecturer.accent.<slug>`
  // override was applied by the boot script for a previous course.
  useEffect(() => {
    applyAccent('default');
  }, []);

  // First-run seed: tucks bundled widget-demo courses into a "Widget Demos"
  // collection so a brand-new install isn't dominated by demo material. Once
  // the seed has run (or is determined unnecessary) we set a localStorage
  // flag so that even a later delete + reload won't bring it back — that
  // matches the AC for US-133.
  useEffect(() => {
    if (seedAttempted.current) return;
    if (courses === null || collections === null) return;
    seedAttempted.current = true;

    let alreadySeeded = false;
    try {
      alreadySeeded = window.localStorage.getItem(SEED_FLAG_KEY) === '1';
    } catch {
      // ignore — non-secure contexts, etc.
    }

    if (alreadySeeded) return;

    if (collections.length > 0) {
      try {
        window.localStorage.setItem(SEED_FLAG_KEY, '1');
      } catch {
        // ignore
      }
      return;
    }

    const presentDemos = courses.filter((c) => DEMO_COURSE_SLUGS.has(c.slug));
    if (presentDemos.length === 0) {
      try {
        window.localStorage.setItem(SEED_FLAG_KEY, '1');
      } catch {
        // ignore
      }
      return;
    }

    void (async () => {
      try {
        const createRes = await fetch('/api/collections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Widget Demos' }),
        });
        if (!createRes.ok) return;
        const created = (await createRes.json()) as Collection;
        for (const c of presentDemos) {
          await fetch(`/api/collections/${created.id}/courses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseSlug: c.slug }),
          });
        }
        try {
          window.localStorage.setItem(SEED_FLAG_KEY, '1');
        } catch {
          // ignore
        }
        await loadData();
      } catch {
        // ignore — leaving the flag unset means we'd retry on the next
        // mount, but only while the store is still empty AND demos are
        // still present, so this is intentional.
      }
    })();
  }, [courses, collections, loadData]);

  // Outside-click + Escape closure for the per-collection actions menu and
  // the unified per-card three-dots menu (US-142, merged in May 2026).
  useEffect(() => {
    if (actionsOpenId === null && menuOpenSlug === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActionsOpenId(null);
        setMenuOpenSlug(null);
      }
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-popover-host]')) return;
      setActionsOpenId(null);
      setMenuOpenSlug(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [actionsOpenId, menuOpenSlug]);

  const resume = useMemo(
    () => (courses && progress ? pickResumeTarget(courses, progress) : null),
    [courses, progress],
  );

  const allComplete = useMemo(
    () => (courses ? allCoursesComplete(courses, progress) : false),
    [courses, progress],
  );

  const enriched = useMemo(() => {
    if (!courses) return [];
    const all = courses.map((c) => ({
      course: c,
      stats: statsFor(c, progress),
      href: cardHref(c, progress),
    }));
    const q = searchQuery.trim().toLowerCase();
    if (q.length === 0) return all;
    return all.filter(({ course }) => {
      if (course.title.toLowerCase().includes(q)) return true;
      if (course.description.toLowerCase().includes(q)) return true;
      for (const m of course.modules) {
        if (m.title.toLowerCase().includes(q)) return true;
        for (const l of m.lessons) {
          if (l.title.toLowerCase().includes(q)) return true;
        }
      }
      return false;
    });
  }, [courses, progress, searchQuery]);

  const grouped = useMemo(() => {
    if (!courses || collections === null) return null;
    const enrichedBySlug = new Map(
      courses.map((c) => [
        c.slug,
        { course: c, stats: statsFor(c, progress), href: cardHref(c, progress) },
      ]),
    );
    const slugsInCollections = new Set<string>();
    for (const col of collections) {
      for (const slug of col.courseSlugs) slugsInCollections.add(slug);
    }
    const uncategorized = courses
      .filter((c) => !slugsInCollections.has(c.slug))
      .map((c) => enrichedBySlug.get(c.slug)!)
      .filter(Boolean);
    const collectionSections = collections.map((col) => ({
      collection: col,
      items: col.courseSlugs
        .map((slug) => enrichedBySlug.get(slug))
        .filter((it): it is NonNullable<typeof it> => Boolean(it)),
    }));
    return { uncategorized, collectionSections };
  }, [courses, progress, collections]);

  const handleNewCollection = useCallback(async () => {
    const raw = window.prompt('Name for the new collection');
    if (raw === null) return;
    const name = raw.trim();
    if (name.length === 0) return;
    try {
      const res = await fetch('/api/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return;
    } catch {
      return;
    }
    await loadData();
  }, [loadData]);

  const handleRenameCollection = useCallback(
    async (col: Collection) => {
      setActionsOpenId(null);
      const raw = window.prompt('Rename collection', col.name);
      if (raw === null) return;
      const name = raw.trim();
      if (name.length === 0) return;
      try {
        const res = await fetch(`/api/collections/${col.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        if (!res.ok) return;
      } catch {
        return;
      }
      await loadData();
    },
    [loadData],
  );

  const handleDeleteCollection = useCallback(
    async (col: Collection) => {
      setActionsOpenId(null);
      const ok = window.confirm(`Delete collection "${col.name}"?`);
      if (!ok) return;
      try {
        const res = await fetch(`/api/collections/${col.id}`, { method: 'DELETE' });
        if (!res.ok) return;
      } catch {
        return;
      }
      await loadData();
    },
    [loadData],
  );

  const handleMoveCourse = useCallback(
    async (slug: string, sourceId: string | null, targetId: string | null) => {
      setMenuOpenSlug(null);
      if (sourceId === targetId) return;
      try {
        if (sourceId !== null) {
          await fetch(`/api/collections/${sourceId}/courses`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseSlug: slug }),
          });
        }
        if (targetId !== null) {
          await fetch(`/api/collections/${targetId}/courses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseSlug: slug }),
          });
        }
      } catch {
        return;
      }
      await loadData();
    },
    [loadData],
  );

  const showToast = useCallback(
    (message: string, opts?: { href?: string; linkLabel?: string }) => {
      const next = { message, href: opts?.href, linkLabel: opts?.linkLabel };
      setToast(next);
      setTimeout(() => {
        setToast((cur) => (cur && cur.message === message ? null : cur));
      }, 4500);
    },
    [],
  );

  const handleConfirmDelete = useCallback(async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    setDeletingSlug(target.slug);
    let res: Response;
    try {
      res = await fetch(`/api/courses/${target.slug}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'soft' }),
      });
    } catch (err) {
      setDeletingSlug(null);
      showToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (res.status === 409) {
      setDeletingSlug(null);
      showToast('Cannot delete — generation in progress for this course');
      return;
    }
    if (res.status === 204 || res.status === 404) {
      setDeletingSlug(null);
      setFadingSlug(target.slug);
      setTimeout(() => {
        setFadingSlug((cur) => (cur === target.slug ? null : cur));
        void loadData();
      }, 200);
      return;
    }
    setDeletingSlug(null);
    showToast(`Delete failed (${res.status})`);
  }, [deleteTarget, loadData, showToast]);

  const handleRequestDelete = useCallback((course: Course) => {
    setMenuOpenSlug(null);
    setDeleteTarget({ slug: course.slug, title: course.title });
  }, []);

  // US-150: Export as ZIP — kicks off a native browser download by setting
  // window.location.href to the streaming endpoint. The browser handles the
  // download stream and the toast surfaces immediate feedback.
  const handleRequestExportZip = useCallback(
    (course: Course) => {
      setMenuOpenSlug(null);
      showToast('Preparing ZIP export…');
      window.location.href = `/api/courses/${course.slug}/export/zip`;
    },
    [showToast],
  );

  // US-152: Export as static HTML — same browser-handled download path,
  // different endpoint that emits a self-contained ZIP of pre-rendered
  // HTML/CSS/JS suitable for hosting on any static host.
  const handleRequestExportHtml = useCallback(
    (course: Course) => {
      setMenuOpenSlug(null);
      showToast('Preparing static HTML export…');
      window.location.href = `/api/courses/${course.slug}/export/html`;
    },
    [showToast],
  );

  const handleRequestExtend = useCallback(
    (course: Course) => {
      setMenuOpenSlug(null);
      router.push(`/courses/${encodeURIComponent(course.slug)}/extend`);
    },
    [router],
  );

  const handleToggleMenu = useCallback((slug: string) => {
    setMenuOpenSlug((cur) => (cur === slug ? null : slug));
  }, []);

  const handleCloseMenu = useCallback(() => {
    setMenuOpenSlug(null);
  }, []);

  const searchActive = searchQuery.trim().length > 0;
  const safeCollections = collections ?? [];

  return (
    <div style={pageStyle}>
      <ResumeGenerationBanners
        sticky={false}
        onNavigateToGeneration={(slug) =>
          router.push(`/create?resume=${encodeURIComponent(slug)}`)
        }
      />
      <header data-testid="dashboard-header" style={headerStyle}>
        <div style={headerLeftStyle}>
          <AppLogoLink />
        </div>
        <form
          role="search"
          style={headerSearchWrapStyle}
          onSubmit={(e) => {
            e.preventDefault();
            const target = searchEnterTarget(
              searchQuery,
              enriched.length > 0,
              courses !== null,
            );
            if (target) {
              router.push(target);
              return;
            }
            (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.blur();
          }}
        >
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
            aria-label="Search courses and lessons"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </form>
        <div style={headerRightStyle}>
          <SettingsMenu />
          <ThemeToggle />
          <AvatarMenu />
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

        {allComplete ? (
          <CreateNewCourseHero />
        ) : (
          resume && <ContinueLearningHero resume={resume} />
        )}

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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              <button
                type="button"
                data-testid="new-collection-cta"
                onClick={handleNewCollection}
                style={secondaryButtonStyle}
              >
                <Plus size={16} strokeWidth={2} />
                New collection
              </button>
              <Link
                data-testid="new-course-cta"
                href="/create"
                style={primaryButtonStyle}
              >
                <Plus size={16} strokeWidth={2} />
                {strings.dashboard.newCourse}
              </Link>
            </div>
          )}
        </div>

        {courses === null ? null : courses.length === 0 ? (
          <EmptyState />
        ) : searchActive ? (
          enriched.length === 0 ? (
            <div
              data-testid="course-grid-empty"
              style={{
                padding: 'var(--space-7) var(--space-6)',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-xl)',
                color: 'var(--text-tertiary)',
                fontSize: 'var(--fs-sm)',
                textAlign: 'center',
              }}
            >
              No matches for &ldquo;{searchQuery.trim()}&rdquo;.
            </div>
          ) : (
            <div data-testid="course-grid" style={courseGridStyle}>
              {enriched.map(({ course, stats, href }) => {
                const sourceCollectionId =
                  safeCollections.find((c) => c.courseSlugs.includes(course.slug))
                    ?.id ?? null;
                return (
                  <CourseCardWithMenu
                    key={course.slug}
                    course={course}
                    stats={stats}
                    href={href}
                    collections={safeCollections}
                    sourceCollectionId={sourceCollectionId}
                    menuOpen={menuOpenSlug === course.slug}
                    onToggleMenu={() => handleToggleMenu(course.slug)}
                    onCloseMenu={handleCloseMenu}
                    onRequestDelete={() => handleRequestDelete(course)}
                    onRequestExportZip={() => handleRequestExportZip(course)}
                    onRequestExportHtml={() => handleRequestExportHtml(course)}
                    onRequestExtend={() => handleRequestExtend(course)}
                    onPickMoveTarget={(targetId) =>
                      void handleMoveCourse(course.slug, sourceCollectionId, targetId)
                    }
                    dimmed={deletingSlug === course.slug}
                    fading={fadingSlug === course.slug}
                  />
                );
              })}
              <ImportCourseCard onImported={loadData} showToast={showToast} />
            </div>
          )
        ) : grouped !== null ? (
          <>
            {grouped.uncategorized.length > 0 && (
              <CollectionSection
                title="Uncategorized"
                collectionId="uncategorized"
                items={grouped.uncategorized}
                collections={safeCollections}
                sourceCollectionId={null}
                collection={null}
                actionsOpen={false}
                onToggleActions={() => undefined}
                onRename={() => undefined}
                onDelete={() => undefined}
                onPickMoveTarget={(slug, targetId) =>
                  void handleMoveCourse(slug, null, targetId)
                }
                menuOpenSlug={menuOpenSlug}
                onToggleMenu={handleToggleMenu}
                onCloseMenu={handleCloseMenu}
                onRequestDelete={handleRequestDelete}
                onRequestExportZip={handleRequestExportZip}
                onRequestExportHtml={handleRequestExportHtml}
                onRequestExtend={handleRequestExtend}
                deletingSlug={deletingSlug}
                fadingSlug={fadingSlug}
              />
            )}
            {grouped.collectionSections.map(({ collection, items }) =>
              items.length === 0 ? null : (
                <CollectionSection
                  key={collection.id}
                  title={collection.name}
                  collectionId={collection.id}
                  items={items}
                  collections={safeCollections}
                  sourceCollectionId={collection.id}
                  collection={collection}
                  actionsOpen={actionsOpenId === collection.id}
                  onToggleActions={() =>
                    setActionsOpenId((cur) =>
                      cur === collection.id ? null : collection.id,
                    )
                  }
                  onRename={() => void handleRenameCollection(collection)}
                  onDelete={() => void handleDeleteCollection(collection)}
                  onPickMoveTarget={(slug, targetId) =>
                    void handleMoveCourse(slug, collection.id, targetId)
                  }
                  menuOpenSlug={menuOpenSlug}
                  onToggleMenu={handleToggleMenu}
                  onCloseMenu={handleCloseMenu}
                  onRequestDelete={handleRequestDelete}
                  onRequestExportZip={handleRequestExportZip}
                  onRequestExportHtml={handleRequestExportHtml}
                  onRequestExtend={handleRequestExtend}
                  deletingSlug={deletingSlug}
                  fadingSlug={fadingSlug}
                />
              ),
            )}
            <div style={courseGridStyle}>
              <ImportCourseCard onImported={loadData} showToast={showToast} />
            </div>
          </>
        ) : null}
      </main>
      {deleteTarget && (
        <DeleteCourseDialog
          courseTitle={deleteTarget.title}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleConfirmDelete()}
        />
      )}
      {toast && (
        <div
          data-testid="dashboard-toast"
          role="status"
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-strong)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 16px',
            fontSize: 'var(--fs-sm)',
            color: 'var(--text)',
            boxShadow: 'var(--shadow-md)',
            zIndex: 1000,
            maxWidth: 'calc(100vw - 32px)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>{toast.message}</span>
          {toast.href && (
            <Link
              data-testid="dashboard-toast-link"
              href={toast.href}
              style={{ color: 'var(--accent-text)', fontWeight: 500 }}
            >
              {toast.linkLabel ?? 'Open'}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function DeleteCourseDialog({
  courseTitle,
  onCancel,
  onConfirm,
}: {
  courseTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      data-testid="course-delete-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="course-delete-dialog-title"
      aria-describedby="course-delete-dialog-body"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1001,
        padding: 'var(--space-4)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-md)',
          padding: 'var(--space-5)',
          width: '100%',
          maxWidth: 440,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-4)',
        }}
      >
        <h2
          id="course-delete-dialog-title"
          data-testid="course-delete-dialog-title"
          style={{
            margin: 0,
            fontSize: 'var(--fs-lg)',
            fontWeight: 600,
            letterSpacing: '-0.01em',
          }}
        >
          Delete &ldquo;{courseTitle}&rdquo;?
        </h2>
        <p
          id="course-delete-dialog-body"
          style={{
            margin: 0,
            fontSize: 'var(--fs-sm)',
            color: 'var(--text-tertiary)',
            lineHeight: 1.5,
          }}
        >
          The course folder will be moved to /courses/.trash/. Recovery requires
          manual filesystem access.
        </p>
        <div
          style={{
            display: 'flex',
            gap: 'var(--space-2)',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            ref={cancelRef}
            data-testid="course-delete-dialog-cancel"
            onClick={onCancel}
            style={{
              ...secondaryButtonStyle,
              height: 36,
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="course-delete-dialog-confirm"
            onClick={onConfirm}
            style={{
              ...primaryButtonStyle,
              height: 36,
              background: 'var(--danger)',
              color: 'var(--text-on-accent, #fff)',
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

