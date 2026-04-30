import { Widget } from '@/widgets/Widget';
import { widgetRegistry, type WidgetType } from '@/widgets/registry';
import { SAMPLE_THEORY_MARKDOWN } from '@/widgets/Theory/sample';

type WidgetStatus = 'todo' | 'progress' | 'done';

interface SampleSection {
  type: WidgetType;
  title: string;
  status: WidgetStatus;
  withFooter?: boolean;
  data?: unknown;
}

const samples: SampleSection[] = [
  {
    type: 'theory',
    title: 'What is a convolution?',
    status: 'done',
    data: { markdown: SAMPLE_THEORY_MARKDOWN },
  },
  { type: 'demo', title: 'Gradient descent — drag to explore', status: 'progress' },
  {
    type: 'quiz',
    title: 'Pick the correct kernel for an edge filter',
    status: 'todo',
  },
  {
    type: 'code',
    title: 'Implement a 3×3 box blur',
    status: 'progress',
    withFooter: true,
  },
  {
    type: 'sandbox',
    title: 'Try changing the sigma — nothing breaks',
    status: 'todo',
    withFooter: true,
  },
  { type: 'custom', title: 'Custom histogram viz', status: 'todo' },
];

export default function TestWidgetsPage() {
  return (
    <main
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh',
        padding: 'var(--space-7)',
        fontFamily: 'var(--font-prose)',
      }}
    >
      <h1
        data-testid="test-widgets-h1"
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          marginBottom: 'var(--space-2)',
        }}
      >
        Widget chrome — all six types
      </h1>
      <p
        style={{
          fontSize: 'var(--fs-md)',
          color: 'var(--text-secondary)',
          maxWidth: '640px',
          marginBottom: 'var(--space-7)',
        }}
      >
        Each widget renders a placeholder body so the shared chrome (top accent
        rail, header icon, eyebrow, title, status badge, optional footer) can be
        inspected in isolation. Toggle <code style={{ fontFamily: 'var(--font-mono)' }}>
        data-theme</code> on <code style={{ fontFamily: 'var(--font-mono)' }}>
        &lt;html&gt;</code> to verify dark mode.
      </p>
      <section
        data-testid="test-widgets-stack"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)',
          maxWidth: '780px',
        }}
      >
        {samples.map((sample, index) => {
          const Body = widgetRegistry[sample.type].component;
          const footer = sample.withFooter ? (
            <div
              style={{
                padding: 'var(--space-4) var(--space-5)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--text-tertiary)',
              }}
            >
              Footer slot — controls live here.
            </div>
          ) : undefined;
          return (
            <Widget
              key={sample.type}
              type={sample.type}
              sectionNumber={index + 1}
              title={sample.title}
              status={sample.status}
              footer={footer}
            >
              <Body data={sample.data} />
            </Widget>
          );
        })}
      </section>
    </main>
  );
}
