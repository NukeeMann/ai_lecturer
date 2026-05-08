// US-153: Print-friendly server-rendered lesson view.
//
// Loaded by the puppeteer-driven PDF export route. Strips all interactive
// affordances (no header, no sidebar, no chat, no regen / pencil panels)
// and renders sections in order with print-friendly styles. Quiz answers
// are visibly highlighted; Code tests stay hidden by default; Sandbox shows
// only the prompt.

import { promises as fs } from 'node:fs';
import { notFound } from 'next/navigation';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';

import { remarkCallout } from '@/widgets/Theory/remarkCallout';
import { LessonSchema, type Lesson, type Section } from '@/lib/schemas/lesson';
import { CourseSchema, type Course } from '@/lib/schemas/course';
import { courseFile, lessonFile, InvalidSlugError } from '@/lib/server/paths';
import type { CodeData, CodeTest } from '@/widgets/Code/schema';
import type { QuizData } from '@/widgets/Quiz/schema';
import type { SandboxData } from '@/widgets/Sandbox/schema';
import type { TheoryData } from '@/widgets/Theory/schema';
import type { DemoData } from '@/widgets/Demo/schema';

export const dynamic = 'force-dynamic';

type Params = Promise<{ slug: string; lessonSlug: string }>;

async function loadCourse(slug: string): Promise<Course | null> {
  let raw: string;
  try {
    raw = await fs.readFile(courseFile(slug), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = CourseSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

async function loadLesson(slug: string, lessonSlug: string): Promise<Lesson | null> {
  let raw: string;
  try {
    raw = await fs.readFile(lessonFile(slug, lessonSlug), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = LessonSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function preprocessMath(markdown: string): string {
  return markdown
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `$$\n${body}\n$$`)
    .replace(/\$\$([^\n$]+?)\$\$/g, (_, body: string) => `$$\n${body}\n$$`);
}

type CalloutTone = 'info' | 'insight' | 'warning' | 'danger';
const VALID_TONES: ReadonlySet<CalloutTone> = new Set([
  'info',
  'insight',
  'warning',
  'danger',
]);

function normalizeTone(raw: unknown): CalloutTone {
  if (typeof raw === 'string' && VALID_TONES.has(raw as CalloutTone)) {
    return raw as CalloutTone;
  }
  return 'info';
}

function PrintCallout({
  tone,
  title,
  children,
}: {
  tone: CalloutTone;
  title?: string;
  children?: React.ReactNode;
}) {
  return (
    <aside
      data-print-callout-tone={tone}
      style={{
        border: '1px solid #888',
        borderRadius: 4,
        padding: '10px 14px',
        margin: '12px 0',
        pageBreakInside: 'avoid',
      }}
    >
      {title ? (
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      ) : null}
      <div>{children}</div>
    </aside>
  );
}

const markdownComponents: Components = {
  ...({
    callout: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => {
      const tone = normalizeTone(props['data-tone']);
      const titleAttr = props['data-title'];
      const title =
        typeof titleAttr === 'string' && titleAttr.length > 0 ? titleAttr : undefined;
      return (
        <PrintCallout tone={tone} title={title}>
          {children}
        </PrintCallout>
      );
    },
  } as Partial<Components>),
};

function PrintMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="print-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkDirective, remarkCallout, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {preprocessMath(markdown)}
      </ReactMarkdown>
    </div>
  );
}

function PrintTheory({ data }: { data: TheoryData }) {
  return <PrintMarkdown markdown={data.markdown} />;
}

function PrintQuiz({ data }: { data: QuizData }) {
  const correctSet = new Set(data.correct);
  return (
    <div data-print-quiz>
      <p
        data-print-quiz-question
        style={{ fontWeight: 600, margin: '6px 0 10px 0' }}
      >
        {data.question}
      </p>
      <ol
        type="A"
        style={{ margin: '0 0 10px 0', paddingLeft: 24 }}
      >
        {data.options.map((opt, i) => {
          const correct = correctSet.has(i);
          return (
            <li
              key={i}
              data-print-quiz-option
              data-correct={correct ? 'true' : 'false'}
              style={{
                margin: '4px 0',
                fontWeight: correct ? 600 : 400,
                background: correct ? '#fffbcc' : 'transparent',
                padding: correct ? '2px 6px' : 0,
                borderRadius: correct ? 3 : 0,
              }}
            >
              {opt}
              {correct ? (
                <span
                  style={{ marginLeft: 8, fontStyle: 'italic', color: '#226622' }}
                >
                  ✓ correct
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {data.explanation ? (
        <div
          data-print-quiz-explanation
          style={{
            borderLeft: '3px solid #999',
            paddingLeft: 10,
            margin: '6px 0',
            fontStyle: 'italic',
          }}
        >
          <strong>Explanation:</strong> {data.explanation}
        </div>
      ) : null}
    </div>
  );
}

function PrintCode({ data }: { data: CodeData }) {
  const visibleTests = data.tests.filter((t: CodeTest) => !t.hidden);
  const hiddenCount = data.tests.length - visibleTests.length;
  return (
    <div data-print-code>
      <PrintMarkdown markdown={data.taskMarkdown} />
      <pre
        data-print-code-block
        style={{
          background: '#f3f3f3',
          padding: 10,
          borderRadius: 4,
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 11,
          whiteSpace: 'pre-wrap',
          pageBreakInside: 'avoid',
        }}
      >
        {data.starterCode}
      </pre>
      {visibleTests.length > 0 ? (
        <div data-print-code-visible-tests>
          <p style={{ fontWeight: 600, margin: '8px 0 4px 0' }}>Visible tests:</p>
          {visibleTests.map((t, i) => (
            <pre
              key={i}
              style={{
                background: '#f8f8f8',
                padding: 8,
                borderRadius: 4,
                fontFamily: 'var(--font-mono, monospace)',
                fontSize: 11,
                whiteSpace: 'pre-wrap',
              }}
            >
              {`# ${t.name}\n${t.body}`}
            </pre>
          ))}
        </div>
      ) : null}
      {hiddenCount > 0 ? (
        <p
          data-print-code-tests-hidden
          style={{
            fontStyle: 'italic',
            color: '#666',
            margin: '6px 0',
          }}
        >
          [Tests hidden]{' '}
          {hiddenCount === 1
            ? '1 hidden test'
            : `${hiddenCount} hidden tests`}{' '}
          will run when you submit your code.
        </p>
      ) : null}
    </div>
  );
}

function PrintSandbox({ data }: { data: SandboxData }) {
  return (
    <div data-print-sandbox>
      <p style={{ margin: '4px 0 8px 0' }}>{data.encouragement}</p>
    </div>
  );
}

function PrintDemo({ data }: { data: DemoData }) {
  return (
    <div data-print-demo>
      <p style={{ margin: '4px 0', fontStyle: 'italic', color: '#444' }}>
        Interactive demo: {data.demoType}
      </p>
    </div>
  );
}

function PrintSection({ section, n }: { section: Section; n: number }) {
  let body: React.ReactNode;
  switch (section.type) {
    case 'theory':
      body = <PrintTheory data={section.data} />;
      break;
    case 'quiz':
      body = <PrintQuiz data={section.data} />;
      break;
    case 'code':
      body = <PrintCode data={section.data} />;
      break;
    case 'sandbox':
      body = <PrintSandbox data={section.data} />;
      break;
    case 'demo':
      body = <PrintDemo data={section.data} />;
      break;
    default:
      body = (
        <p
          data-print-unsupported
          style={{ fontStyle: 'italic', color: '#666' }}
        >
          {section.type} content omitted from print export.
        </p>
      );
  }
  return (
    <section
      data-print-section
      data-section-id={section.id}
      data-widget-type={section.type}
      style={{
        margin: '14pt 0 0 0',
        pageBreakInside: 'avoid',
      }}
    >
      <h2
        style={{
          fontSize: '14pt',
          fontWeight: 600,
          margin: '0 0 4pt 0',
          borderBottom: '1px solid #ccc',
          paddingBottom: 2,
        }}
      >
        {n}. {section.title}
      </h2>
      {section.description ? (
        <p style={{ color: '#555', fontStyle: 'italic', margin: '2pt 0 6pt 0' }}>
          {section.description}
        </p>
      ) : null}
      <div>{body}</div>
    </section>
  );
}

const PRINT_STYLES = `
  body { background: #fff; color: #000; }
  .print-root {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 12pt;
    line-height: 1.5;
    color: #000;
    background: #fff;
    max-width: 100%;
    margin: 0;
    padding: 0;
  }
  .print-root h1 { font-size: 18pt; margin: 0 0 4pt 0; }
  .print-root h2 { font-size: 14pt; }
  .print-root h3 { font-size: 13pt; }
  .print-root p { margin: 4pt 0; }
  .print-root pre, .print-root code { font-size: 11pt; }
  .print-root .print-markdown table { border-collapse: collapse; width: 100%; }
  .print-root .print-markdown th, .print-root .print-markdown td {
    border: 1px solid #888; padding: 4pt 6pt;
  }
  .print-root [data-print-section] { page-break-inside: avoid; }
  .print-root pre { page-break-inside: avoid; }
  @media print {
    body { background: #fff !important; color: #000 !important; }
    .print-root { color: #000 !important; background: #fff !important; }
    .print-root [data-print-callout-tone] { background: #fff !important; }
  }
`;

export default async function LessonPrintPage({ params }: { params: Params }) {
  const { slug, lessonSlug } = await params;

  let course: Course | null = null;
  let lesson: Lesson | null = null;
  try {
    [course, lesson] = await Promise.all([
      loadCourse(slug),
      loadLesson(slug, lessonSlug),
    ]);
  } catch (err) {
    if (err instanceof InvalidSlugError) {
      notFound();
    }
    throw err;
  }
  if (!course || !lesson) {
    notFound();
  }

  let moduleN = 0;
  let lessonM = 0;
  const mIdx = course.modules.findIndex((m) => m.id === lesson.moduleId);
  if (mIdx >= 0) {
    const lIdx = course.modules[mIdx].lessons.findIndex(
      (l) => l.slug === lesson.slug,
    );
    moduleN = mIdx + 1;
    lessonM = lIdx >= 0 ? lIdx + 1 : 0;
  }

  return (
    <div className="print-root" data-testid="lesson-print-root">
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <header
        data-print-header
        style={{
          marginBottom: 12,
          paddingBottom: 6,
          borderBottom: '2px solid #000',
        }}
      >
        <div
          style={{
            fontSize: '10pt',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: '#555',
            marginBottom: 4,
          }}
        >
          {course.title}
          {moduleN > 0 && lessonM > 0
            ? ` · Module ${moduleN} · Lesson ${lessonM}`
            : ''}
        </div>
        <h1
          data-print-lesson-title
          style={{
            fontSize: '18pt',
            margin: 0,
            fontWeight: 700,
          }}
        >
          {lesson.title}
        </h1>
        {lesson.description ? (
          <p style={{ color: '#444', margin: '6pt 0 0 0' }}>{lesson.description}</p>
        ) : null}
      </header>
      <main>
        {lesson.sections.map((section, i) => (
          <PrintSection key={section.id} section={section} n={i + 1} />
        ))}
      </main>
      {lesson.sources && lesson.sources.length > 0 ? (
        <section
          data-print-sources
          style={{
            marginTop: 18,
            paddingTop: 8,
            borderTop: '1px solid #888',
          }}
        >
          <h2 style={{ fontSize: '12pt', margin: '0 0 4pt 0' }}>Sources</h2>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {lesson.sources.map((s, i) => (
              <li key={i} style={{ margin: '2pt 0', fontSize: '10pt' }}>
                {s.title}
                {s.author ? ` — ${s.author}` : ''}
                {s.year ? ` (${s.year})` : ''}
                {' '}
                <span style={{ color: '#555' }}>{s.url}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}
