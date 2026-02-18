import { describe, it, expect } from 'vitest';
import { loadConfig } from './loader.js';

describe('loadConfig', () => {
  it('returns default config when no file/env/cli overrides', async () => {
    const config = await loadConfig();
    expect(config.auth.apiKey).toBe(null);
    expect(config.auth.oauth).toBe(true);
    expect(config.comparison.threshold).toBe(0.95);
    expect(config.comparison.maxIterations).toBe(10);
    expect(config.rendering.port).toBe(3000);
    expect(config.rendering.viewport.width).toBe(1440);
    expect(config.rendering.viewport.height).toBe(900);
  });

  it('CLI overrides take priority over defaults', async () => {
    const config = await loadConfig({
      cliOverrides: { auth: { apiKey: 'test-key' } },
    });
    expect(config.auth.apiKey).toBe('test-key');
    expect(config.auth.oauth).toBe(true);
  });

  it('throws on invalid config', async () => {
    await expect(
      loadConfig({
        cliOverrides: { comparison: { threshold: 2.0 } },
      }),
    ).rejects.toThrow('Invalid configuration');
  });
});
