'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Check, X } from 'lucide-react';

import { Callout } from '@/components/Callout';

import {
  DragMatchDataSchema,
  validateDragMatch,
  type DragMatchData,
  type DragMatchItem,
  type DragMatchPlacement,
} from './schema';

export const DRAG_MATCH_BANK_ID = '__bank__';

export interface DragMatchProgressKey {
  courseSlug: string;
  lessonSlug: string;
  sectionId: string;
}

export interface DragMatchWidgetProps {
  data: DragMatchData;
  progressKey?: DragMatchProgressKey;
  onComplete?: () => void;
}

const wrapStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
  padding: 'var(--space-5)',
};

const promptStyle: CSSProperties = {
  fontSize: 'var(--fs-md)',
  fontWeight: 500,
  color: 'var(--text)',
  lineHeight: 1.4,
};

const sectionLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-tertiary)',
  marginBottom: 'var(--space-2)',
};

const itemBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-strong)',
  fontSize: 'var(--fs-sm)',
  color: 'var(--text)',
  cursor: 'grab',
  userSelect: 'none',
  touchAction: 'none',
  lineHeight: 1.3,
};

const zonesGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
  gap: 'var(--space-3)',
};

const submitButtonBase: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 36,
  padding: '0 var(--space-5)',
  borderRadius: 'var(--radius-md)',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  cursor: 'pointer',
  border: '1px solid transparent',
};

interface DraggableItemProps {
  item: DragMatchItem;
  misplaced: boolean;
  expectedZoneLabel: string | null;
  submitted: boolean;
  disabled: boolean;
}

function DraggableItem({
  item,
  misplaced,
  expectedZoneLabel,
  submitted,
  disabled,
}: DraggableItemProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: item.id,
      disabled,
      attributes: { roleDescription: 'Draggable item' },
    });

  const style: CSSProperties = {
    ...itemBaseStyle,
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0 : 1,
    cursor: disabled ? 'default' : 'grab',
  };

  if (submitted && misplaced) {
    style.outline = '2px dashed var(--danger-border)';
    style.outlineOffset = 2;
  } else if (submitted) {
    style.outline = '2px solid var(--success-border)';
    style.outlineOffset = 2;
  }

  return (
    <span
      ref={setNodeRef}
      data-testid={`dragmatch-item-${item.id}`}
      data-item-id={item.id}
      data-misplaced={submitted && misplaced ? 'true' : 'false'}
      style={style}
      {...listeners}
      {...attributes}
    >
      {item.label}
      {submitted && misplaced && expectedZoneLabel && (
        <span
          data-testid={`dragmatch-item-expected-${item.id}`}
          style={{
            marginLeft: 6,
            fontSize: 'var(--fs-xs)',
            color: 'var(--danger)',
            fontStyle: 'italic',
          }}
        >
          → {expectedZoneLabel}
        </span>
      )}
    </span>
  );
}

interface DroppableContainerProps {
  id: string;
  children: React.ReactNode;
  testId?: string;
  baseStyle: CSSProperties;
  hoverStyle?: CSSProperties;
  feedbackStyle?: CSSProperties;
  ariaLabel?: string;
}

function DroppableContainer({
  id,
  children,
  testId,
  baseStyle,
  hoverStyle,
  feedbackStyle,
  ariaLabel,
}: DroppableContainerProps) {
  const { setNodeRef, isOver, active } = useDroppable({ id });
  const showHover = isOver && active !== null;

  const style: CSSProperties = {
    ...baseStyle,
    ...(showHover && hoverStyle ? hoverStyle : {}),
    ...(feedbackStyle ?? {}),
  };

  return (
    <div
      ref={setNodeRef}
      data-testid={testId}
      data-drop-id={id}
      data-drop-over={showHover ? 'true' : 'false'}
      aria-label={ariaLabel}
      style={style}
    >
      {children}
    </div>
  );
}

const bankBaseStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)',
  minHeight: 56,
  padding: 'var(--space-3)',
  borderRadius: 'var(--radius-md)',
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'var(--border-strong)',
  background: 'var(--bg-subtle)',
};

const zoneBaseStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  minHeight: 96,
  padding: 'var(--space-3)',
  borderRadius: 'var(--radius-md)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border-strong)',
  background: 'var(--bg-elevated)',
};

const zoneLabelStyle: CSSProperties = {
  fontSize: 'var(--fs-sm)',
  color: 'var(--text-secondary)',
  fontWeight: 500,
  marginBottom: 4,
};

const zoneItemsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 'var(--space-2)',
  flex: 1,
};

const zoneEmptyHintStyle: CSSProperties = {
  fontSize: 'var(--fs-xs)',
  color: 'var(--text-quaternary)',
  fontStyle: 'italic',
};

const hoverStyle: CSSProperties = {
  background: 'var(--accent-subtle)',
  borderColor: 'var(--accent-border)',
};

function zoneFeedbackStyle(state: 'correct' | 'incorrect' | 'idle'): CSSProperties {
  if (state === 'correct') {
    return {
      background: 'var(--success-subtle)',
      borderColor: 'var(--success-border)',
    };
  }
  if (state === 'incorrect') {
    return {
      background: 'var(--danger-subtle)',
      borderColor: 'var(--danger-border)',
    };
  }
  return {};
}

function buildInitialPlacement(data: DragMatchData): DragMatchPlacement {
  const out: DragMatchPlacement = {};
  out[DRAG_MATCH_BANK_ID] = data.items.map((i) => i.id);
  for (const z of data.zones) out[z.id] = [];
  return out;
}

export function DragMatchWidget({
  data: rawData,
  progressKey,
  onComplete,
}: DragMatchWidgetProps) {
  const data = useMemo(() => DragMatchDataSchema.parse(rawData), [rawData]);

  const [placement, setPlacement] = useState<DragMatchPlacement>(() =>
    buildInitialPlacement(data),
  );
  const [submitted, setSubmitted] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const completedOnceRef = useRef(false);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const itemById = useMemo(() => {
    const m = new Map<string, DragMatchItem>();
    for (const it of data.items) m.set(it.id, it);
    return m;
  }, [data.items]);

  const expectedZoneLabelByItem = useMemo(() => {
    const m = new Map<string, string>();
    for (const z of data.zones) {
      for (const itemId of z.accepts) m.set(itemId, z.label);
    }
    return m;
  }, [data.zones]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor),
  );

  const validation = useMemo(
    () => (submitted ? validateDragMatch(data, placement) : null),
    [submitted, data, placement],
  );

  const allCorrect = validation?.allCorrect ?? false;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over) return;
      const itemId = String(active.id);
      const targetId = String(over.id);

      setPlacement((prev) => {
        const next: DragMatchPlacement = {};
        for (const k of Object.keys(prev)) next[k] = prev[k].slice();

        let sourceContainer: string | null = null;
        for (const k of Object.keys(next)) {
          if (next[k].includes(itemId)) {
            sourceContainer = k;
            break;
          }
        }
        if (!sourceContainer) return prev;
        if (sourceContainer === targetId) return prev;

        next[sourceContainer] = next[sourceContainer].filter((id) => id !== itemId);

        if (!next[targetId]) next[targetId] = [];

        const targetIsZone = data.zones.some((z) => z.id === targetId);
        if (targetIsZone && !data.multipleItemsPerZone) {
          // single-item-per-zone: move existing occupants back to bank
          const displaced = next[targetId];
          if (displaced.length > 0) {
            next[DRAG_MATCH_BANK_ID] = [
              ...(next[DRAG_MATCH_BANK_ID] ?? []),
              ...displaced,
            ];
          }
          next[targetId] = [itemId];
        } else {
          next[targetId] = [...next[targetId], itemId];
        }
        return next;
      });

      if (submitted) setSubmitted(false);
    },
    [data, submitted],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const handleSubmit = useCallback(() => {
    setSubmitted(true);
    const result = validateDragMatch(data, placement);
    if (result.allCorrect && !completedOnceRef.current) {
      completedOnceRef.current = true;
      if (progressKey) void patchSectionDone(progressKey);
      onCompleteRef.current?.();
    }
  }, [data, placement, progressKey]);

  const handleReset = useCallback(() => {
    setPlacement(buildInitialPlacement(data));
    setSubmitted(false);
  }, [data]);

  const bankItems = placement[DRAG_MATCH_BANK_ID] ?? [];
  const allPlaced = bankItems.length === 0;

  const submitDisabled = submitted ? false : !allPlaced;
  const submitButtonStyle: CSSProperties = useMemo(() => {
    if (submitted && allCorrect) {
      return {
        ...submitButtonBase,
        background: 'transparent',
        border: '1px solid var(--success-border)',
        color: 'var(--success)',
        cursor: 'default',
      };
    }
    if (submitted) {
      return {
        ...submitButtonBase,
        background: 'transparent',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-strong)',
      };
    }
    return {
      ...submitButtonBase,
      background: submitDisabled ? 'var(--bg-active)' : 'var(--accent)',
      color: submitDisabled ? 'var(--text-tertiary)' : 'var(--text-on-accent)',
      cursor: submitDisabled ? 'not-allowed' : 'pointer',
      opacity: submitDisabled ? 0.7 : 1,
    };
  }, [submitted, allCorrect, submitDisabled]);

  function renderItem(itemId: string, opts: { inOverlay?: boolean } = {}) {
    const item = itemById.get(itemId);
    if (!item) return null;
    const misplaced = validation?.misplacedItemIds.has(item.id) ?? false;
    const expectedZoneLabel = expectedZoneLabelByItem.get(item.id) ?? null;
    if (opts.inOverlay) {
      return (
        <span
          style={{
            ...itemBaseStyle,
            cursor: 'grabbing',
            boxShadow: 'var(--shadow-md)',
          }}
        >
          {item.label}
        </span>
      );
    }
    return (
      <DraggableItem
        key={item.id}
        item={item}
        misplaced={misplaced}
        expectedZoneLabel={expectedZoneLabel}
        submitted={submitted}
        disabled={submitted && allCorrect}
      />
    );
  }

  return (
    <div data-dragmatch-body style={wrapStyle}>
      <div data-dragmatch-prompt style={promptStyle}>
        {data.prompt}
      </div>

      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <div>
          <div style={sectionLabelStyle}>Items</div>
          <DroppableContainer
            id={DRAG_MATCH_BANK_ID}
            testId="dragmatch-bank"
            ariaLabel="Item bank"
            baseStyle={bankBaseStyle}
            hoverStyle={hoverStyle}
          >
            {bankItems.length === 0 ? (
              <span style={zoneEmptyHintStyle}>All items placed</span>
            ) : (
              bankItems.map((id) => renderItem(id))
            )}
          </DroppableContainer>
        </div>

        <div>
          <div style={sectionLabelStyle}>Zones</div>
          <div style={zonesGridStyle}>
            {data.zones.map((zone) => {
              const placed = placement[zone.id] ?? [];
              const correctness = submitted
                ? validation?.zoneCorrect[zone.id]
                  ? 'correct'
                  : 'incorrect'
                : 'idle';
              return (
                <DroppableContainer
                  key={zone.id}
                  id={zone.id}
                  testId={`dragmatch-zone-${zone.id}`}
                  ariaLabel={`Zone: ${zone.label}`}
                  baseStyle={zoneBaseStyle}
                  hoverStyle={hoverStyle}
                  feedbackStyle={zoneFeedbackStyle(correctness)}
                >
                  <div style={zoneLabelStyle}>{zone.label}</div>
                  <div style={zoneItemsStyle}>
                    {placed.length === 0 ? (
                      <span style={zoneEmptyHintStyle}>Drop here</span>
                    ) : (
                      placed.map((id) => renderItem(id))
                    )}
                  </div>
                </DroppableContainer>
              );
            })}
          </div>
        </div>

        <DragOverlay>
          {activeId ? renderItem(activeId, { inOverlay: true }) : null}
        </DragOverlay>
      </DndContext>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
        }}
      >
        {submitted && !allCorrect ? (
          <button
            type="button"
            data-testid="dragmatch-reset"
            onClick={handleReset}
            style={{
              ...submitButtonBase,
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border-strong)',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        ) : null}
        <button
          type="button"
          data-testid="dragmatch-submit"
          onClick={handleSubmit}
          disabled={submitDisabled}
          aria-label={submitted && allCorrect ? 'Solved' : 'Check answers'}
          style={submitButtonStyle}
        >
          {submitted && allCorrect ? (
            <>
              <Check size={14} aria-hidden /> Solved
            </>
          ) : submitted ? (
            <>
              <X size={14} aria-hidden /> Submit again
            </>
          ) : (
            'Submit'
          )}
        </button>
      </div>

      {submitted && data.explanation && (
        <Callout tone="info" title="Explanation">
          {data.explanation}
        </Callout>
      )}
    </div>
  );
}

async function patchSectionDone(key: DragMatchProgressKey): Promise<void> {
  try {
    await fetch('/api/progress', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseSlug: key.courseSlug,
        lessonSlug: key.lessonSlug,
        sectionState: { [key.sectionId]: { done: true } },
      }),
    });
  } catch {
    // Persistence is non-fatal.
  }
}
