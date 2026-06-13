import { describe, expect, it } from 'vitest';

import {
  PYODIDE_LOADABLE_PACKAGE_LIST,
  allPyodideLoadable,
  isPyodideLoadable,
} from './pyodidePackages';

describe('pyodidePackages allowlist (US-212)', () => {
  it('includes the AC-mandated minimum set', () => {
    for (const pkg of ['numpy', 'matplotlib', 'scipy', 'scikit-image', 'pandas']) {
      expect(isPyodideLoadable(pkg)).toBe(true);
    }
    // import-name alias for scikit-image
    expect(isPyodideLoadable('skimage')).toBe(true);
  });

  it('rejects kernel-only packages', () => {
    for (const pkg of ['cv2', 'torch', 'tensorflow', 'opencv-python']) {
      expect(isPyodideLoadable(pkg)).toBe(false);
    }
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(isPyodideLoadable('  NumPy ')).toBe(true);
    expect(isPyodideLoadable('PANDAS')).toBe(true);
  });

  it('allPyodideLoadable treats undefined/empty as loadable', () => {
    expect(allPyodideLoadable(undefined)).toBe(true);
    expect(allPyodideLoadable(null)).toBe(true);
    expect(allPyodideLoadable([])).toBe(true);
  });

  it('allPyodideLoadable is true only when every package is allowlisted', () => {
    expect(allPyodideLoadable(['numpy', 'matplotlib'])).toBe(true);
    expect(allPyodideLoadable(['numpy', 'cv2'])).toBe(false);
    expect(allPyodideLoadable(['torch'])).toBe(false);
  });

  it('exposes a sorted canonical list', () => {
    const sorted = [...PYODIDE_LOADABLE_PACKAGE_LIST].sort();
    expect(PYODIDE_LOADABLE_PACKAGE_LIST).toEqual(sorted);
    expect(PYODIDE_LOADABLE_PACKAGE_LIST).toContain('numpy');
  });
});
