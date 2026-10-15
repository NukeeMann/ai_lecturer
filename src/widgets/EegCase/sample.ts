import type { EegCaseDataInput } from './schema';

/** Staged case on AES 2016 Fig. 90 (electrode pop at P7). Approximate key — widget fixture only. */
export const eegCaseSample: EegCaseDataInput = {
  vignette: '**16-latek**, epizody „zawieszania się” w szkole. Rutynowe EEG w czuwaniu; technik zgłasza „rytmiczny wzorzec po lewej”.',
  figure: {
    src: '/api/courses/eeg-widgets-test/assets/figures/aes-fig90.png',
    alt: 'Routine EEG, bipolar montage, 10 s, rhythmic sharp waveforms confined to P7',
    width: 2007,
    height: 1603,
    attribution: {
      text: 'St. Louis EK, Frey LC (eds). *Electroencephalography (EEG): An Introductory Text and Atlas*. AES 2016, Fig. 90',
      license: 'CC BY-NC-SA 4.0',
      url: 'https://doi.org/10.5698/978-0-9979756-0-4',
    },
  },
  calibration: { pxPerSecond: 189 },
  steps: [
    {
      id: 'where',
      kind: 'choice',
      prompt: 'Przy której elektrodzie jest maksimum rytmicznego wzorca?',
      options: ['P7', 'T7', 'O1', 'Cz'],
      correct: [0],
      explanation: 'Kanały **T7-P7** i **P7-O1** wychylają się przeciwnie — odwrócenie fazy na **P7**, a sąsiednie łańcuchy są spokojne.',
    },
    {
      id: 'mark',
      kind: 'mark',
      prompt: 'Zaznacz ramką fragment, w którym widać odwrócenie fazy wokół P7.',
      mode: 'box',
      targets: [{ id: 'p7', rect: { x: 0.3, y: 0.62, w: 0.32, h: 0.1 }, label: 'T7-P7 / P7-O1' }],
      explanation: 'Wzorzec jest tylko w kanałach zawierających P7 — pole „jednej elektrody”.',
    },
    {
      id: 'why',
      kind: 'multi',
      prompt: 'Co przemawia za artefaktem elektrody, a nie za napadem? (zaznacz wszystkie)',
      options: [
        'Wzorzec ograniczony do kanałów z P7 — brak pola na sąsiednich elektrodach',
        'Brak ewolucji częstotliwości, amplitudy i rozległości',
        'Rytmiczne fale ostre',
        'Pacjent ma epizody zawieszania się',
      ],
      correct: [0, 1],
      explanation: 'Napad ma pole mózgowe i **ewoluuje**; artefakt elektrody jest ograniczony do jednej elektrody i monotonny.',
    },
    {
      id: 'grid',
      kind: 'measure',
      prompt: 'Cyrklem zmierz odstęp między dwiema pionowymi liniami siatki.',
      quantity: 'durationMs',
      expected: 1000,
      tolerance: 80,
      explanation: 'Linie siatki są co **1 s** (10 s na stronę).',
    },
    {
      id: 'confirm',
      kind: 'reveal',
      prompt: 'Jak potwierdzisz artefakt w pracowni?',
      content: 'Sprawdź impedancję P7, obejrzyj wideo i pacjenta, popraw lub wymień elektrodę — artefakt znika po poprawie kontaktu.',
    },
  ],
  summary: '**Pop elektrody P7 udający rytmiczny napad.** Zawsze szukaj pola: wzorzec obecny tylko w kanałach jednej elektrody, bez ewolucji, to artefakt.',
};

export default eegCaseSample;
