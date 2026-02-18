import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { ImugiConfigSchema, type ImugiConfig } from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';

function deepMerge<T extends Record<string, unknown>>(target: T, source: Record<string, unknown>): T {
  const result = { ...target } as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];
    if (
      sourceVal !== null &&
      sourceVal !== undefined &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>,
      );
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }
  return result as T;
}

function loadEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};

  if (process.env.IMUGI_API_KEY) {
    overrides.auth = { apiKey: process.env.IMUGI_API_KEY };
  }

  const comparison: Record<string, unknown> = {};
  if (process.env.IMUGI_THRESHOLD) {
    comparison.threshold = parseFloat(process.env.IMUGI_THRESHOLD);
  }
  if (process.env.IMUGI_MAX_ITERATIONS) {
    comparison.maxIterations = parseInt(process.env.IMUGI_MAX_ITERATIONS, 10);
  }
  if (Object.keys(comparison).length > 0) {
    overrides.comparison = comparison;
  }

  if (process.env.IMUGI_PORT) {
    overrides.rendering = { port: parseInt(process.env.IMUGI_PORT, 10) };
  }

  return overrides;
}

async function loadFileConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const content = await readFile(configPath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return {};
    }
    throw new Error(`Failed to read config file ${configPath}: ${error.message}`);
  }
}

export async function loadConfig(options?: {
  configPath?: string;
  cliOverrides?: Record<string, unknown>;
}): Promise<ImugiConfig> {
  const configPath = options?.configPath ?? resolve(process.cwd(), 'imugi.config.json');
  const fileConfig = await loadFileConfig(configPath);
  const envOverrides = loadEnvOverrides();
  const cliOverrides = options?.cliOverrides ?? {};

  let merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, fileConfig);
  merged = deepMerge(merged, envOverrides);
  merged = deepMerge(merged, cliOverrides);

  try {
    return ImugiConfigSchema.parse(merged);
  } catch (err: unknown) {
    const error = err as Error;
    throw new Error(`Invalid configuration: ${error.message}`);
  }
}
