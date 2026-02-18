import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  bundle: true,
  splitting: false,
  clean: true,
  sourcemap: true,
  dts: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    'sharp',
    'playwright',
    'playwright-core',
    '@anthropic-ai/sdk',
  ],
  noExternal: [],
});
