'use client';

import type { Source } from '@/lib/schemas/lesson';
import { EegJsonEditor } from '@/widgets/common/eeg/EegJsonEditor';

import { MontageLabDataSchema, type MontageLabData } from './schema';

export interface MontageLabEditorProps {
  initial: MontageLabData;
  initialSources?: Source[];
  onCancel: () => void;
  onSave: (next: MontageLabData, sources?: Source[]) => Promise<void>;
}

export function MontageLabEditor(props: MontageLabEditorProps) {
  return (
    <EegJsonEditor
      title="Montage lab data (JSON)"
      hint="scenario (simulation preset or spec), montages, editable source options, optional click-to-answer challenges."
      schema={MontageLabDataSchema}
      testId="montage-lab-editor"
      {...props}
    />
  );
}

export default MontageLabEditor;
