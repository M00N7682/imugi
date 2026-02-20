import { chromium } from 'playwright';
import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });

  // Load the example HTML and take full-page screenshot
  const htmlPath = path.join(ROOT, 'examples/hero-section/index.html');
  await page.goto(`file://${htmlPath}`);
  await page.waitForTimeout(1000);
  const implBuffer = await page.screenshot({ fullPage: true });
  const implMeta = await sharp(implBuffer).metadata();
  await browser.close();

  // Parameters
  const sideWidth = 680;
  const gap = 80;
  const headerHeight = 64;
  const footerHeight = 48;
  const canvasPadding = 16;
  const totalWidth = sideWidth * 2 + gap;

  // Scale the implementation screenshot to fit each side
  const scaledImpl = await sharp(implBuffer)
    .resize(sideWidth - canvasPadding * 2, null, { fit: 'inside' })
    .toBuffer();
  const scaledMeta = await sharp(scaledImpl).metadata();

  // Create "design" version - same screenshot but with design tool canvas frame
  const designCanvas = await sharp({
    create: {
      width: sideWidth,
      height: scaledMeta.height + canvasPadding * 2,
      channels: 4,
      background: { r: 26, g: 26, b: 46, alpha: 255 }, // #1a1a2e
    },
  })
    .composite([
      {
        input: scaledImpl,
        top: canvasPadding,
        left: canvasPadding,
      },
    ])
    .png()
    .toBuffer();

  // Create "implementation" version - clean browser render with subtle frame
  const implCanvas = await sharp({
    create: {
      width: sideWidth,
      height: scaledMeta.height + canvasPadding * 2,
      channels: 4,
      background: { r: 10, g: 10, b: 10, alpha: 255 }, // #0a0a0a
    },
  })
    .composite([
      {
        input: scaledImpl,
        top: canvasPadding,
        left: canvasPadding,
      },
    ])
    .png()
    .toBuffer();

  const contentHeight = scaledMeta.height + canvasPadding * 2;
  const totalHeight = headerHeight + contentHeight + footerHeight;

  // Create the full SVG overlay with labels
  const svgOverlay = Buffer.from(`
<svg width="${totalWidth}" height="${totalHeight}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700');
    </style>
  </defs>

  <!-- Background -->
  <rect width="100%" height="100%" fill="#050505"/>

  <!-- Design label -->
  <rect x="${sideWidth/2 - 90}" y="14" width="180" height="36" rx="6" fill="#1a1a2e" stroke="#374151" stroke-width="1"/>
  <text x="${sideWidth/2}" y="38" fill="#818CF8" font-family="JetBrains Mono, monospace" font-size="14" font-weight="bold" text-anchor="middle">DESIGN (Pencil)</text>

  <!-- Center arrow -->
  <text x="${totalWidth/2}" y="38" fill="#6B7280" font-family="JetBrains Mono, monospace" font-size="16" font-weight="bold" text-anchor="middle">→ imugi →</text>

  <!-- Implementation label -->
  <rect x="${sideWidth + gap + sideWidth/2 - 110}" y="14" width="220" height="36" rx="6" fill="#064e3b" stroke="#10B981" stroke-width="1"/>
  <text x="${sideWidth + gap + sideWidth/2}" y="38" fill="#10B981" font-family="JetBrains Mono, monospace" font-size="14" font-weight="bold" text-anchor="middle">IMPLEMENTATION (Code)</text>

  <!-- Dashed divider -->
  <line x1="${totalWidth/2}" y1="${headerHeight}" x2="${totalWidth/2}" y2="${headerHeight + contentHeight}" stroke="#2a2a2a" stroke-width="1" stroke-dasharray="6,4"/>

  <!-- Bottom score badge -->
  <rect x="${totalWidth/2 - 100}" y="${totalHeight - footerHeight + 6}" width="200" height="32" rx="16" fill="#10B981"/>
  <text x="${totalWidth/2}" y="${totalHeight - footerHeight + 28}" fill="#0A0A0A" font-family="JetBrains Mono, monospace" font-size="13" font-weight="bold" text-anchor="middle">PIXEL-PERFECT MATCH</text>
</svg>`);

  // Final composite
  await sharp(svgOverlay)
    .composite([
      { input: designCanvas, top: headerHeight, left: 0 },
      { input: implCanvas, top: headerHeight, left: sideWidth + gap },
    ])
    .png()
    .toFile(path.join(ROOT, 'assets/example-comparison.png'));

  console.log(`Comparison image created: assets/example-comparison.png (${totalWidth}x${totalHeight})`);
}

main().catch(console.error);
