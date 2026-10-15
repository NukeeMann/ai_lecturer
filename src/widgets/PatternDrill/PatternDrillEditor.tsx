'use client';

import type { Source } from '@/lib/schemas/lesson';
import { EegJsonEditor } from '@/widgets/common/eeg/EegJsonEditor';

import { PatternDrillDataSchema, type PatternDrillData } from './schema';

export interface PatternDrillEditorProps {
  initial: PatternDrillData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: PatternDrillData, sources?: Source[]) => Promise<void>;
}

export function PatternDrillEditor(props: PatternDrillEditorProps) {
  return (
    <EegJsonEditor
      title="Pattern drill data (JSON)"
      hint="categories (2–9), items (real figure + attribution, answer category, explanation, optional crop and contrast item), session options."
      schema={PatternDrillDataSchema}
      testId="pattern-drill-editor"
      {...props}
    />
  );
}

export default PatternDrillEditor;
