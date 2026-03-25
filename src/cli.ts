import { Command } from 'commander';
import { readFile, writeFile, access } from 'fs/promises';
import { resolve, join } from 'path';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { loadConfig } from './config/loader.js';
import { ensureAuthenticated, logout, loadStoredToken } from './agent/auth.js';
import { startMcpServer } from './mcp/server.js';
import { createClaudeClient } from './llm/client.js';
import { detectProjectContext } from './core/context.js';
import { createRenderer, resizeToMatch } from './core/renderer.js';
import { compareImages } from './core/comparator.js';
import { analyzeDifferences, generateReportText } from './core/analyzer.js';
import { runBoulderLoop } from './agent/loop.js';
import { parseFigmaUrl, exportFigmaImage, resolveToken } from './core/figma.js';
import { generateHtmlReport } from './core/report.js';
import sharp from 'sharp';

const execFileAsync = promisify(execFileCb);

process.on('unhandledRejection', (reason) => {
  process.stderr.write(`Fatal: ${reason instanceof Error ? reason.message : String(reason)}\n`);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});

const cleanupHandlers: Array<() => Promise<void>> = [];

function registerCleanup(fn: () => Promise<void>): void {
  cleanupHandlers.push(fn);
}

async function runCleanup(): Promise<void> {
  for (const handler of cleanupHandlers) {
    try {
      await handler();
    } catch {
      // best effort
    }
  }
  cleanupHandlers.length = 0;
}

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write('\nShutting down...\n');
    await runCleanup();
    process.exit(0);
  });
}

declare const __IMUGI_VERSION__: string;

const program = new Command();

program
  .name('imugi')
  .description('Design to Code — AI-powered frontend builder with visual verification')
  .version(__IMUGI_VERSION__)
  .option('--api-key <key>', 'Anthropic API key')
  .option('--threshold <number>', 'Similarity threshold (0.8-0.99)', parseFloat)
  .option('--max-iterations <number>', 'Maximum iterations', parseInt)
  .option('--url <url>', 'Dev server URL (skip auto-detection)')
  .option('--config <path>', 'Config file path')
  .option('--verbose', 'Enable verbose debug output');

function verbose(...args: unknown[]): void {
  if (program.opts().verbose) {
    process.stderr.write(`[debug] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`);
  }
}

function buildCliOverrides(opts: Record<string, unknown>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (opts.apiKey) {
    overrides.auth = { apiKey: opts.apiKey as string };
  }

  const comparison: Record<string, unknown> = {};
  if (opts.threshold !== undefined) {
    comparison.threshold = opts.threshold;
  }
  if (opts.maxIterations !== undefined) {
    comparison.maxIterations = opts.maxIterations;
  }
  if (Object.keys(comparison).length > 0) {
    overrides.comparison = comparison;
  }

  if (opts.url) {
    overrides.rendering = { url: opts.url as string };
  }

  return overrides;
}

program
  .command('agent', { isDefault: true })
  .description('Start interactive design-to-code agent (default)')
  .action(async () => {
    const opts = program.opts();
    const config = await loadConfig({
      configPath: opts.config as string | undefined,
      cliOverrides: buildCliOverrides(opts),
    });

    const { startInteractiveUI } = await import('./agent/ui.js');
    startInteractiveUI(config);
  });

