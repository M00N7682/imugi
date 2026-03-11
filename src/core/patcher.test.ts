import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  writeCodeToFiles,
  createBackup,
  rollbackToBackup,
  readCurrentCode,
  patchCode,
  fixBuildError,
} from './patcher.js';
import type { PatchOptions } from './patcher.js';
import type { ComparisonResult, DiffReport, ProjectContext } from '../types.js';

const mockMkdir = vi.fn().mockResolvedValue(undefined);
const mockWriteFile = vi.fn().mockResolvedValue(undefined);
const mockReadFile = vi.fn().mockResolvedValue('file content');
const mockCp = vi.fn().mockResolvedValue(undefined);
const mockReaddir = vi.fn().mockResolvedValue([]);

vi.mock('fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  cp: (...args: unknown[]) => mockCp(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}));

vi.mock('../llm/client.js', () => ({
  sendMessage: vi.fn().mockResolvedValue('```tsx\n// src/app/page.tsx\nexport default function Page() {}\n```'),
  streamMessage: vi.fn(),
  prepareImageForAPI: vi.fn().mockResolvedValue({ base64: 'abc', mediaType: 'image/png' }),
}));

vi.mock('../llm/prompts.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
  buildCodeGenPrompt: vi.fn().mockReturnValue('codegen prompt'),
  buildFullRegenPrompt: vi.fn().mockReturnValue('fullregen prompt'),
  buildSurgicalPatchPrompt: vi.fn().mockReturnValue('surgical prompt'),
  buildBuildErrorFixPrompt: vi.fn().mockReturnValue('fix prompt'),
  extractCodeFromResponse: vi.fn().mockReturnValue(new Map([['src/app/page.tsx', 'fixed code']])),
}));

function makeContext(): ProjectContext {
  return {
    framework: 'react',
    metaFramework: 'next',
    version: '14.0.0',
    language: 'typescript',
    css: { method: 'tailwind', version: '3.0', config: 'tailwind.config.ts' },
    componentPattern: 'functional',
    fileConvention: { naming: 'kebab-case', extension: '.tsx', styleExtension: null },
    designSystem: null,
    stateManagement: null,
    devServer: { command: 'npm run dev', port: 3000 },
  };
}

