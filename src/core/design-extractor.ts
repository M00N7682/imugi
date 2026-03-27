/**
 * Extract visual properties from a design image by analyzing pixels.
 * No API key, no external service — pure local image analysis via Sharp.
 *
 * Pairs with DOM computed styles to produce concrete CSS diffs
 * like "background: design=#ffffff vs code=#0f172a" for ANY image.
 */
import sharp from 'sharp';
import type { DiffRegion } from '../types.js';

export interface DesignRegionStyle {
  dominantColor: string;
  backgroundColor: string;
  textColor: string | null;
  estimatedFontSize: number | null;
  estimatedPadding: { top: number; right: number; bottom: number; left: number } | null;
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Sample the dominant color in a region by analyzing pixel frequency.
 */
async function sampleDominantColor(
  imageBuffer: Buffer,
  region: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  // Clamp region to image bounds
  const left = Math.max(0, Math.min(region.x, imgW - 1));
  const top = Math.max(0, Math.min(region.y, imgH - 1));
  const width = Math.min(region.width, imgW - left);
  const height = Math.min(region.height, imgH - top);

  if (width <= 0 || height <= 0) return '#000000';

  const cropped = await sharp(imageBuffer)
    .extract({ left, top, width, height })
    .resize(1, 1, { fit: 'cover' })
    .raw()
    .toBuffer();

  return rgbToHex(cropped[0], cropped[1], cropped[2]);
}

/**
 * Sample the background color of a region by looking at corners and edges.
 */
async function sampleBackgroundColor(
  imageBuffer: Buffer,
  region: { x: number; y: number; width: number; height: number },
): Promise<string> {
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  const left = Math.max(0, Math.min(region.x, imgW - 1));
  const top = Math.max(0, Math.min(region.y, imgH - 1));
  const width = Math.min(region.width, imgW - left);
  const height = Math.min(region.height, imgH - top);

  if (width <= 4 || height <= 4) return '#000000';

  const raw = await sharp(imageBuffer)
    .extract({ left, top, width, height })
    .raw()
    .ensureAlpha()
    .toBuffer();

  const w = width;

  // Sample corners and edges (most likely to be background)
  const samples: Array<[number, number, number]> = [];
  const samplePoints = [
    [1, 1], [w - 2, 1], [1, height - 2], [w - 2, height - 2], // corners
    [Math.floor(w / 2), 1], [1, Math.floor(height / 2)],       // edges
  ];

  for (const [sx, sy] of samplePoints) {
    if (sx >= 0 && sx < w && sy >= 0 && sy < height) {
      const idx = (sy * w + sx) * 4;
      samples.push([raw[idx], raw[idx + 1], raw[idx + 2]]);
    }
  }

  if (samples.length === 0) return '#000000';

  // Find most common color among samples (quantized to reduce noise)
  const quantize = (v: number) => Math.round(v / 8) * 8;
  const colorCounts = new Map<string, { count: number; r: number; g: number; b: number }>();

  for (const [r, g, b] of samples) {
    const key = `${quantize(r)},${quantize(g)},${quantize(b)}`;
    const existing = colorCounts.get(key);
    if (existing) {
      existing.count++;
    } else {
      colorCounts.set(key, { count: 1, r, g, b });
    }
  }

  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const entry of colorCounts.values()) {
    if (entry.count > best.count) best = entry;
  }

  return rgbToHex(best.r, best.g, best.b);
}

/**
 * Estimate text color by finding the most common non-background color.
 */
