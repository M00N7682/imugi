import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectProjectContext } from '../core/context.js';

describe('Context Detection E2E', () => {
  const testDir = join(tmpdir(), `imugi-context-test-${Date.now()}`);

  afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe('Next.js + Tailwind project', () => {
    const projectDir = join(testDir, 'nextjs-project');

    beforeAll(async () => {
      await mkdir(join(projectDir, 'src', 'app'), { recursive: true });
      await writeFile(join(projectDir, 'package.json'), JSON.stringify({
        dependencies: {
          next: '14.1.0',
          react: '18.2.0',
          'react-dom': '18.2.0',
        },
        devDependencies: {
          tailwindcss: '3.4.0',
          typescript: '5.3.0',
        },
      }));
      await writeFile(join(projectDir, 'tsconfig.json'), '{}');
      await writeFile(join(projectDir, 'tailwind.config.ts'), 'export default {}');
      await writeFile(join(projectDir, 'src', 'app', 'page.tsx'), 'export default function Page() {}');
    });

    it('detects Next.js framework', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.framework).toBe('react');
      expect(ctx.metaFramework).toBe('next');
    });

    it('detects Tailwind CSS', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.css.method).toBe('tailwind');
    });

    it('detects TypeScript', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.language).toBe('typescript');
    });

    it('detects dev server settings', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.devServer.command).toBeTruthy();
      expect(ctx.devServer.port).toBe(3000);
    });
  });

  describe('Vue + Nuxt project', () => {
    const projectDir = join(testDir, 'nuxt-project');

    beforeAll(async () => {
      await mkdir(join(projectDir, 'pages'), { recursive: true });
      await writeFile(join(projectDir, 'package.json'), JSON.stringify({
        dependencies: {
          nuxt: '3.9.0',
          vue: '3.4.0',
        },
      }));
      await writeFile(join(projectDir, 'pages', 'index.vue'), '<template><div>Hello</div></template>');
    });

    it('detects Vue + Nuxt', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.framework).toBe('vue');
      expect(ctx.metaFramework).toBe('nuxt');
    });
  });

  describe('plain React project', () => {
    const projectDir = join(testDir, 'react-project');

    beforeAll(async () => {
      await mkdir(join(projectDir, 'src'), { recursive: true });
      await writeFile(join(projectDir, 'package.json'), JSON.stringify({
        dependencies: {
          react: '18.2.0',
          'react-dom': '18.2.0',
        },
      }));
      await writeFile(join(projectDir, 'src', 'App.jsx'), 'export default function App() {}');
    });

    it('detects React without meta-framework', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.framework).toBe('react');
      expect(ctx.metaFramework).toBeNull();
    });

    it('detects JavaScript (no tsconfig)', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.language).toBe('javascript');
    });
  });

  describe('empty project', () => {
    const projectDir = join(testDir, 'empty-project');

    beforeAll(async () => {
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, 'package.json'), '{}');
    });

    it('returns sensible defaults', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.framework).toBeNull();
      expect(ctx.metaFramework).toBeNull();
      expect(ctx.language).toBe('javascript');
      expect(ctx.css.method).toBeDefined();
    });
  });

  describe('shadcn detection', () => {
    const projectDir = join(testDir, 'shadcn-project');

    beforeAll(async () => {
      await mkdir(join(projectDir, 'components', 'ui'), { recursive: true });
      await writeFile(join(projectDir, 'package.json'), JSON.stringify({
        dependencies: {
          react: '18.2.0',
          next: '14.0.0',
          '@radix-ui/react-dialog': '1.0.0',
        },
        devDependencies: {
          tailwindcss: '3.4.0',
        },
      }));
      await writeFile(join(projectDir, 'components', 'ui', 'button.tsx'), 'export {}');
      await writeFile(join(projectDir, 'components.json'), '{}');
    });

    it('detects shadcn design system', async () => {
      const ctx = await detectProjectContext(projectDir);
      expect(ctx.designSystem).toContain('shadcn');
    });
  });
});
