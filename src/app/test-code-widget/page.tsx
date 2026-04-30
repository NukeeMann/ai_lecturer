'use client';

import { useState } from 'react';

import { CodeWidget } from '@/widgets/Code/CodeWidget';
import { SAMPLE_CODE_BOX_BLUR } from '@/widgets/Code/sample';
import { Widget } from '@/widgets/Widget';

type WidgetStatus = 'todo' | 'progress' | 'done';

export default function TestCodeWidgetPage() {
  const [status, setStatus] = useState<WidgetStatus>('progress');

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
        data-testid="test-code-widget-h1"
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          marginBottom: 'var(--space-2)',
        }}
      >
        CodeWidget — graded exercise with tests
      </h1>
      <p
        style={{
          fontSize: 'var(--fs-md)',
          color: 'var(--text-secondary)',
          maxWidth: '640px',
          marginBottom: 'var(--space-7)',
        }}
      >
        Smoke-test page for the Code widget: 3 tests, hidden by default; Submit
        runs them via Pyodide. On all-pass, the chrome status badge below
        flips to <code style={{ fontFamily: 'var(--font-mono)' }}>done</code>.
      </p>
      <section style={{ maxWidth: '780px' }}>
        <Widget
          type="code"
          sectionNumber={1}
          title="Implement a 3×3 box blur (compute the mean)"
          status={status}
        >
          <CodeWidget
            data={SAMPLE_CODE_BOX_BLUR}
            onComplete={() => setStatus('done')}
          />
        </Widget>
      </section>
    </main>
  );
}
