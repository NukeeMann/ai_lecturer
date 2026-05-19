// US-152: Static-HTML export renderer.
//
// Produces self-contained HTML / JS / CSS strings that the route handler
// streams into a ZIP. Per-lesson HTML is built via React's
// `renderToStaticMarkup` against a STATIC variant of the lesson tree —
// interactive features (AI tutor, regenerate UI, generation log, progress
// tracking, pencil-panel) are simply absent from the static component tree.
//
// Code + Quiz widgets keep their interactivity via a small
// `static-client.js` bundle (NO React; vanilla DOM listeners) that consumes
// the lesson JSON serialised into `<lessonSlug>.data.js` and the Pyodide
// loader at `assets/pyodide-loader.js`.

import { createRequire } from 'node:module';
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { remarkCallout } from '@/widgets/Theory/remarkCallout';
import type { Course } from '@/lib/schemas/course';
import type { Lesson, Section } from '@/lib/schemas/lesson';

type CalloutTone = 'info' | 'insight' | 'warning' | 'danger';

import { PYODIDE_CDN_SCRIPT, PYODIDE_VERSION } from './constants';

// `react-dom/server` cannot be statically imported in Next 16's App Router
// even from a server-only module — Turbopack rejects the import on principle.
// Loading it via `createRequire` defers resolution to plain Node `require()`
// at first use, which Turbopack does not statically analyse.
const nodeRequire = createRequire(import.meta.url);
type RenderToStaticMarkup = (element: React.ReactElement) => string;
let _renderToStaticMarkup: RenderToStaticMarkup | null = null;
function renderToStaticMarkup(element: React.ReactElement): string {
  if (!_renderToStaticMarkup) {
    const mod = nodeRequire('react-dom/server') as {
      renderToStaticMarkup: RenderToStaticMarkup;
    };
    _renderToStaticMarkup = mod.renderToStaticMarkup;
  }
  return _renderToStaticMarkup(element);
}

const VALID_TONES: ReadonlySet<CalloutTone> = new Set([
  'info',
  'insight',
  'warning',
  'danger',
]);

interface StaticCalloutProps {
  tone: CalloutTone;
  title?: string;
  children?: ReactNode;
}

const calloutStyle: Record<CalloutTone, CSSProperties> = {
  info: {
    background: 'var(--info-subtle)',
    borderColor: 'var(--info-border)',
    color: 'var(--info)',
  },
  insight: {
    background: 'var(--insight-subtle)',
    borderColor: 'var(--insight-border)',
    color: 'var(--insight)',
  },
  warning: {
    background: 'var(--warning-subtle)',
    borderColor: 'var(--warning-border)',
    color: 'var(--warning)',
  },
  danger: {
    background: 'var(--danger-subtle)',
    borderColor: 'var(--danger-border)',
    color: 'var(--danger)',
  },
};

// Server-render-friendly callout — does NOT import lucide-react (those
// components are client-only in Next 16). Pure inline JSX + CSS vars.
function StaticCallout({ tone, title, children }: StaticCalloutProps) {
  const spec = calloutStyle[tone];
  return (
    <aside
      className="static-callout"
      data-callout-tone={tone}
      style={{
        background: spec.background,
        border: `1px solid ${spec.borderColor}`,
        borderRadius: 'var(--radius-md, 6px)',
        padding: '14px 18px',
        margin: '12px 0',
      }}
    >
      {title ? (
        <div
          style={{
            fontWeight: 600,
            color: spec.color,
            marginBottom: 4,
            fontSize: 14,
          }}
        >
          {title}
        </div>
      ) : null}
      <div style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.6 }}>
        {children}
      </div>
    </aside>
  );
}

function preprocessMath(markdown: string): string {
  return markdown
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, body: string) => `$${body}$`)
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, body: string) => `$$\n${body}\n$$`)
    .replace(/\$\$([^\n$]+?)\$\$/g, (_, body: string) => `$$\n${body}\n$$`);
}

function normalizeTone(raw: unknown): CalloutTone {
  if (typeof raw === 'string' && VALID_TONES.has(raw as CalloutTone)) {
    return raw as CalloutTone;
  }
  return 'info';
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
        <StaticCallout tone={tone} title={title}>
          {children}
        </StaticCallout>
      );
    },
  } as Partial<Components>),
};