program
  .command('generate <design-image>')
  .description('One-shot: generate code from a design image')
  .option('-o, --output <path>', 'Output file path', 'src/app/page.tsx')
  .action(async (designImagePath: string, cmdOpts: { output: string }) => {
    const opts = program.opts();
    const config = await loadConfig({
      configPath: opts.config as string | undefined,
      cliOverrides: buildCliOverrides(opts),
    });
    verbose('Config loaded', config);

    const auth = await ensureAuthenticated(config.auth.apiKey);
    const client = createClaudeClient(auth);
    const context = await detectProjectContext(process.cwd());
    verbose('Project context', context);
    const renderer = createRenderer(config);

    process.stdout.write('Starting dev server and browser...\n');
    await renderer.start(context, process.cwd());
    registerCleanup(() => renderer.shutdown());

    const result = await runBoulderLoop({
      client,
      designImagePath: resolve(designImagePath),
      userRequest: 'Implement this design pixel-perfectly.',
      outputPath: cmdOpts.output,
      projectDir: process.cwd(),
      config,
      projectContext: context,
      renderer,
      onProgress: (state) => {
        process.stdout.write(
          `\r[${state.iteration}/${state.maxIterations}] ${state.status} — score: ${state.score.toFixed(3)} (${state.strategy})`,
        );
      },
    });

    await renderer.shutdown();
    process.stdout.write(
      `\n\nDone: score ${result.finalScore.toFixed(3)} after ${result.totalIterations} iterations (${result.stopReason})\n`,
    );
    process.stdout.write(`Report: ${result.reportDir}\n`);
  });

program
  .command('compare <design-image>')
  .description('Compare a design image against the current running page')
  .option('--screenshot <path-or-url>', 'Path to screenshot file or URL to capture (e.g. http://localhost:3000)')
  .option('--report [dir]', 'Generate an HTML report (default: .imugi/reports)')
  .action(async (designImagePath: string, cmdOpts: { screenshot?: string; report?: string | true }) => {
    const opts = program.opts();
    const config = await loadConfig({
      configPath: opts.config as string | undefined,
      cliOverrides: buildCliOverrides(opts),
    });
    verbose('Config loaded', config);

    const designBuffer = await readFile(resolve(designImagePath));
    const designMeta = await sharp(designBuffer).metadata();
    const designWidth = designMeta.width ?? config.rendering.viewport.width;
    const designHeight = designMeta.height ?? config.rendering.viewport.height;

    let screenshotBuffer: Buffer;

    if (cmdOpts.screenshot && /^https?:\/\//.test(cmdOpts.screenshot)) {
      // URL: capture screenshot from live page
      const browser = await (await import('playwright')).chromium.launch({ headless: true });
      try {
        const ctx = await browser.newContext({ viewport: { width: designWidth, height: designHeight } });
        const page = await ctx.newPage();
        try {
          await page.goto(cmdOpts.screenshot, { waitUntil: 'networkidle', timeout: 15000 });
        } catch (navErr) {
          const msg = navErr instanceof Error ? navErr.message : String(navErr);
          if (msg.includes('ERR_CONNECTION_REFUSED') || msg.includes('ECONNREFUSED')) {
            throw new Error(`Dev server not responding at ${cmdOpts.screenshot} — is it running? Try: npm run dev`);
          }
          if (msg.includes('Timeout')) {
            throw new Error(`Page load timed out at ${cmdOpts.screenshot} — the server may be slow or unresponsive`);
          }
          throw navErr;
        }
        await page.waitForTimeout(500);
        screenshotBuffer = Buffer.from(await page.screenshot({ fullPage: true, type: 'png' }));
      } finally {
        await browser.close();
      }
    } else if (cmdOpts.screenshot) {
      screenshotBuffer = await readFile(resolve(cmdOpts.screenshot));
    } else {
      const context = await detectProjectContext(process.cwd());
      const renderer = createRenderer(config);
      await renderer.start(context, process.cwd());
      registerCleanup(() => renderer.shutdown());
      screenshotBuffer = await renderer.capture('/');
      await renderer.shutdown();
    }

    const resized = await resizeToMatch(screenshotBuffer, designWidth, designHeight);
    const comparison = await compareImages(designBuffer, resized);
    const report = analyzeDifferences(comparison);
    const reportText = generateReportText(report);

    process.stdout.write(reportText + '\n');
    process.stdout.write(`\nSSIM: ${comparison.ssim.mssim.toFixed(4)}\n`);
    process.stdout.write(`Pixel diff: ${(comparison.pixelDiff.diffPercentage * 100).toFixed(2)}%\n`);
    process.stdout.write(`Composite score: ${comparison.compositeScore.toFixed(4)}\n`);
    process.stdout.write(`Diff regions: ${comparison.diffRegions.length}\n`);

    if (cmdOpts.report !== undefined) {
      const reportDir = typeof cmdOpts.report === 'string' ? cmdOpts.report : join(process.cwd(), '.imugi', 'reports');
      const htmlPath = await generateHtmlReport({
        designBuffer,
        screenshotBuffer: resized,
        comparison,
        report,
        outputDir: reportDir,
      });
      process.stdout.write(`\nHTML report: ${htmlPath}\n`);
    }
  });

