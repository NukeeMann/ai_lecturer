import type { ComponentType } from 'react';
import {
  BarChart3,
  Code,
  FileText,
  FlaskConical,
  Layers,
  type LucideProps,
  Target,
  Terminal,
} from 'lucide-react';

import { CodeWidget } from './Code/CodeWidget';
import { CustomPlaceholder } from './Custom/CustomPlaceholder';
import { GaussDemo } from './Demo/GaussDemo';
import { HistogramWidget } from './Histogram/HistogramWidget';
import { QuizWidget } from './Quiz/QuizWidget';
import { SandboxWidget } from './Sandbox/SandboxWidget';
import { TheoryWidget } from './Theory/TheoryWidget';

export type WidgetType =
  | 'theory'
  | 'quiz'
  | 'code'
  | 'demo'
  | 'sandbox'
  | 'histogram'
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
  custom: {
    component: CustomPlaceholder,
    label: 'Custom Widget',
    icon: Layers,
    accentVar: '--accent',
  },
};
