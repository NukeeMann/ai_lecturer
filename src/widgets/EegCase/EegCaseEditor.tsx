'use client';

import type { Source } from '@/lib/schemas/lesson';
import { EegJsonEditor } from '@/widgets/common/eeg/EegJsonEditor';

import { EegCaseDataSchema, type EegCaseData } from './schema';

export interface EegCaseEditorProps {
  initial: EegCaseData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: EegCaseData, sources?: Source[]) => Promise<void>;
}

export function EegCaseEditor(props: EegCaseEditorProps) {
  return (
    <EegJsonEditor
      title="EEG case (JSON)"
      hint="vignette, figure (or viewer), steps: choice / multi / mark / measure / reveal, expert summary."
      schema={EegCaseDataSchema}
      testId="eeg-case-editor"
      {...props}
    />
  );
}

export default EegCaseEditor;
