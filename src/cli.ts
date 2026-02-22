import { Command } from 'commander';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { loadConfig } from './config/loader.js';
import { ensureAuthenticated, logout, loadStoredToken, type AuthResult } from './agent/auth.js';
import { startMcpServer } from './mcp/server.js';
import { createClaudeClient } from './llm/client.js';
import { detectProjectContext } from './core/context.js';
import { createRenderer, resizeToMatch, inferRoute } from './core/renderer.js';
import { compareImages } from './core/comparator.js';
import { analyzeDifferences, generateReportText } from './core/analyzer.js';
import { runBoulderLoop } from './agent/loop.js';
import { generateInitialCode, writeCodeToFiles } from './core/patcher.js';
import sharp from 'sharp';

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
  .option('--config <path>', 'Config file path');

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

    const auth = await ensureAuthenticated(config.auth.apiKey);
    const client = createClaudeClient(auth);
    const context = await detectProjectContext(process.cwd());
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
  .option('--screenshot <path>', 'Use an existing screenshot instead of capturing')
  .action(async (designImagePath: string, cmdOpts: { screenshot?: string }) => {
    const opts = program.opts();
    const config = await loadConfig({
      configPath: opts.config as string | undefined,
      cliOverrides: buildCliOverrides(opts),
    });

    const designBuffer = await readFile(resolve(designImagePath));
    const designMeta = await sharp(designBuffer).metadata();
    const designWidth = designMeta.width ?? config.rendering.viewport.width;
    const designHeight = designMeta.height ?? config.rendering.viewport.height;

    let screenshotBuffer: Buffer;

    if (cmdOpts.screenshot) {
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
