import { describe, it, expect, beforeAll } from 'vitest';
import sharp from 'sharp';
import { compareImages, computeSSIM, pixelDiff, generateHeatmap, findDiffRegions } from '../core/comparator.js';

function createSolidImage(width: number, height: number, color: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: color },
  }).png().toBuffer();
}

function createTwoToneImage(
  width: number,
  height: number,
  topColor: { r: number; g: number; b: number },
  bottomColor: { r: number; g: number; b: number },
): Promise<Buffer> {
  const halfHeight = Math.floor(height / 2);
  const top = sharp({
    create: { width, height: halfHeight, channels: 3, background: topColor },
  }).png().toBuffer();
  const bottom = sharp({
    create: { width, height: height - halfHeight, channels: 3, background: bottomColor },
  }).png().toBuffer();

  return Promise.all([top, bottom]).then(([topBuf, bottomBuf]) =>
    sharp({
      create: { width, height, channels: 3, background: topColor },
    })
      .composite([
        { input: topBuf, top: 0, left: 0 },
        { input: bottomBuf, top: halfHeight, left: 0 },
      ])
      .png()
      .toBuffer(),
  );
}

describe('Comparator Pipeline E2E', () => {
  let identicalA: Buffer;
  let identicalB: Buffer;
  let slightlyDifferent: Buffer;
  let veryDifferent: Buffer;

  beforeAll(async () => {
    identicalA = await createSolidImage(200, 200, { r: 66, g: 133, b: 244 });
    identicalB = await createSolidImage(200, 200, { r: 66, g: 133, b: 244 });
    slightlyDifferent = await createSolidImage(200, 200, { r: 70, g: 130, b: 240 });
    veryDifferent = await createSolidImage(200, 200, { r: 244, g: 67, b: 54 });
  });

  describe('computeSSIM', () => {
    it('returns ~1.0 for identical images', async () => {
      const result = await computeSSIM(identicalA, identicalB);
      expect(result.mssim).toBeGreaterThan(0.99);
      expect(result.performanceMs).toBeGreaterThanOrEqual(0);
    });

    it('returns high score for slightly different images', async () => {
      const result = await computeSSIM(identicalA, slightlyDifferent);
      expect(result.mssim).toBeGreaterThan(0.8);
      expect(result.mssim).toBeLessThan(1.0);
    });

    it('returns lower score for very different images than identical ones', async () => {
      const identicalResult = await computeSSIM(identicalA, identicalB);
      const differentResult = await computeSSIM(identicalA, veryDifferent);
      expect(differentResult.mssim).toBeLessThan(identicalResult.mssim);
    });
  });

  describe('pixelDiff', () => {
    it('returns 0 diff for identical images', async () => {
      const result = await pixelDiff(identicalA, identicalB);
      expect(result.diffCount).toBe(0);
      expect(result.diffPercentage).toBe(0);
      expect(result.totalPixels).toBe(200 * 200);
      expect(result.diffImageBuffer.length).toBeGreaterThan(0);
    });

    it('returns nonzero diff for different images', async () => {
      const result = await pixelDiff(identicalA, veryDifferent);
      expect(result.diffCount).toBeGreaterThan(0);
      expect(result.diffPercentage).toBeGreaterThan(0.5);
    });

    it('returns small diff for slightly different images', async () => {
      const result = await pixelDiff(identicalA, slightlyDifferent);
      expect(result.diffPercentage).toBeLessThan(0.5);
    });
  });

  describe('generateHeatmap', () => {
    it('produces a valid PNG buffer', async () => {
      const diff = await pixelDiff(identicalA, veryDifferent);
      const heatmap = await generateHeatmap(diff.diffImageBuffer, identicalA);
      expect(heatmap.length).toBeGreaterThan(0);
      const meta = await sharp(heatmap).metadata();
      expect(meta.format).toBe('png');
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(200);
    });
  });

  describe('findDiffRegions', () => {
    it('finds no significant regions for identical images', async () => {
      const diff = await pixelDiff(identicalA, identicalB);
      const regions = await findDiffRegions(diff.diffImageBuffer, 200);
      expect(regions.length).toBeLessThanOrEqual(1);
    });

    it('finds regions for different images', async () => {
      const diff = await pixelDiff(identicalA, veryDifferent);
      const regions = await findDiffRegions(diff.diffImageBuffer);
      expect(regions.length).toBeGreaterThan(0);
      for (const region of regions) {
        expect(region.x).toBeGreaterThanOrEqual(0);
        expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.width).toBeGreaterThan(0);
        expect(region.height).toBeGreaterThan(0);
        expect(region.diffIntensity).toBeGreaterThan(0);
        expect(region.pixelCount).toBeGreaterThan(0);
      }
    });
  });

  describe('compareImages (full pipeline)', () => {
    it('returns high score for identical images', async () => {
      const result = await compareImages(identicalA, identicalB);
      expect(result.ssim.mssim).toBeGreaterThan(0.99);
      expect(result.pixelDiff.diffPercentage).toBe(0);
      expect(result.compositeScore).toBeGreaterThan(0.99);
      expect(result.heatmapBuffer.length).toBeGreaterThan(0);
      expect(result.designDimensions).toEqual({ width: 200, height: 200 });
    });

    it('returns lower score for very different images', async () => {
      const identicalResult = await compareImages(identicalA, identicalB);
      const differentResult = await compareImages(identicalA, veryDifferent);
      expect(differentResult.pixelDiff.diffPercentage).toBeGreaterThan(0.5);
      expect(differentResult.compositeScore).toBeLessThan(identicalResult.compositeScore);
      expect(differentResult.diffRegions.length).toBeGreaterThan(0);
    });

    it('returns intermediate score for slightly different images', async () => {
      const result = await compareImages(identicalA, slightlyDifferent);
      expect(result.compositeScore).toBeGreaterThan(0.5);
      expect(result.compositeScore).toBeLessThan(1.0);
    });

    it('handles images of different sizes by resizing', async () => {
      const small = await createSolidImage(100, 100, { r: 66, g: 133, b: 244 });
      const large = await createSolidImage(200, 200, { r: 66, g: 133, b: 244 });
      const result = await compareImages(small, large);
      expect(result.ssim.mssim).toBeGreaterThan(0.9);
      expect(result.designDimensions.width).toBeGreaterThanOrEqual(100);
      expect(result.designDimensions.height).toBeGreaterThanOrEqual(100);
    });

    it('generates crop pairs for diff regions', async () => {
      const design = await createTwoToneImage(400, 400, { r: 0, g: 0, b: 255 }, { r: 255, g: 255, b: 255 });
      const impl = await createTwoToneImage(400, 400, { r: 0, g: 0, b: 255 }, { r: 255, g: 0, b: 0 });
      const result = await compareImages(design, impl);
      if (result.diffRegions.length > 0) {
        expect(result.cropPairs.length).toBeGreaterThan(0);
        expect(result.cropPairs.length).toBeLessThanOrEqual(5);
        for (const pair of result.cropPairs) {
          expect(pair.design.length).toBeGreaterThan(0);
          expect(pair.screenshot.length).toBeGreaterThan(0);
          expect(pair.region).toBeDefined();
        }
      }
    });
  });
});
