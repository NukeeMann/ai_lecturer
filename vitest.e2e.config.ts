import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// US-205 — dedicated config for the kernel end-to-end suite. It runs ONLY the
// `*.e2e.test.ts` files (excluded from the default `vitest run`) and drives the
// real US-196 runtime through the kernel bridge. Real torch/tensorflow imports
// and a 30s runaway-timeout case make each test slow, so give them generous
// per-test and hook budgets. Prerequisite + runbook: docs/kernel-e2e.md.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.e2e.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 120_000,
    hookTimeout: 200_000,
    // Real kernels hold OS resources; run the suite serially for determinism.
    fileParallelism: false,
  },
});
