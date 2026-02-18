import { z } from 'zod';

const ImugiConfigSchema = z.object({
  auth: z.object({
    apiKey: z.string().nullable().default(null),
    oauth: z.boolean().default(true),
  }).default({}),
  comparison: z.object({
    threshold: z.number().min(0.8).max(0.99).default(0.95),
    maxIterations: z.number().int().min(1).max(50).default(10),
    improvementThreshold: z.number().min(0).max(0.1).default(0.01),
    patchSwitchThreshold: z.number().min(0.3).max(0.95).default(0.7),
  }).default({}),
  rendering: z.object({
    devServerCommand: z.string().nullable().default(null),
    url: z.string().nullable().default(null),
    port: z.number().int().min(1024).max(65535).default(3000),
    viewport: z.object({
      width: z.number().int().default(1440),
      height: z.number().int().default(900),
    }).default({}),
  }).default({}),
  project: z.object({
    framework: z.enum(['auto', 'react', 'vue', 'svelte', 'html']).nullable().default(null),
    css: z.enum(['auto', 'tailwind', 'modules', 'styled-components', 'css']).nullable().default(null),
    language: z.enum(['auto', 'typescript', 'javascript']).nullable().default(null),
  }).default({}),
  timeouts: z.object({
    overall: z.number().default(1800),
    pageLoad: z.number().default(15),
    devServer: z.number().default(30),
  }).default({}),
});

type ImugiConfig = z.infer<typeof ImugiConfigSchema>;

export { ImugiConfigSchema, type ImugiConfig };
