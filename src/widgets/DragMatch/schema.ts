import { z } from 'zod';

export const DragMatchItemSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});

export const DragMatchZoneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  accepts: z.array(z.string().min(1)),
});

export const DragMatchDataSchema = z.object({
  prompt: z.string(),
  items: z.array(DragMatchItemSchema).min(1),
  zones: z.array(DragMatchZoneSchema).min(1),
  multipleItemsPerZone: z.boolean().default(false),
  /**
   * When true (default), every block in `items` must be placed before the
   * Submit button enables. When false, only the items referenced by some
   * zone's `accepts` are required — extra items can stay in the bank as
   * distractors and Submit becomes clickable as soon as the required items
   * are placed in zones.
   */
  requireAll: z.boolean().default(true),
  explanation: z.string().optional(),
});

export type DragMatchItem = z.infer<typeof DragMatchItemSchema>;
export type DragMatchZone = z.infer<typeof DragMatchZoneSchema>;
export type DragMatchData = z.infer<typeof DragMatchDataSchema>;

export type DragMatchPlacement = Record<string, string[]>;

export interface DragMatchValidationResult {
  allCorrect: boolean;
  zoneCorrect: Record<string, boolean>;
  misplacedItemIds: Set<string>;
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function setsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

export function validateDragMatch(
  data: DragMatchData,
  placement: DragMatchPlacement,
): DragMatchValidationResult {
  const zoneCorrect: Record<string, boolean> = {};
  const expectedZoneByItem = new Map<string, string>();
  for (const zone of data.zones) {
    for (const itemId of zone.accepts) {
      expectedZoneByItem.set(itemId, zone.id);
    }
  }

  for (const zone of data.zones) {
    const placed = placement[zone.id] ?? [];
    zoneCorrect[zone.id] = data.multipleItemsPerZone
      ? arraysEqual(placed, zone.accepts)
      : setsEqual(placed, zone.accepts);
  }

  const misplacedItemIds = new Set<string>();
  for (const item of data.items) {
    let actualZone: string | null = null;
    for (const zone of data.zones) {
      if ((placement[zone.id] ?? []).includes(item.id)) {
        actualZone = zone.id;
        break;
      }
    }
    const expected = expectedZoneByItem.get(item.id) ?? null;
    if (actualZone !== expected) misplacedItemIds.add(item.id);
  }

  const allCorrect = data.zones.every((z) => zoneCorrect[z.id]);
  return { allCorrect, zoneCorrect, misplacedItemIds };
}

/**
 * Returns true when the current placement satisfies the "ready to submit"
 * gate.
 *
 * - Full-selection mode (`requireAll: true`, default): every item in
 *   `data.items` must be out of the bank (i.e. placed in some zone).
 * - Partial-selection mode (`requireAll: false`): only items that some zone
 *   accepts are required; extra items can remain in the bank as distractors
 *   and Submit becomes enabled as soon as every required item is placed.
 */
export function isReadyToSubmit(
  data: DragMatchData,
  placement: DragMatchPlacement,
): boolean {
  const placedInZones = new Set<string>();
  for (const z of data.zones) {
    for (const id of placement[z.id] ?? []) placedInZones.add(id);
  }
  const requiredIds = data.requireAll
    ? data.items.map((i) => i.id)
    : Array.from(new Set(data.zones.flatMap((z) => z.accepts)));
  return requiredIds.every((id) => placedInZones.has(id));
}

export type DragMatchZoneDisplayState = 'correct' | 'incorrect' | 'idle';

/**
 * Display state for a single drop-zone, computed from the current placement.
 *
 * "correct" is reported LIVE — the moment a zone's contents satisfy its accepts
 * rule, the box flips to the success state, regardless of how many submit
 * attempts have happened. Mismatched/empty zones stay 'idle' until the learner
 * has explicitly checked their answers (`submitted=true`), at which point they
 * surface as 'incorrect'.
 */
export function computeZoneState(
  data: DragMatchData,
  placement: DragMatchPlacement,
  zoneId: string,
  submitted: boolean,
): DragMatchZoneDisplayState {
  const zone = data.zones.find((z) => z.id === zoneId);
  if (!zone) return 'idle';
  const placed = placement[zoneId] ?? [];
  if (placed.length > 0) {
    const matches = data.multipleItemsPerZone
      ? arraysEqual(placed, zone.accepts)
      : setsEqual(placed, zone.accepts);
    if (matches) return 'correct';
  }
  return submitted ? 'incorrect' : 'idle';
}
