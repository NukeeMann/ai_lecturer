// US-212: single source of truth for the Python packages that the static-HTML
// export can run interactively in the browser via Pyodide.
//
// Code / Sandbox widgets declare `requiresPackages` (US-202/203) — real pip
// packages the KERNEL runtime must provide (e.g. cv2/torch/tensorflow). The
// static export has no kernel; it only has Pyodide. Pyodide can load a curated
// set of pure-Python / wasm-compiled scientific packages from its CDN, but it
// CANNOT provide cv2/torch/tensorflow. So the export path uses this allowlist
// to decide per widget:
//   - every required package is Pyodide-loadable  → interactive Pyodide widget
//   - any required package is outside the allowlist → read-only degradation
//     (highlighted starter code + "Requires local kernel runtime" badge,
//      no Run button) so the learner never hits a confusing import error.
//
// Names are matched case-insensitively against both common import names
// (e.g. `skimage`) and PyPI distribution names (e.g. `scikit-image`) because
// `requiresPackages` accepts either form.

const PYODIDE_LOADABLE_PACKAGES: ReadonlySet<string> = new Set([
  // --- AC-mandated minimum set ---
  'numpy',
  'matplotlib',
  'scipy',
  'scikit-image',
  'skimage',
  'pandas',
  // --- additional packages Pyodide ships and can load from its CDN ---
  'scikit-learn',
  'sklearn',
  'sympy',
  'networkx',
  'pillow',
  'pil',
]);

/** Sorted list of the canonical allowlisted names (for docs / display). */
export const PYODIDE_LOADABLE_PACKAGE_LIST: readonly string[] = Array.from(
  PYODIDE_LOADABLE_PACKAGES,
).sort();

/** True when `pkg` can be loaded into Pyodide in the browser. */
export function isPyodideLoadable(pkg: string): boolean {
  return PYODIDE_LOADABLE_PACKAGES.has(pkg.trim().toLowerCase());
}

/**
 * True when a widget's `requiresPackages` can run in the static export's
 * Pyodide runtime. Undefined or empty means "no special packages required",
 * which is trivially loadable (plain CPython-in-wasm).
 */
export function allPyodideLoadable(
  pkgs: readonly string[] | undefined | null,
): boolean {
  if (!pkgs || pkgs.length === 0) return true;
  return pkgs.every(isPyodideLoadable);
}
