import type { ImugiConfig } from './schema.js';

export const DEFAULT_CONFIG: ImugiConfig = {
  auth: {
    apiKey: null,
    oauth: true,
  },
  comparison: {
    threshold: 0.95,
    maxIterations: 10,
    improvementThreshold: 0.01,
    patchSwitchThreshold: 0.7,
  },
  rendering: {
    devServerCommand: null,
    url: null,
    port: 3000,
    viewport: { width: 1440, height: 900 },
  },
  project: {
    framework: null,
    css: null,
    language: null,
  },
  timeouts: {
    overall: 1800,
    pageLoad: 15,
    devServer: 30,
  },
};
