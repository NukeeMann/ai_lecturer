'use client';

import { CodeRunner } from '@/widgets/Code/CodeRunner';
import { Widget } from '@/widgets/Widget';

const STARTER = "print('hello, world')\n";

export default function TestCodeRunnerPage() {
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
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          marginBottom: 'var(--space-5)',
        }}
      >
        CodeRunner shell
      </h1>
      <section style={{ maxWidth: 780 }}>
        <Widget
          type="code"
          sectionNumber={1}
          title="Try it: print('hi'), then ⌘+Enter"
          status="todo"
        >
          <CodeRunner starterCode={STARTER} />
        </Widget>
      </section>
    </main>
  );
}