async function sampleTextColor(
  imageBuffer: Buffer,
  region: { x: number; y: number; width: number; height: number },
  bgColor: string,
): Promise<string | null> {
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  const left = Math.max(0, Math.min(region.x, imgW - 1));
  const top = Math.max(0, Math.min(region.y, imgH - 1));
  const width = Math.min(region.width, imgW - left);
  const height = Math.min(region.height, imgH - top);

  if (width <= 0 || height <= 0) return null;

  const raw = await sharp(imageBuffer)
    .extract({ left, top, width, height })
    .resize(Math.min(width, 100), Math.min(height, 100), { fit: 'inside' })
    .raw()
    .ensureAlpha()
    .toBuffer();

  const resizedMeta = await sharp(imageBuffer)
    .extract({ left, top, width, height })
    .resize(Math.min(width, 100), Math.min(height, 100), { fit: 'inside' })
    .metadata();

  const w = resizedMeta.width ?? 1;
  const h = resizedMeta.height ?? 1;

  // Parse background color
  const bgR = parseInt(bgColor.slice(1, 3), 16);
  const bgG = parseInt(bgColor.slice(3, 5), 16);
  const bgB = parseInt(bgColor.slice(5, 7), 16);

  // Find pixels that differ significantly from background (likely text/content)
  // Use adaptive threshold: higher for dark backgrounds to skip anti-aliasing noise
  const colorCounts = new Map<string, { count: number; r: number; g: number; b: number }>();
  const bgLum = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;
  const threshold = bgLum < 50 ? 80 : 30;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = raw[idx], g = raw[idx + 1], b = raw[idx + 2];
      const dist = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
      if (dist > threshold) {
        const quantize = (v: number) => Math.round(v / 16) * 16;
        const key = `${quantize(r)},${quantize(g)},${quantize(b)}`;
        const existing = colorCounts.get(key);
        if (existing) {
          existing.count++;
        } else {
          colorCounts.set(key, { count: 1, r, g, b });
        }
      }
    }
  }

  if (colorCounts.size === 0) return null;

  let best = { count: 0, r: 0, g: 0, b: 0 };
  for (const entry of colorCounts.values()) {
    if (entry.count > best.count) best = entry;
  }

  return rgbToHex(best.r, best.g, best.b);
}

/**
 * Estimate font size by measuring the height of individual text lines.
 *
 * Algorithm: convert to high-contrast binary (text vs background), scan rows
 * for content density, group into lines, take the MEDIAN line height.
 * Handles both light-on-dark and dark-on-light designs.
 */
async function estimateFontSize(
  imageBuffer: Buffer,
  region: { x: number; y: number; width: number; height: number },
  bgColor: string,
): Promise<number | null> {
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  const left = Math.max(0, Math.min(region.x, imgW - 1));
  const top = Math.max(0, Math.min(region.y, imgH - 1));
  const width = Math.min(region.width, imgW - left);
  const height = Math.min(region.height, imgH - top);

  if (width <= 0 || height <= 10) return null;

  // Extract region at original resolution (no resize — precision matters)
  const raw = await sharp(imageBuffer)
    .extract({ left, top, width, height })
    .raw()
    .ensureAlpha()
    .toBuffer();

  const bgR = parseInt(bgColor.slice(1, 3), 16);
  const bgG = parseInt(bgColor.slice(3, 5), 16);
  const bgB = parseInt(bgColor.slice(5, 7), 16);

  // Adaptive threshold: dark backgrounds need higher threshold because
  // anti-aliased light-on-dark text creates many intermediate-colored pixels
  const bgLuminance = bgR * 0.299 + bgG * 0.587 + bgB * 0.114;
  const distThreshold = bgLuminance < 50 ? 80 : 30;

  // Count content pixels per row — only in the middle 80% of width
  // to avoid border/padding artifacts
  const marginX = Math.floor(width * 0.1);
  const scanWidth = width - 2 * marginX;
  const rowCounts: number[] = [];

  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = marginX; x < marginX + scanWidth; x++) {
      const idx = (y * width + x) * 4;
      const dist = Math.abs(raw[idx] - bgR) + Math.abs(raw[idx + 1] - bgG) + Math.abs(raw[idx + 2] - bgB);
      if (dist > distThreshold) count++;
    }
    rowCounts.push(count);
  }

  // Require at least 1% of scan width to count as a content row.
  // Lower threshold catches thin glyphs and wide-spaced text layouts.
  const contentThreshold = Math.max(scanWidth * 0.01, 3);

  // Find text lines: groups of consecutive content rows.
  // Allow gaps of up to 4px within a line to handle:
  // - Anti-aliased edges on dark backgrounds
  // - Thin parts of glyphs (e.g., crossbar of 'e', dot of 'i')
  // - Sub-pixel rendering artifacts
  const maxGap = 4;
  const lines: Array<{ start: number; end: number }> = [];
  let lineStart: number | null = null;
  let gapCount = 0;

  for (let y = 0; y < rowCounts.length; y++) {
    if (rowCounts[y] > contentThreshold) {
      if (lineStart === null) lineStart = y;
      gapCount = 0;
    } else {
      if (lineStart !== null) {
        gapCount++;
        if (gapCount > maxGap) {
          lines.push({ start: lineStart, end: y - gapCount });
          lineStart = null;
          gapCount = 0;
        }
      }
    }
  }
  if (lineStart !== null) lines.push({ start: lineStart, end: height });

  // Filter out tiny lines (noise) and huge lines (merged blocks)
  const validLines = lines.filter(l => {
    const h = l.end - l.start;
    return h >= 6 && h <= 120; // reasonable text line height: 6px-120px
  });

  if (validLines.length === 0) return null;

  // Use median line height — more robust than max (which picks up headers
  // when there's mixed font sizes in the region)
  const heights = validLines.map(l => l.end - l.start).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)];

  // font-size ≈ visual line height × 0.7
  // Text rendering: the visible height of a line includes ascenders (b, d, h)
  // and descenders (g, p, y). The font-size (em square) is roughly 70% of that.
  // For multi-line text, each "line" from our scan = one line of text.
  return Math.round(medianHeight * 0.7);
}

