import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runBoulderLoop, type BoulderLoopOptions } from './loop.js';
import type { ProjectContext } from '../types.js';
import type { ImugiConfig } from '../config/schema.js';

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('design-image')),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    metadata: vi.fn().mockResolvedValue({ width: 1440, height: 900 }),
  }),
}));

vi.mock('../core/comparator.js', () => ({
  compareImages: vi.fn().mockResolvedValue({
    ssim: { mssim: 0.96, performanceMs: 100 },
    pixelDiff: { diffCount: 50, totalPixels: 100000, diffPercentage: 0.0005, diffImageBuffer: Buffer.from('diff') },
    heatmapBuffer: Buffer.from('heatmap'),
    diffRegions: [],
    compositeScore: 0.96,
    designDimensions: { width: 1440, height: 900 },
    screenshotBuffer: Buffer.from('screenshot'),
    cropPairs: [],
  }),
  computeCompositeScore: vi.fn().mockReturnValue(0.96),
}));

vi.mock('../core/renderer.js', () => ({
  resizeToMatch: vi.fn().mockResolvedValue(Buffer.from('resized')),
  inferRoute: vi.fn().mockReturnValue('/'),
}));

vi.mock('../core/analyzer.js', () => ({
  analyzeDifferences: vi.fn().mockReturnValue({
    overallScore: 0.96,
    regionCount: 0,
    regions: [],
    summary: 'Looks good',
    suggestedStrategy: 'surgical_patch',
  }),
  categorizeIteration: vi.fn().mockReturnValue('achieved'),
  suggestStrategy: vi.fn().mockReturnValue({
    strategy: 'surgical_patch',
    reason: 'Score achieved',
    shouldStop: true,
    stopReason: 'success',
    shouldRollback: false,
  }),
  buildIterationRecord: vi.fn().mockReturnValue({
    iteration: 1,
    score: 0.96,
    strategy: 'surgical_patch',
    filesModified: ['src/app/page.tsx'],
    elapsedMs: 5000,
    category: 'achieved',
    timestamp: Date.now(),
  }),
}));

vi.mock('../llm/client.js', () => ({
  sendVisionComparison: vi.fn().mockResolvedValue({
    similarityScore: 0.95,
    differences: [],
    overallAssessment: 'Close match',
  }),
}));

vi.mock('../core/patcher.js', () => ({
  generateInitialCode: vi.fn().mockResolvedValue(new Map([['src/app/page.tsx', 'generated code']])),
  patchCode: vi.fn().mockResolvedValue({
    newCode: new Map([['src/app/page.tsx', 'patched code']]),
    strategy: 'surgical_patch',
    filesModified: ['src/app/page.tsx'],
    tokensUsed: 1000,
  }),
  writeCodeToFiles: vi.fn().mockResolvedValue(undefined),
  createBackup: vi.fn().mockResolvedValue('1'),
  rollbackToBackup: vi.fn().mockResolvedValue(new Map([['src/app/page.tsx', 'rollback code']])),
}));

function makeConfig(): ImugiConfig {
  return {
    auth: { apiKey: null, oauth: true },
    comparison: { threshold: 0.95, maxIterations: 10, improvementThreshold: 0.01, patchSwitchThreshold: 0.7 },
    rendering: { devServerCommand: null, url: null, port: 3000, viewport: { width: 1440, height: 900 } },
    project: { framework: 'auto', css: 'auto', language: 'auto' },
    timeouts: { overall: 1800, pageLoad: 15, devServer: 30 },
    figma: { token: null, defaultScale: 2 },
  };
}

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

function makeRenderer() {
  return {
    capture: vi.fn().mockResolvedValue(Buffer.from('screenshot')),
    captureHMR: vi.fn().mockResolvedValue(Buffer.from('hmr-screenshot')),
    close: vi.fn().mockResolvedValue(undefined),
    browserHandle: null,
  };
}

