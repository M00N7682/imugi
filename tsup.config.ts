import { defineConfig } from 'tsup';
import { readFileSync } from 'fs';

const { version } = JSON.parse(readFileSync('./package.json', 'utf-8'));

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
  define: {
    __IMUGI_VERSION__: JSON.stringify(version),
  },
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
