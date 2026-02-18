import { describe, it, expect } from 'vitest';
import { inferRoute } from './renderer.js';
import type { ProjectContext } from '../types.js';

describe('inferRoute', () => {
  const mockContext: ProjectContext = {
    framework: 'react',
    metaFramework: 'next',
    version: null,
    language: 'typescript',
    css: { method: null, version: null, config: null },
    componentPattern: 'functional',
    fileConvention: { naming: 'kebab-case', extension: '.tsx', styleExtension: null },
    designSystem: null,
    stateManagement: null,
    devServer: { command: 'npm run dev', port: 3000 },
  };

  it('src/app/login/page.tsx returns /login', () => {
    const route = inferRoute('src/app/login/page.tsx', mockContext);
    expect(route).toBe('/login');
  });

  it('src/app/page.tsx returns /', () => {
    const route = inferRoute('src/app/page.tsx', mockContext);
    expect(route).toBe('/');
  });

  it('src/pages/about.tsx returns /about', () => {
    const route = inferRoute('src/pages/about.tsx', mockContext);
    expect(route).toBe('/about');
  });

  it('src/pages/index.tsx returns /', () => {
    const route = inferRoute('src/pages/index.tsx', mockContext);
    expect(route).toBe('/');
  });

  it('src/routes/+page.svelte returns /', () => {
    const route = inferRoute('src/routes/+page.svelte', mockContext);
    expect(route).toBe('/');
  });

  it('random/file.tsx returns / (fallback)', () => {
    const route = inferRoute('random/file.tsx', mockContext);
    expect(route).toBe('/');
  });
});
