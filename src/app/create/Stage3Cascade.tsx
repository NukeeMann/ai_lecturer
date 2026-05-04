'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  computeStageInputHash,
  hasUserEdits,
  isStageStale,
  snapshotUpstreamHashes,
  type WizardCaches,
} from '@/lib/wizard/dependencies';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, ArrowLeft, Sparkles } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Level = 'beginner' | 'intermediate' | 'advanced';
export type DurationTarget = 'short' | 'standard' | 'extensive' | 'comprehensive';

export interface LessonDraft {
  id: string;
  title: string;
  summary: string;
  estimatedMinutes: number;
}

export interface ModuleDraft {
  id: string;
  title: string;
  lessons: LessonDraft[];
}

export interface StructureDraft {
  courseTitle: string;
  courseDescription: string;
  modules: ModuleDraft[];
}

export interface ClarificationQuestion {
  id: string;
  text: string;
}

export interface Draft {
  topic: string;
  level: Level | null;
  durationTarget: DurationTarget | null;
  theoryPracticeRatio: number;
  /** Questions returned by /api/wizard/clarify (cached so back-nav can re-render). */
  clarificationQuestions?: ClarificationQuestion[];
  /** Free-form learner answers, keyed by question id. */
  clarification?: Record<string, string>;
  structure: StructureDraft | null;
  /**
   * Per-stage cache records used to detect when an upstream input has changed
   * and the downstream cached output needs to be regenerated (US-093).
   */
  caches?: WizardCaches;
}

