import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { coursesRoot, assertSafeSlug, InvalidSlugError } from './paths';

describe('coursesRoot test-env guard', () => {
  let savedOverride: string | undefined;

  beforeEach(() => {
    savedOverride = process.env.COURSES_ROOT_OVERRIDE;
  });

  afterEach(() => {
    if (savedOverride === undefined) delete process.env.COURSES_ROOT_OVERRIDE;
    else process.env.COURSES_ROOT_OVERRIDE = savedOverride;
  });

  it('returns COURSES_ROOT_OVERRIDE verbatim when set', () => {
    process.env.COURSES_ROOT_OVERRIDE = '/tmp/some-test-courses';
    expect(coursesRoot()).toBe('/tmp/some-test-courses');
  });

  it('THROWS under test instead of falling back to the real ./courses', () => {
    // The whole suite runs under vitest (process.env.VITEST is set). Without an
    // explicit override, coursesRoot() must refuse to resolve to the real
    // ./courses so a leaked async generation write can never corrupt the
    // developer's course data (slug↔fixture collision, e.g. edge-detection-basics).
    delete process.env.COURSES_ROOT_OVERRIDE;
    expect(() => coursesRoot()).toThrow(/refusing to touch the real/i);
  });
});

describe('assertSafeSlug', () => {
  it('rejects path-traversal and accepts plain slugs', () => {
    expect(() => assertSafeSlug('edge-detection-basics')).not.toThrow();
    expect(() => assertSafeSlug('../escape')).toThrow(InvalidSlugError);
    expect(() => assertSafeSlug('a/b')).toThrow(InvalidSlugError);
    expect(() => assertSafeSlug('')).toThrow(InvalidSlugError);
  });
});
