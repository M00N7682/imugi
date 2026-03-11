import { describe, it, expect, vi } from 'vitest';
import { generateHtmlReport, type ReportOptions } from './report.js';
import type { ComparisonResult, DiffReport } from '../types.js';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

function makeOptions(overrides: Partial<ReportOptions> = {}): ReportOptions {
  return {
    designBuffer: Buffer.from('design-png-data'),
    screenshotBuffer: Buffer.from('screenshot-png-data'),
    comparison: {
      ssim: { mssim: 0.92, performanceMs: 120 },
      pixelDiff: { diffCount: 500, totalPixels: 100000, diffPercentage: 0.005, diffImageBuffer: Buffer.from('diff') },
      heatmapBuffer: Buffer.from('heatmap-png-data'),
      diffRegions: [
        { x: 10, y: 20, width: 100, height: 50, diffIntensity: 0.7, pixelCount: 200 },
      ],
      compositeScore: 0.88,
      designDimensions: { width: 1440, height: 900 },
      screenshotBuffer: Buffer.from('screenshot'),
      cropPairs: [],
    } as ComparisonResult,
    report: {
      overallScore: 0.88,
      regionCount: 1,
      regions: [
        {
          region: { x: 10, y: 20, width: 100, height: 50, diffIntensity: 0.7, pixelCount: 200 },
          classification: 'color',
          priority: 'high',
          description: 'Background color mismatch',
          cssSuggestion: 'Use #1a1a1a',
        },
      ],
      summary: 'Color issues detected',
      suggestedStrategy: 'surgical_patch',
    } as DiffReport,
    outputDir: '/tmp/test-report',
    ...overrides,
  };
}

describe('generateHtmlReport', () => {
  it('creates output directory', async () => {
    const { mkdir } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    expect(mkdir).toHaveBeenCalledWith('/tmp/test-report', { recursive: true });
  });

  it('writes HTML file to outputDir', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/test-report/report.html',
      expect.stringContaining('<!DOCTYPE html>'),
      'utf-8',
    );
  });

  it('returns the output file path', async () => {
    const result = await generateHtmlReport(makeOptions());
    expect(result).toBe('/tmp/test-report/report.html');
  });

  it('embeds design image as base64 data URL', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const expected = Buffer.from('design-png-data').toString('base64');
    expect(html).toContain(`data:image/png;base64,${expected}`);
  });

  it('embeds screenshot image as base64 data URL', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const expected = Buffer.from('screenshot-png-data').toString('base64');
    expect(html).toContain(`data:image/png;base64,${expected}`);
  });

  it('embeds heatmap image as base64 data URL', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    const expected = Buffer.from('heatmap-png-data').toString('base64');
    expect(html).toContain(`data:image/png;base64,${expected}`);
  });

  it('displays composite score as percentage', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('88.0%');
  });

  it('displays SSIM as percentage', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('92.0%');
  });

  it('shows correct score color for composite 0.88 (amber)', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('#F59E0B');
  });

  it('shows "Good" label for score >= 0.8', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('Good');
  });

  it('shows green color for excellent score >= 0.95', async () => {
    const { writeFile } = await import('fs/promises');
    (writeFile as ReturnType<typeof vi.fn>).mockClear();
    const opts = makeOptions();
    opts.comparison = { ...opts.comparison, compositeScore: 0.97 };
    await generateHtmlReport(opts);
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('#10B981');
    expect(html).toContain('Excellent');
  });

  it('shows red color for poor score < 0.8', async () => {
    const { writeFile } = await import('fs/promises');
    (writeFile as ReturnType<typeof vi.fn>).mockClear();
    const opts = makeOptions();
    opts.comparison = { ...opts.comparison, compositeScore: 0.5 };
    await generateHtmlReport(opts);
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('#EF4444');
  });

  it('renders diff regions table when regions exist', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('region-table');
    expect(html).toContain('Background color mismatch');
    expect(html).toContain('10, 20');
    expect(html).toContain('100x50');
    expect(html).toContain('badge-high');
  });

  it('omits regions section when no regions', async () => {
    const { writeFile } = await import('fs/promises');
    (writeFile as ReturnType<typeof vi.fn>).mockClear();
    const opts = makeOptions();
    opts.report = { ...opts.report, regions: [] };
    await generateHtmlReport(opts);
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    // The CSS class definition exists in <style>, but the actual table element should not be rendered
    expect(html).not.toContain('<table class="region-table">');
  });

  it('includes page title', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('<title>imugi');
  });

  it('includes footer with imugi branding', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('imugi');
    expect(html).toContain('footer');
  });

  it('displays diff regions count', async () => {
    const { writeFile } = await import('fs/promises');
    await generateHtmlReport(makeOptions());
    const html = (writeFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(html).toContain('Diff Regions');
  });
});
