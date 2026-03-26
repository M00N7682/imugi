import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile, writeFile, access, mkdir, readdir, unlink } from 'fs/promises';
import { spawn, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { join, resolve, isAbsolute } from 'path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { compareImages } from '../core/comparator.js';
import { analyzeDifferences, generateReportText } from '../core/analyzer.js';
import { detectProjectContext } from '../core/context.js';
import { resizeToMatch } from '../core/renderer.js';
import { parseFigmaUrl, exportFigmaImage, resolveToken, fetchFigmaSpecs, diffFigmaVsDom } from '../core/figma.js';
import { extractDesignRegionStyles, diffDesignVsDom } from '../core/design-extractor.js';

declare const __IMUGI_VERSION__: string;

// ── Helpers ──

async function safeReadFile(filePath: string): Promise<Buffer> {
  const resolved = resolve(filePath);
  try {
    await access(resolved);
  } catch {
    throw new Error(`File not found: ${resolved} — check the file path and make sure it exists`);
  }
  return readFile(resolved);
}

function validateFilePath(filePath: string): string {
  const resolved = resolve(filePath);
  const cwd = resolve(process.cwd());
  if (!resolved.startsWith(cwd)) {
    throw new Error(`Access denied: ${filePath} is outside the project directory (${cwd}). Only files within the project can be accessed.`);
  }
  return resolved;
}

async function safeReadProjectFile(filePath: string): Promise<Buffer> {
  validateFilePath(filePath);
  return safeReadFile(filePath);
}

async function ensureHeatmapDir(): Promise<string> {
  const dir = join(process.cwd(), '.imugi');
  await mkdir(dir, { recursive: true });
  return dir;
}

async function cleanupOldHeatmaps(dir: string, keepLast: number): Promise<void> {
  try {
    const files = await readdir(dir);
    const heatmaps = files
      .filter(f => f.startsWith('heatmap-iter-') && f.endsWith('.png'))
      .sort();
    const toRemove = heatmaps.slice(0, Math.max(0, heatmaps.length - keepLast));
    await Promise.all(toRemove.map(f => unlink(join(dir, f)).catch(() => {})));
  } catch {
    // cleanup is best-effort
  }
}

function pageUrlError(url: string, err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ECONNREFUSED')) {
    return `Dev server not responding at ${url} — is it running? Try: npm run dev (or imugi_serve)`;
  }
  if (msg.includes('ERR_NAME_NOT_RESOLVED') || msg.includes('ENOTFOUND')) {
    return `Cannot resolve hostname in ${url} — check the URL`;
  }
  if (msg.includes('Timeout')) {
    return `Page load timed out at ${url} — the server may be slow or unresponsive`;
  }
  return `Failed to load ${url}: ${msg}`;
}

