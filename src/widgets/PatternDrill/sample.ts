import type { PatternDrillDataInput } from './schema';

const AES = (fig: number) => ({
  text: `St. Louis EK, Frey LC (eds). *Electroencephalography (EEG): An Introductory Text and Atlas*. AES 2016, Fig. ${fig}`,
  license: 'CC BY-NC-SA 4.0',
  url: 'https://doi.org/10.5698/978-0-9979756-0-4',
});

/** Minimal valid patternDrill: artifact vs epileptiform (widget fixture). */
export const patternDrillSample: PatternDrillDataInput = {
  prompt: 'Artefakt czy wyładowanie? Odpowiadaj szybko — liczy się pierwsze wrażenie.',
  categories: [
    { id: 'artifact', label: 'Artefakt' },
    { id: 'epileptiform', label: 'Wyładowanie padaczkowe' },
    { id: 'normal', label: 'Wariant prawidłowy' },
  ],
  items: [
    {
      id: 'fig84',
      figure: { src: '/api/courses/eeg-widgets-test/assets/figures/aes-fig84.png', alt: 'Lateral eye movements with lateral rectus spikes', width: 2018, height: 1600, attribution: AES(84) },
      answer: 'artifact',
      explanation: 'Kolce m. prostego bocznego przy ruchu gałek: przeciwne wychylenia F7/F8, brak pola mózgowego.',
      contrastItemId: 'fig90',
    },
    {
      id: 'fig90',
      figure: { src: '/api/courses/eeg-widgets-test/assets/figures/aes-fig90.png', alt: 'Electrode pop at P7', width: 2007, height: 1603, attribution: AES(90) },
      answer: 'artifact',
      explanation: 'Pop elektrody P7: nagłe wychylenie tylko w kanałach z P7, bez pola na sąsiednich elektrodach.',
    },
  ],
  session: { showCriteriaChecklist: true },
};

export default patternDrillSample;
