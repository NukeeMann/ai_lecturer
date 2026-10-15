import type { EegFigureMarkDataInput } from './schema';

/** Minimal valid eegFigureMark (AES 2016 Fig. 84; approximate key — widget fixture only). */
export const eegFigureMarkSample: EegFigureMarkDataInput = {
  prompt: 'Zaznacz ramką **mrugnięcie** (artefakt z gałek ocznych).',
  figure: {
    src: '/api/courses/eeg-widgets-test/assets/figures/aes-fig84.png',
    alt: 'Routine EEG, longitudinal bipolar montage, 10 s: lateral eye movements and a blink',
    width: 2018,
    height: 1600,
    attribution: {
      text: 'St. Louis EK, Frey LC (eds). *Electroencephalography (EEG): An Introductory Text and Atlas*. AES 2016, Fig. 84',
      license: 'CC BY-NC-SA 4.0',
      url: 'https://doi.org/10.5698/978-0-9979756-0-4',
    },
  },
  mode: 'box',
  targets: [{ id: 'blink', rect: { x: 0.29, y: 0.17, w: 0.06, h: 0.5 }, label: 'Mrugnięcie — dodatniość czołowa' }],
  calibration: { pxPerSecond: 189, uvPerPx: 0.91 },
  explanation: 'Mrugnięcie to **dodatnia** fala nad Fp1/Fp2 (rogówka jest dodatnia): w kanałach Fp1-F3 / Fp2-F4 wychylenie w dół, symetrycznie, bez pola mózgowego za okolicą czołową.',
};

export default eegFigureMarkSample;
