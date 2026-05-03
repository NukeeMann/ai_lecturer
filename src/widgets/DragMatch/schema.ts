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