// ─── Seed defaults ───────────────────────────────────────────────────────────

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Math.random().toString(36).slice(2, 11)}`;
}

function capitalize(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const LEVEL_DESCRIPTORS: Record<Level, string> = {
  beginner: 'A beginner-friendly introduction',
  intermediate: 'A practical guide',
  advanced: 'A focused deep dive',
};

const MODULE_TEMPLATES: { title: (topic: string) => string; lessons: string[] }[] = [
  {
    title: (topic) => `Module 1: Intro to ${topic}`,
    lessons: ['What is it?', 'Why it matters', 'A first example', 'Wrap up'],
  },
  {
    title: () => `Module 2: Core concepts`,
    lessons: ['Foundations', 'Key building blocks', 'Common patterns', 'Hands-on practice'],
  },
  {
    title: () => `Module 3: Putting it together`,
    lessons: [
      'Real-world applications',
      'Edge cases & gotchas',
      'Best practices',
      'Where to go next',
    ],
  },
  {
    title: () => `Module 4: Advanced techniques`,
    lessons: [
      'Going deeper',
      'Optimization tricks',
      'Less obvious pitfalls',
      'Hands-on advanced practice',
    ],
  },
  {
    title: () => `Module 5: Capstone & next steps`,
    lessons: [
      'A capstone project',
      'Comparing to alternatives',
      'How experts approach this',
      'Curated reading list',
    ],
  },
  {
    title: () => `Module 6: Specialised topics`,
    lessons: [
      'Niche application 1',
      'Niche application 2',
      'Edge-of-field research',
      'Open problems',
    ],
  },
];

const DURATION_PROFILE: Record<DurationTarget, { moduleCount: number; lessonsPerModule: number }> = {
  short: { moduleCount: 1, lessonsPerModule: 4 },
  standard: { moduleCount: 3, lessonsPerModule: 4 },
  extensive: { moduleCount: 4, lessonsPerModule: 6 },
  comprehensive: { moduleCount: 6, lessonsPerModule: 8 },
};

export function seedStructure(
  rawTopic: string,
  level: Level | null,
  durationTarget: DurationTarget | null = null,
): StructureDraft {
  const topic = rawTopic.trim() || 'this topic';
  const titleTopic = capitalize(topic);
  const lvl = level ?? 'beginner';
  const profile = DURATION_PROFILE[durationTarget ?? 'standard'];
  const moduleCount = Math.min(profile.moduleCount, MODULE_TEMPLATES.length);
  return {
    courseTitle: titleTopic,
    courseDescription: `${LEVEL_DESCRIPTORS[lvl]} to ${topic}.`,
    modules: MODULE_TEMPLATES.slice(0, moduleCount).map((tpl) => {
      const baseLessons = tpl.lessons;
      const lessons: string[] = [];
      for (let i = 0; i < profile.lessonsPerModule; i++) {
        lessons.push(baseLessons[i % baseLessons.length]);
      }
      return {
        id: makeId(),
        title: tpl.title(titleTopic),
        lessons: lessons.map((lessonTitle, i) => ({
          id: makeId(),
          title: `Lesson ${i + 1}: ${lessonTitle}`,
          summary: 'Brief 1-line description.',
          estimatedMinutes: 10,
        })),
      };
    }),
  };
}

// ─── Stage 3 Cascade ─────────────────────────────────────────────────────────

interface Stage3Props {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  onNext: () => void;
  onBack: () => void;
}

export default function Stage3Cascade({ draft, setDraft, onNext, onBack }: Stage3Props) {
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  // One-shot guard for the on-mount stale check / initial seed (we only want
  // to evaluate "did upstream change while I was away?" once per mount).
  const stalenessHandledRef = useRef(false);

  // Re-seed the structure with current topic/level/duration AND record a
  // fresh cache snapshot. Used both for first-entry seed and stale-reopen
  // regeneration.
  const seedAndCache = useCallback(() => {
    setDraft((d) => {
      const next = seedStructure(d.topic, d.level, d.durationTarget);
      const draftWithStructure = { ...d, structure: next };
      const generatedHash = computeStageInputHash('structure', draftWithStructure);
      return {
        ...draftWithStructure,
        caches: {
          ...(d.caches ?? {}),
          structure: {
            upstreamHashes: snapshotUpstreamHashes('structure', draftWithStructure),
            generatedHash,
          },
        },
      };
    });
  }, [setDraft]);

  // Seed on first entry / stale reopen. The ref-gate makes this a one-shot
  // subscription pattern; eslint's set-state-in-effect rule still flags it.
  useEffect(() => {
    if (stalenessHandledRef.current) return;
    stalenessHandledRef.current = true;
    if (!draft.structure) {
      seedAndCache();
      return;
    }
    const cache = draft.caches?.structure;
    if (isStageStale('structure', draft, cache)) {
      if (hasUserEdits('structure', draft, cache)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setConfirmRegenerate(true);
      } else {
        seedAndCache();
      }
    }
  }, [draft, seedAndCache]);

  const handleConfirmRegenerate = useCallback(() => {
    setConfirmRegenerate(false);
    seedAndCache();
  }, [seedAndCache]);

  const handleKeepCurrent = useCallback(() => {
    setConfirmRegenerate(false);
    // User chose to keep their edits; refresh the cache's upstreamHashes so
    // the dialog doesn't keep re-firing on every reopen, but DO NOT touch
    // their structure content.
    setDraft((d) => {
      if (!d.structure) return d;
      const generatedHash = computeStageInputHash('structure', d);
      return {
        ...d,
        caches: {
          ...(d.caches ?? {}),
          structure: {
            upstreamHashes: snapshotUpstreamHashes('structure', d),
            generatedHash,
          },
        },
      };
    });
  }, [setDraft]);

  const structure = draft.structure;
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);

  // Effective selection falls back to first module if user-selected id is missing
  const effectiveSelectedId = useMemo(() => {
    if (!structure || structure.modules.length === 0) return null;
    if (selectedModuleId && structure.modules.some((m) => m.id === selectedModuleId)) {
      return selectedModuleId;
    }
    return structure.modules[0].id;
  }, [structure, selectedModuleId]);

  const updateStructure = useCallback(
    (mut: (s: StructureDraft) => StructureDraft) => {
      setDraft((d) => {
        if (!d.structure) return d;
        return { ...d, structure: mut(d.structure) };
      });
    },
    [setDraft],
  );

  const setCourseTitle = (v: string) =>
    updateStructure((s) => ({ ...s, courseTitle: v }));
  const setCourseDescription = (v: string) =>
    updateStructure((s) => ({ ...s, courseDescription: v }));

  const setModuleTitle = (moduleId: string, v: string) =>
    updateStructure((s) => ({
      ...s,
      modules: s.modules.map((m) => (m.id === moduleId ? { ...m, title: v } : m)),
    }));

  const addModule = () =>
    updateStructure((s) => {
      const idx = s.modules.length + 1;
      return {
        ...s,
        modules: [
          ...s.modules,
          {
            id: makeId(),
            title: `Module ${idx}: New module`,
            lessons: [
              {
                id: makeId(),
                title: `Lesson 1: Overview`,
                summary: 'Brief 1-line description.',
                estimatedMinutes: 10,
              },
            ],
          },
        ],
      };
    });

  const removeModule = (moduleId: string) =>
    updateStructure((s) => ({
      ...s,
      modules: s.modules.filter((m) => m.id !== moduleId),
    }));

  const reorderModules = (fromId: string, toId: string) =>
    updateStructure((s) => {
      const from = s.modules.findIndex((m) => m.id === fromId);
      const to = s.modules.findIndex((m) => m.id === toId);
      if (from === -1 || to === -1 || from === to) return s;
      return { ...s, modules: arrayMove(s.modules, from, to) };
    });

  const setLessonField = <K extends keyof LessonDraft>(
    moduleId: string,
    lessonId: string,
    key: K,
    value: LessonDraft[K],
  ) =>
    updateStructure((s) => ({
      ...s,
      modules: s.modules.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              lessons: m.lessons.map((l) =>
                l.id === lessonId ? { ...l, [key]: value } : l,
              ),
            }
          : m,
      ),
    }));

  const addLesson = (moduleId: string) =>
    updateStructure((s) => ({
      ...s,
      modules: s.modules.map((m) => {
        if (m.id !== moduleId) return m;
        const idx = m.lessons.length + 1;
        return {
          ...m,
          lessons: [
            ...m.lessons,
            {
              id: makeId(),
              title: `Lesson ${idx}: New lesson`,
              summary: 'Brief 1-line description.',
              estimatedMinutes: 10,
            },
          ],
        };
      }),
    }));

  const removeLesson = (moduleId: string, lessonId: string) =>
    updateStructure((s) => ({
      ...s,
      modules: s.modules.map((m) =>
        m.id === moduleId
          ? { ...m, lessons: m.lessons.filter((l) => l.id !== lessonId) }
          : m,
      ),
    }));

  const reorderLessons = (moduleId: string, fromId: string, toId: string) =>
    updateStructure((s) => ({
      ...s,
      modules: s.modules.map((m) => {
        if (m.id !== moduleId) return m;
        const from = m.lessons.findIndex((l) => l.id === fromId);
        const to = m.lessons.findIndex((l) => l.id === toId);
        if (from === -1 || to === -1 || from === to) return m;
        return { ...m, lessons: arrayMove(m.lessons, from, to) };
      }),
    }));

  const selectedModule =
    structure?.modules.find((m) => m.id === effectiveSelectedId) ?? null;

  const totalLessons = useMemo(
    () => structure?.modules.reduce((acc, m) => acc + m.lessons.length, 0) ?? 0,
    [structure],
  );

  if (!structure) {
    return (
      <div style={stageWrapStyle}>
        <div style={{ flex: 1 }} />
      </div>
    );
  }

  return (
    <div style={stageWrapStyle} data-testid="stage3-cascade">
      {confirmRegenerate && (
        <ConfirmRegenerateDialog
          stageLabel="Structure"
          onConfirm={handleConfirmRegenerate}
          onCancel={handleKeepCurrent}
        />
      )}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 'var(--space-5) var(--space-6) var(--space-7)',
          background: 'var(--bg-subtle)',
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: '0 auto',
            display: 'grid',
            gridTemplateColumns: '300px 320px 1fr',
            gap: 'var(--space-5)',
          }}
        >
          {/* Column 1 — Course */}
          <CascadeColumn title="Course" subtitle="Your full curriculum">
            <div style={courseCardStyle} data-testid="stage3-course-card">
              <InlineEdit
                value={structure.courseTitle}
                onChange={setCourseTitle}
                testId="stage3-course-title"
                style={{
                  fontSize: 'var(--fs-md)',
                  fontWeight: 600,
                  color: 'var(--text)',
                }}
              />
              <InlineEdit
                value={structure.courseDescription}
                onChange={setCourseDescription}
                testId="stage3-course-description"
                multiline
                style={{
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-tertiary)',
                  marginTop: 6,
                  lineHeight: 1.4,
                }}
              />
              <div
                style={{
                  marginTop: 12,
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-quaternary)',
                  fontFamily: 'var(--font-mono)',
                }}
                data-testid="stage3-course-meta"
              >
                {structure.modules.length} modules · {totalLessons} lessons
              </div>
            </div>
          </CascadeColumn>

          {/* Column 2 — Modules */}
          <CascadeColumn
            title="Modules"
            subtitle={`${structure.modules.length} modules · drag to reorder`}
          >
            <DndContextWrapper
              ids={structure.modules.map((m) => m.id)}
              onReorder={reorderModules}
            >
              {structure.modules.map((m) => (
                <SortableModuleCard
                  key={m.id}
                  module={m}
                  selected={m.id === effectiveSelectedId}
                  onSelect={() => setSelectedModuleId(m.id)}
                  onRename={(v) => setModuleTitle(m.id, v)}
                  onDelete={() => removeModule(m.id)}
                  canDelete={structure.modules.length > 1}
                />
              ))}
            </DndContextWrapper>
            <AddButton
              label="Add module"
              onClick={addModule}
              testId="stage3-add-module"
            />
          </CascadeColumn>

          {/* Column 3 — Lessons */}
          <CascadeColumn
            title="Lessons"
            subtitle={selectedModule ? selectedModule.title : 'Select a module'}
            accent
          >
            {selectedModule ? (
              <>
                <DndContextWrapper
                  ids={selectedModule.lessons.map((l) => l.id)}
                  onReorder={(fromId, toId) =>
                    reorderLessons(selectedModule.id, fromId, toId)
                  }
                >
                  {selectedModule.lessons.map((l, i) => (
                    <SortableLessonRow
                      key={l.id}
                      lesson={l}
                      index={i}
                      onRenameTitle={(v) =>
                        setLessonField(selectedModule.id, l.id, 'title', v)
                      }
                      onRenameSummary={(v) =>
                        setLessonField(selectedModule.id, l.id, 'summary', v)
                      }
                      onChangeMinutes={(v) =>
                        setLessonField(selectedModule.id, l.id, 'estimatedMinutes', v)
                      }
                      onDelete={() => removeLesson(selectedModule.id, l.id)}
                      canDelete={selectedModule.lessons.length > 1}
                    />
                  ))}
                </DndContextWrapper>
                <AddButton
                  label="Add lesson"
                  onClick={() => addLesson(selectedModule.id)}
                  testId="stage3-add-lesson"
                />
              </>
            ) : (
              <div
                style={{
                  padding: 'var(--space-5)',
                  fontSize: 'var(--fs-xs)',
                  color: 'var(--text-tertiary)',
                  textAlign: 'center',
                }}
              >
                No module selected
              </div>
            )}
          </CascadeColumn>
        </div>
      </div>

      {/* Sticky bottom bar */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          padding: 'var(--space-4) var(--space-6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <button
          type="button"
          data-testid="wizard-back"
          onClick={onBack}
          style={ghostBtnStyle}
        >
          <ArrowLeft size={14} strokeWidth={2} />
          Back
        </button>
        <button
          type="button"
          data-testid="wizard-next"
          onClick={onNext}
          style={primaryBtnStyle}
        >
          <Sparkles size={14} strokeWidth={2} />
          Looks good — generate
        </button>
      </div>
    </div>
  );
}

// ─── DnD wrapper ─────────────────────────────────────────────────────────────

function DndContextWrapper({
  ids,
  onReorder,
  children,
}: {
  ids: string[];
  onReorder: (fromId: string, toId: string) => void;
  children: ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    onReorder(String(active.id), String(over.id));
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

// ─── Sortable Module Card ────────────────────────────────────────────────────

function SortableModuleCard({
  module: mod,
  selected,
  onSelect,
  onRename,
  onDelete,
  canDelete,
}: {
  module: ModuleDraft;
  selected: boolean;
  onSelect: () => void;
  onRename: (v: string) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: mod.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 10px 10px 6px',
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    background: selected ? 'var(--accent-subtle)' : 'var(--bg-elevated)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
  };

  const handleCardClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-stop-select]')) return;
    onSelect();
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={handleCardClick}
      data-testid={`stage3-module-card-${mod.id}`}
      data-selected={selected}
      data-module-id={mod.id}
    >
      <button
        type="button"
        data-stop-select
        data-testid={`stage3-module-grip-${mod.id}`}
        aria-label="Drag to reorder module"
        {...attributes}
        {...listeners}
        style={gripBtnStyle}
      >
        <GripVertical size={14} />
      </button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <InlineEdit
          value={mod.title}
          onChange={onRename}
          editEnabled={selected}
          testId={`stage3-module-title-${mod.id}`}
          style={{
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            color: selected ? 'var(--accent-text)' : 'var(--text)',
          }}
        />
        <div
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-tertiary)',
            marginTop: 2,
          }}
        >
          {mod.lessons.length} lesson{mod.lessons.length === 1 ? '' : 's'}
        </div>
      </div>
      <DeleteButton
        onConfirm={onDelete}
        disabled={!canDelete}
        testId={`stage3-module-trash-${mod.id}`}
        confirmTestId={`stage3-module-trash-confirm-${mod.id}`}
        ariaLabel="Delete module"
      />
    </div>
  );
}

// ─── Sortable Lesson Row ─────────────────────────────────────────────────────

function SortableLessonRow({
  lesson,
  index,
  onRenameTitle,
  onRenameSummary,
  onChangeMinutes,
  onDelete,
  canDelete,
}: {
  lesson: LessonDraft;
  index: number;
  onRenameTitle: (v: string) => void;
  onRenameSummary: (v: string) => void;
  onChangeMinutes: (v: number) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lesson.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    border: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 10px 10px 6px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`stage3-lesson-row-${lesson.id}`}
      data-lesson-id={lesson.id}
    >
      <button
        type="button"
        data-testid={`stage3-lesson-grip-${lesson.id}`}
        aria-label="Drag to reorder lesson"
        {...attributes}
        {...listeners}
        style={{ ...gripBtnStyle, marginTop: 2 }}
      >
        <GripVertical size={14} />
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--text-tertiary)',
              flexShrink: 0,
            }}
          >
            L{String(index + 1).padStart(2, '0')}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <InlineEdit
              value={lesson.title}
              onChange={onRenameTitle}
              testId={`stage3-lesson-title-${lesson.id}`}
              style={{
                fontSize: 'var(--fs-sm)',
                fontWeight: 500,
                color: 'var(--text)',
              }}
            />
          </div>
          <MinutesEdit
            value={lesson.estimatedMinutes}
            onChange={onChangeMinutes}
            testId={`stage3-lesson-minutes-${lesson.id}`}
          />
        </div>
        <InlineEdit
          value={lesson.summary}
          onChange={onRenameSummary}
          testId={`stage3-lesson-summary-${lesson.id}`}
          multiline
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-tertiary)',
            lineHeight: 1.4,
            paddingLeft: 28,
          }}
        />
      </div>
      <DeleteButton
        onConfirm={onDelete}
        disabled={!canDelete}
        testId={`stage3-lesson-trash-${lesson.id}`}
        confirmTestId={`stage3-lesson-trash-confirm-${lesson.id}`}
        ariaLabel="Delete lesson"
      />
    </div>
  );
}

// ─── Inline edit ─────────────────────────────────────────────────────────────

function InlineEdit({
  value,
  onChange,
  multiline = false,
  style,
  testId,
  editEnabled = true,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  style?: CSSProperties;
  testId?: string;
  editEnabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select?.();
      });
    }
  }, [editing]);

  const startEditing = () => setDraft(value);

  const commit = () => {
    if (draft === null) return;
    const next = draft.trim();
    if (next.length === 0) {
      setDraft(null);
      return;
    }
    if (next !== value) onChange(next);
    setDraft(null);
  };

  const cancel = () => {
    setDraft(null);
  };

  const handleKey = (
    e: ReactKeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    if (e.key === 'Enter' && !(multiline && e.shiftKey)) {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  };

  if (editing) {
    const inputStyle: CSSProperties = {
      ...style,
      width: '100%',
      border: '1px solid var(--accent)',
      borderRadius: 'var(--radius-sm)',
      padding: '4px 6px',
      background: 'var(--bg)',
      color: 'var(--text)',
      fontFamily: 'inherit',
      outline: 'none',
      boxSizing: 'border-box',
      resize: 'none',
    };
    if (multiline) {
      return (
        <textarea
          ref={(el) => {
            inputRef.current = el;
          }}
          rows={2}
          value={draft ?? ''}
          data-testid={testId}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKey}
          style={inputStyle}
        />
      );
    }
    return (
      <input
        ref={(el) => {
          inputRef.current = el;
        }}
        type="text"
        value={draft ?? ''}
        data-testid={testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKey}
        style={inputStyle}
      />
    );
  }

  return (
    <span
      role={editEnabled ? 'button' : undefined}
      tabIndex={editEnabled ? 0 : undefined}
      data-testid={testId}
      onClick={(e) => {
        if (!editEnabled) return; // let click bubble (e.g. to card-select)
        e.stopPropagation();
        startEditing();
      }}
      onKeyDown={(e) => {
        if (!editEnabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          startEditing();
        }
      }}
      style={{
        ...style,
        cursor: 'text',
        display: 'block',
        whiteSpace: multiline ? 'normal' : 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {value}
    </span>
  );
}

// ─── Minutes edit ────────────────────────────────────────────────────────────

function MinutesEdit({
  value,
  onChange,
  testId,
}: {
  value: number;
  onChange: (v: number) => void;
  testId?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const startEditing = () => setDraft(String(value));

  const commit = () => {
    if (draft === null) return;
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n > 0 && n !== value) onChange(n);
    setDraft(null);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={1}
        value={draft ?? ''}
        data-testid={testId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setDraft(null);
          }
        }}
        style={{
          width: 56,
          padding: '2px 4px',
          fontSize: 'var(--fs-xs)',
          fontFamily: 'var(--font-mono)',
          border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg)',
          color: 'var(--text)',
          outline: 'none',
        }}
      />
    );
  }

  return (
    <button
      type="button"
      data-stop-select
      data-testid={testId}
      onClick={startEditing}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 22,
        padding: '0 8px',
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-full)',
        color: 'var(--text-secondary)',
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {value} min
    </button>
  );
}

// ─── Delete button (inline confirm) ──────────────────────────────────────────

function DeleteButton({
  onConfirm,
  disabled,
  testId,
  confirmTestId,
  ariaLabel,
}: {
  onConfirm: () => void;
  disabled?: boolean;
  testId?: string;
  confirmTestId?: string;
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!armed) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setArmed(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [armed]);

  if (armed) {
    return (
      <span
        ref={wrapperRef}
        data-stop-select
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <button
          type="button"
          data-testid={confirmTestId}
          onClick={(e) => {
            e.stopPropagation();
            setArmed(false);
            onConfirm();
          }}
          style={{
            height: 22,
            padding: '0 8px',
            background: 'var(--danger)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: 'white',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
          }}
        >
          Delete?
        </button>
      </span>
    );
  }

  return (
    <span ref={wrapperRef} data-stop-select>
      <button
        type="button"
        data-testid={testId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setArmed(true);
        }}
        style={{
          ...iconBtnStyle,
          opacity: disabled ? 0.4 : 1,
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <Trash2 size={13} />
      </button>
    </span>
  );
}

// ─── Misc small components ───────────────────────────────────────────────────

function CascadeColumn({
  title,
  subtitle,
  accent,
  children,
}: {
  title: string;
  subtitle: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <div
        style={{
          padding: 'var(--space-3) var(--space-4)',
          borderBottom: '1px solid var(--border)',
          background: accent ? 'var(--accent-subtle)' : 'var(--bg-subtle)',
        }}
      >
        <div
          style={{
            fontSize: 10.5,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 600,
            color: accent ? 'var(--accent-text)' : 'var(--text-tertiary)',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: 'var(--fs-xs)',
            color: 'var(--text-secondary)',
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {subtitle}
        </div>
      </div>
      <div
        style={{
          padding: 'var(--space-3)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          flex: 1,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AddButton({
  label,
  onClick,
  testId,
}: {
  label: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '10px 12px',
        background: 'transparent',
        border: '1px dashed var(--border-strong)',
        borderRadius: 'var(--radius-md)',
        color: 'var(--text-tertiary)',
        fontSize: 'var(--fs-xs)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <Plus size={12} />
      {label}
    </button>
  );
}

// ─── Confirm-regenerate dialog ───────────────────────────────────────────────

function ConfirmRegenerateDialog({
  stageLabel,
  onConfirm,
  onCancel,
}: {
  stageLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      data-testid="wizard-regenerate-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-regenerate-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg, 12px)',
          padding: 'var(--space-5)',
          maxWidth: 440,
          margin: '0 var(--space-4)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.18)',
        }}
      >
        <div
          id="wizard-regenerate-title"
          style={{
            fontSize: 'var(--fs-md)',
            fontWeight: 600,
            color: 'var(--text)',
            marginBottom: 8,
          }}
        >
          Upstream changed — regenerate {stageLabel}?
        </div>
        <p
          data-testid="wizard-regenerate-body"
          style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: 'var(--fs-sm)',
            lineHeight: 1.5,
          }}
        >
          Your edits will be lost.
        </p>
        <div
          style={{
            marginTop: 'var(--space-4)',
            display: 'flex',
            gap: 'var(--space-3)',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            data-testid="wizard-regenerate-cancel"
            onClick={onCancel}
            style={ghostBtnStyle}
          >
            Keep my edits
          </button>
          <button
            type="button"
            data-testid="wizard-regenerate-confirm"
            onClick={onConfirm}
            style={primaryBtnStyle}
          >
            Regenerate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const stageWrapStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const courseCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '12px 14px',
  border: '1px solid var(--accent)',
  background: 'var(--accent-subtle)',
  borderRadius: 'var(--radius-md)',
};

const gripBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  background: 'transparent',
  border: 'none',
  color: 'var(--text-quaternary)',
  cursor: 'grab',
  padding: 0,
  flexShrink: 0,
};

const iconBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  background: 'transparent',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--text-tertiary)',
  cursor: 'pointer',
  flexShrink: 0,
};

const ghostBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 36,
  padding: '0 14px',
  border: 'none',
  background: 'transparent',
  color: 'var(--text-secondary)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
};

const primaryBtnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  height: 36,
  padding: '0 18px',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  background: 'var(--accent)',
  color: 'var(--text-on-accent)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  fontFamily: 'inherit',
  cursor: 'pointer',
  transition: 'background var(--t-fast), opacity var(--t-fast)',
};
