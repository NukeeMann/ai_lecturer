'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Play } from 'lucide-react';

import { Callout } from '@/components/Callout';
import {
  KernelStopError,
  useKernel,
  type KernelSessionKey,
  type PyodideInputFile,
  type RunWithTestsResult,
} from '@/lib/kernel/client';

import { CodeRunner, type CodeRunnerProgressKey } from '../Code/CodeRunner';
import { inputMountName } from '../Code/schema';
import { IORow } from '../common/IOPanel';
import type { SandboxData } from './schema';

export const DEFAULT_SANDBOX_ENCOURAGEMENT =
  'Try changing values and see what happens. Nothing breaks.';

/** Session used when the widget is rendered without a lesson `progressKey`
 *  (e.g. previews). Mirrors CodeRunner / CodeWidget's fallback. */
const SCRATCH_SESSION: KernelSessionKey = {
  courseSlug: 'scratch',
  lessonSlug: 'scratch',
  sectionId: 'scratch',
};

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

const panelWrapStyle: CSSProperties = {
  background: 'var(--bg-elevated)',
  borderTop: '1px solid var(--border)',
  padding: 'var(--space-4) var(--space-5)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
};

export function SandboxWidget({ data, initialCode, progressKey }: SandboxWidgetProps) {
  const encouragement = data.encouragement?.trim()
    ? data.encouragement
    : DEFAULT_SANDBOX_ENCOURAGEMENT;

  // Free-run executes on the real per-lesson IPython kernel (US-203). Session
  // identity comes from `progressKey`; previews without one fall back to a
  // scratch session (parity with CodeRunner / CodeWidget).
  const session = useMemo<KernelSessionKey>(
    () =>
      progressKey
        ? {
            courseSlug: progressKey.courseSlug,
            lessonSlug: progressKey.lessonSlug,
            sectionId: progressKey.sectionId,
          }
        : SCRATCH_SESSION,
    [progressKey],
  );
  const { status, runWithTests, checkPackages, stop } = useKernel(session);

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
  // Import names from `requiresPackages` that are NOT present in the runtime —
  // surfaced as an actionable "run setup" message (US-203 precondition check).
  const [missingPackages, setMissingPackages] = useState<string[]>([]);
  // Set when a kernel run is stopped by the user or hits the 30s timeout.
  const [stopReason, setStopReason] = useState<'user' | 'timeout' | null>(null);

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

  // Precondition check (US-203, same semantics as US-202): `requiresPackages`
  // declares packages that must already be installed in the runtime. We verify
  // they are importable BEFORE running — we never pip-install during a run.
  // Returns true when it is safe to proceed.
  const ensurePackages = useCallback(async (): Promise<boolean> => {
    const pkgs = data.requiresPackages;
    if (!pkgs || pkgs.length === 0) {
      setMissingPackages([]);
      return true;
    }
    const missing = await checkPackages(pkgs);
    setMissingPackages(missing);
    return missing.length === 0;
  }, [data.requiresPackages, checkPackages]);

  const handleLiveRun = useCallback(async () => {
    // The kernel is runnable from `idle` (first run lazily boots it) as well as
    // `ready`; only a mid-spawn `loading` / hard `error` blocks a fresh run.
    if (status !== 'ready' && status !== 'idle') return;
    if (liveRunning) return;
    setLiveRunning(true);
    setStopReason(null);
    try {
      // Precondition: bail out with an actionable message if a declared package
      // is missing — without ever installing it at run time.
      if (!(await ensurePackages())) {
        setLiveRunning(false);
        return;
      }
      const result: RunWithTestsResult = await runWithTests(codeRef.current, [], {
        captureLiveImage: true,
        inputs: workerInputs.length > 0 ? workerInputs : undefined,
      });
      if (result.png && result.png instanceof Uint8Array) {
        const blob = new Blob([result.png as BlobPart], { type: 'image/png' });
        setLivePng(URL.createObjectURL(blob));
      }
    } catch (err) {
      if (err instanceof KernelStopError) {
        // User-stop or 30s timeout: the kernel stays alive. Surface the stop
        // banner; the editor's own output already reflects nothing ran.
        setStopReason(err.reason);
        return;
      }
      // Surface non-stop errors only via the editor's own run path on the
      // next attempt — Sandbox stays quiet here so we don't double-render
      // the same traceback the kernel already reported.
    } finally {
      setLiveRunning(false);
    }
  }, [
    status,
    liveRunning,
    runWithTests,
    ensurePackages,
    workerInputs,
    setLivePng,
  ]);

  const handleReset = useCallback(() => {
    setLivePng(null);
    setMissingPackages([]);
    setStopReason(null);
  }, [setLivePng]);

  // Kernel is runnable from `idle` (lazy server-side spawn) as well as `ready`.
  const runnable = status === 'ready' || status === 'idle';
  const liveRunDisabled = !runnable || liveRunning;
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

  const extraPanel =
    missingPackages.length > 0 || stopReason ? (
      <>
        {missingPackages.length > 0 && (
          <div
            data-sandbox-missing-packages
            data-packages={missingPackages.join(',')}
            style={panelWrapStyle}
          >
            <Callout tone="warning">
              {missingPackages.length === 1
                ? `Missing package: ${missingPackages[0]} — run setup to install it before running.`
                : `Missing packages: ${missingPackages.join(', ')} — run setup to install them before running.`}
            </Callout>
          </div>
        )}
        {stopReason && (
          <div
            data-sandbox-stop
            data-stop-reason={stopReason}
            style={panelWrapStyle}
          >
            <Callout tone="warning">
              {stopReason === 'timeout'
                ? 'Execution timed out after 30s. The kernel was interrupted — try again.'
                : 'Execution stopped.'}
            </Callout>
          </div>
        )}
      </>
    ) : undefined;

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
        extraPanel={extraPanel}
        primaryAction={liveRunAction}
        actionRunning={liveRunning}
        runRequiresPackages={data.requiresPackages}
        runInputs={workerInputs.length > 0 ? workerInputs : undefined}
        onStop={stop}
      />
    </div>
  );
}
