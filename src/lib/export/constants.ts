// US-152: shared constants for the static-HTML export pipeline.
//
// PYODIDE_VERSION is the single source of truth for the Pyodide CDN release
// pinned into every exported course. Bumping it here automatically updates
// the loader script, the documentation, and the integration tests in lockstep.
//
// We pin to a specific patch release (NOT `latest`) so an exported course
// remains reproducible — a future Pyodide release that breaks API
// compatibility will not silently retro-break already-published courses.
export const PYODIDE_VERSION = '0.27.4';

export const PYODIDE_CDN_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full`;
export const PYODIDE_CDN_SCRIPT = `${PYODIDE_CDN_BASE}/pyodide.js`;
