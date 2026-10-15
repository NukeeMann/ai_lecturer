import type { EegViewerDataInput } from './schema';

/** Minimal valid eegViewer: the synthetic F8 phase-reversal demo with a marking task. */
export const eegViewerSample: EegViewerDataInput = {
  prompt: 'Znajdź wyładowania i ustal, gdzie jest **odwrócenie fazy**.',
  source: { kind: 'simulation', preset: 'phaseReversalF8' },
  initial: { montage: 'LB', sensitivityUvPerMm: 10, secondsPerPage: 10 },
  task: {
    kind: 'markEvents',
    prompt: 'Zaznacz każdą iglicę.',
    mode: 'point',
    targets: [
      { id: 's1', onsetSec: 1.6, channels: ['F8'], label: 'Iglica F8' },
      { id: 's2', onsetSec: 4.3, channels: ['F8'], label: 'Iglica F8' },
      { id: 's3', onsetSec: 7.4, channels: ['F8'], label: 'Iglica F8' },
    ],
    toleranceSec: 0.3,
    explanation:
      'Ujemne wychylenia „wskazują na siebie” w kanałach **Fp2-F8** i **F8-T8**: to ujemne odwrócenie fazy, więc maksimum pola leży pod **F8**.',
  },
};

export default eegViewerSample;
