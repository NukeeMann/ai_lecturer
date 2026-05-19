import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// This tool lives at <repo>/tools/static-export. The actual widget code is
// imported READ-ONLY from <repo>/src via the `@/` alias — we never write
// there, so editing anything in this tool cannot affect the main app.
const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, '..', '..');
const repoSrc = path.join(repoRoot, 'src');
const repoModules = path.join(repoRoot, 'node_modules');

// All runtime libs (react, react-markdown, @dnd-kit, katex, lucide-react,
// pyodide worker, …) resolve to the MAIN project's node_modules so the
// exported course is byte-for-byte the same component code the app runs and
// there is exactly ONE React instance (no "invalid hook call").
export default defineConfig({
  root: toolDir,
  base: './', // every asset ref relative → works at /index.html and /lessons/*.html depth
  plugins: [react()],
  resolve: {
    alias: {
      '@': repoSrc,
      react: path.join(repoModules, 'react'),
      'react-dom': path.join(repoModules, 'react-dom'),
      'react/jsx-runtime': path.join(repoModules, 'react', 'jsx-runtime.js'),
    },
    dedupe: ['react', 'react-dom'],
  },
  build: {
    outDir: process.env.SX_OUTDIR
      ? path.resolve(process.env.SX_OUTDIR)
      : path.join(toolDir, '.bundle'),
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 4000,
  },
  // Pyodide's worker uses classic `importScripts(<jsdelivr cdn>)`, which is
  // only valid in a classic worker — keep Vite's default classic worker
  // format (do NOT switch to 'es').
});
