'use client';

// Loads the signal behind an EEG viewer: a recording asset (fetched JSON in
// the ai-lecturer-eeg@1 format) or a synthetic simulation generated in the
// browser from a preset/spec. The static export shims fetch() for
// /api/courses/<slug>/assets/… paths, so the same code works there.

import { useEffect, useMemo, useState } from 'react';

import { generateRecording, resolveSimulation, safeDecodeRecording, type DecodedRecording } from '@/lib/eeg';
import type { SimulationSpecInput } from '@/lib/eeg';

export type RecordingSourceInput =
  | { kind: 'recording'; src: string }
  | { kind: 'simulation'; preset?: string; spec?: SimulationSpecInput };

export type RecordingState =
  | { status: 'loading' }
  | { status: 'ready'; recording: DecodedRecording }
  | { status: 'error'; error: string };

// Decoded recordings are shared between widgets showing the same asset.
const recordingCache = new Map<string, Promise<DecodedRecording>>();

async function loadRecording(src: string): Promise<DecodedRecording> {
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Could not load the EEG recording (${res.status} ${res.statusText || ''})`.trim());
  const json: unknown = await res.json();
  const decoded = safeDecodeRecording(json);
  if (!decoded.ok) throw new Error(`Invalid EEG recording file: ${decoded.error}`);
  return decoded.recording;
}

/** Simulation output for a source (pure; throws on an invalid spec). */
export function simulateSource(source: { preset?: string; spec?: SimulationSpecInput }): DecodedRecording {
  return generateRecording(resolveSimulation({ preset: source.preset, spec: source.spec }));
}

export function useRecordingSource(source: RecordingSourceInput): RecordingState {
  const simKey = source.kind === 'simulation' ? JSON.stringify({ p: source.preset, s: source.spec }) : null;
  const simulated = useMemo<RecordingState | null>(() => {
    if (source.kind !== 'simulation') return null;
    try {
      return { status: 'ready', recording: simulateSource(source) };
    } catch (e) {
      return { status: 'error', error: e instanceof Error ? e.message : String(e) };
    }
    // simKey captures the source content; the object identity may change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simKey]);

  const src = source.kind === 'recording' ? source.src : null;
  const [fetched, setFetched] = useState<{ src: string; state: RecordingState } | null>(null);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    let p = recordingCache.get(src);
    if (!p) {
      p = loadRecording(src);
      recordingCache.set(src, p);
      p.catch(() => recordingCache.delete(src));
    }
    p.then(
      (recording) => {
        if (!cancelled) setFetched({ src, state: { status: 'ready', recording } });
      },
      (e: unknown) => {
        if (!cancelled) setFetched({ src, state: { status: 'error', error: e instanceof Error ? e.message : String(e) } });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (simulated) return simulated;
  if (fetched && fetched.src === src) return fetched.state;
  return { status: 'loading' };
}