export async function startMcpServer(): Promise<void> {
  const spawnedProcesses: ChildProcess[] = [];

  function trackProcess(child: ChildProcess): void {
    spawnedProcesses.push(child);
    child.on('exit', () => {
      const idx = spawnedProcesses.indexOf(child);
      if (idx !== -1) spawnedProcesses.splice(idx, 1);
    });
  }

  function killAllProcesses(): void {
    for (const child of spawnedProcesses) {
      if (!child.killed) {
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 3000);
      }
    }
    spawnedProcesses.length = 0;
  }

  process.on('SIGINT', killAllProcesses);
  process.on('SIGTERM', killAllProcesses);
  process.on('exit', killAllProcesses);

  const server = new McpServer({
    name: 'imugi',
    version: __IMUGI_VERSION__,
  });

  function errorResult(err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true as const };
  }

  // ── Iteration state per design (keyed by resolved design path or figma URL) ──
  const iterationSessions = new Map<string, Array<{ iteration: number; score: number; timestamp: number }>>();

  function getSessionKey(designImagePath?: string, figmaUrl?: string): string {
    if (figmaUrl) return `figma:${figmaUrl}`;
    if (designImagePath) return `file:${resolve(designImagePath)}`;
    return 'default';
  }

  // ── Viewport schema reused across tools ──
  const viewportWidth = z.number().int().min(100).max(7680).default(1440).describe('Viewport width (100-7680)');
  const viewportHeight = z.number().int().min(100).max(4320).default(900).describe('Viewport height (100-4320)');

  server.tool(
    'imugi_capture',
    'Capture a screenshot of a web page at a given URL. Use imugi_iterate instead for the full design-to-code verification loop.',
    {
      url: z.string().describe('URL to screenshot'),
      width: viewportWidth,
      height: viewportHeight,
      fullPage: z.boolean().default(true).describe('Capture full page'),
    },
    async ({ url, width, height, fullPage }) => {
      try {
        const browser = await chromium.launch({ headless: true });
        try {
          const context = await browser.newContext({ viewport: { width, height } });
          const page = await context.newPage();
          try {
            await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
          } catch (navErr) {
            return errorResult(new Error(pageUrlError(url, navErr)));
          }
          await page.waitForTimeout(500);
          const buffer = await page.screenshot({ fullPage, type: 'png' });

          return {
            content: [
              { type: 'image' as const, data: Buffer.from(buffer).toString('base64'), mimeType: 'image/png' as const },
              { type: 'text' as const, text: `Screenshot captured: ${width}x${height}, fullPage=${fullPage}` },
            ],
          };
        } finally {
          await browser.close();
        }
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'imugi_compare',
    'Compare a design image against a rendered screenshot. Returns SSIM score, pixel diff, and heatmap. For the full iterative workflow, prefer imugi_iterate which combines capture + compare + analyze.',
    {
      designImagePath: z.string().optional().describe('Path to the design image file (or use figmaUrl instead)'),
      screenshotUrl: z.string().optional().describe('URL to capture screenshot from'),
      screenshotPath: z.string().optional().describe('Path to an existing screenshot file'),
      figmaUrl: z.string().optional().describe('Figma URL to export as design image (alternative to designImagePath)'),
      viewportWidth,
      viewportHeight,
    },
    async ({ designImagePath, screenshotUrl, screenshotPath, figmaUrl, viewportWidth: vw, viewportHeight: vh }) => {
      try {
        let designBuffer: Buffer;

        if (figmaUrl) {
          const parsed = parseFigmaUrl(figmaUrl);
          if (!parsed.nodeId) {
            return { content: [{ type: 'text' as const, text: 'Error: Figma URL must include a node-id parameter' }] };
          }
          const token = resolveToken();
          designBuffer = await exportFigmaImage({ fileKey: parsed.fileKey, nodeId: parsed.nodeId, token });
        } else if (designImagePath) {
          designBuffer = await safeReadProjectFile(designImagePath);
        } else {
          return { content: [{ type: 'text' as const, text: 'Error: Provide either designImagePath or figmaUrl' }] };
        }

        let screenshotBuffer: Buffer;

        if (screenshotPath) {
          screenshotBuffer = await safeReadProjectFile(screenshotPath);
        } else if (screenshotUrl) {
          const browser = await chromium.launch({ headless: true });
          try {
            const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
            const page = await ctx.newPage();
            try {
              await page.goto(screenshotUrl, { waitUntil: 'networkidle', timeout: 15000 });
            } catch (navErr) {
              return errorResult(new Error(pageUrlError(screenshotUrl, navErr)));
            }
            await page.waitForTimeout(500);
            screenshotBuffer = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
          } finally {
            await browser.close();
          }
        } else {
          return { content: [{ type: 'text' as const, text: 'Error: Provide either screenshotUrl or screenshotPath' }] };
        }

        const designMeta = await sharp(designBuffer).metadata();
        const resized = await resizeToMatch(screenshotBuffer, designMeta.width ?? vw, designMeta.height ?? vh);
        const comparison = await compareImages(designBuffer, resized);

        const compareContent: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }> = [
          {
            type: 'text' as const,
            text: JSON.stringify({
              ssim: comparison.ssim.mssim,
              pixelDiffPercentage: comparison.pixelDiff.diffPercentage,
              compositeScore: comparison.compositeScore,
              diffRegions: comparison.diffRegions.length,
              performanceMs: comparison.ssim.performanceMs,
            }, null, 2),
          },
          { type: 'image' as const, data: comparison.heatmapBuffer.toString('base64'), mimeType: 'image/png' as const },
        ];

        // Include crop pairs for top diff regions so the AI editor can visually compare specific areas
        const topPairs = comparison.cropPairs.slice(0, 3);
        for (let i = 0; i < topPairs.length; i++) {
          const pair = topPairs[i];
          const region = pair.region;
          compareContent.push(
            { type: 'text' as const, text: `--- Region ${i + 1}: (${region.x}, ${region.y}) ${region.width}x${region.height} — design vs screenshot ---` },
            { type: 'image' as const, data: pair.design.toString('base64'), mimeType: 'image/png' as const },
            { type: 'image' as const, data: pair.screenshot.toString('base64'), mimeType: 'image/png' as const },
          );
        }

        return { content: compareContent };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'imugi_analyze',
    'Analyze differences between a design and screenshot, returning actionable fix suggestions',
    {
      designImagePath: z.string().describe('Path to the design image'),
      screenshotPath: z.string().describe('Path to the screenshot image'),
    },
    async ({ designImagePath, screenshotPath }) => {
      try {
        const designBuffer = await safeReadProjectFile(designImagePath);
        const screenshotBuffer = await safeReadProjectFile(screenshotPath);
        const designMeta = await sharp(designBuffer).metadata();
        const resized = await resizeToMatch(screenshotBuffer, designMeta.width ?? 1440, designMeta.height ?? 900);
        const comparison = await compareImages(designBuffer, resized);
        const report = analyzeDifferences(comparison);
        const reportText = generateReportText(report);

        return {
          content: [{ type: 'text' as const, text: reportText }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'imugi_iterate',
    `Run one iteration of the design verification loop: captures a screenshot of your running page, compares it against the design image, and returns a detailed analysis with scores, heatmap, and fix suggestions.

IMPORTANT — Workflow for AI editors (Claude Code, Cursor, etc.):
1. Generate or patch the frontend code based on the design image.
2. Call imugi_iterate to verify the result.
3. If the status is "ACTION_REQUIRED", read the fix suggestions and patch the code accordingly.
4. Call imugi_iterate again after patching.
5. Repeat steps 3-4 until the status is "DONE".

The tool tracks iteration history per design and will tell you when to stop (threshold reached, converged, or max iterations).`,
    {
      designImagePath: z.string().optional().describe('Path to the design image file'),
      figmaUrl: z.string().optional().describe('Figma URL to export as design image (alternative to designImagePath)'),
      pageUrl: z.string().describe('URL of the running page to screenshot and compare'),
      viewportWidth,
      viewportHeight,
      threshold: z.number().min(0).max(1).default(0.95).describe('Similarity threshold to consider the implementation done (0-1)'),
      maxIterations: z.number().int().min(1).max(50).default(10).describe('Maximum number of iterations before stopping'),
    },
    async ({ designImagePath, figmaUrl, pageUrl, viewportWidth: vw, viewportHeight: vh, threshold, maxIterations }) => {
      try {
        // ── Resolve design image ──
        let designBuffer: Buffer;
        if (figmaUrl) {
          const parsed = parseFigmaUrl(figmaUrl);
          if (!parsed.nodeId) {
            return { content: [{ type: 'text' as const, text: 'Error: Figma URL must include a node-id parameter' }] };
          }
          const token = resolveToken();
          designBuffer = await exportFigmaImage({ fileKey: parsed.fileKey, nodeId: parsed.nodeId, token });
        } else if (designImagePath) {
          designBuffer = await safeReadProjectFile(designImagePath);
        } else {
          return { content: [{ type: 'text' as const, text: 'Error: Provide either designImagePath or figmaUrl' }] };
        }

        // ── Capture screenshot + extract DOM element styles ──
        let screenshotBuffer: Buffer;
        let domElements: Array<{
          tag: string; text: string;
          x: number; y: number; width: number; height: number;
          styles: Record<string, string>;
        }> = [];
        const browser = await chromium.launch({ headless: true });
        try {
          const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
          const page = await ctx.newPage();
          try {
            await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 15000 });
          } catch (navErr) {
            return errorResult(new Error(pageUrlError(pageUrl, navErr)));
          }
          await page.waitForTimeout(500);
          screenshotBuffer = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));

          // Extract visible elements with computed styles
          domElements = await page.evaluate(() => {
            const props = [
              'fontSize', 'fontWeight', 'fontFamily', 'color', 'backgroundColor',
              'padding', 'margin', 'borderRadius', 'gap', 'width', 'height',
              'display', 'flexDirection', 'justifyContent', 'alignItems',
              'lineHeight', 'letterSpacing', 'textAlign', 'border',
            ];
            const results: Array<{
              tag: string; text: string;
              x: number; y: number; width: number; height: number;
              styles: Record<string, string>;
            }> = [];
            const els = document.querySelectorAll('body *');
            for (const el of els) {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 || rect.height === 0) continue;
              if (rect.bottom < 0 || rect.top > window.innerHeight * 2) continue;
              const cs = getComputedStyle(el);
              const styles: Record<string, string> = {};
              for (const p of props) {
                const v = cs.getPropertyValue(p.replace(/([A-Z])/g, '-$1').toLowerCase());
                if (v && v !== 'normal' && v !== 'none' && v !== '0px' && v !== 'auto' && v !== 'rgba(0, 0, 0, 0)') {
                  styles[p] = v;
                }
              }
              results.push({
                tag: el.tagName.toLowerCase(),
                text: (el.textContent ?? '').trim().slice(0, 60),
                x: Math.round(rect.x), y: Math.round(rect.y),
                width: Math.round(rect.width), height: Math.round(rect.height),
                styles,
              });
            }
            return results;
          });
        } finally {
          await browser.close();
        }

        // ── Compare ──
        const designMeta = await sharp(designBuffer).metadata();
        const resized = await resizeToMatch(screenshotBuffer, designMeta.width ?? vw, designMeta.height ?? vh);
        const comparison = await compareImages(designBuffer, resized);

        // ── Analyze ──
        const report = analyzeDifferences(comparison);
        const reportText = generateReportText(report);

        // ── Track iteration per design session ──
        const sessionKey = getSessionKey(designImagePath, figmaUrl);
        if (!iterationSessions.has(sessionKey)) {
          iterationSessions.set(sessionKey, []);
        }
        const history = iterationSessions.get(sessionKey)!;

        const currentIteration = history.length + 1;
        const previousScore = history.length > 0
          ? history[history.length - 1].score
          : null;
        history.push({
          iteration: currentIteration,
          score: comparison.compositeScore,
          timestamp: Date.now(),
        });

        // ── Determine status ──
        const score = comparison.compositeScore;
        let status: string;
        let statusDetail: string;

        if (score >= threshold) {
          status = 'DONE';
          statusDetail = `Similarity score ${score.toFixed(3)} meets threshold ${threshold}. Implementation matches the design.`;
        } else if (currentIteration >= maxIterations) {
          status = 'DONE';
          statusDetail = `Maximum iterations (${maxIterations}) reached. Best score: ${score.toFixed(3)}. Consider adjusting the threshold or reviewing the remaining differences manually.`;
        } else {
          // Check for convergence (3 consecutive stalls)
          const recent = history.slice(-3);
          const isConverged = recent.length >= 3 && recent.every((r, i) => {
            if (i === 0) return true;
            return Math.abs(r.score - recent[i - 1].score) < 0.01;
          });

          if (isConverged) {
            status = 'DONE';
            statusDetail = `Score converged at ${score.toFixed(3)} after ${currentIteration} iterations (no significant improvement in last 3 iterations). Consider a different approach for the remaining differences.`;
          } else {
            status = 'ACTION_REQUIRED';
            const improvement = previousScore !== null ? score - previousScore : 0;
            const improvementStr = previousScore !== null
              ? ` (${improvement >= 0 ? '+' : ''}${improvement.toFixed(3)} from previous)`
              : '';
            statusDetail = `Score: ${score.toFixed(3)}${improvementStr} — below threshold ${threshold}. Fix the issues below and call imugi_iterate again.`;
          }
        }

        // ── Build strategy suggestion ──
        const strategy = score < 0.7 ? 'FULL_REWRITE' : 'SURGICAL_PATCH';
        const strategyHint = score < 0.7
          ? 'Score is low — consider rewriting the component from scratch based on the design.'
          : 'Score is close — make targeted CSS/layout fixes for the specific regions listed below.';

        // ── Figma spec diff (if figmaUrl provided and FIGMA_TOKEN available) ──
        let figmaDiffText = '';
        if (figmaUrl && status === 'ACTION_REQUIRED') {
          try {
            const parsed = parseFigmaUrl(figmaUrl);
            if (parsed.nodeId) {
              const token = resolveToken();
              const figmaSpecs = await fetchFigmaSpecs({ fileKey: parsed.fileKey, nodeId: parsed.nodeId, token });
              const diffs = diffFigmaVsDom(figmaSpecs, domElements);
              if (diffs.length > 0) {
                figmaDiffText = '\n\n--- Figma vs Code: Exact CSS Differences ---\n' +
                  diffs.map(d =>
                    `${d.figmaElement} ↔ ${d.domElement}\n` +
                    d.differences.map(dd => `  ${dd.property}: design=${dd.figma} → your code=${dd.dom}`).join('\n')
                  ).join('\n\n');
              }
            }
          } catch {
            // Figma spec extraction is optional — continue without it
          }
        }

        // ── Save heatmap to .imugi/ directory with cleanup ──
        const heatmapDir = await ensureHeatmapDir();
        await cleanupOldHeatmaps(heatmapDir, 5);
        const heatmapPath = join(heatmapDir, `heatmap-iter-${currentIteration}.png`);
        await writeFile(heatmapPath, comparison.heatmapBuffer);

        // ── Build response ──
        const resultJson = JSON.stringify({
          status,
          statusDetail,
          iteration: currentIteration,
          maxIterations,
          score: Number(score.toFixed(4)),
          threshold,
          previousScore: previousScore !== null ? Number(previousScore.toFixed(4)) : null,
          strategy,
          strategyHint,
          metrics: {
            ssim: comparison.ssim.mssim,
            pixelDiffPercentage: comparison.pixelDiff.diffPercentage,
            diffRegions: comparison.diffRegions.length,
          },
          heatmapPath,
          history: history.map(h => ({
            iteration: h.iteration,
            score: Number(h.score.toFixed(4)),
          })),
        }, null, 2);

        const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: 'image/png' }> = [
          { type: 'text' as const, text: resultJson },
        ];

        // Include heatmap + crop pairs for visual reference
        if (status === 'ACTION_REQUIRED') {
          content.push(
            { type: 'image' as const, data: comparison.heatmapBuffer.toString('base64'), mimeType: 'image/png' as const },
            { type: 'text' as const, text: `--- Diff Analysis ---\n${reportText}\n\n--- What to fix ---\n${strategyHint}${figmaDiffText}` },
          );

          // Include side-by-side crop pairs + DOM element styles for top diff regions
          const topRegions = comparison.cropPairs.slice(0, 3);
          for (let i = 0; i < topRegions.length; i++) {
            const pair = topRegions[i];
            const region = pair.region;

            // Find DOM elements that overlap with this diff region
            const overlapping = domElements.filter(el =>
              el.x < region.x + region.width &&
              el.x + el.width > region.x &&
              el.y < region.y + region.height &&
              el.y + el.height > region.y
            ).slice(0, 8);

            const elementsInfo = overlapping.length > 0
              ? '\nYour code\'s elements in this region:\n' + overlapping.map(el =>
                `  <${el.tag}>${el.text ? ` "${el.text}"` : ''} — ${Object.entries(el.styles).map(([k, v]) => `${k}: ${v}`).join(', ')}`
              ).join('\n')
              : '';

            // Extract visual properties from the design image for this region (no API needed)
            let designAnalysis = '';
            try {
              const designStyle = await extractDesignRegionStyles(designBuffer, region);
              const visualDiffs = diffDesignVsDom(designStyle, overlapping);
              const designProps = [
                designStyle.backgroundColor !== '#000000' ? `bg≈${designStyle.backgroundColor}` : null,
                designStyle.textColor ? `text≈${designStyle.textColor}` : null,
                designStyle.estimatedFontSize ? `fontSize≈${designStyle.estimatedFontSize}px` : null,
              ].filter(Boolean).join(', ');
              designAnalysis = designProps ? `\nDesign image analysis: ${designProps}` : '';
              if (visualDiffs.length > 0) {
                designAnalysis += '\nDesign vs Code differences:\n' + visualDiffs.map(d => `  ${d}`).join('\n');
              }
            } catch {
              // Design extraction is best-effort
            }

            content.push(
              { type: 'text' as const, text: `--- Region ${i + 1}: (${region.x}, ${region.y}) ${region.width}x${region.height} — design vs your code ---${designAnalysis}${elementsInfo}` },
              { type: 'image' as const, data: pair.design.toString('base64'), mimeType: 'image/png' as const },
              { type: 'image' as const, data: pair.screenshot.toString('base64'), mimeType: 'image/png' as const },
            );
          }
        }

        return { content };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'imugi_figma_export',
    'Export a Figma frame as a PNG image. Pass a Figma URL or file key + node ID. Requires FIGMA_TOKEN env var.',
    {
      url: z.string().optional().describe('Full Figma URL (e.g. https://www.figma.com/design/FILE_KEY/name?node-id=42-1234)'),
      fileKey: z.string().optional().describe('Figma file key (alternative to URL)'),
      nodeId: z.string().optional().describe('Node ID to export (e.g. 42:1234)'),
      scale: z.number().min(1).max(4).default(2).describe('Export scale (1-4)'),
      format: z.enum(['png', 'jpg', 'svg', 'pdf']).default('png').describe('Image format'),
      outputPath: z.string().optional().describe('Save to file path instead of returning inline'),
    },
    async ({ url, fileKey, nodeId, scale, format, outputPath }) => {
      try {
        let resolvedFileKey: string;
        let resolvedNodeId: string;

        if (url) {
          const parsed = parseFigmaUrl(url);
          resolvedFileKey = parsed.fileKey;
          if (!parsed.nodeId) {
            return { content: [{ type: 'text' as const, text: 'Error: Figma URL must include a node-id parameter (e.g. ?node-id=42-1234)' }] };
          }
          resolvedNodeId = parsed.nodeId;
        } else if (fileKey && nodeId) {
          resolvedFileKey = fileKey;
          resolvedNodeId = nodeId;
        } else {
          return { content: [{ type: 'text' as const, text: 'Error: Provide either a Figma URL or both fileKey and nodeId' }] };
        }

        const token = resolveToken();
        const buffer = await exportFigmaImage({
          fileKey: resolvedFileKey,
          nodeId: resolvedNodeId,
          token,
          scale,
          format,
        });

        if (outputPath) {
          const validatedPath = validateFilePath(outputPath);
          await writeFile(validatedPath, buffer);
          return {
            content: [{ type: 'text' as const, text: `Exported Figma frame to ${validatedPath} (${buffer.length} bytes, ${scale}x ${format})` }],
          };
        }

        const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'svg' ? 'image/svg+xml' : format === 'pdf' ? 'application/pdf' : 'image/png';
        return {
          content: [
            { type: 'image' as const, data: buffer.toString('base64'), mimeType: mimeType as 'image/png' },
            { type: 'text' as const, text: `Figma export: ${resolvedFileKey} node ${resolvedNodeId} (${scale}x ${format}, ${buffer.length} bytes)` },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'imugi_detect',
    'Detect the tech stack of a project (framework, CSS, language, dev server)',
    {
      projectDir: z.string().default('.').describe('Project directory path'),
    },
    async ({ projectDir }) => {
      try {
        const context = await detectProjectContext(projectDir);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(context, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.tool(
    'imugi_serve',
    'Start a dev server and return the URL (for use with imugi_capture). The server process is tracked and will be cleaned up when the MCP session ends.',
    {
      command: z.string().default('npm run dev').describe('Dev server command'),
      port: z.number().int().default(3000).describe('Expected port'),
      projectDir: z.string().default('.').describe('Project directory'),
    },
    async ({ command, port, projectDir }) => {
      try {
        const child = spawn(command, {
          cwd: projectDir,
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PORT: String(port), BROWSER: 'none' },
        });

        trackProcess(child);

        let stderr = '';
        child.stderr?.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        const waitForPort = () => new Promise<void>((resolve, reject) => {
          const start = Date.now();
          const check = () => {
            if (child.killed || child.exitCode !== null) {
              reject(new Error(`Dev server exited unexpectedly.\nStderr: ${stderr.slice(-500)}`));
              return;
            }
            if (Date.now() - start > 30000) {
              child.kill('SIGTERM');
              reject(new Error('Dev server timeout (30s)'));
              return;
            }
            const socket = createConnection({ port, host: '127.0.0.1' });
            socket.on('connect', () => { socket.destroy(); resolve(); });
            socket.on('error', () => setTimeout(check, 500));
          };
          check();
        });

        await waitForPort();

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({ url: `http://localhost:${port}`, pid: child.pid, command }),
          }],
        };
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
