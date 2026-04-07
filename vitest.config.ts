import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve Next.js `@/` path alias for mission-control tests.
      '@': path.resolve(__dirname, 'packages/mission-control/src'),
      // Subpath export for auth facade (avoids pulling full core barrel)
      '@yclaw/core/auth': path.resolve(__dirname, 'packages/core/src/auth/server.ts'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts'],
    globals: true,
  },
});