function makePatchOptions(strategy: 'full_regen' | 'surgical_patch'): PatchOptions {
  return {
    client: {} as PatchOptions['client'],
    strategy,
    designImage: Buffer.from('design'),
    currentCode: new Map([['src/app/page.tsx', 'old code']]),
    comparisonResult: {
      ssim: { mssim: 0.8, performanceMs: 100 },
      pixelDiff: { diffCount: 100, totalPixels: 10000, diffPercentage: 0.01, diffImageBuffer: Buffer.from('diff') },
      heatmapBuffer: Buffer.from('heatmap'),
      diffRegions: [{ x: 0, y: 0, width: 100, height: 100, diffIntensity: 0.5, pixelCount: 200 }],
      compositeScore: 0.8,
      designDimensions: { width: 1440, height: 900 },
      screenshotBuffer: Buffer.from('screenshot'),
      cropPairs: [{ design: Buffer.from('d'), screenshot: Buffer.from('s'), region: { x: 0, y: 0, width: 100, height: 100, diffIntensity: 0.5, pixelCount: 200 } }],
    } as ComparisonResult,
    diffReport: {
      overallScore: 0.8,
      regionCount: 1,
      regions: [{
        region: { x: 0, y: 0, width: 100, height: 100, diffIntensity: 0.5, pixelCount: 200 },
        classification: 'color',
        priority: 'high',
        description: 'Color mismatch',
      }],
      summary: 'Issues found',
      suggestedStrategy: strategy,
    } as DiffReport,
    projectContext: makeContext(),
    heatmapImage: Buffer.from('heatmap'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('writeCodeToFiles', () => {
  it('creates parent directories for each file', async () => {
    const code = new Map([
      ['src/app/page.tsx', 'code1'],
      ['src/styles/globals.css', 'code2'],
    ]);
    await writeCodeToFiles(code, '/project');
    expect(mockMkdir).toHaveBeenCalledTimes(2);
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('src/app'), { recursive: true });
  });

  it('writes each file with utf-8 encoding', async () => {
    const code = new Map([['src/app/page.tsx', 'export default function() {}']]);
    await writeCodeToFiles(code, '/project');
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringContaining('src/app/page.tsx'),
      'export default function() {}',
      'utf-8',
    );
  });

  it('handles empty code map', async () => {
    await writeCodeToFiles(new Map(), '/project');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe('createBackup', () => {
  it('creates backup directory for iteration', async () => {
    await createBackup(['src/app/page.tsx'], '/project', 3);
    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('.imugi/backups/3'),
      { recursive: true },
    );
  });

  it('copies files to backup directory', async () => {
    await createBackup(['src/app/page.tsx'], '/project', 1);
    expect(mockCp).toHaveBeenCalled();
  });

  it('returns iteration number as string', async () => {
    const result = await createBackup(['src/app/page.tsx'], '/project', 5);
    expect(result).toBe('5');
  });

  it('handles missing source file gracefully', async () => {
    mockCp.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await createBackup(['nonexistent.tsx'], '/project', 1);
    expect(result).toBe('1');
  });
});

describe('rollbackToBackup', () => {
  it('walks backup directory and restores files', async () => {
    mockReaddir.mockResolvedValueOnce([
      { name: 'page.tsx', isDirectory: () => false },
    ]);
    mockReadFile.mockResolvedValueOnce('restored code');

    const result = await rollbackToBackup('2', '/project');
    expect(result.has('page.tsx')).toBe(true);
    expect(result.get('page.tsx')).toBe('restored code');
  });

  it('recursively walks subdirectories', async () => {
    mockReaddir
      .mockResolvedValueOnce([{ name: 'src', isDirectory: () => true }])
      .mockResolvedValueOnce([{ name: 'page.tsx', isDirectory: () => false }]);
    mockReadFile.mockResolvedValueOnce('code');

    const result = await rollbackToBackup('1', '/project');
    expect(result.size).toBe(1);
  });

  it('writes restored files to project directory', async () => {
    mockReaddir.mockResolvedValueOnce([
      { name: 'page.tsx', isDirectory: () => false },
    ]);
    mockReadFile.mockResolvedValueOnce('code');

    await rollbackToBackup('1', '/project');
    expect(mockWriteFile).toHaveBeenCalled();
  });
});

describe('readCurrentCode', () => {
  it('reads files and returns code map', async () => {
    mockReadFile.mockResolvedValueOnce('code1');
    const result = await readCurrentCode(['src/app/page.tsx'], '/project');
    expect(result.get('src/app/page.tsx')).toBe('code1');
  });

  it('handles missing files gracefully', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    const result = await readCurrentCode(['missing.tsx'], '/project');
    expect(result.size).toBe(0);
  });

  it('reads multiple files', async () => {
    mockReadFile.mockResolvedValueOnce('code1').mockResolvedValueOnce('code2');
    const result = await readCurrentCode(['a.tsx', 'b.tsx'], '/project');
    expect(result.size).toBe(2);
  });
});

describe('patchCode', () => {
  it('routes to full_regen strategy', async () => {
    const { sendMessage } = await import('../llm/client.js');
    const opts = makePatchOptions('full_regen');
    const result = await patchCode(opts);
    expect(result.strategy).toBe('full_regen');
    expect(sendMessage).toHaveBeenCalled();
  });

  it('routes to surgical_patch strategy', async () => {
    const { sendMessage } = await import('../llm/client.js');
    const opts = makePatchOptions('surgical_patch');
    const result = await patchCode(opts);
    expect(result.strategy).toBe('surgical_patch');
    expect(sendMessage).toHaveBeenCalled();
  });

  it('returns new code map from full_regen', async () => {
    const opts = makePatchOptions('full_regen');
    const result = await patchCode(opts);
    expect(result.newCode).toBeInstanceOf(Map);
    expect(result.filesModified.length).toBeGreaterThan(0);
  });

  it('merges patched code with existing for surgical_patch', async () => {
    const opts = makePatchOptions('surgical_patch');
    const result = await patchCode(opts);
    expect(result.newCode).toBeInstanceOf(Map);
  });
});

describe('fixBuildError', () => {
  it('sends error to Claude and returns merged code', async () => {
    const code = new Map([['src/app/page.tsx', 'broken code']]);
    const result = await fixBuildError({} as PatchOptions['client'], 'SyntaxError', code, makeContext());
    expect(result).toBeInstanceOf(Map);
    expect(result.has('src/app/page.tsx')).toBe(true);
  });

  it('preserves original code entries not in fix', async () => {
    const { extractCodeFromResponse } = await import('../llm/prompts.js');
    (extractCodeFromResponse as ReturnType<typeof vi.fn>).mockReturnValueOnce(new Map([['src/app/new.tsx', 'new']]));
    const code = new Map([['src/app/page.tsx', 'original']]);
    const result = await fixBuildError({} as PatchOptions['client'], 'Error', code, makeContext());
    expect(result.get('src/app/page.tsx')).toBe('original');
    expect(result.get('src/app/new.tsx')).toBe('new');
  });
});
