'use client';

import type { Source } from '@/lib/schemas/lesson';
import { EegJsonEditor } from '@/widgets/common/eeg/EegJsonEditor';

import { EegFigureMarkDataSchema, type EegFigureMarkData } from './schema';

export interface EegFigureMarkEditorProps {
  initial: EegFigureMarkData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: EegFigureMarkData, sources?: Source[]) => Promise<void>;
}

export function EegFigureMarkEditor(props: EegFigureMarkEditorProps) {
  return (
    <EegJsonEditor
      title="Figure-marking exercise (JSON)"
      hint="figure (asset + attribution), point/box mode, expert targets and distractors in normalised 0..1 coordinates, optional caliper calibration."
      schema={EegFigureMarkDataSchema}
      testId="eeg-figure-mark-editor"
      {...props}
    />
  );
}

export default EegFigureMarkEditor;
