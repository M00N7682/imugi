import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { chromium } from 'playwright';
import { compareImages } from '../core/comparator.js';
import { analyzeDifferences, generateReportText } from '../core/analyzer.js';
import { resizeToMatch } from '../core/renderer.js';

describe('Full Pipeline E2E (Playwright + Comparator + Analyzer)', () => {
  let designImage: Buffer;
  let screenshotImage: Buffer;

  beforeAll(async () => {
    designImage = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 760, height: 80, channels: 3, background: { r: 37, g: 99, b: 235 } },
          }).png().toBuffer(),
          top: 0,
          left: 20,
        },
        {
          input: await sharp({
            create: { width: 360, height: 400, channels: 3, background: { r: 243, g: 244, b: 246 } },
          }).png().toBuffer(),
          top: 100,
          left: 20,
        },
        {
          input: await sharp({
            create: { width: 360, height: 400, channels: 3, background: { r: 243, g: 244, b: 246 } },
          }).png().toBuffer(),
          top: 100,
          left: 420,
        },
      ])
      .png()
      .toBuffer();

    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 800, height: 600 } });
      const page = await context.newPage();

      await page.setContent(`
        <html>
        <body style="margin: 0; padding: 0; background: white; font-family: sans-serif;">
          <header style="background: #2563EB; height: 80px; margin: 0 20px; width: 760px;"></header>
          <div style="display: flex; gap: 40px; padding: 20px;">
            <div style="width: 360px; height: 400px; background: #F3F4F6; border-radius: 4px;"></div>
            <div style="width: 360px; height: 400px; background: #E8E8E8; border-radius: 4px;"></div>
          </div>
        </body>
        </html>
      `);

      await page.waitForTimeout(300);
      screenshotImage = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
    } finally {
      await browser.close();
    }
  }, 30000);

  it('compares design vs Playwright screenshot', async () => {
    const designMeta = await sharp(designImage).metadata();
    const resized = await resizeToMatch(screenshotImage, designMeta.width!, designMeta.height!);
    const comparison = await compareImages(designImage, resized);

    expect(comparison.ssim.mssim).toBeGreaterThan(0.5);
    expect(comparison.compositeScore).toBeGreaterThan(0.5);
    expect(comparison.heatmapBuffer.length).toBeGreaterThan(0);
    expect(comparison.designDimensions.width).toBe(800);
    expect(comparison.designDimensions.height).toBe(600);
  });

  it('generates analysis report from comparison', async () => {
    const designMeta = await sharp(designImage).metadata();
    const resized = await resizeToMatch(screenshotImage, designMeta.width!, designMeta.height!);
    const comparison = await compareImages(designImage, resized);
    const report = analyzeDifferences(comparison);

    expect(report.overallScore).toBeGreaterThan(0);
    expect(report.overallScore).toBeLessThanOrEqual(1);
    expect(typeof report.summary).toBe('string');
    expect(report.suggestedStrategy).toMatch(/^(full_regen|surgical_patch)$/);

    const reportText = generateReportText(report);
    expect(reportText).toContain('Overall Score:');
    expect(reportText.length).toBeGreaterThan(20);
  });

  it('resizes screenshot to match design dimensions exactly', async () => {
    const resized = await resizeToMatch(screenshotImage, 800, 600);
    const meta = await sharp(resized).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it('produces valid heatmap image', async () => {
    const designMeta = await sharp(designImage).metadata();
    const resized = await resizeToMatch(screenshotImage, designMeta.width!, designMeta.height!);
    const comparison = await compareImages(designImage, resized);
    const heatmapMeta = await sharp(comparison.heatmapBuffer).metadata();
    expect(heatmapMeta.format).toBe('png');
    expect(heatmapMeta.width).toBe(800);
    expect(heatmapMeta.height).toBe(600);
  });
});