program
  .command('figma <url>')
  .description('Export a Figma frame as PNG and optionally compare against a running dev server')
  .option('-o, --output <path>', 'Save exported image to path', 'figma-export.png')
  .option('-s, --scale <number>', 'Export scale 1-4', parseFloat)
  .option('--compare', 'After export, compare against running dev server')
  .action(async (url: string, cmdOpts: { output: string; scale?: number; compare?: boolean }) => {
    const opts = program.opts();
    const config = await loadConfig({
      configPath: opts.config as string | undefined,
      cliOverrides: buildCliOverrides(opts),
    });

    const parsed = parseFigmaUrl(url);
    verbose('Parsed Figma URL', parsed);
    if (!parsed.nodeId) {
      process.stderr.write('Error: Figma URL must include a node-id parameter (e.g. ?node-id=42-1234)\n');
      process.exit(1);
    }

    const token = resolveToken(config.figma.token);
    const scale = cmdOpts.scale ?? config.figma.defaultScale;
    verbose(`Export settings: scale=${scale}, output=${cmdOpts.output}`);

    process.stdout.write(`Exporting Figma frame (${parsed.fileKey}, node ${parsed.nodeId}, ${scale}x)...\n`);
    const buffer = await exportFigmaImage({
      fileKey: parsed.fileKey,
      nodeId: parsed.nodeId,
      token,
      scale,
    });

    const outputPath = resolve(cmdOpts.output);
    await writeFile(outputPath, buffer);
    process.stdout.write(`Saved to ${outputPath} (${buffer.length} bytes)\n`);

    if (cmdOpts.compare) {
      process.stdout.write('\nComparing against dev server...\n');
      const designBuffer = buffer;
      const designMeta = await sharp(designBuffer).metadata();
      const designWidth = designMeta.width ?? config.rendering.viewport.width;
      const designHeight = designMeta.height ?? config.rendering.viewport.height;

      const context = await detectProjectContext(process.cwd());
      const renderer = createRenderer(config);
      await renderer.start(context, process.cwd());
      registerCleanup(() => renderer.shutdown());
      const screenshotBuffer = await renderer.capture('/');
      await renderer.shutdown();

      const resized = await resizeToMatch(screenshotBuffer, designWidth, designHeight);
      const comparison = await compareImages(designBuffer, resized);
      const report = analyzeDifferences(comparison);
      const reportText = generateReportText(report);

      process.stdout.write(reportText + '\n');
      process.stdout.write(`\nSSIM: ${comparison.ssim.mssim.toFixed(4)}\n`);
      process.stdout.write(`Pixel diff: ${(comparison.pixelDiff.diffPercentage * 100).toFixed(2)}%\n`);
      process.stdout.write(`Composite score: ${comparison.compositeScore.toFixed(4)}\n`);
      process.stdout.write(`Diff regions: ${comparison.diffRegions.length}\n`);
    }
  });

