import { spawn, type ChildProcess } from 'child_process';
import { createConnection } from 'net';
import { chromium, type Browser, type Page } from 'playwright';
import sharp from 'sharp';
import type { ImugiConfig } from '../config/schema.js';
import type { ProjectContext } from '../types.js';

export interface DevServerHandle {
  url: string;
  port: number;
  process: ChildProcess | null;
  stop: () => Promise<void>;
}

export interface BrowserHandle {
  browser: Browser;
  page: Page | null;
  close: () => Promise<void>;
}

export interface CaptureOptions {
  browserHandle: BrowserHandle;
  url: string;
  viewport: { width: number; height: number };
  waitForStability?: boolean;
  timeoutMs?: number;
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' });
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Dev server did not start within ${timeoutMs / 1000}s on port ${port}`));
        return;
      }

      isPortInUse(port).then((inUse) => {
        if (inUse) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });
    };

    check();
  });
}

export async function startDevServer(
  context: ProjectContext,
  config: ImugiConfig,
  projectDir: string,
): Promise<DevServerHandle> {
  if (config.rendering.url) {
    const url = config.rendering.url;
    const port = new URL(url).port ? parseInt(new URL(url).port, 10) : 80;
    return {
      url,
      port,
      process: null,
      stop: async () => {},
    };
  }

  const port = config.rendering.port;

  if (await isPortInUse(port)) {
    return {
      url: `http://localhost:${port}`,
      port,
      process: null,
      stop: async () => {},
    };
  }

  const command = config.rendering.devServerCommand ?? context.devServer.command;
  const [cmd, ...args] = command.split(' ');

  const child = spawn(cmd, args, {
    cwd: projectDir,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: String(port), BROWSER: 'none' },
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  child.on('error', (err) => {
    throw new Error(`Failed to start dev server: ${err.message}`);
  });

  const timeoutMs = config.timeouts.devServer * 1000;

  try {
    await waitForPort(port, timeoutMs);
  } catch (err) {
    child.kill('SIGTERM');
    throw new Error(`Dev server failed to start: ${(err as Error).message}\nStderr: ${stderr.slice(-500)}`, { cause: err });
  }

  return {
    url: `http://localhost:${port}`,
    port,
    process: child,
    stop: async () => {
      if (child.killed) return;
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const forceKill = setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
          resolve();
        }, 5000);
        child.on('exit', () => {
          clearTimeout(forceKill);
          resolve();
        });
      });
    },
  };
}

export async function launchBrowser(): Promise<BrowserHandle> {
  const browser = await chromium.launch({ headless: true });
  return {
    browser,
    page: null,
    close: async () => {
      await browser.close();
    },
  };
}

export async function captureScreenshot(options: CaptureOptions): Promise<Buffer> {
  const { browserHandle, url, viewport, waitForStability = true, timeoutMs = 15000 } = options;

  if (!browserHandle.page) {
    const context = await browserHandle.browser.newContext({ viewport });
    browserHandle.page = await context.newPage();
  } else {
    await browserHandle.page.setViewportSize(viewport);
  }

  const page = browserHandle.page;
  await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });

  if (waitForStability) {
    await page.waitForTimeout(500);
  }

  const buffer = await page.screenshot({ fullPage: true, type: 'png' });
  return Buffer.from(buffer);
}

export async function captureAfterHMR(page: Page, timeoutMs = 5000): Promise<Buffer> {
  try {
    await page.waitForLoadState('networkidle', { timeout: timeoutMs });
  } catch {
    // networkidle timeout is acceptable for HMR
  }
  await page.waitForTimeout(1000);

  const buffer = await page.screenshot({ fullPage: true, type: 'png' });
  return Buffer.from(buffer);
}

export async function resizeToMatch(
  screenshotBuffer: Buffer,
  targetWidth: number,
  targetHeight: number,
): Promise<Buffer> {
  return sharp(screenshotBuffer)
    .resize(targetWidth, targetHeight, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toBuffer();
}

export function inferRoute(
  outputFilePath: string,
  _context: ProjectContext,
): string {
  const normalized = outputFilePath.replace(/\\/g, '/');

  const appRouterMatch = normalized.match(/src\/app\/(.+?)\/page\.\w+$/);
  if (appRouterMatch) {
    return '/' + appRouterMatch[1];
  }

  const pagesMatch = normalized.match(/(?:src\/)?pages\/(.+?)\.\w+$/);
  if (pagesMatch) {
    const route = pagesMatch[1];
    if (route === 'index') return '/';
    return '/' + route;
  }

  const routesMatch = normalized.match(/src\/routes\/(.+?)\.\w+$/);
  if (routesMatch) {
    const route = routesMatch[1];
    if (route === 'index' || route === '+page') return '/';
    return '/' + route.replace(/\/\+page$/, '');
  }

  if (normalized.endsWith('index.html') || normalized.endsWith('index.tsx') || normalized.endsWith('index.jsx')) {
    return '/';
  }

  return '/';
}

export interface Renderer {
  devServer: DevServerHandle | null;
  browserHandle: BrowserHandle | null;
  config: ImugiConfig;
  start: (context: ProjectContext, projectDir: string) => Promise<void>;
  capture: (route?: string) => Promise<Buffer>;
  captureHMR: () => Promise<Buffer>;
  shutdown: () => Promise<void>;
}

export function createRenderer(config: ImugiConfig): Renderer {
  const renderer: Renderer = {
    devServer: null,
    browserHandle: null,
    config,

    async start(context: ProjectContext, projectDir: string) {
      renderer.devServer = await startDevServer(context, config, projectDir);
      renderer.browserHandle = await launchBrowser();
    },

    async capture(route = '/') {
      if (!renderer.devServer || !renderer.browserHandle) {
        throw new Error('Renderer not started. Call start() first.');
      }
      const url = renderer.devServer.url + route;
      return captureScreenshot({
        browserHandle: renderer.browserHandle,
        url,
        viewport: config.rendering.viewport,
      });
    },

    async captureHMR() {
      if (!renderer.browserHandle?.page) {
        throw new Error('No page available for HMR capture');
      }
      return captureAfterHMR(renderer.browserHandle.page);
    },

    async shutdown() {
      if (renderer.browserHandle) {
        await renderer.browserHandle.close();
        renderer.browserHandle = null;
      }
      if (renderer.devServer) {
        await renderer.devServer.stop();
        renderer.devServer = null;
      }
    },
  };

  return renderer;
}
