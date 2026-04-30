'use client';

import { useState } from 'react';

import { usePyodide } from '@/lib/pyodide/client';

export default function TestPyodidePage() {
  const { status, run, runWithTests } = usePyodide();
  const [stdout, setStdout] = useState<string>('');
  const [stderr, setStderr] = useState<string>('');
  const [traceback, setTraceback] = useState<string>('');
  const [testJson, setTestJson] = useState<string>('');

  const handleRunHello = async () => {
    const r = await run("print('hello')");
    setStdout(r.stdout);
    setStderr(r.stderr);
    setTraceback(r.traceback ?? '');
  };

  const handleRunWithTests = async () => {
    const r = await runWithTests('def add(a, b):\n    return a + b\n', [
      { name: 'positive', body: 'assert add(1, 2) == 3' },
      { name: 'zero', body: 'assert add(0, 0) == 0' },
      {
        name: 'fail',
        body: 'assert add(1, 1) == 3, "1+1 should be 3 (intentional fail)"',
      },
    ]);
    setTestJson(JSON.stringify(r.testResults, null, 2));
  };

  return (
    <main
      style={{
        padding: 'var(--space-7)',
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh',
        fontFamily: 'var(--font-prose)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--fs-2xl)',
          fontWeight: 600,
          marginBottom: 'var(--space-3)',
        }}
      >
        Pyodide smoke test
      </h1>
      <p style={{ marginBottom: 'var(--space-4)', color: 'var(--text-secondary)' }}>
        Status:{' '}
        <span data-testid="pyodide-status" style={{ fontFamily: 'var(--font-mono)' }}>
          {status}
        </span>
      </p>
      <div style={{ display: 'flex', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
        <button
          data-testid="run-hello"
          onClick={handleRunHello}
          disabled={status !== 'ready'}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            cursor: status === 'ready' ? 'pointer' : 'not-allowed',
            opacity: status === 'ready' ? 1 : 0.5,
          }}
        >
          Run print(&apos;hello&apos;)
        </button>
        <button
          data-testid="run-with-tests"
          onClick={handleRunWithTests}
          disabled={status !== 'ready'}
          style={{
            padding: 'var(--space-2) var(--space-4)',
            background: 'var(--bg-elevated)',
            color: 'var(--text)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            cursor: status === 'ready' ? 'pointer' : 'not-allowed',
            opacity: status === 'ready' ? 1 : 0.5,
          }}
        >
          Run with tests (custom runner)
        </button>
      </div>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <pre
          data-testid="pyodide-stdout"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}
        >
          stdout: {stdout}
        </pre>
        <pre
          data-testid="pyodide-stderr"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}
        >
          stderr: {stderr}
        </pre>
        <pre
          data-testid="pyodide-traceback"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}
        >
          traceback: {traceback}
        </pre>
        <pre
          data-testid="pyodide-test-results"
          style={{
            background: 'var(--bg-subtle)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: 'var(--space-3)',
            fontFamily: 'var(--font-mono)',
            fontSize: 'var(--fs-sm)',
            whiteSpace: 'pre-wrap',
            margin: 0,
          }}
        >
          testResults: {testJson}
        </pre>
      </section>
    </main>
  );
}
