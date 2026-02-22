import { describe, it, expect, beforeAll } from 'vitest';
import { execFile } from 'child_process';
import { join } from 'path';
import { writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import sharp from 'sharp';

const CLI_PATH = join(import.meta.dirname, '..', '..', 'dist', 'cli.js');

function runCli(args: string[], options?: { timeout?: number }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    execFile('node', [CLI_PATH, ...args], {
      timeout: options?.timeout ?? 15000,
      env: { ...process.env, NO_COLOR: '1' },
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        code: error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 0 : (error as unknown as { status?: number })?.status ?? 0,
      });
    });
  });
}

describe('CLI E2E', () => {
  describe('imugi --help', () => {
    it('displays help with all commands', async () => {
      const { stdout } = await runCli(['--help']);
      expect(stdout).toContain('Design to Code');
      expect(stdout).toContain('agent');
      expect(stdout).toContain('generate');
      expect(stdout).toContain('compare');
      expect(stdout).toContain('mcp');
      expect(stdout).toContain('auth');
    });
  });

  describe('imugi --version', () => {
    it('outputs version number', async () => {
      const { stdout } = await runCli(['--version']);
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe('imugi auth status', () => {
    it('shows auth status without crash', async () => {
      const { stdout } = await runCli(['auth', 'status']);
      expect(stdout).toContain('Auth:');
    });
  });

  describe('imugi auth --help', () => {
    it('lists auth subcommands', async () => {
      const { stdout } = await runCli(['auth', '--help']);
      expect(stdout).toContain('login');
      expect(stdout).toContain('logout');
      expect(stdout).toContain('status');
    });
  });

  describe('imugi compare', () => {
    const fixtureDir = join(tmpdir(), `imugi-cli-e2e-${Date.now()}`);
    let designPath: string;
    let screenshotPath: string;

    beforeAll(async () => {
      await mkdir(fixtureDir, { recursive: true });

      designPath = join(fixtureDir, 'design.png');
      screenshotPath = join(fixtureDir, 'screenshot.png');

      const design = await sharp({
        create: { width: 400, height: 300, channels: 3, background: { r: 66, g: 133, b: 244 } },
      }).png().toBuffer();

      const screenshot = await sharp({
        create: { width: 400, height: 300, channels: 3, background: { r: 70, g: 130, b: 240 } },
      }).png().toBuffer();

      await writeFile(designPath, design);
      await writeFile(screenshotPath, screenshot);
    });

    it('compares two images via --screenshot flag', async () => {
      const { stdout } = await runCli(['compare', designPath, '--screenshot', screenshotPath], { timeout: 30000 });
      expect(stdout).toContain('SSIM:');
      expect(stdout).toContain('Pixel diff:');
      expect(stdout).toContain('Composite score:');
      expect(stdout).toContain('Diff regions:');
    });

    it('shows meaningful scores', async () => {
      const { stdout } = await runCli(['compare', designPath, '--screenshot', screenshotPath], { timeout: 30000 });
      const ssimMatch = stdout.match(/SSIM:\s*([\d.]+)/);
      expect(ssimMatch).not.toBeNull();
      const ssim = parseFloat(ssimMatch![1]);
      expect(ssim).toBeGreaterThan(0.5);
      expect(ssim).toBeLessThanOrEqual(1.0);
    });
  });

  describe('imugi generate --help', () => {
    it('shows generate usage', async () => {
      const { stdout } = await runCli(['generate', '--help']);
      expect(stdout).toContain('design-image');
      expect(stdout).toContain('--output');
    });
  });
});
