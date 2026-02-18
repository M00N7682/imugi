import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import type {
  ComparisonResult,
  SSIMResult,
  PixelDiffResult,
  DiffRegion,
} from '../types.js';

async function ensureSameDimensions(
  designBuffer: Buffer,
  screenshotBuffer: Buffer,
): Promise<{ design: Buffer; screenshot: Buffer; width: number; height: number }> {
  const designMeta = await sharp(designBuffer).metadata();
  const screenshotMeta = await sharp(screenshotBuffer).metadata();

  const width = Math.max(designMeta.width ?? 0, screenshotMeta.width ?? 0);
  const height = Math.max(designMeta.height ?? 0, screenshotMeta.height ?? 0);

  const resizeOpts = {
    width,
    height,
    fit: 'contain' as const,
    background: { r: 255, g: 255, b: 255, alpha: 1 },
  };

  const design = await sharp(designBuffer).resize(resizeOpts).png().toBuffer();
  const screenshot = await sharp(screenshotBuffer).resize(resizeOpts).png().toBuffer();

  return { design, screenshot, width, height };
}

export async function pixelDiff(
  designBuffer: Buffer,
  screenshotBuffer: Buffer,
  threshold = 0.1,
): Promise<PixelDiffResult> {
  const { design, screenshot, width, height } = await ensureSameDimensions(designBuffer, screenshotBuffer);

  const designPng = PNG.sync.read(design);
  const screenshotPng = PNG.sync.read(screenshot);
  const diffPng = new PNG({ width, height });

  const diffCount = pixelmatch(
    designPng.data as unknown as Uint8Array,
    screenshotPng.data as unknown as Uint8Array,
    diffPng.data as unknown as Uint8Array,
    width,
    height,
    { threshold, includeAA: false, alpha: 0.1, diffColor: [255, 0, 0] },
  );

  const totalPixels = width * height;
  const diffImageBuffer = Buffer.from(PNG.sync.write(diffPng));

  return {
    diffCount,
    totalPixels,
    diffPercentage: totalPixels > 0 ? diffCount / totalPixels : 0,
    diffImageBuffer,
  };
}

export async function computeSSIM(
  designBuffer: Buffer,
  screenshotBuffer: Buffer,
): Promise<SSIMResult> {
  const startTime = Date.now();
  const { design, screenshot, width, height } = await ensureSameDimensions(designBuffer, screenshotBuffer);

  const designGray = await sharp(design).grayscale().raw().toBuffer();
  const screenshotGray = await sharp(screenshot).grayscale().raw().toBuffer();

  const windowSize = 8;
  const k1 = 0.01;
  const k2 = 0.03;
  const L = 255;
  const c1 = (k1 * L) ** 2;
  const c2 = (k2 * L) ** 2;

  let totalSSIM = 0;
  let windowCount = 0;

  for (let y = 0; y <= height - windowSize; y += windowSize) {
    for (let x = 0; x <= width - windowSize; x += windowSize) {
      let sumA = 0, sumB = 0, sumAA = 0, sumBB = 0, sumAB = 0;
      const n = windowSize * windowSize;

      for (let wy = 0; wy < windowSize; wy++) {
        for (let wx = 0; wx < windowSize; wx++) {
          const idx = (y + wy) * width + (x + wx);
          const a = designGray[idx];
          const b = screenshotGray[idx];
          sumA += a;
          sumB += b;
          sumAA += a * a;
          sumBB += b * b;
          sumAB += a * b;
        }
      }

      const meanA = sumA / n;
      const meanB = sumB / n;
      const varA = sumAA / n - meanA * meanA;
      const varB = sumBB / n - meanB * meanB;
      const covAB = sumAB / n - meanA * meanB;

      const numerator = (2 * meanA * meanB + c1) * (2 * covAB + c2);
      const denominator = (meanA * meanA + meanB * meanB + c1) * (varA + varB + c2);

      totalSSIM += numerator / denominator;
      windowCount++;
    }
  }

  const mssim = windowCount > 0 ? totalSSIM / windowCount : 1;

  return {
    mssim: Math.max(0, Math.min(1, mssim)),
    performanceMs: Date.now() - startTime,
  };
}

