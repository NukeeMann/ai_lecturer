import type { MontageLabDataInput } from './schema';

/** Minimal valid montageLab: F8 phase reversal with one localisation challenge. */
export const montageLabSample: MontageLabDataInput = {
  prompt: 'Przełączaj montaże i obserwuj, jak zmienia się obraz **tego samego** wyładowania.',
  scenario: { preset: 'phaseReversalF8' },
  montages: ['LB', 'TB', 'AVG', 'CZ'],
  initialMontage: 'LB',
  challenges: [
    {
      id: 'max',
      prompt: 'Kliknij na główce elektrodę, pod którą leży maksimum ujemności.',
      answer: { kind: 'electrode', electrodes: ['F8'] },
      explanation: 'W montażu podwójnego banana kanały **Fp2-F8** i **F8-T8** wychylają się do siebie — ujemne odwrócenie fazy na **F8**.',
    },
  ],
};

export default montageLabSample;
