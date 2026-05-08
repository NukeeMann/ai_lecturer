import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  CollectionSchema,
  CollectionsFileSchema,
  type Collection,
  type CollectionsFile,
} from '@/lib/schemas/collection';

export class CollectionNotFoundError extends Error {
  constructor(id: string) {
    super(`Collection not found: ${id}`);
    this.name = 'CollectionNotFoundError';
  }
}

export function getCollectionsPath(): string {
  return path.join(os.homedir(), '.ai-lecturer', 'collections.json');
}

export async function readCollections(): Promise<CollectionsFile> {
  const file = getCollectionsPath();
  let raw: string;
  try {
    raw = await fs.readFile(file, { encoding: 'utf-8' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { collections: [] };
    }
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(
      `[collections] corrupt collections.json (invalid JSON), returning empty: ${String(err)}\n`,
    );
    return { collections: [] };
  }

  const parsed = CollectionsFileSchema.safeParse(json);
  if (!parsed.success) {
    process.stderr.write(
      `[collections] corrupt collections.json (schema mismatch), returning empty: ${parsed.error.message}\n`,
    );
    return { collections: [] };
  }
  return parsed.data;
}

export async function writeCollections(file: CollectionsFile): Promise<void> {
  const validated = CollectionsFileSchema.parse(file);
  const target = getCollectionsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  const content = `${JSON.stringify(validated, null, 2)}\n`;
  await fs.writeFile(tmp, content, { encoding: 'utf-8' });
  await fs.rename(tmp, target);
}

export async function createCollection(name: string): Promise<Collection> {
  const current = await readCollections();
  const collection: Collection = CollectionSchema.parse({
    id: randomUUID(),
    name,
    courseSlugs: [],
  });
  const next: CollectionsFile = {
    collections: [...current.collections, collection],
  };
  await writeCollections(next);
  return collection;
}

export async function renameCollection(
  id: string,
  name: string,
): Promise<Collection> {
  const current = await readCollections();
  const idx = current.collections.findIndex((c) => c.id === id);
  if (idx === -1) {
    throw new CollectionNotFoundError(id);
  }
  const updated: Collection = CollectionSchema.parse({
    ...current.collections[idx],
    name,
  });
  const nextList = [...current.collections];
  nextList[idx] = updated;
  await writeCollections({ collections: nextList });
  return updated;
}

export async function deleteCollection(id: string): Promise<void> {
  const current = await readCollections();
  const nextList = current.collections.filter((c) => c.id !== id);
  if (nextList.length === current.collections.length) {
    return;
  }
  await writeCollections({ collections: nextList });
}

export async function addCourseToCollection(
  id: string,
  courseSlug: string,
): Promise<Collection> {
  const current = await readCollections();
  const idx = current.collections.findIndex((c) => c.id === id);
  if (idx === -1) {
    throw new CollectionNotFoundError(id);
  }
  const existing = current.collections[idx];
  const slugs = existing.courseSlugs.includes(courseSlug)
    ? existing.courseSlugs
    : [...existing.courseSlugs, courseSlug];
  const updated: Collection = CollectionSchema.parse({
    ...existing,
    courseSlugs: slugs,
  });
  const nextList = [...current.collections];
  nextList[idx] = updated;
  await writeCollections({ collections: nextList });
  return updated;
}

export async function removeCourseFromCollection(
  id: string,
  courseSlug: string,
): Promise<Collection> {
  const current = await readCollections();
  const idx = current.collections.findIndex((c) => c.id === id);
  if (idx === -1) {
    throw new CollectionNotFoundError(id);
  }
  const existing = current.collections[idx];
  const slugs = existing.courseSlugs.filter((s) => s !== courseSlug);
  const updated: Collection = CollectionSchema.parse({
    ...existing,
    courseSlugs: slugs,
  });
  const nextList = [...current.collections];
  nextList[idx] = updated;
  await writeCollections({ collections: nextList });
  return updated;
}
