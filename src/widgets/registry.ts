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

import { CodeWidget } from './Code/CodeWidget';
import { CustomPlaceholder } from './Custom/CustomPlaceholder';
import { DemoPlaceholder } from './Demo/DemoPlaceholder';
import { QuizWidget } from './Quiz/QuizWidget';
import { SandboxPlaceholder } from './Sandbox/SandboxPlaceholder';
import { TheoryWidget } from './Theory/TheoryWidget';

export type WidgetType = 'theory' | 'quiz' | 'code' | 'demo' | 'sandbox' | 'custom';

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
