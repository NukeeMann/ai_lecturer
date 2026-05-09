import type { ComponentType } from 'react';
import {
  BarChart3,
  Code,
  FileText,
  FlaskConical,
  Headphones,
  Image as ImageIcon,
  Layers,
  Languages,
  type LucideProps,
  Move,
  PenLine,
  Sliders,
  Table as TableIcon,
  Target,
  Terminal,
  Video as VideoIcon,
} from 'lucide-react';

import { AudioPlayerWidget } from './AudioPlayer/AudioPlayerWidget';
import { TranscriptClozeWidget } from './TranscriptCloze/TranscriptClozeWidget';
import { CodeWidget } from './Code/CodeWidget';
import { CodeClozeWidget } from './CodeCloze/CodeClozeWidget';
import { CustomPlaceholder } from './Custom/CustomPlaceholder';
import { DataTableWidget } from './DataTable/DataTableWidget';
import { GaussDemo } from './Demo/GaussDemo';
import { DragMatchWidget } from './DragMatch/DragMatchWidget';
import { HistogramWidget } from './Histogram/HistogramWidget';
import { ParametricExplorerWidget } from './ParametricExplorer/ParametricExplorerWidget';
import { PlotImageWidget } from './PlotImage/PlotImageWidget';
import { QuizWidget } from './Quiz/QuizWidget';
import { SandboxWidget } from './Sandbox/SandboxWidget';
import { TheoryWidget } from './Theory/TheoryWidget';
import { VideoWidget } from './Video/VideoWidget';

export type WidgetType =
  | 'theory'
  | 'quiz'
  | 'code'
  | 'codeCloze'
  | 'demo'
  | 'sandbox'
  | 'histogram'
  | 'plotImage'
  | 'parametricExplorer'
  | 'dragMatch'
  | 'dataTable'
  | 'video'
  | 'audioPlayer'
  | 'transcriptCloze'
  | 'custom';

export interface WidgetRegistryEntry {
  component: ComponentType<{ data?: unknown }>;
  label: string;
  icon: ComponentType<LucideProps>;
  accentVar: string;
}

export const widgetRegistry: Record<WidgetType, WidgetRegistryEntry> = {
  theory: {
    component: TheoryWidget as ComponentType<{ data?: unknown }>,
    label: 'Theory',
    icon: FileText,
    accentVar: '--widget-theory',
  },
  quiz: {
    component: QuizWidget as ComponentType<{ data?: unknown }>,
    label: 'Quiz',
    icon: Target,
    accentVar: '--widget-quiz',
  },
  code: {
    component: CodeWidget as ComponentType<{ data?: unknown }>,
    label: 'Code Exercise',
    icon: Code,
    accentVar: '--widget-code',
  },
  codeCloze: {
    component: CodeClozeWidget as ComponentType<{ data?: unknown }>,
    label: 'Code Cloze',
    icon: PenLine,
    accentVar: '--widget-code-cloze',
  },
  demo: {
    component: GaussDemo as ComponentType<{ data?: unknown }>,
    label: 'Interactive Demo',
    icon: FlaskConical,
    accentVar: '--widget-demo',
  },
  sandbox: {
    component: SandboxWidget as ComponentType<{ data?: unknown }>,
    label: 'Sandbox',
    icon: Terminal,
    accentVar: '--widget-sandbox',
  },
  histogram: {
    component: HistogramWidget as ComponentType<{ data?: unknown }>,
    label: 'Histogram',
    icon: BarChart3,
    accentVar: '--widget-histogram',
  },
  plotImage: {
    component: PlotImageWidget as ComponentType<{ data?: unknown }>,
    label: 'Plot Image',
    icon: ImageIcon,
    accentVar: '--widget-plot-image',
  },
  parametricExplorer: {
    component: ParametricExplorerWidget as ComponentType<{ data?: unknown }>,
    label: 'Parametric Explorer',
    icon: Sliders,
    accentVar: '--widget-parametric-explorer',
  },
  dragMatch: {
    component: DragMatchWidget as ComponentType<{ data?: unknown }>,
    label: 'Drag Match',
    icon: Move,
    accentVar: '--widget-drag-match',
  },
  dataTable: {
    component: DataTableWidget as ComponentType<{ data?: unknown }>,
    label: 'Data Table',
    icon: TableIcon,
    accentVar: '--widget-data-table',
  },
  video: {
    component: VideoWidget as ComponentType<{ data?: unknown }>,
    label: 'Video',
    icon: VideoIcon,
    accentVar: '--widget-video',
  },
  audioPlayer: {
    component: AudioPlayerWidget as ComponentType<{ data?: unknown }>,
    label: 'Audio Player',
    icon: Headphones,
    accentVar: '--widget-audio-player',
  },
  transcriptCloze: {
    component: TranscriptClozeWidget as ComponentType<{ data?: unknown }>,
    label: 'Transcript Cloze',
    icon: Languages,
    accentVar: '--widget-transcript-cloze',
  },
  custom: {
    component: CustomPlaceholder,
    label: 'Custom Widget',
    icon: Layers,
    accentVar: '--accent',
  },
};
