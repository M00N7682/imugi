import { describe, it, expect } from 'vitest';
import {
  extractCodeFromResponse,
  extractVisionAnalysis,
  buildSystemPrompt,
  buildCodeGenPrompt,
  buildFullRegenPrompt,
  buildSurgicalPatchPrompt,
  buildBuildErrorFixPrompt,
  buildVisionComparisonPrompt,
  buildConversationalPrompt,
} from './prompts.js';
import type { ProjectContext, DiffReport, IterationState } from '../types.js';

function makeContext(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
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
    ...overrides,
  };
}

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

  it('extracts JSON from surrounding text', () => {
    const input = 'Analysis: {"similarityScore": 0.9, "differences": [], "overallAssessment": "Great"} done.';
    const result = extractVisionAnalysis(input);
    expect(result.similarityScore).toBe(0.9);
    expect(result.overallAssessment).toBe('Great');
  });

  it('handles non-number similarityScore', () => {
    const input = '{"similarityScore": "high", "differences": [], "overallAssessment": "ok"}';
    const result = extractVisionAnalysis(input);
    expect(result.similarityScore).toBe(0.5);
  });

  it('handles non-array differences', () => {
    const input = '{"similarityScore": 0.8, "differences": "none", "overallAssessment": "ok"}';
    const result = extractVisionAnalysis(input);
    expect(result.differences).toEqual([]);
  });

  it('handles non-string overallAssessment', () => {
    const input = '{"similarityScore": 0.8, "differences": [], "overallAssessment": 123}';
    const result = extractVisionAnalysis(input);
    expect(result.overallAssessment).toBe('');
  });
});

describe('buildSystemPrompt', () => {
  it('contains framework name, CSS method, language', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain('react');
    expect(prompt).toContain('next');
    expect(prompt).toContain('tailwind');
    expect(prompt).toContain('typescript');
  });

  it('contains design system name when provided', () => {
    const prompt = buildSystemPrompt(makeContext({ designSystem: 'shadcn' }));
    expect(prompt).toContain('shadcn');
  });

  it('omits design system line when null', () => {
    const prompt = buildSystemPrompt(makeContext({ designSystem: null }));
    expect(prompt).not.toContain('Design System:');
  });

  it('omits meta-framework when null', () => {
    const prompt = buildSystemPrompt(makeContext({ metaFramework: null }));
    expect(prompt).not.toContain('(next)');
  });

  it('includes component pattern', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain('functional');
  });

  it('includes file convention details', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain('kebab-case');
    expect(prompt).toContain('.tsx');
  });

  it('includes code output rules', () => {
    const prompt = buildSystemPrompt(makeContext());
    expect(prompt).toContain('markdown code blocks');
    expect(prompt).toContain('file paths');
  });

  it('handles html framework with no meta-framework', () => {
    const prompt = buildSystemPrompt(makeContext({ framework: 'html', metaFramework: null, css: { method: 'css', version: null, config: null } }));
    expect(prompt).toContain('html');
    expect(prompt).toContain('css');
  });
});

describe('buildCodeGenPrompt', () => {
  it('includes user request', () => {
    const result = buildCodeGenPrompt('Build a login page', makeContext());
    expect(result).toContain('Build a login page');
  });

  it('generates TypeScript for ts projects', () => {
    const result = buildCodeGenPrompt('test', makeContext({ language: 'typescript' }));
    expect(result).toContain('TypeScript');
  });

  it('generates JavaScript for js projects', () => {
    const result = buildCodeGenPrompt('test', makeContext({ language: 'javascript' }));
    expect(result).toContain('JavaScript');
  });

  it('includes CSS method', () => {
    const result = buildCodeGenPrompt('test', makeContext());
    expect(result).toContain('tailwind');
  });

  it('includes example format', () => {
    const result = buildCodeGenPrompt('test', makeContext());
    expect(result).toContain('```tsx');
  });
});

