import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { spawn, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { compareImages } from '../core/comparator.js';
import { analyzeDifferences, generateReportText } from '../core/analyzer.js';
import { detectProjectContext } from '../core/context.js';
import { resizeToMatch } from '../core/renderer.js';
import { parseFigmaUrl, exportFigmaImage, resolveToken } from '../core/figma.js';

declare const __IMUGI_VERSION__: string;

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

  server.tool(
    'imugi_capture',
    'Capture a screenshot of a web page at a given URL',
    {
      url: z.string().describe('URL to screenshot'),
      width: z.number().int().default(1440).describe('Viewport width'),
      height: z.number().int().default(900).describe('Viewport height'),
      fullPage: z.boolean().default(true).describe('Capture full page'),
    },
    async ({ url, width, height, fullPage }) => {
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport: { width, height } });
        const page = await context.newPage();
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
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
    },
  );

  server.tool(
    'imugi_compare',
    'Compare a design image against a rendered screenshot. Returns SSIM score, pixel diff, and heatmap.',
    {
      designImagePath: z.string().describe('Path to the design image file'),
      screenshotUrl: z.string().optional().describe('URL to capture screenshot from'),
      screenshotPath: z.string().optional().describe('Path to an existing screenshot file'),
      figmaUrl: z.string().optional().describe('Figma URL to export as design image (alternative to designImagePath)'),
      viewportWidth: z.number().int().default(1440),
      viewportHeight: z.number().int().default(900),
    },
    async ({ designImagePath, screenshotUrl, screenshotPath, figmaUrl, viewportWidth, viewportHeight }) => {
      let designBuffer: Buffer;

      if (figmaUrl) {
        const parsed = parseFigmaUrl(figmaUrl);
        if (!parsed.nodeId) {
          return { content: [{ type: 'text' as const, text: 'Error: Figma URL must include a node-id parameter' }] };
        }
        const token = resolveToken();
        designBuffer = await exportFigmaImage({ fileKey: parsed.fileKey, nodeId: parsed.nodeId, token });
      } else {
        designBuffer = await readFile(designImagePath);
      }

      let screenshotBuffer: Buffer;

      if (screenshotPath) {
        screenshotBuffer = await readFile(screenshotPath);
      } else if (screenshotUrl) {
        const browser = await chromium.launch({ headless: true });
        try {
          const ctx = await browser.newContext({ viewport: { width: viewportWidth, height: viewportHeight } });
          const page = await ctx.newPage();
          await page.goto(screenshotUrl, { waitUntil: 'networkidle', timeout: 15000 });
          await page.waitForTimeout(500);
          screenshotBuffer = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
        } finally {
          await browser.close();
        }
      } else {
        return { content: [{ type: 'text' as const, text: 'Error: Provide either screenshotUrl or screenshotPath' }] };
      }

      const designMeta = await sharp(designBuffer).metadata();
      const resized = await resizeToMatch(screenshotBuffer, designMeta.width ?? viewportWidth, designMeta.height ?? viewportHeight);
      const comparison = await compareImages(designBuffer, resized);

      return {
        content: [
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
        ],
      };
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
      const designBuffer = await readFile(designImagePath);
      const screenshotBuffer = await readFile(screenshotPath);
      const designMeta = await sharp(designBuffer).metadata();
      const resized = await resizeToMatch(screenshotBuffer, designMeta.width ?? 1440, designMeta.height ?? 900);
      const comparison = await compareImages(designBuffer, resized);
      const report = analyzeDifferences(comparison);
      const reportText = generateReportText(report);

      return {
        content: [{ type: 'text' as const, text: reportText }],
      };
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
        const { writeFile: writeFileAsync } = await import('fs/promises');
        await writeFileAsync(outputPath, buffer);
        return {
          content: [{ type: 'text' as const, text: `Exported Figma frame to ${outputPath} (${buffer.length} bytes, ${scale}x ${format})` }],
        };
      }

      const mimeType = format === 'jpg' ? 'image/jpeg' : format === 'svg' ? 'image/svg+xml' : format === 'pdf' ? 'application/pdf' : 'image/png';
      return {
        content: [
          { type: 'image' as const, data: buffer.toString('base64'), mimeType: mimeType as 'image/png' },
          { type: 'text' as const, text: `Figma export: ${resolvedFileKey} node ${resolvedNodeId} (${scale}x ${format}, ${buffer.length} bytes)` },
        ],
      };
    },
  );

  server.tool(
    'imugi_detect',
    'Detect the tech stack of a project (framework, CSS, language, dev server)',
    {
      projectDir: z.string().default('.').describe('Project directory path'),
    },
    async ({ projectDir }) => {
      const context = await detectProjectContext(projectDir);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(context, null, 2) }],
      };
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
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
