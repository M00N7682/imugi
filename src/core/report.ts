import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { ComparisonResult, DiffReport } from '../types.js';

export interface ReportOptions {
  designBuffer: Buffer;
  screenshotBuffer: Buffer;
  comparison: ComparisonResult;
  report: DiffReport;
  outputDir: string;
}

function toDataUrl(buffer: Buffer, mime = 'image/png'): string {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

function scoreColor(score: number): string {
  if (score >= 0.95) return '#10B981';
  if (score >= 0.8) return '#F59E0B';
  return '#EF4444';
}

function scoreLabel(score: number): string {
  if (score >= 0.95) return 'Excellent';
  if (score >= 0.8) return 'Good';
  if (score >= 0.6) return 'Fair';
  return 'Poor';
}

function buildHtml(options: ReportOptions): string {
  const { designBuffer, screenshotBuffer, comparison, report } = options;
  const composite = comparison.compositeScore;
  const ssim = comparison.ssim.mssim;
  const pixelDiff = comparison.pixelDiff.diffPercentage;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>imugi — Visual Comparison Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0F172A; color: #E2E8F0; line-height: 1.6; }
  .container { max-width: 1400px; margin: 0 auto; padding: 32px 24px; }
  h1 { font-size: 24px; font-weight: 600; margin-bottom: 8px; }
  .subtitle { color: #94A3B8; font-size: 14px; margin-bottom: 32px; }
  .scores { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
  .score-card { background: #1E293B; border-radius: 12px; padding: 20px; text-align: center; }
  .score-value { font-size: 36px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .score-label { font-size: 13px; color: #94A3B8; margin-top: 4px; }
  .score-badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; margin-top: 8px; }
  .comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 32px; }
  .comparison-panel { background: #1E293B; border-radius: 12px; overflow: hidden; }
  .comparison-panel h3 { padding: 12px 16px; font-size: 14px; font-weight: 600; border-bottom: 1px solid #334155; }
  .comparison-panel img { width: 100%; height: auto; display: block; }
  .heatmap-section { background: #1E293B; border-radius: 12px; overflow: hidden; margin-bottom: 32px; }
  .heatmap-section h3 { padding: 12px 16px; font-size: 14px; font-weight: 600; border-bottom: 1px solid #334155; }
  .heatmap-section img { width: 100%; max-width: 800px; height: auto; display: block; margin: 16px auto; }
  .regions { background: #1E293B; border-radius: 12px; padding: 20px; }
  .regions h3 { font-size: 16px; font-weight: 600; margin-bottom: 16px; }
  .region-table { width: 100%; border-collapse: collapse; }
  .region-table th { text-align: left; padding: 8px 12px; font-size: 12px; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #334155; }
  .region-table td { padding: 8px 12px; font-size: 14px; border-bottom: 1px solid #1E293B; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
  .badge-high { background: #7F1D1D; color: #FCA5A5; }
  .badge-medium { background: #78350F; color: #FCD34D; }
  .badge-low { background: #064E3B; color: #6EE7B7; }
  .footer { text-align: center; margin-top: 40px; padding-top: 20px; border-top: 1px solid #1E293B; color: #64748B; font-size: 13px; }
</style>
</head>
<body>
<div class="container">
  <h1>imugi Visual Comparison Report</h1>
  <p class="subtitle">Generated ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC</p>

  <div class="scores">
    <div class="score-card">
      <div class="score-value" style="color: ${scoreColor(composite)}">${(composite * 100).toFixed(1)}%</div>
      <div class="score-label">Composite Score</div>
      <span class="score-badge" style="background: ${scoreColor(composite)}20; color: ${scoreColor(composite)}">${scoreLabel(composite)}</span>
    </div>
    <div class="score-card">
      <div class="score-value">${(ssim * 100).toFixed(1)}%</div>
      <div class="score-label">SSIM</div>
    </div>
    <div class="score-card">
      <div class="score-value">${(pixelDiff * 100).toFixed(2)}%</div>
      <div class="score-label">Pixel Diff</div>
    </div>
    <div class="score-card">
      <div class="score-value">${comparison.diffRegions.length}</div>
      <div class="score-label">Diff Regions</div>
    </div>
  </div>

  <div class="comparison">
    <div class="comparison-panel">
      <h3>Design (Target)</h3>
      <img src="${toDataUrl(designBuffer)}" alt="Design" />
    </div>
    <div class="comparison-panel">
      <h3>Implementation (Current)</h3>
      <img src="${toDataUrl(screenshotBuffer)}" alt="Screenshot" />
    </div>
  </div>

  <div class="heatmap-section">
    <h3>Difference Heatmap</h3>
    <img src="${toDataUrl(comparison.heatmapBuffer)}" alt="Heatmap" />
  </div>

  ${
    report.regions.length > 0
      ? `
  <div class="regions">
    <h3>Diff Regions (${report.regions.length})</h3>
    <table class="region-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Classification</th>
          <th>Priority</th>
          <th>Position</th>
          <th>Size</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${report.regions
          .map(
            (r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${r.classification}</td>
          <td><span class="badge badge-${r.priority}">${r.priority}</span></td>
          <td>${r.region.x}, ${r.region.y}</td>
          <td>${r.region.width}x${r.region.height}</td>
          <td>${r.description}</td>
        </tr>`,
          )
          .join('')}
      </tbody>
    </table>
  </div>
  `
      : ''
  }

  <div class="footer">
    Generated by <strong>imugi</strong> — Design to Code with visual verification
  </div>
</div>
</body>
</html>`;
}

export async function generateHtmlReport(options: ReportOptions): Promise<string> {
  await mkdir(options.outputDir, { recursive: true });
  const html = buildHtml(options);
  const outputPath = join(options.outputDir, 'report.html');
  await writeFile(outputPath, html, 'utf-8');
  return outputPath;
}
