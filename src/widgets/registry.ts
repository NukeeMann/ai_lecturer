import type { ComponentType } from 'react';
import {
  Code,
  FileText,
  FlaskConical,
  Layers,
  type LucideProps,
  Target,
  Terminal,
} from 'lucide-react';

import { CodePlaceholder } from './Code/CodePlaceholder';
import { CustomPlaceholder } from './Custom/CustomPlaceholder';
import { DemoPlaceholder } from './Demo/DemoPlaceholder';
import { QuizPlaceholder } from './Quiz/QuizPlaceholder';
import { SandboxPlaceholder } from './Sandbox/SandboxPlaceholder';
import { TheoryPlaceholder } from './Theory/TheoryPlaceholder';

export type WidgetType = 'theory' | 'quiz' | 'code' | 'demo' | 'sandbox' | 'custom';

export interface WidgetRegistryEntry {
  component: ComponentType<{ data?: unknown }>;
  label: string;
  icon: ComponentType<LucideProps>;
  accentVar: string;
}

export const widgetRegistry: Record<WidgetType, WidgetRegistryEntry> = {
  theory: {
    component: TheoryPlaceholder,
    label: 'Theory',
    icon: FileText,
    accentVar: '--widget-theory',
  },
  quiz: {
    component: QuizPlaceholder,
    label: 'Quiz',
    icon: Target,
    accentVar: '--widget-quiz',
  },
  code: {
    component: CodePlaceholder,
    label: 'Code Exercise',
    icon: Code,
    accentVar: '--widget-code',
  },
  demo: {
    component: DemoPlaceholder,
    label: 'Interactive Demo',
    icon: FlaskConical,
    accentVar: '--widget-demo',
  },
  sandbox: {
    component: SandboxPlaceholder,
    label: 'Sandbox',
    icon: Terminal,
    accentVar: '--widget-sandbox',
  },
  custom: {
    component: CustomPlaceholder,
    label: 'Custom Widget',
    icon: Layers,
    accentVar: '--accent',
  },
};
