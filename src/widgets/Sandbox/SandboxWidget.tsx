'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Play } from 'lucide-react';

import {
  PyodideStopError,
  usePyodide,
  type PyodideInputFile,
  type RunWithTestsResult,
} from '@/lib/pyodide/client';

import { CodeRunner, type CodeRunnerProgressKey } from '../Code/CodeRunner';
import { inputMountName } from '../Code/schema';
import { IORow } from '../common/IOPanel';
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

  const { status, runWithTests } = usePyodide();

  const inputs = data.inputs ?? [];
  const outputMedia = data.outputMedia;
  const liveCaptureEnabled =
    outputMedia?.kind === 'image' && outputMedia.live === true;

  const workerInputs = useMemo<PyodideInputFile[]>(() => {
    if (!data.inputs?.length) return [];
    const out: PyodideInputFile[] = [];
    for (const input of data.inputs) {
      const filename = inputMountName(input);
      if (!filename) continue;
      if (input.kind === 'text') continue;
      out.push({ filename, src: input.src });
    }
    return out;
  }, [data.inputs]);

  const [code, setCode] = useState<string>(initialCode ?? data.starterCode);
  const codeRef = useRef(code);
  useEffect(() => {
    codeRef.current = code;
  }, [code]);

  const [liveRunning, setLiveRunning] = useState(false);

  const [livePngUrl, setLivePngUrl] = useState<string | null>(null);
  const livePngUrlRef = useRef<string | null>(null);
  useEffect(() => {
    livePngUrlRef.current = livePngUrl;
  }, [livePngUrl]);
  useEffect(() => {
    return () => {
      if (livePngUrlRef.current) URL.revokeObjectURL(livePngUrlRef.current);
    };
  }, []);
  const setLivePng = useCallback((next: string | null) => {
    setLivePngUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return next;
    });
  }, []);

  const handleLiveRun = useCallback(async () => {
    if (status !== 'ready') return;
    if (liveRunning) return;
    setLiveRunning(true);
    try {
      const result: RunWithTestsResult = await runWithTests(codeRef.current, [], {
        requiresPackages: data.requiresPackages,
        captureLiveImage: true,
        inputs: workerInputs.length > 0 ? workerInputs : undefined,
      });
      if (result.png && result.png instanceof Uint8Array) {
        const blob = new Blob([result.png as BlobPart], { type: 'image/png' });
        setLivePng(URL.createObjectURL(blob));
      }
    } catch (err) {
      if (err instanceof PyodideStopError) {
        // CodeRunner shows the restart Callout; nothing more to do here.
        return;
      }
      // Surface non-stop errors only via the editor's own run path on the
      // next attempt — Sandbox stays quiet here so we don't double-render
      // the same traceback the worker already streamed.
    } finally {
      setLiveRunning(false);
    }
  }, [
    status,
    liveRunning,
    runWithTests,
    data.requiresPackages,
    workerInputs,
    setLivePng,
  ]);

  const handleReset = useCallback(() => {
    setLivePng(null);
  }, [setLivePng]);

  const liveRunDisabled = status !== 'ready' || liveRunning;
  const liveRunAction = useMemo(
    () =>
      liveCaptureEnabled
        ? {
            label: liveRunning ? 'Running…' : 'Run',
            icon: <Play size={14} aria-hidden />,
            onClick: () => {
              void handleLiveRun();
            },
            disabled: liveRunDisabled,
            variant: 'secondary' as const,
            testId: 'sandbox-live-run',
            ariaLabel: 'Run code and capture matplotlib figure',
          }
        : undefined,
    [liveCaptureEnabled, liveRunning, handleLiveRun, liveRunDisabled],
  );

  return (
    <div data-sandbox-widget>
      <p data-sandbox-encouragement style={encouragementStyle}>
        {encouragement}
      </p>
      <IORow
        inputs={inputs}
        outputMedia={outputMedia}
        outputDisplaySrc={liveCaptureEnabled ? livePngUrl ?? undefined : undefined}
        outputPlaceholderCaption={
          liveCaptureEnabled
            ? '# placeholder showing what your output should look like'
            : undefined
        }
      />
      <CodeRunner
        starterCode={data.starterCode}
        initialCode={initialCode}
        progressKey={progressKey}
        onCodeChange={setCode}
        onReset={handleReset}
        primaryAction={liveRunAction}
        actionRunning={liveRunning}
        runRequiresPackages={data.requiresPackages}
        runInputs={workerInputs.length > 0 ? workerInputs : undefined}
      />
    </div>
  );
}
