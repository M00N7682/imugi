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

  // Find pixels that differ from background (likely text/content)
  const colorCounts = new Map<string, { count: number; r: number; g: number; b: number }>();
  const threshold = 30; // color distance threshold

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
 * Estimate font size by measuring the height of text strokes in a region.
 * Uses horizontal scan lines to find text row boundaries.
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

  if (width <= 0 || height <= 0) return null;

  const raw = await sharp(imageBuffer)
    .extract({ left, top, width, height })
    .raw()
    .ensureAlpha()
    .toBuffer();

  const bgR = parseInt(bgColor.slice(1, 3), 16);
  const bgG = parseInt(bgColor.slice(3, 5), 16);
  const bgB = parseInt(bgColor.slice(5, 7), 16);

  // Count non-background pixels per row
  const rowCounts: number[] = [];
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const dist = Math.abs(raw[idx] - bgR) + Math.abs(raw[idx + 1] - bgG) + Math.abs(raw[idx + 2] - bgB);
      if (dist > 30) count++;
    }
    rowCounts.push(count);
  }

  // Find text line boundaries (contiguous rows with content)
  const contentThreshold = width * 0.02; // at least 2% of width has content
  const lines: Array<{ start: number; end: number }> = [];
  let lineStart: number | null = null;

  for (let y = 0; y < rowCounts.length; y++) {
    if (rowCounts[y] > contentThreshold) {
      if (lineStart === null) lineStart = y;
    } else {
      if (lineStart !== null) {
        lines.push({ start: lineStart, end: y });
        lineStart = null;
      }
    }
  }
  if (lineStart !== null) lines.push({ start: lineStart, end: height });

  if (lines.length === 0) return null;

  // The tallest text line is our best estimate for font size
  // (font-size ≈ line height × 0.75, but line height ≈ text block height)
  const maxLineHeight = Math.max(...lines.map(l => l.end - l.start));
  return Math.round(maxLineHeight * 0.85); // approximate font-size from visual height
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