function StaticTheory({ markdown }: { markdown: string }) {
  return (
    <div data-theory-body>
      <ReactMarkdown
        remarkPlugins={[remarkDirective, remarkCallout, remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {preprocessMath(markdown)}
      </ReactMarkdown>
    </div>
  );
}

interface StaticSectionProps {
  section: Section;
}

function StaticCode({ section }: { section: Extract<Section, { type: 'code' }> }) {
  return (
    <div data-codewidget-static data-section-id={section.id}>
      <div className="static-code-task">
        <StaticTheory markdown={section.data.taskMarkdown} />
      </div>
      <div className="static-code-editor">
        <label
          className="static-code-label"
          htmlFor={`code-input-${section.id}`}
        >
          Your code
        </label>
        <textarea
          id={`code-input-${section.id}`}
          className="static-code-textarea"
          data-static-code-input
          data-section-id={section.id}
          spellCheck={false}
          defaultValue={section.data.starterCode}
        />
        <div className="static-code-actions">
          <button
            type="button"
            className="static-btn static-btn-primary"
            data-static-code-run
            data-section-id={section.id}
          >
            Run
          </button>
          <span
            className="static-code-status"
            data-static-code-status
            data-section-id={section.id}
          >
            Pyodide loading…
          </span>
        </div>
        <pre
          className="static-code-output"
          data-static-code-output
          data-section-id={section.id}
        >
          (no output yet)
        </pre>
      </div>
      {section.data.solution ? (
        <details className="static-code-solution">
          <summary>Reference solution</summary>
          <pre className="static-code-block">{section.data.solution}</pre>
        </details>
      ) : null}
    </div>
  );
}

function StaticQuiz({ section }: { section: Extract<Section, { type: 'quiz' }> }) {
  const data = section.data;
  return (
    <div
      data-quizwidget-static
      data-section-id={section.id}
      data-multi-select={data.multiSelect ? 'true' : 'false'}
    >
      <p className="static-quiz-question">{data.question}</p>
      <div className="static-quiz-options" role="group" aria-label="Answer options">
        {data.options.map((option, i) => (
          <button
            key={i}
            type="button"
            className="static-quiz-option"
            data-static-quiz-option
            data-section-id={section.id}
            data-option-index={i}
          >
            <span className="static-quiz-letter">
              {String.fromCharCode(65 + i)}
            </span>
            <span className="static-quiz-option-text">{option}</span>
          </button>
        ))}
      </div>
      <div className="static-quiz-actions">
        <button
          type="button"
          className="static-btn static-btn-primary"
          data-static-quiz-submit
          data-section-id={section.id}
        >
          Submit
        </button>
      </div>
      <div
        className="static-quiz-explanation"
        data-static-quiz-explanation
        data-section-id={section.id}
        hidden
      >
        <span className="static-quiz-explanation-label">Explanation</span>
        <p>{data.explanation}</p>
      </div>
    </div>
  );
}

function StaticCodeCloze({
  section,
}: {
  section: Extract<Section, { type: 'codeCloze' }>;
}) {
  // Cloze fills are displayed as `___` placeholders for static viewing —
  // interactivity is intentionally out of scope for this widget per AC.
  type ClozeData = {
    template?: string;
    blanks?: Array<{ answer: string }>;
    prompt?: string;
  };
  const data = section.data as unknown as ClozeData;
  const template = typeof data.template === 'string' ? data.template : '';
  const filled = template.replace(/\{\{\s*\d+\s*\}\}/g, '___');
  return (
    <div data-codeclozewidget-static data-section-id={section.id}>
      {data.prompt ? <p className="static-cloze-prompt">{data.prompt}</p> : null}
      <pre className="static-code-block">{filled}</pre>
      <p className="static-cloze-note">
        Cloze blanks are read-only in static export — open the live course to
        practise.
      </p>
    </div>
  );
}

function StaticSandbox({
  section,
}: {
  section: Extract<Section, { type: 'sandbox' }>;
}) {
  type SandboxData = { starterCode?: string; description?: string };
  const data = section.data as unknown as SandboxData;
  return (
    <div data-sandboxwidget-static data-section-id={section.id}>
      {data.description ? (
        <p className="static-sandbox-desc">{data.description}</p>
      ) : null}
      <pre className="static-code-block">{data.starterCode ?? ''}</pre>
      <p className="static-sandbox-note">
        Sandbox is read-only in static export.
      </p>
    </div>
  );
}

function StaticDemo({ section }: { section: Extract<Section, { type: 'demo' }> }) {
  type DemoData = { description?: string; preset?: string };
  const data = section.data as unknown as DemoData;
  return (
    <div data-demowidget-static data-section-id={section.id}>
      <p className="static-demo-note">
        Interactive demo (preset
        {data.preset ? ` "${data.preset}"` : ''}) — open the live course to
        explore.
      </p>
      {data.description ? (
        <StaticTheory markdown={data.description} />
      ) : null}
    </div>
  );
}

function StaticUnsupported({ section }: StaticSectionProps) {
  return (
    <div data-unsupportedwidget-static data-section-id={section.id}>
      <p className="static-unsupported-note">
        <em>{section.type}</em> widget is not available in static export.
      </p>
    </div>
  );
}

function StaticSection({ section }: StaticSectionProps) {
  const widgetType = section.type;
  const accentVar = `--widget-${widgetType.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
  return (
    <section
      className="static-section"
      data-section-id={section.id}
      data-widget-type={widgetType}
      style={{ ['--section-accent' as string]: `var(${accentVar})` }}
    >
      <header className="static-section-header">
        <span className="static-section-eyebrow">{widgetType}</span>
        <h2 className="static-section-title">{section.title}</h2>
        {section.description ? (
          <p className="static-section-description">{section.description}</p>
        ) : null}
      </header>
      <div className="static-section-body">
        <StaticSectionBody section={section} />
      </div>
    </section>
  );
}

function StaticSectionBody({ section }: StaticSectionProps) {
  switch (section.type) {
    case 'theory':
      return <StaticTheory markdown={section.data.markdown} />;
    case 'code':
      return <StaticCode section={section} />;
    case 'quiz':
      return <StaticQuiz section={section} />;
    case 'codeCloze':
      return <StaticCodeCloze section={section} />;
    case 'sandbox':
      return <StaticSandbox section={section} />;
    case 'demo':
      return <StaticDemo section={section} />;
    default:
      return <StaticUnsupported section={section} />;
  }
}

interface LessonNavLink {
  slug: string;
  title: string;
}

interface RenderLessonOptions {
  lesson: Lesson;
  course: Course;
  prev: LessonNavLink | null;
  next: LessonNavLink | null;
}

function StaticLessonBody({
  lesson,
  course,
  prev,
  next,
}: RenderLessonOptions) {
  return (
    <Fragment>
      <header className="static-lesson-header">
        <a href="../index.html" className="static-back-link">
          ← {course.title}
        </a>
        <p className="static-lesson-eyebrow">{lesson.eyebrow}</p>
        <h1 className="static-lesson-title">{lesson.title}</h1>
        <p className="static-lesson-description">{lesson.description}</p>
        <p className="static-lesson-meta">
          {lesson.estimatedMinutes} min · {lesson.sections.length} section
          {lesson.sections.length === 1 ? '' : 's'}
        </p>
      </header>
      <main className="static-lesson-stream">
        {lesson.sections.map((section) => (
          <StaticSection key={section.id} section={section} />
        ))}
      </main>
      <nav className="static-lesson-nav" aria-label="Lesson navigation">
        {prev ? (
          <a className="static-nav-link" href={`./${prev.slug}.html`}>
            ← {prev.title}
          </a>
        ) : (
          <span />
        )}
        {next ? (
          <a className="static-nav-link" href={`./${next.slug}.html`}>
            {next.title} →
          </a>
        ) : (
          <span />
        )}
      </nav>
    </Fragment>
  );
}

function htmlShell({
  title,
  bodyHtml,
  scriptsHtml = '',
  cssHref,
}: {
  title: string;
  bodyHtml: string;
  scriptsHtml?: string;
  cssHref: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${cssHref}" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
</head>
<body>
${bodyHtml}
${scriptsHtml}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsonForScript(json: string): string {
  // Avoid prematurely closing the embedding `<script>` element.
  return json.replace(/<\/script/gi, '<\\/script');
}

export function renderLessonHtml(opts: RenderLessonOptions): string {
  const inner = renderToStaticMarkup(<StaticLessonBody {...opts} />);
  const scripts = `<script src="../assets/pyodide-loader.js" defer></script>
<script src="./${opts.lesson.slug}.data.js" defer></script>
<script src="../assets/static-client.js" defer></script>`;
  return htmlShell({
    title: `${opts.lesson.title} — ${opts.course.title}`,
    bodyHtml: `<div class="static-shell static-lesson-shell">${inner}</div>`,
    scriptsHtml: scripts,
    cssHref: '../assets/styles.css',
  });
}

export function renderLessonDataJs(lesson: Lesson): string {
  const json = JSON.stringify(lesson);
  return `// Lesson payload — consumed by static-client.js for code + quiz interactivity.
window.__AI_LECTURER_LESSON__ = ${escapeJsonForScript(json)};
`;
}

export function renderIndexHtml(course: Course): string {
  const inner = renderToStaticMarkup(<StaticIndexBody course={course} />);
  return htmlShell({
    title: course.title,
    bodyHtml: `<div class="static-shell static-index-shell">${inner}</div>`,
    cssHref: './assets/styles.css',
  });
}

function StaticIndexBody({ course }: { course: Course }) {
  return (
    <Fragment>
      <header className="static-index-header">
        <p className="static-index-eyebrow">Course</p>
        <h1 className="static-index-title">{course.title}</h1>
        <p className="static-index-description">{course.description}</p>
      </header>
      <main className="static-index-modules">
        {course.modules.map((module) => (
          <section key={module.id} className="static-index-module">
            <h2 className="static-index-module-title">{module.title}</h2>
            {module.summary ? (
              <p className="static-index-module-summary">{module.summary}</p>
            ) : null}
            <ol className="static-index-lessons">
              {module.lessons.map((ref) => (
                <li key={ref.slug} className="static-index-lesson">
                  <a
                    className="static-index-lesson-link"
                    href={`./lessons/${ref.slug}.html`}
                  >
                    <span className="static-index-lesson-title">{ref.title}</span>
                    <span className="static-index-lesson-min">
                      {ref.estimatedMinutes} min
                    </span>
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </main>
      <footer className="static-index-footer">
        <p>
          Static export · Pyodide v{PYODIDE_VERSION} loaded from{' '}
          <code>{PYODIDE_CDN_SCRIPT}</code>
        </p>
      </footer>
    </Fragment>
  );
}

export const STATIC_STYLES_CSS = `/* US-152: extracted design tokens + minimal layout for static-HTML export. */
${STATIC_TOKENS_CSS_PLACEHOLDER()}

/* Reset & base */
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
}
a { color: var(--accent-text); text-decoration: none; }
a:hover { text-decoration: underline; }
code, pre, textarea.static-code-textarea { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }

.static-shell {
  max-width: 880px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

/* Index page */
.static-index-header { margin-bottom: 32px; }
.static-index-eyebrow { color: var(--text-tertiary); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px; }
.static-index-title { font-size: 32px; line-height: 1.15; margin: 0 0 8px; }
.static-index-description { color: var(--text-secondary); margin: 0; }
.static-index-modules { display: flex; flex-direction: column; gap: 32px; }
.static-index-module-title { font-size: 20px; margin: 0 0 4px; }
.static-index-module-summary { color: var(--text-secondary); margin: 0 0 12px; }
.static-index-lessons { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.static-index-lesson-link {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 12px 14px;
  border: 1px solid var(--border); border-radius: 8px;
  background: var(--bg-elevated);
  text-decoration: none; color: var(--text);
  transition: border-color 120ms;
}
.static-index-lesson-link:hover { border-color: var(--accent-border); text-decoration: none; }
.static-index-lesson-title { font-weight: 500; }
.static-index-lesson-min { color: var(--text-tertiary); font-size: 13px; }
.static-index-footer { margin-top: 48px; color: var(--text-tertiary); font-size: 12px; }
.static-index-footer code { font-size: 11px; background: var(--bg-subtle); padding: 1px 4px; border-radius: 3px; }

/* Lesson page */
.static-back-link { display: inline-block; color: var(--text-tertiary); font-size: 13px; margin-bottom: 12px; }
.static-lesson-eyebrow { color: var(--text-tertiary); font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 4px; }
.static-lesson-title { font-size: 28px; line-height: 1.2; margin: 0 0 8px; }
.static-lesson-description { color: var(--text-secondary); margin: 0 0 6px; }
.static-lesson-meta { color: var(--text-tertiary); font-size: 13px; margin: 0 0 24px; }

.static-lesson-stream { display: flex; flex-direction: column; gap: 24px; }
.static-section {
  border: 1px solid var(--border);
  border-left: 3px solid var(--section-accent, var(--accent));
  border-radius: 10px;
  background: var(--bg-elevated);
  overflow: hidden;
}
.static-section-header { padding: 16px 20px; border-bottom: 1px solid var(--border); background: var(--bg-subtle); }
.static-section-eyebrow { display: inline-block; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 4px; }
.static-section-title { font-size: 18px; margin: 0; line-height: 1.3; }
.static-section-description { margin: 8px 0 0; color: var(--text-secondary); font-size: 14px; }
.static-section-body { padding: 18px 20px; }

[data-theory-body] p { margin: 0 0 12px; }
[data-theory-body] h1, [data-theory-body] h2, [data-theory-body] h3 { line-height: 1.25; margin: 16px 0 8px; }
[data-theory-body] code { background: var(--bg-subtle); padding: 1px 5px; border-radius: 3px; font-size: 13px; }
[data-theory-body] pre { background: var(--code-bg); color: var(--code-text); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
[data-theory-body] pre code { background: transparent; padding: 0; }
[data-theory-body] ul, [data-theory-body] ol { padding-left: 24px; margin: 0 0 12px; }
[data-theory-body] li { margin: 0 0 4px; }
[data-theory-body] blockquote { border-left: 3px solid var(--border-strong); padding-left: 12px; color: var(--text-secondary); margin: 12px 0; }

/* Code widget */
.static-code-task { margin-bottom: 14px; }
.static-code-editor { display: flex; flex-direction: column; gap: 8px; }
.static-code-label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); font-weight: 600; }
.static-code-textarea {
  width: 100%; min-height: 160px;
  padding: 10px 12px;
  background: var(--code-bg); color: var(--code-text);
  border: 1px solid var(--border); border-radius: 6px;
  font-size: 13px; line-height: 1.5;
  resize: vertical;
}
.static-code-actions { display: flex; align-items: center; gap: 12px; }
.static-code-status { font-size: 12px; color: var(--text-tertiary); }
.static-code-output {
  margin: 0;
  padding: 10px 12px;
  min-height: 40px;
  background: var(--bg-subtle); color: var(--text);
  border: 1px solid var(--border); border-radius: 6px;
  font-size: 13px; white-space: pre-wrap; word-break: break-word;
}
.static-code-output[data-state="error"] { color: var(--danger); }
.static-code-output[data-state="ok"] { color: var(--text); }

.static-code-block { background: var(--code-bg); color: var(--code-text); padding: 10px 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
.static-code-solution summary { cursor: pointer; color: var(--text-tertiary); font-size: 13px; margin-top: 12px; }

/* Quiz widget */
.static-quiz-question { font-size: 15px; font-weight: 500; margin: 0 0 12px; }
.static-quiz-options { display: flex; flex-direction: column; gap: 8px; }
.static-quiz-option {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border: 1px solid var(--border-strong); border-radius: 8px;
  background: var(--bg-elevated); color: var(--text);
  cursor: pointer; text-align: left;
  font: inherit;
  transition: border-color 120ms, background-color 120ms;
}
.static-quiz-option:hover { border-color: var(--accent-border); background: var(--accent-subtle); }
.static-quiz-option[data-state="selected"] { border-color: var(--accent); background: var(--accent-subtle); }
.static-quiz-option[data-state="correct"] { border-color: var(--success-border); background: var(--success-subtle); }
.static-quiz-option[data-state="incorrect"] { border-color: var(--danger-border); background: var(--danger-subtle); }
.static-quiz-option[data-disabled="true"] { cursor: default; }
.static-quiz-letter { color: var(--text-tertiary); font-family: ui-monospace, monospace; width: 16px; flex-shrink: 0; font-size: 12px; }
.static-quiz-option-text { flex: 1; font-size: 14px; }
.static-quiz-actions { margin-top: 14px; }
.static-quiz-explanation {
  margin-top: 14px; padding: 12px 14px;
  background: var(--bg-subtle); border: 1px solid var(--border);
  border-radius: 6px; font-size: 14px;
}
.static-quiz-explanation-label { font-size: 11px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-tertiary); display: block; margin-bottom: 4px; }
.static-quiz-explanation p { margin: 0; color: var(--text-secondary); }

/* Cloze / sandbox / demo */
.static-cloze-prompt, .static-sandbox-desc, .static-demo-note, .static-unsupported-note { color: var(--text-secondary); font-size: 14px; margin: 0 0 12px; }
.static-cloze-note, .static-sandbox-note { color: var(--text-tertiary); font-size: 12px; margin-top: 8px; font-style: italic; }

/* Buttons */
.static-btn {
  display: inline-flex; align-items: center; justify-content: center;
  height: 34px; padding: 0 16px;
  border-radius: 6px; font-size: 13px; font-weight: 500;
  border: 1px solid transparent; cursor: pointer;
  font-family: inherit;
  transition: background-color 120ms, border-color 120ms;
}
.static-btn-primary {
  background: var(--accent); color: var(--text-on-accent); border-color: var(--accent);
}
.static-btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.static-btn-primary[disabled] { opacity: 0.5; cursor: not-allowed; }

/* Lesson nav */
.static-lesson-nav { display: flex; justify-content: space-between; gap: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid var(--border); }
.static-nav-link { color: var(--accent-text); font-size: 14px; }

/* Print */
@media print {
  body { background: white; color: #111; }
  .static-quiz-options button { break-inside: avoid; }
  .static-section { break-inside: avoid; border: 1px solid #ccc; }
  .static-back-link, .static-lesson-nav { display: none; }
  .static-code-actions { display: none; }
  .static-code-output { background: #fafafa; color: #111; }
}
`;

function STATIC_TOKENS_CSS_PLACEHOLDER(): string {
  // Inlined design-token block. Keeping it inside this module rather than
  // reading it from disk at request time keeps the export deterministic
  // (no runtime fs.read of /src/styles/tokens.css that would break in
  // production builds where source files are not packaged).
  return `:root {
  --bg: #fdfcfa;
  --bg-elevated: #ffffff;
  --bg-subtle: #f6f4f0;
  --bg-hover: #f0ede7;
  --bg-active: #e8e4dc;
  --border: #e8e4dc;
  --border-strong: #d4cec3;
  --text: #18171a;
  --text-secondary: #56524a;
  --text-tertiary: #8a8479;
  --text-quaternary: #b3ad9f;
  --text-on-accent: #ffffff;
  --accent: #2563eb;
  --accent-hover: #1d4fd7;
  --accent-subtle: #eaf0fd;
  --accent-border: #c2d2f8;
  --accent-text: #1d4fd7;
  --success: #0d7a5f;
  --success-subtle: #e3f3ec;
  --success-border: #b8dccb;
  --warning: #b45309;
  --warning-subtle: #fdf4e3;
  --warning-border: #f1d9a8;
  --danger: #be3a3a;
  --danger-subtle: #fcebe9;
  --danger-border: #f1c0bb;
  --insight: #6b3eaa;
  --insight-subtle: #f1ebfa;
  --insight-border: #ddccf2;
  --info: #2563eb;
  --info-subtle: #eaf0fd;
  --info-border: #c2d2f8;
  --widget-theory: #56524a;
  --widget-demo: #2563eb;
  --widget-quiz: #6b3eaa;
  --widget-code: #0d7a5f;
  --widget-code-cloze: #1f6f8b;
  --widget-sandbox: #b45309;
  --widget-histogram: #4e7a85;
  --widget-plot-image: #876b3a;
  --widget-parametric-explorer: #5a4f8a;
  --widget-drag-match: #8a4a6f;
  --widget-data-table: #4a6f8a;
  --widget-video: #b94a6f;
  --widget-custom: #56524a;
  --code-bg: #fafaf7;
  --code-text: #18171a;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0f0e11;
    --bg-elevated: #18171a;
    --bg-subtle: #1c1b1f;
    --bg-hover: #232227;
    --bg-active: #2c2b30;
    --border: #2a282d;
    --border-strong: #3a383e;
    --text: #f0ede7;
    --text-secondary: #b3ad9f;
    --text-tertiary: #8a8479;
    --text-quaternary: #56524a;
    --accent: #4f8aff;
    --accent-hover: #6b9eff;
    --accent-subtle: #1a2336;
    --accent-border: #2c3e6a;
    --accent-text: #87aeff;
    --success: #4ec79a;
    --success-subtle: #142b22;
    --success-border: #1e4435;
    --warning: #e0a458;
    --warning-subtle: #2c2317;
    --warning-border: #4a3a22;
    --danger: #ef6f6f;
    --danger-subtle: #2c1818;
    --danger-border: #4a2727;
    --info: #4f8aff;
    --info-subtle: #1a2336;
    --info-border: #2c3e6a;
    --code-bg: #131215;
    --code-text: #f0ede7;
  }
}`;
}

export const PYODIDE_LOADER_JS = `// US-152: Pyodide loader — pinned to v${PYODIDE_VERSION}.
//
// Loads Pyodide from the jsDelivr CDN on first \`runPython\` invocation, then
// reuses the same instance for subsequent calls. Exposes a single async
// function on \`window\`:
//
//   window.runPython(code: string): Promise<string>
//
// Returns whatever Python wrote to stdout (joined with newlines), or the
// repr of the last expression if stdout was empty. Throws a regular Error
// on Python exceptions; the message is the Python traceback.

(function () {
  var PYODIDE_INDEX_URL = '${PYODIDE_CDN_SCRIPT.replace(/\/pyodide\.js$/, '/')}';
  var PYODIDE_SCRIPT = '${PYODIDE_CDN_SCRIPT}';
  var pyodidePromise = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Failed to load ' + src)); };
      document.head.appendChild(s);
    });
  }

  async function getPyodide() {
    if (pyodidePromise) return pyodidePromise;
    pyodidePromise = (async function () {
      if (typeof window.loadPyodide !== 'function') {
        await loadScript(PYODIDE_SCRIPT);
      }
      // eslint-disable-next-line no-undef
      var py = await window.loadPyodide({ indexURL: PYODIDE_INDEX_URL });
      return py;
    })();
    return pyodidePromise;
  }

  async function runPython(code) {
    var py = await getPyodide();
    var stdoutChunks = [];
    py.setStdout({
      batched: function (chunk) { stdoutChunks.push(String(chunk)); },
    });
    py.setStderr({
      batched: function (chunk) { stdoutChunks.push(String(chunk)); },
    });
    var result = await py.runPythonAsync(String(code));
    py.setStdout({});
    py.setStderr({});
    if (stdoutChunks.length > 0) {
      return stdoutChunks.join('\\n');
    }
    if (result === undefined || result === null) return '';
    return String(result);
  }

  window.runPython = runPython;
  window.__PYODIDE_VERSION__ = '${PYODIDE_VERSION}';
})();
`;

export const STATIC_CLIENT_JS = `// US-152: client-side wiring for Code + Quiz widgets in the static export.
//
// Reads the lesson payload from \`window.__AI_LECTURER_LESSON__\` (set by the
// per-lesson \`<lessonSlug>.data.js\`) and attaches DOM listeners. NO React,
// NO build step — plain ES2017 served straight to the browser.

(function () {
  function ready(fn) {
    if (document.readyState !== 'loading') { fn(); return; }
    document.addEventListener('DOMContentLoaded', fn);
  }

  function bySection(attr, sectionId) {
    return document.querySelector('[' + attr + '][data-section-id="' + sectionId + '"]');
  }

  function setStatus(sectionId, text) {
    var el = bySection('data-static-code-status', sectionId);
    if (el) el.textContent = text;
  }

  function attachCodeRunners(lesson) {
    var buttons = document.querySelectorAll('[data-static-code-run]');
    if (buttons.length === 0) return;
    // Pyodide is only loaded on first click — keep the page lightweight on
    // open. The status field flips to "Ready" once the first run resolves.
    buttons.forEach(function (btn) {
      var sectionId = btn.getAttribute('data-section-id');
      btn.addEventListener('click', async function () {
        var input = bySection('data-static-code-input', sectionId);
        var output = bySection('data-static-code-output', sectionId);
        if (!input || !output) return;
        btn.disabled = true;
        setStatus(sectionId, 'Running…');
        output.textContent = '';
        output.removeAttribute('data-state');
        try {
          if (typeof window.runPython !== 'function') {
            throw new Error('Pyodide loader not initialised');
          }
          var result = await window.runPython(input.value);
          output.textContent = result || '(no output)';
          output.setAttribute('data-state', 'ok');
          setStatus(sectionId, 'Ready');
        } catch (err) {
          output.textContent = (err && err.message) ? String(err.message) : String(err);
          output.setAttribute('data-state', 'error');
          setStatus(sectionId, 'Error');
        } finally {
          btn.disabled = false;
        }
      });
    });
    // Friendlier idle status while the user reads the task.
    document.querySelectorAll('[data-static-code-status]').forEach(function (s) {
      s.textContent = 'Ready (Pyodide loads on first run)';
    });
  }

  function attachQuizCheckers(lesson) {
    var sections = (lesson && lesson.sections) || [];
    sections.forEach(function (section) {
      if (section.type !== 'quiz') return;
      var sectionId = section.id;
      var data = section.data || {};
      var multi = data.multiSelect === true;
      var correct = (data.correct || []).slice().sort(function (a, b) { return a - b; });
      var selected = [];

      var optionButtons = Array.prototype.slice.call(
        document.querySelectorAll('[data-static-quiz-option][data-section-id="' + sectionId + '"]')
      );
      var submitBtn = bySection('data-static-quiz-submit', sectionId);
      var explanation = bySection('data-static-quiz-explanation', sectionId);
      var submitted = false;

      function updateOptionStates() {
        optionButtons.forEach(function (btn) {
          var idx = Number(btn.getAttribute('data-option-index'));
          if (submitted) {
            if (correct.indexOf(idx) >= 0) {
              btn.setAttribute('data-state', 'correct');
            } else if (selected.indexOf(idx) >= 0) {
              btn.setAttribute('data-state', 'incorrect');
            } else {
              btn.removeAttribute('data-state');
            }
            btn.setAttribute('data-disabled', 'true');
          } else if (selected.indexOf(idx) >= 0) {
            btn.setAttribute('data-state', 'selected');
          } else {
            btn.removeAttribute('data-state');
          }
        });
      }

      optionButtons.forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (submitted) return;
          var idx = Number(btn.getAttribute('data-option-index'));
          if (multi) {
            var found = selected.indexOf(idx);
            if (found >= 0) {
              selected.splice(found, 1);
            } else {
              selected.push(idx);
            }
          } else {
            selected = [idx];
          }
          updateOptionStates();
        });
      });

      if (submitBtn) {
        submitBtn.addEventListener('click', function () {
          if (submitted) return;
          if (selected.length === 0) return;
          submitted = true;
          updateOptionStates();
          if (explanation) explanation.removeAttribute('hidden');
          submitBtn.setAttribute('data-disabled', 'true');
          submitBtn.disabled = true;
        });
      }
    });
  }

  ready(function () {
    var lesson = window.__AI_LECTURER_LESSON__;
    if (!lesson) return;
    attachCodeRunners(lesson);
    attachQuizCheckers(lesson);
  });
})();
`;