program
  .command('init')
  .description('Set up imugi: install Playwright browser, detect project, create config')
  .action(async () => {
    const w = (msg: string) => process.stdout.write(msg);
    w('\n  imugi init — One-click setup\n\n');

    // 1. Playwright browser
    w('  [1/5] Installing Playwright Chromium...\n');
    try {
      await execFileAsync('npx', ['playwright', 'install', 'chromium'], { timeout: 120000 });
      w('        Done.\n');
    } catch (err) {
      w(`        Warning: ${(err as Error).message}\n`);
      w('        Run manually: npx playwright install chromium\n');
    }

    // 2. Detect project
    w('  [2/5] Detecting project...\n');
    const context = await detectProjectContext(process.cwd());
    const stack = [
      context.framework ?? 'html',
      context.metaFramework ? `(${context.metaFramework})` : null,
      context.css.method ?? 'css',
      context.language,
    ].filter(Boolean).join(' + ');
    w(`        ${stack}\n`);

    // 3. Create config
    const configPath = join(process.cwd(), 'imugi.config.json');
    let configExists = false;
    try { await access(configPath); configExists = true; } catch { /* noop */ }

    if (configExists) {
      w('  [3/5] Config file already exists, skipping.\n');
    } else {
      w('  [3/5] Creating imugi.config.json...\n');
      const config = {
        comparison: { threshold: 0.95, maxIterations: 10 },
        rendering: {
          port: context.devServer.port,
          viewport: { width: 1440, height: 900 },
        },
      };
      await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
      w('        Done.\n');
    }

    // 4. Check API key
    w('  [4/5] Checking authentication...\n');
    const envKey = process.env.ANTHROPIC_API_KEY || process.env.IMUGI_API_KEY;
    if (envKey) {
      w('        API key found in environment.\n');
    } else {
      const token = await loadStoredToken();
      if (token) {
        w('        OAuth token found.\n');
      } else {
        w('        No API key found.\n');
        w('        Set ANTHROPIC_API_KEY or run: imugi auth login\n');
      }
    }

    // 5. Check Figma token
    w('  [5/5] Checking Figma integration...\n');
    const figmaToken = process.env.FIGMA_TOKEN || process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
    if (figmaToken) {
      w('        Figma token found in environment.\n');
    } else {
      w('        No Figma token found (optional).\n');
      w('        To use Figma integration: export FIGMA_TOKEN=your-token\n');
      w('        Get one at: https://www.figma.com/developers/api#access-tokens\n');
    }

    w('\n  Setup complete! Next steps:\n');
    w('    1. imugi auth login          (if not authenticated)\n');
    w('    2. imugi generate design.png  (one-shot generation)\n');
    w('    3. imugi figma <url>          (export from Figma)\n');
    w('    4. imugi                      (interactive agent)\n\n');
  });

program
  .command('mcp')
  .description('Start as MCP server (stdio transport)')
  .action(async () => {
    await startMcpServer();
  });

const authCmd = program
  .command('auth')
  .description('Authentication management');

authCmd
  .command('login')
  .description('Authenticate with Anthropic (OAuth PKCE or API key)')
  .action(async () => {
    const opts = program.opts();
    const config = await loadConfig({
      configPath: opts.config as string | undefined,
      cliOverrides: buildCliOverrides(opts),
    });

    try {
      const result = await ensureAuthenticated(config.auth.apiKey);
      if (result.type === 'api_key') {
        process.stdout.write('Authenticated via API key.\n');
      } else {
        process.stdout.write('Authenticated via OAuth. Token saved.\n');
      }
    } catch (err) {
      process.stderr.write(`Authentication failed: ${(err as Error).message}\n`);
      process.exit(1);
    }
  });

authCmd
  .command('logout')
  .description('Remove stored OAuth tokens')
  .action(async () => {
    await logout();
    process.stdout.write('Logged out. Token removed.\n');
  });

authCmd
  .command('status')
  .description('Show current authentication status')
  .action(async () => {
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) {
      process.stdout.write(`Auth: API key from environment (${envKey.slice(0, 8)}...)\n`);
      return;
    }

    const token = await loadStoredToken();
    if (token) {
      const expiresAt = token.saved_at ? new Date((token.saved_at + token.expires_in * 1000)).toISOString() : 'unknown';
      process.stdout.write(`Auth: OAuth token stored\nExpires: ${expiresAt}\n`);
    } else {
      process.stdout.write('Auth: Not authenticated\n');
    }
  });

program.parse();