/**
 * Extract visual style properties from a design image for a specific region.
 */
export async function extractDesignRegionStyles(
  designBuffer: Buffer,
  region: DiffRegion,
): Promise<DesignRegionStyle> {
  const bg = await sampleBackgroundColor(designBuffer, region);
  const textColor = await sampleTextColor(designBuffer, region, bg);
  const fontSize = await estimateFontSize(designBuffer, region, bg);

  return {
    dominantColor: await sampleDominantColor(designBuffer, region),
    backgroundColor: bg,
    textColor,
    estimatedFontSize: fontSize,
    estimatedPadding: null, // TODO: edge detection for padding estimation
  };
}

/**
 * Compare design region visual properties against DOM element styles.
 * Returns human-readable differences.
 */
export function diffDesignVsDom(
  designStyle: DesignRegionStyle,
  domElements: Array<{ tag: string; text: string; styles: Record<string, string> }>,
): string[] {
  const diffs: string[] = [];

  for (const el of domElements.slice(0, 3)) {
    const domBg = el.styles.backgroundColor;
    const domColor = el.styles.color;
    const domFontSize = el.styles.fontSize;

    // Background color comparison
    if (domBg && designStyle.backgroundColor) {
      const normDom = normalizeColor(domBg);
      const normDesign = designStyle.backgroundColor.toLowerCase();
      if (normDom && normDesign && colorDistance(normDesign, normDom) > 20) {
        diffs.push(`<${el.tag}>${el.text ? ` "${el.text.slice(0, 30)}"` : ''}: backgroundColor design≈${normDesign} vs code=${normDom}`);
      }
    }

    // Text color comparison
    if (domColor && designStyle.textColor) {
      const normDom = normalizeColor(domColor);
      const normDesign = designStyle.textColor.toLowerCase();
      if (normDom && normDesign && colorDistance(normDesign, normDom) > 20) {
        diffs.push(`<${el.tag}>${el.text ? ` "${el.text.slice(0, 30)}"` : ''}: color design≈${normDesign} vs code=${normDom}`);
      }
    }

    // Font size comparison
    if (domFontSize && designStyle.estimatedFontSize) {
      const domPx = parseFloat(domFontSize);
      const designPx = designStyle.estimatedFontSize;
      if (Math.abs(domPx - designPx) > 3) {
        diffs.push(`<${el.tag}>${el.text ? ` "${el.text.slice(0, 30)}"` : ''}: fontSize design≈${designPx}px vs code=${domPx}px`);
      }
    }
  }

  return diffs;
}

function normalizeColor(css: string): string | null {
  // Handle rgb(r, g, b) format
  const rgbMatch = css.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return rgbToHex(parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3]));
  }
  // Handle hex
  if (css.startsWith('#')) return css.toLowerCase();
  return null;
}

function colorDistance(hex1: string, hex2: string): number {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  return Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2);
}
