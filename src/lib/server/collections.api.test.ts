import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  GET as listCollections,
  POST as createCollectionRoute,
} from '@/app/api/collections/route';
import {
  PATCH as patchCollectionRoute,
  DELETE as deleteCollectionRoute,
} from '@/app/api/collections/[id]/route';
import {
  POST as addCourseRoute,
  DELETE as removeCourseRoute,
} from '@/app/api/collections/[id]/courses/route';

let tmpRoot: string;
let originalHome: string | undefined;

const jsonReq = (
  url: string,
  method: string,
  body?: unknown,
): Request =>
  new Request(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-lecturer-collections-api-'));
  originalHome = process.env.HOME;
  process.env.HOME = tmpRoot;
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe('GET /api/collections', () => {
  it('returns { collections: [] } when no file exists yet', async () => {
    const res = await listCollections();
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual({ collections: [] });
  });
});

describe('POST /api/collections', () => {
  it('creates a collection and reflects it in the next GET', async () => {
    const created = await createCollectionRoute(
      jsonReq('http://x/api/collections', 'POST', { name: 'IT' }),
    );
    expect(created.status).toBe(201);
    expect(created.headers.get('Cache-Control')).toBe('no-store');
    const body = (await created.json()) as { id: string; name: string; courseSlugs: string[] };
    expect(body.name).toBe('IT');
    expect(body.courseSlugs).toEqual([]);
    expect(body.id).toMatch(/^[A-Za-z0-9-]{8,}$/);

    const list = await listCollections();
    const listBody = (await list.json()) as { collections: { id: string; name: string }[] };
    expect(listBody.collections).toHaveLength(1);
    expect(listBody.collections[0]).toEqual(body);
  });

  it('400s on invalid body', async () => {
    const res = await createCollectionRoute(
      jsonReq('http://x/api/collections', 'POST', { name: '' }),
    );
    expect(res.status).toBe(400);
  });

  it('400s on non-JSON body', async () => {
    const req = new Request('http://x/api/collections', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await createCollectionRoute(req);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/collections/[id]', () => {
  it('renames an existing collection', async () => {
    const created = await createCollectionRoute(
      jsonReq('http://x/api/collections', 'POST', { name: 'Old' }),
    );
    const { id } = (await created.json()) as { id: string };

    const patch = await patchCollectionRoute(
      jsonReq(`http://x/api/collections/${id}`, 'PATCH', { name: 'New' }),
      { params: Promise.resolve({ id }) },
    );
    expect(patch.status).toBe(200);
    const body = (await patch.json()) as { id: string; name: string };
    expect(body.id).toBe(id);
    expect(body.name).toBe('New');

    const list = await listCollections();
    const listBody = (await list.json()) as { collections: { name: string }[] };
    expect(listBody.collections[0].name).toBe('New');
  });

  it('rejects a bad id with 400', async () => {
    const res = await patchCollectionRoute(
      jsonReq('http://x/api/collections/..', 'PATCH', { name: 'x' }),
      { params: Promise.resolve({ id: '..' }) },
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when id is well-formed but unknown', async () => {
    const res = await patchCollectionRoute(
      jsonReq('http://x/api/collections/abcdefgh-1234', 'PATCH', { name: 'x' }),
      { params: Promise.resolve({ id: 'abcdefgh-1234' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/collections/[id]', () => {
  it('deletes an existing collection (204)', async () => {
    const created = await createCollectionRoute(
      jsonReq('http://x/api/collections', 'POST', { name: 'X' }),
    );
    const { id } = (await created.json()) as { id: string };

    const del = await deleteCollectionRoute(
      new Request(`http://x/api/collections/${id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id }) },
    );
    expect(del.status).toBe(204);

    const list = await listCollections();
    const listBody = (await list.json()) as { collections: unknown[] };
    expect(listBody.collections).toEqual([]);
  });

  it('returns 204 even when the id does not exist (idempotent)', async () => {
    const res = await deleteCollectionRoute(
      new Request('http://x/api/collections/abcdefgh-1234', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'abcdefgh-1234' }) },
    );
    expect(res.status).toBe(204);
  });

  it('rejects a bad id with 400', async () => {
    const res = await deleteCollectionRoute(
      new Request('http://x/api/collections/..', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '..' }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/collections/[id]/courses', () => {
  it('adds a courseSlug to the collection', async () => {
    const created = await createCollectionRoute(
      jsonReq('http://x/api/collections', 'POST', { name: 'IT' }),
    );
    const { id } = (await created.json()) as { id: string };

    const res = await addCourseRoute(
      jsonReq(`http://x/api/collections/${id}/courses`, 'POST', {
        courseSlug: 'python-basics',
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { courseSlugs: string[] };
    expect(body.courseSlugs).toEqual(['python-basics']);
  });

  it('rejects a bad slug with 400', async () => {
    const created = await createCollectionRoute(
      jsonReq('http://x/api/collections', 'POST', { name: 'IT' }),
    );
    const { id } = (await created.json()) as { id: string };

    const res = await addCourseRoute(
      jsonReq(`http://x/api/collections/${id}/courses`, 'POST', {
        courseSlug: 'Foo!',
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });

  it('rejects a bad id with 400', async () => {
    const res = await addCourseRoute(
      jsonReq('http://x/api/collections/../courses', 'POST', {
        courseSlug: 'python-basics',
      }),
      { params: Promise.resolve({ id: '..' }) },
    );
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/collections/[id]/courses', () => {
  it('removes a courseSlug from the collection', async () => {
    const created = await createCollectionRoute(
      jsonReq('http://x/api/collections', 'POST', { name: 'IT' }),
    );
    const { id } = (await created.json()) as { id: string };
    await addCourseRoute(
      jsonReq(`http://x/api/collections/${id}/courses`, 'POST', {
        courseSlug: 'python-basics',
      }),
      { params: Promise.resolve({ id }) },
    );

    const res = await removeCourseRoute(
      jsonReq(`http://x/api/collections/${id}/courses`, 'DELETE', {
        courseSlug: 'python-basics',
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { courseSlugs: string[] };
    expect(body.courseSlugs).toEqual([]);
  });

  it('rejects a bad slug with 400', async () => {
    const created = await createCollectionRoute(
      jsonReq('http://x/api/collections', 'POST', { name: 'IT' }),
    );
    const { id } = (await created.json()) as { id: string };

    const res = await removeCourseRoute(
      jsonReq(`http://x/api/collections/${id}/courses`, 'DELETE', {
        courseSlug: 'Foo!',
      }),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(400);
  });
});
