import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = dirname(fileURLToPath(import.meta.url));
const webSetupFile = resolve(rootDir, 'apps/web/src/test/setup.ts');

const workspaceAliases = [
  { find: /^@pmusic\/core$/, replacement: resolve(rootDir, 'packages/core/src/index.ts') },
  { find: /^@pmusic\/providers$/, replacement: resolve(rootDir, 'packages/providers/src/index.ts') },
  { find: /^@pmusic\/audio-engine$/, replacement: resolve(rootDir, 'packages/audio-engine/src/index.ts') },
  { find: /^@pmusic\/recommendations$/, replacement: resolve(rootDir, 'packages/recommendations/src/index.ts') },
  { find: /^@pmusic\/sync$/, replacement: resolve(rootDir, 'packages/sync/src/index.ts') },
];

const commonExclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  'e2e/**',
  'design/**',
  'apps/mobile/android/**',
  'apps/desktop/release/**',
];

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    clearMocks: true,
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'packages',
          environment: 'node',
          include: ['packages/*/src/**/*.test.ts'],
          exclude: commonExclude,
        },
      },
      {
        extends: true,
        esbuild: {
          jsx: 'automatic',
        },
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          exclude: commonExclude,
          ...(existsSync(webSetupFile) ? { setupFiles: [webSetupFile] } : {}),
        },
      },
    ],
  },
});
