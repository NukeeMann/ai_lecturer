'use client';

import type { Source } from '@/lib/schemas/lesson';
import { EegJsonEditor } from '@/widgets/common/eeg/EegJsonEditor';

import { EegViewerDataSchema, type EegViewerData } from './schema';

export interface EegViewerEditorProps {
  initial: EegViewerData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: EegViewerData, sources?: Source[]) => Promise<void>;
}

export function EegViewerEditor(props: EegViewerEditorProps) {
  return (
    <EegJsonEditor
      title="EEG viewer data (JSON)"
      hint="source (recording asset or simulation preset), initial display settings, optional markEvents task with an expert key."
      schema={EegViewerDataSchema}
      testId="eeg-viewer-editor"
      {...props}
    />
  );
}

export default EegViewerEditor;
