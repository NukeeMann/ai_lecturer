'use client';

import type { CSSProperties } from 'react';

import { CodeRunner, type CodeRunnerProgressKey } from '../Code/CodeRunner';
import type { SandboxData } from './schema';

export const DEFAULT_SANDBOX_ENCOURAGEMENT =
  'Try changing values and see what happens. Nothing breaks.';

export interface SandboxWidgetProps {
  data: SandboxData;
  initialCode?: string;
  progressKey?: CodeRunnerProgressKey;
}

const encouragementStyle: CSSProperties = {
  margin: 0,
  padding: 'var(--space-3) var(--space-5)',
  fontSize: 'var(--fs-sm)',
  fontStyle: 'italic',
  color: 'var(--text-secondary)',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border)',
};

export function SandboxWidget({ data, initialCode, progressKey }: SandboxWidgetProps) {
  const encouragement = data.encouragement?.trim()
    ? data.encouragement
    : DEFAULT_SANDBOX_ENCOURAGEMENT;

  return (
    <div data-sandbox-widget>
      <p data-sandbox-encouragement style={encouragementStyle}>
        {encouragement}
      </p>
      <CodeRunner
        starterCode={data.starterCode}
        initialCode={initialCode}
        progressKey={progressKey}
      />
    </div>
  );
}
