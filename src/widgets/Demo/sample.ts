import type { DemoData } from './schema';

export const SAMPLE_DEMO_GAUSS: DemoData = {
  demoType: 'gauss',
  imageSrc: '/demo-images/cameraman.jpg',
  params: {
    sigmaMin: 0,
    sigmaMax: 10,
    sigmaDefault: 1.5,
  },
};
