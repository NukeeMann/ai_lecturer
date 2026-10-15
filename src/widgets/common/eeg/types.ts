// Shared prop contract of the EEG widgets (spec §0). Node-safe.

export interface EegProgressKey {
  courseSlug: string;
  lessonSlug: string;
  sectionId: string;
}

export interface EegWidgetProps<D> {
  /** Raw lesson JSON in the static export — widgets safeParse it themselves. */
  data: D | unknown;
  /** Absent in the static export / previews: then never write progress. */
  progressKey?: EegProgressKey;
  /** Call once when the learner finishes (submits / completes). */
  onComplete?: () => void;
  /** `sectionState[sectionId].widgetState` from progress (validate before use). */
  initialWidgetState?: unknown;
  /** The section is already done (suppress celebrations on re-entry). */
  alreadyCompleted?: boolean;
}