describe('buildFullRegenPrompt', () => {
  const code = new Map([['src/app/page.tsx', 'export default function Home() {}']]);
  const diffReport: DiffReport = {
    overallScore: 0.6,
    regionCount: 2,
    regions: [
      {
        region: { x: 0, y: 0, width: 100, height: 100, diffIntensity: 0.8, pixelCount: 500 },
        classification: 'color',
        priority: 'high',
        description: 'Background color mismatch',
        cssSuggestion: 'Change background to #1a1a1a',
      },
      {
        region: { x: 200, y: 200, width: 50, height: 50, diffIntensity: 0.3, pixelCount: 100 },
        classification: 'spacing',
        priority: 'medium',
        description: 'Padding too large',
      },
    ],
    summary: 'Major color and spacing issues',
    suggestedStrategy: 'full_regen',
  };

  it('includes current code with file path', () => {
    const result = buildFullRegenPrompt(code, diffReport, makeContext());
    expect(result).toContain('src/app/page.tsx');
    expect(result).toContain('export default function Home()');
  });

  it('lists issues with priority', () => {
    const result = buildFullRegenPrompt(code, diffReport, makeContext());
    expect(result).toContain('[HIGH]');
    expect(result).toContain('Background color mismatch');
  });

  it('includes CSS suggestions', () => {
    const result = buildFullRegenPrompt(code, diffReport, makeContext());
    expect(result).toContain('Change background to #1a1a1a');
  });

  it('includes image descriptions', () => {
    const result = buildFullRegenPrompt(code, diffReport, makeContext());
    expect(result).toContain('Original design');
    expect(result).toContain('Heatmap');
  });

  it('handles empty regions gracefully', () => {
    const emptyReport: DiffReport = { overallScore: 0.5, regionCount: 0, regions: [], summary: '', suggestedStrategy: 'full_regen' };
    const result = buildFullRegenPrompt(code, emptyReport, makeContext());
    expect(result).toContain('General visual mismatch');
  });
});

describe('buildSurgicalPatchPrompt', () => {
  it('lists specific fixes with numbering', () => {
    const result = buildSurgicalPatchPrompt('code', [], ['Fix button color', 'Adjust padding']);
    expect(result).toContain('1. Fix button color');
    expect(result).toContain('2. Adjust padding');
  });

  it('includes code block', () => {
    const result = buildSurgicalPatchPrompt('const x = 1;', [], ['Fix']);
    expect(result).toContain('const x = 1;');
  });

  it('instructs minimal changes', () => {
    const result = buildSurgicalPatchPrompt('code', [], ['Fix']);
    expect(result).toContain('MINIMAL');
  });
});

describe('buildVisionComparisonPrompt', () => {
  it('includes JSON format instructions', () => {
    const result = buildVisionComparisonPrompt();
    expect(result).toContain('similarityScore');
    expect(result).toContain('differences');
    expect(result).toContain('overallAssessment');
  });

  it('describes image roles', () => {
    const result = buildVisionComparisonPrompt();
    expect(result).toContain('DESIGN');
    expect(result).toContain('IMPLEMENTATION');
  });
});

describe('buildBuildErrorFixPrompt', () => {
  it('includes error message', () => {
    const result = buildBuildErrorFixPrompt('SyntaxError: unexpected token', 'const x =', makeContext());
    expect(result).toContain('SyntaxError: unexpected token');
  });

  it('includes code', () => {
    const result = buildBuildErrorFixPrompt('error', 'const x = 1;', makeContext());
    expect(result).toContain('const x = 1;');
  });

  it('includes framework context', () => {
    const result = buildBuildErrorFixPrompt('error', 'code', makeContext());
    expect(result).toContain('react');
  });
});

describe('buildConversationalPrompt', () => {
  it('includes user message', () => {
    const result = buildConversationalPrompt('Make the button blue', null);
    expect(result).toContain('Make the button blue');
  });

  it('includes score when state provided', () => {
    const state = { score: 0.85 } as IterationState;
    const result = buildConversationalPrompt('change', state);
    expect(result).toContain('0.850');
  });

  it('omits score when state is null', () => {
    const result = buildConversationalPrompt('change', null);
    expect(result).not.toContain('similarity score');
  });
});
