import type { VideoData } from './schema';

export const SAMPLE_VIDEO: VideoData = {
  kind: 'youtube',
  src: 'aircAruvnKk',
  title: 'But what is a neural network?',
  durationSeconds: 1140,
  autoplay: false,
  transcript: [
    { tStart: 0, tEnd: 6, text: 'This is a 3 — connected to a network.', speaker: 'Grant' },
    { tStart: 6, tEnd: 14, text: 'Each neuron holds a number called its activation.' },
    { tStart: 14, tEnd: 22, text: 'And the connections between layers carry weights.' },
  ],
};
