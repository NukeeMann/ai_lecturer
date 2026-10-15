'use client';

import type { Source } from '@/lib/schemas/lesson';
import { EegJsonEditor } from '@/widgets/common/eeg/EegJsonEditor';

import { FigureSequenceDataSchema, type FigureSequenceData } from './schema';

export interface FigureSequenceEditorProps {
  initial: FigureSequenceData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: FigureSequenceData, sources?: Source[]) => Promise<void>;
}

export function FigureSequenceEditor(props: FigureSequenceEditorProps) {
  return (
    <EegJsonEditor
      title="Figure sequence (JSON)"
      hint="layout stepper / slider / compare; frames with label, real figure + attribution and caption."
      schema={FigureSequenceDataSchema}
      testId="figure-sequence-editor"
      {...props}
    />
  );
}

export default FigureSequenceEditor;
