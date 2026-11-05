import { defineConfig } from 'vitest/config';

declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

export default defineConfig({
  define: {
    __BUILD_REVISION__: JSON.stringify(process.env.GITHUB_SHA ?? 'unavailable'),
  },
  build: {
    rollupOptions: {
      input: { main: 'index.html', benchmark: 'benchmark.html' },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.mjs'],
  },
});
