import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  addCourseToCollection,
  createCollection,
  deleteCollection,
  getCollectionsPath,
  readCollections,
  removeCourseFromCollection,
  renameCollection,
  writeCollections,
} from '@/lib/server/collections';

let tmpRoot: string;
let originalHome: string | undefined;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-lecturer-collections-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpRoot;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('getCollectionsPath', () => {
  it('returns ~/.ai-lecturer/collections.json under the current HOME', () => {
    expect(getCollectionsPath()).toBe(
      path.join(tmpRoot, '.ai-lecturer', 'collections.json'),
    );
  });
});

describe('readCollections', () => {
  it('returns an empty file shape when the file is missing (ENOENT)', async () => {
    const file = await readCollections();
    expect(file).toEqual({ collections: [] });
  });

  it('parses a valid file', async () => {
    const seeded = {
      collections: [
        { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'IT', courseSlugs: ['python-basics'] },
      ],
    };
    const target = getCollectionsPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify(seeded), { encoding: 'utf-8' });

    const file = await readCollections();
    expect(file).toEqual(seeded);
  });

  it('returns empty + warns to stderr when the file is corrupt JSON', async () => {
    const target = getCollectionsPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '{not valid json', { encoding: 'utf-8' });

    const file = await readCollections();
    expect(file).toEqual({ collections: [] });
  });

  it('returns empty when the file shape is valid JSON but fails schema', async () => {
    const target = getCollectionsPath();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, JSON.stringify({ wrong: 'shape' }), {
      encoding: 'utf-8',
    });

    const file = await readCollections();
    expect(file).toEqual({ collections: [] });
  });
});

describe('writeCollections', () => {
  it('round-trips: write then read returns the same content', async () => {
    const data = {
      collections: [
        { id: 'aaaaaaaa-1111', name: 'A', courseSlugs: [] },
        { id: 'bbbbbbbb-2222', name: 'B', courseSlugs: ['x', 'y'] },
      ],
    };
    await writeCollections(data);
    const read = await readCollections();
    expect(read).toEqual(data);
  });

  it('creates the parent ~/.ai-lecturer/ dir if missing', async () => {
    await expect(
      fs.access(path.join(tmpRoot, '.ai-lecturer')),
    ).rejects.toThrow();
    await writeCollections({ collections: [] });
    await fs.access(path.join(tmpRoot, '.ai-lecturer'));
  });

  it('does not leave a .tmp file on success (atomic rename)', async () => {
    await writeCollections({ collections: [] });
    const dir = path.join(tmpRoot, '.ai-lecturer');
    const entries = await fs.readdir(dir);
    expect(entries.some((n) => n.endsWith('.tmp'))).toBe(false);
    expect(entries).toContain('collections.json');
  });
});

describe('createCollection', () => {
  it('appends a new collection and persists to disk', async () => {
    const c1 = await createCollection('First');
    expect(c1.name).toBe('First');
    expect(c1.courseSlugs).toEqual([]);
    expect(c1.id).toMatch(/^[A-Za-z0-9-]{8,}$/);

    const c2 = await createCollection('Second');
    expect(c2.id).not.toBe(c1.id);

    const persisted = await readCollections();
    expect(persisted.collections.map((c) => c.name)).toEqual(['First', 'Second']);
  });
});

describe('renameCollection', () => {
  it('updates only the named entry', async () => {
    const a = await createCollection('A');
    const b = await createCollection('B');
    const c = await createCollection('C');

    const renamed = await renameCollection(b.id, 'B-prime');
    expect(renamed.id).toBe(b.id);
    expect(renamed.name).toBe('B-prime');

    const persisted = await readCollections();
    expect(persisted.collections.map((c) => c.name)).toEqual(['A', 'B-prime', 'C']);
    expect(persisted.collections[0].id).toBe(a.id);
    expect(persisted.collections[2].id).toBe(c.id);
  });

  it('throws CollectionNotFoundError when id is missing', async () => {
    await expect(
      renameCollection('does-not-exist-1234', 'whatever'),
    ).rejects.toThrow(/Collection not found/);
  });
});

describe('deleteCollection', () => {
  it('removes the matching collection', async () => {
    const a = await createCollection('A');
    const b = await createCollection('B');

    await deleteCollection(a.id);
    const persisted = await readCollections();
    expect(persisted.collections.map((c) => c.id)).toEqual([b.id]);
  });

  it('is a no-op on missing id (does not throw)', async () => {
    await createCollection('A');
    await expect(deleteCollection('missing-id-1234')).resolves.toBeUndefined();
    const persisted = await readCollections();
    expect(persisted.collections.map((c) => c.name)).toEqual(['A']);
  });
});

describe('addCourseToCollection', () => {
  it('appends a slug', async () => {
    const c = await createCollection('IT');
    const updated = await addCourseToCollection(c.id, 'python-basics');
    expect(updated.courseSlugs).toEqual(['python-basics']);
  });

  it('deduplicates when called twice with the same slug', async () => {
    const c = await createCollection('IT');
    await addCourseToCollection(c.id, 'python-basics');
    const updated = await addCourseToCollection(c.id, 'python-basics');
    expect(updated.courseSlugs).toEqual(['python-basics']);

    const persisted = await readCollections();
    expect(persisted.collections[0].courseSlugs).toEqual(['python-basics']);
  });
});

describe('removeCourseFromCollection', () => {
  it('removes an existing slug', async () => {
    const c = await createCollection('IT');
    await addCourseToCollection(c.id, 'python-basics');
    await addCourseToCollection(c.id, 'algorithms');

    const updated = await removeCourseFromCollection(c.id, 'python-basics');
    expect(updated.courseSlugs).toEqual(['algorithms']);
  });

  it('is a no-op when the slug is absent', async () => {
    const c = await createCollection('IT');
    await addCourseToCollection(c.id, 'python-basics');

    const updated = await removeCourseFromCollection(c.id, 'not-there');
    expect(updated.courseSlugs).toEqual(['python-basics']);
  });
});
