import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFile } from 'fs/promises';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { compareImages, computeCompositeScore } from '../core/comparator.js';
import { analyzeDifferences, generateReportText } from '../core/analyzer.js';
import { detectProjectContext } from '../core/context.js';
import { resizeToMatch } from '../core/renderer.js';

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'imugi',
    version: '1.0.0',
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
      viewportWidth: z.number().int().default(1440),
      viewportHeight: z.number().int().default(900),
    },
    async ({ designImagePath, screenshotUrl, screenshotPath, viewportWidth, viewportHeight }) => {
      const designBuffer = await readFile(designImagePath);
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
    'Start a dev server and return the URL (for use with imugi_capture)',
    {
      command: z.string().default('npm run dev').describe('Dev server command'),
      port: z.number().int().default(3000).describe('Expected port'),
      projectDir: z.string().default('.').describe('Project directory'),
    },
    async ({ command, port, projectDir }) => {
      const { spawn } = await import('child_process');
      const child = spawn(command.split(' ')[0], command.split(' ').slice(1), {
        cwd: projectDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: String(port), BROWSER: 'none' },
      });

      const { createConnection } = await import('net');
      const waitForPort = () => new Promise<void>((resolve, reject) => {
        const start = Date.now();
        const check = () => {
          if (Date.now() - start > 30000) {
            child.kill();
            reject(new Error('Dev server timeout'));
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