function makeOptions(overrides: Partial<BoulderLoopOptions> = {}): BoulderLoopOptions {
  return {
    client: {} as BoulderLoopOptions['client'],
    designImagePath: '/designs/test.png',
    userRequest: 'Build a login page',
    outputPath: 'src/app/login/page.tsx',
    projectDir: '/project',
    config: makeConfig(),
    projectContext: makeContext(),
    renderer: makeRenderer() as unknown as BoulderLoopOptions['renderer'],
    onProgress: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runBoulderLoop', () => {
  it('generates initial code when no existingCode provided', async () => {
    const { generateInitialCode } = await import('../core/patcher.js');
    await runBoulderLoop(makeOptions());
    expect(generateInitialCode).toHaveBeenCalled();
  });

  it('skips initial code generation when existingCode provided', async () => {
    const { generateInitialCode } = await import('../core/patcher.js');
    const existing = new Map([['src/app/page.tsx', 'existing code']]);
    await runBoulderLoop(makeOptions({ existingCode: existing }));
    expect(generateInitialCode).not.toHaveBeenCalled();
  });

  it('returns success when score meets threshold', async () => {
    const result = await runBoulderLoop(makeOptions());
    expect(result.stopReason).toBe('success');
    expect(result.finalScore).toBe(0.96);
  });

  it('calls onProgress with status updates', async () => {
    const onProgress = vi.fn();
    await runBoulderLoop(makeOptions({ onProgress }));
    expect(onProgress).toHaveBeenCalled();
    const statuses = onProgress.mock.calls.map((c: unknown[]) => (c[0] as { status: string }).status);
    expect(statuses).toContain('capturing');
    expect(statuses).toContain('comparing');
  });

  it('captures screenshot using renderer', async () => {
    const renderer = makeRenderer();
    await runBoulderLoop(makeOptions({ renderer: renderer as unknown as BoulderLoopOptions['renderer'] }));
    expect(renderer.capture).toHaveBeenCalled();
  });

  it('returns max_iterations when loop completes without reaching threshold', async () => {
    const { suggestStrategy } = await import('../core/analyzer.js');
    (suggestStrategy as ReturnType<typeof vi.fn>).mockReturnValue({
      strategy: 'surgical_patch',
      reason: 'Not good enough',
      shouldStop: false,
      shouldRollback: false,
    });

    const config = makeConfig();
    config.comparison.maxIterations = 2;
    const result = await runBoulderLoop(makeOptions({ config }));
    expect(result.stopReason).toBe('max_iterations');
    expect(result.totalIterations).toBe(2);
  });

  it('returns timeout when elapsed time exceeds overall timeout', async () => {
    // Use a very small timeout so the async setup (readFile + sharp.metadata) pushes us past it
    const config = makeConfig();
    config.timeouts.overall = -1; // Negative ensures immediate timeout in the loop
    const result = await runBoulderLoop(makeOptions({ config }));
    expect(result.stopReason).toBe('timeout');
  });

  it('creates backup before patching on iterations > 1', async () => {
    const { suggestStrategy } = await import('../core/analyzer.js');
    const { createBackup } = await import('../core/patcher.js');
    (suggestStrategy as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ strategy: 'surgical_patch', reason: '', shouldStop: false, shouldRollback: false })
      .mockReturnValueOnce({ strategy: 'surgical_patch', reason: '', shouldStop: true, stopReason: 'success', shouldRollback: false });

    const config = makeConfig();
    config.comparison.maxIterations = 5;
    await runBoulderLoop(makeOptions({ config }));
    expect(createBackup).toHaveBeenCalled();
  });

  it('handles rollback when recommended', async () => {
    const { suggestStrategy } = await import('../core/analyzer.js');
    const { rollbackToBackup } = await import('../core/patcher.js');
    (suggestStrategy as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ strategy: 'full_regen', reason: '', shouldStop: false, shouldRollback: true, rollbackTo: 1 })
      .mockReturnValueOnce({ strategy: 'full_regen', reason: '', shouldStop: true, stopReason: 'success', shouldRollback: false });

    const config = makeConfig();
    config.comparison.maxIterations = 5;
    await runBoulderLoop(makeOptions({ config }));
    expect(rollbackToBackup).toHaveBeenCalledWith('1', '/project');
  });

  it('returns history of iterations', async () => {
    const result = await runBoulderLoop(makeOptions());
    expect(result.history).toBeInstanceOf(Array);
    expect(result.history.length).toBeGreaterThan(0);
  });

  it('returns reportDir path', async () => {
    const result = await runBoulderLoop(makeOptions());
    expect(result.reportDir).toContain('.imugi/reports/run-');
  });

  it('returns finalCode map', async () => {
    const result = await runBoulderLoop(makeOptions());
    expect(result.finalCode).toBeInstanceOf(Map);
  });
});
