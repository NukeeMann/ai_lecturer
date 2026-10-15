import type { FigureSequenceDataInput } from './schema';

const AES = (fig: number) => ({
  text: `St. Louis EK, Frey LC (eds). *Electroencephalography (EEG): An Introductory Text and Atlas*. AES 2016, Fig. ${fig}`,
  license: 'CC BY-NC-SA 4.0',
  url: 'https://doi.org/10.5698/978-0-9979756-0-4',
});

/** Posterior dominant rhythm maturation (AES 2016 Figs. 37–40, 43). */
export const figureSequenceSample: FigureSequenceDataInput = {
  prompt: 'Przesuń suwak i obserwuj, jak **przyspiesza rytm podstawowy** (PDR) z wiekiem.',
  layout: 'slider',
  sliderLabel: 'Wiek',
  frames: [
    { id: 'm11', label: '11 mies.', figure: { src: '/api/courses/eeg-widgets-test/assets/figures/aes-fig37.png', alt: 'Awake EEG of an 11-month-old, 5–6 Hz PDR', width: 2018, height: 1255, attribution: AES(37) }, caption: 'PDR **5–6 Hz** (11 miesięcy).' },
    { id: 'm12', label: '12 mies.', figure: { src: '/api/courses/eeg-widgets-test/assets/figures/aes-fig38.png', alt: 'Awake EEG of a 12-month-old, 6–7 Hz PDR', width: 1920, height: 1196, attribution: AES(38) }, caption: 'PDR **6–7 Hz** (12 miesięcy).' },
    { id: 'm16', label: '16 mies.', figure: { src: '/api/courses/eeg-widgets-test/assets/figures/aes-fig39.png', alt: 'Awake EEG of a 16-month-old, 7–8 Hz PDR', width: 1920, height: 1194, attribution: AES(39) }, caption: 'PDR **7–8 Hz** (16 miesięcy).' },
    { id: 'y10', label: '10 lat', figure: { src: '/api/courses/eeg-widgets-test/assets/figures/aes-fig43.png', alt: 'Awake EEG of a 10-year-old, 10 Hz PDR', width: 2018, height: 1257, attribution: AES(43) }, caption: 'PDR **10 Hz** (10 lat).' },
  ],
};

export default figureSequenceSample;
