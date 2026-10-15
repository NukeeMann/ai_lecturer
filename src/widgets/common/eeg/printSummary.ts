// Static (print / PDF) summary of the EEG widgets. Node-safe: used by the
// server-rendered print page, which cannot run canvases or interactions.

import type { Attribution } from './figure';

export interface EegPrintFigure {
  src: string;
  alt: string;
  caption?: string;
  attribution?: Attribution;
}

export interface EegPrintSummary {
  /** Markdown-ish prompt text (printed as plain paragraphs). */
  prompt?: string;
  /** Italic note about what the interactive widget does. */
  note: string;
  figures: EegPrintFigure[];
  caption?: string;
  attribution?: Attribution;
}

interface AnyEegData {
  prompt?: string;
  caption?: string;
  attribution?: Attribution;
  source?: { kind?: string; preset?: string };
  task?: { prompt?: string };
  simulationLabel?: string;
}

/** Summary for one EEG section (unknown types fall back to a generic note). */
export function eegPrintSummary(type: string, data: unknown): EegPrintSummary {
  const d = (data ?? {}) as AnyEegData;
  switch (type) {
    case 'eegViewer': {
      const synthetic = d.source?.kind === 'simulation';
      const what = synthetic
        ? `${d.simulationLabel ?? 'SYMULACJA'} — synthetic signal demonstrating a mechanism, not a real recording`
        : 'real EEG recording';
      return {
        prompt: [d.prompt, d.task?.prompt].filter(Boolean).join('\n\n') || undefined,
        note: `Interactive EEG viewer (${what}). Open the lesson in the app to change montage, sensitivity, timebase and filters${d.task ? ' and to do the marking task' : ''}.`,
        figures: [],
        caption: d.caption,
        attribution: d.attribution,
      };
    }
    default:
      return { prompt: d.prompt, note: `Interactive EEG exercise (${type}) — open the lesson in the app.`, figures: [], caption: d.caption };
  }
}
