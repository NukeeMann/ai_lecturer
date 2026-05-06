import { describe, it, expect } from 'vitest';
import { searchEnterTarget } from './dashboard';

// US-118 — pressing ENTER on the dashboard search bar with zero matches must
// hand the query off to /create as the prefilled topic. Empty queries and
// queries that DO match keep their legacy no-op (the form's onSubmit handler
// just blurs the input). The pre-load case (courses still null) also no-ops
// so a transient empty `enriched` array doesn't redirect the user away from
// the dashboard before they ever saw their courses.

describe('US-118 — searchEnterTarget', () => {
  it('returns null on empty query', () => {
    expect(searchEnterTarget('', false, true)).toBeNull();
    expect(searchEnterTarget('   ', false, true)).toBeNull();
  });

  it('returns null when courses have not loaded yet', () => {
    expect(searchEnterTarget('linear algebra', false, false)).toBeNull();
  });

  it('returns null when at least one course matches', () => {
    expect(searchEnterTarget('linear algebra', true, true)).toBeNull();
  });

  it('returns /create?topic=…&from=search when query is non-empty and yields zero matches', () => {
    expect(searchEnterTarget('linear algebra', false, true)).toBe(
      '/create?topic=linear%20algebra&from=search',
    );
  });

  it('trims whitespace before encoding', () => {
    expect(searchEnterTarget('  bayes  ', false, true)).toBe(
      '/create?topic=bayes&from=search',
    );
  });

  it('encodes characters that are unsafe in a URL', () => {
    expect(searchEnterTarget('how transformers work?', false, true)).toBe(
      '/create?topic=how%20transformers%20work%3F&from=search',
    );
    expect(searchEnterTarget('a&b', false, true)).toBe(
      '/create?topic=a%26b&from=search',
    );
  });
});
