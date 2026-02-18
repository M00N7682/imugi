import { describe, it, expect } from 'vitest';
import { extractCodeFromResponse, extractVisionAnalysis, buildSystemPrompt } from './prompts.js';
import type { ProjectContext } from '../types.js';

describe('extractCodeFromResponse', () => {
  it('extracts single code block with // filepath comment', () => {
    const input = `Here's the code:
\`\`\`tsx
// src/app/page.tsx
export default function Page() { return <div>Hello</div> }
\`\`\``;
    const result = extractCodeFromResponse(input);
    expect(result.has('src/app/page.tsx')).toBe(true);
    expect(result.get('src/app/page.tsx')).toContain('export default function Page');
  });

  it('extracts multiple code blocks', () => {
    const input = `\`\`\`tsx
// src/app/page.tsx
code1
\`\`\`

\`\`\`css
// src/app/globals.css
code2
\`\`\``;
    const result = extractCodeFromResponse(input);
    expect(result.size).toBe(2);
    expect(result.has('src/app/page.tsx')).toBe(true);
    expect(result.has('src/app/globals.css')).toBe(true);
  });

  it('returns empty map for no code blocks', () => {
    const input = 'No code blocks here';
    const result = extractCodeFromResponse(input);
    expect(result.size).toBe(0);
  });

  it('handles **filepath** format', () => {
    const input = `\`\`\`tsx
**src/app/page.tsx**
export default function Page() {}
\`\`\``;
    const result = extractCodeFromResponse(input);
    expect(result.has('src/app/page.tsx')).toBe(true);
  });
});

describe('extractVisionAnalysis', () => {
  it('parses valid JSON response', () => {
    const input = '{"similarityScore": 0.85, "differences": [{"area":"header","type":"color","description":"wrong bg","cssSuggestion":"bg-blue-500"}], "overallAssessment": "close match"}';
    const result = extractVisionAnalysis(input);
    expect(result.similarityScore).toBe(0.85);
    expect(result.differences.length).toBe(1);
    expect(result.differences[0].area).toBe('header');
    expect(result.overallAssessment).toBe('close match');
  });

  it('returns defaults for invalid JSON', () => {
    const input = 'not json';
    const result = extractVisionAnalysis(input);
    expect(result.similarityScore).toBe(0.5);
    expect(result.differences).toEqual([]);
    expect(result.overallAssessment).toContain('Failed');
  });
});

describe('buildSystemPrompt', () => {
  it('contains framework name, CSS method, language', () => {
    const context: ProjectContext = {
      framework: 'react',
      metaFramework: 'next',
      version: '14.0.0',
      language: 'typescript',
      css: { method: 'tailwind', version: '3.0', config: 'tailwind.config.ts' },
      componentPattern: 'functional',
      fileConvention: { naming: 'kebab-case', extension: '.tsx', styleExtension: null },
      designSystem: null,
      stateManagement: null,
      devServer: { command: 'npm run dev', port: 3000 },
    };
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain('react');
    expect(prompt).toContain('next');
    expect(prompt).toContain('tailwind');
    expect(prompt).toContain('typescript');
  });

  it('contains design system name when provided', () => {
    const context: ProjectContext = {
      framework: 'react',
      metaFramework: 'next',
      version: '14.0.0',
      language: 'typescript',
      css: { method: 'tailwind', version: '3.0', config: 'tailwind.config.ts' },
      componentPattern: 'functional',
      fileConvention: { naming: 'kebab-case', extension: '.tsx', styleExtension: null },
      designSystem: 'shadcn',
      stateManagement: null,
      devServer: { command: 'npm run dev', port: 3000 },
    };
    const prompt = buildSystemPrompt(context);
    expect(prompt).toContain('shadcn');
  });
});