export async function generateHeatmap(
  diffImageBuffer: Buffer,
  designBuffer: Buffer,
): Promise<Buffer> {
  const designMeta = await sharp(designBuffer).metadata();
  const width = designMeta.width ?? 0;
  const height = designMeta.height ?? 0;

  const resizedDiff = await sharp(diffImageBuffer)
    .resize(width, height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .modulate({ brightness: 1.5 })
    .png()
    .toBuffer();

  return sharp(designBuffer)
    .composite([{ input: resizedDiff, blend: 'over', gravity: 'northwest' }])
    .png()
    .toBuffer();
}

export async function findDiffRegions(
  diffImageBuffer: Buffer,
  minRegionSize = 100,
): Promise<DiffRegion[]> {
  const meta = await sharp(diffImageBuffer).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  const rawData = await sharp(diffImageBuffer).raw().ensureAlpha().toBuffer();

  const gridSize = 32;
  const gridCols = Math.ceil(width / gridSize);
  const gridRows = Math.ceil(height / gridSize);
  const grid: number[] = new Array(gridCols * gridRows).fill(0);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = rawData[idx];
      if (r > 50) {
        const gx = Math.floor(x / gridSize);
        const gy = Math.floor(y / gridSize);
        grid[gy * gridCols + gx]++;
      }
    }
  }

  const visited = new Set<number>();
  const regions: DiffRegion[] = [];

  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === 0 || visited.has(i)) continue;

    let minX = gridCols, maxX = 0, minY = gridRows, maxY = 0;
    let totalPixels = 0;
    const queue = [i];
    visited.add(i);

    while (queue.length > 0) {
      const cell = queue.shift()!;
      const cx = cell % gridCols;
      const cy = Math.floor(cell / gridCols);

      minX = Math.min(minX, cx);
      maxX = Math.max(maxX, cx);
      minY = Math.min(minY, cy);
      maxY = Math.max(maxY, cy);
      totalPixels += grid[cell];

      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx >= 0 && nx < gridCols && ny >= 0 && ny < gridRows) {
          const ni = ny * gridCols + nx;
          if (grid[ni] > 0 && !visited.has(ni)) {
            visited.add(ni);
            queue.push(ni);
          }
        }
      }
    }

    if (totalPixels < minRegionSize) continue;

    const regionWidth = (maxX - minX + 1) * gridSize;
    const regionHeight = (maxY - minY + 1) * gridSize;
    const regionArea = regionWidth * regionHeight;

    regions.push({
      x: minX * gridSize,
      y: minY * gridSize,
      width: Math.min(regionWidth, width - minX * gridSize),
      height: Math.min(regionHeight, height - minY * gridSize),
      diffIntensity: regionArea > 0 ? totalPixels / regionArea : 0,
      pixelCount: totalPixels,
    });
  }

  return regions.sort((a, b) => b.diffIntensity - a.diffIntensity);
}

export async function cropRegion(
  imageBuffer: Buffer,
  region: DiffRegion,
  padding = 20,
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const imgWidth = meta.width ?? 0;
  const imgHeight = meta.height ?? 0;

  const left = Math.max(0, region.x - padding);
  const top = Math.max(0, region.y - padding);
  const right = Math.min(imgWidth, region.x + region.width + padding);
  const bottom = Math.min(imgHeight, region.y + region.height + padding);

  return sharp(imageBuffer)
    .extract({ left, top, width: right - left, height: bottom - top })
    .png()
    .toBuffer();
}

export async function cropRegionPair(
  designBuffer: Buffer,
  screenshotBuffer: Buffer,
  region: DiffRegion,
): Promise<{ designCrop: Buffer; screenshotCrop: Buffer }> {
  const [designCrop, screenshotCrop] = await Promise.all([
    cropRegion(designBuffer, region),
    cropRegion(screenshotBuffer, region),
  ]);
  return { designCrop, screenshotCrop };
}

export function computeCompositeScore(scores: {
  ssim: number;
  layout?: number;
  vision?: number;
}): number {
  if (scores.vision !== undefined && scores.layout !== undefined) {
    return Math.max(0, Math.min(1, scores.ssim * 0.3 + scores.layout * 0.3 + scores.vision * 0.4));
  }
  if (scores.vision !== undefined) {
    return Math.max(0, Math.min(1, scores.ssim * 0.4 + scores.vision * 0.6));
  }
  if (scores.layout !== undefined) {
    return Math.max(0, Math.min(1, scores.ssim * 0.5 + scores.layout * 0.5));
  }
  return Math.max(0, Math.min(1, scores.ssim));
}

export async function compareImages(
  designBuffer: Buffer,
  screenshotBuffer: Buffer,
): Promise<ComparisonResult> {
  const designMeta = await sharp(designBuffer).metadata();

  const [pixelResult, ssimResult] = await Promise.all([
    pixelDiff(designBuffer, screenshotBuffer),
    computeSSIM(designBuffer, screenshotBuffer),
  ]);

  const heatmapBuffer = await generateHeatmap(pixelResult.diffImageBuffer, designBuffer);
  const diffRegions = await findDiffRegions(pixelResult.diffImageBuffer);

  const cropPairs = await Promise.all(
    diffRegions.slice(0, 5).map((region) => cropRegionPair(designBuffer, screenshotBuffer, region)),
  );

  const compositeScore = computeCompositeScore({ ssim: ssimResult.mssim });

  return {
    ssim: ssimResult,
    pixelDiff: pixelResult,
    heatmapBuffer,
    diffRegions,
    compositeScore,
    designDimensions: { width: designMeta.width ?? 0, height: designMeta.height ?? 0 },
    screenshotBuffer,
    cropPairs: cropPairs.map((pair, i) => ({
      design: pair.designCrop,
      screenshot: pair.screenshotCrop,
      region: diffRegions[i],
    })),
  };
}
