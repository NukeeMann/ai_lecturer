import { defineConfig, configDefaults } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // The kernel E2E suite (US-205) requires the provisioned US-196 runtime
    // (real cv2/torch/tensorflow) and is intentionally un-skippable, so it must
    // NOT run in the default suite on hosts without that runtime. Run it
    // explicitly via `npm run test:e2e` (vitest.e2e.config.ts).
    exclude: [...configDefaults.exclude, 'src/**/*.e2e.test.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
