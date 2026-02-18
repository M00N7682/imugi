import type { ProjectContext, DiffReport, DiffRegion, IterationState, VisionAnalysis } from '../types.js';

export function buildSystemPrompt(context: ProjectContext): string {
  const parts = [
    'You are an expert frontend developer who generates pixel-perfect code matching design images exactly.',
    '',
    `Stack: ${context.framework ?? 'HTML'} ${context.metaFramework ? `(${context.metaFramework})` : ''} + ${context.css.method ?? 'CSS'} + ${context.language}`,
  ];

  if (context.designSystem) {
    parts.push(`Design System: ${context.designSystem}`);
  }

  parts.push(
    '',
    'Conventions:',
    `- Component pattern: ${context.componentPattern ?? 'functional'}`,
    `- File naming: ${context.fileConvention.naming}`,
    `- File extension: ${context.fileConvention.extension}`,
    '',
    'Rules:',
    '- Output ONLY code in markdown code blocks with file paths as the first line comment',
    '- Match the design EXACTLY: every pixel, color, spacing, font size, border radius',
    '- Use the project existing patterns and conventions',
    '- Do not add explanatory comments in the code',
    '- Format file paths as: ```tsx // src/app/page.tsx',
  );

  return parts.join('\n');
}

export function buildCodeGenPrompt(
  userRequest: string,
  context: ProjectContext,
): string {
  return [
    userRequest,
    '',
    'The attached image is the design to implement.',
    '',
    `Generate ${context.language === 'typescript' ? 'TypeScript' : 'JavaScript'} code using ${context.framework ?? 'HTML/CSS'} ${context.css.method ? `with ${context.css.method}` : ''}.`,
    '',
    'Output each file as a separate markdown code block with the file path as a comment on the first line.',
    'Example format:',
    '```tsx',
    '// src/app/login/page.tsx',
    'export default function LoginPage() { ... }',
    '```',
  ].join('\n');
}

export function buildFullRegenPrompt(
  currentCode: Map<string, string>,
  diffReport: DiffReport,
  context: ProjectContext,
): string {
  const codeEntries = Array.from(currentCode.entries())
    .map(([path, content]) => `\`\`\`${context.fileConvention.extension.slice(1)}\n// ${path}\n${content}\n\`\`\``)
    .join('\n\n');

  const issues = diffReport.regions
    .map((r, i) => `${i + 1}. [${r.priority.toUpperCase()}] ${r.description}${r.cssSuggestion ? ` — Fix: ${r.cssSuggestion}` : ''}`)
    .join('\n');

  return [
    'The current code does not match the design well enough.',
    '',
    'Problems found:',
    issues || 'General visual mismatch detected.',
    '',
    'Current code (keep what works, fix what does not):',
    codeEntries,
    '',
    'Attached images:',
    '1. Original design (TARGET)',
    '2. Current rendering (what your code produces)',
    '3. Heatmap showing differences (red = most different)',
    '',
    'Regenerate the complete code. Preserve correct parts, fix everything else.',
    'Output each file as a separate markdown code block with file path comment.',
  ].join('\n');
}

export function buildSurgicalPatchPrompt(
  codeBlock: string,
  diffRegions: DiffRegion[],
  specificFixes: string[],
): string {
  const fixList = specificFixes.map((f, i) => `${i + 1}. ${f}`).join('\n');

  return [
    'The code is mostly correct but has these specific issues:',
    fixList,
    '',
    'Relevant code:',
    '```',
    codeBlock,
    '```',
    '',
    'Attached images show the problem areas (design vs current rendering).',
    '',
    'Make MINIMAL changes to fix only these issues.',
    'Do not restructure or rewrite unrelated code.',
    'Return the complete modified file with the file path comment.',
  ].join('\n');
}

export function buildVisionComparisonPrompt(): string {
  return [
    'Compare these images of a web page:',
    '- Image 1: The DESIGN (target/goal)',
    '- Image 2: The IMPLEMENTATION (current rendering)',
    '- Image 3 (if present): Heatmap highlighting pixel-level differences',
    '',
    'Analyze and respond with ONLY valid JSON (no markdown wrapping):',
    '{',
    '  "similarityScore": <number 0.0-1.0>,',
    '  "differences": [',
    '    {',
    '      "area": "<header, sidebar, button, etc.>",',
    '      "type": "<color|spacing|size|position|missing|extra|font>",',
    '      "description": "<what exactly is different>",',
    '      "cssSuggestion": "<specific CSS fix>"',
    '    }',
    '  ],',
    '  "overallAssessment": "<one sentence summary>"',
    '}',
  ].join('\n');
}

export function buildBuildErrorFixPrompt(
  errorMessage: string,
  code: string,
  context: ProjectContext,
): string {
  return [
    'This code has a build error. Fix it while preserving the visual intent.',
    '',
    `Framework: ${context.framework ?? 'HTML'} + ${context.css.method ?? 'CSS'} + ${context.language}`,
    '',
    'Error:',
    errorMessage,
    '',
    'Code:',
    '```',
    code,
    '```',
    '',
    'Return the complete fixed code with the file path comment.',
  ].join('\n');
}

export function buildConversationalPrompt(
  userMessage: string,
  currentState: IterationState | null,
): string {
  const parts = ['The user wants a modification to the current code.'];

  if (currentState) {
    parts.push(`Current similarity score: ${currentState.score.toFixed(3)}`);
  }

  parts.push(
    '',
    `User request: ${userMessage}`,
    '',
    'Make the requested change while maintaining or improving the design match.',
    'Return complete modified files with file path comments.',
  );

  return parts.join('\n');
}

export function extractCodeFromResponse(responseText: string): Map<string, string> {
  const codeMap = new Map<string, string>();
  const blockRegex = /```[\w]*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(responseText)) !== null) {
    const blockContent = match[1].trim();
    const lines = blockContent.split('\n');
    let filePath: string | null = null;

    const firstLine = lines[0].trim();
    const pathMatch = firstLine.match(/^\/\/\s*(.+\.\w+)$/) ?? firstLine.match(/^\*\*(.+\.\w+)\*\*$/);
    if (pathMatch) {
      filePath = pathMatch[1].trim();
      lines.shift();
    }

    if (!filePath) {
      const textBefore = responseText.substring(
        Math.max(0, (match.index ?? 0) - 200),
        match.index ?? 0,
      );
      const pathInText = textBefore.match(/(?:`|\/|\*\*)([a-zA-Z][\w/.-]+\.\w+)(?:`|\*\*)?/);
      if (pathInText) {
        filePath = pathInText[1];
      }
    }

    if (filePath) {
      codeMap.set(filePath, lines.join('\n').trim());
    }
  }

  return codeMap;
}

export function extractVisionAnalysis(responseText: string): VisionAnalysis {
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { similarityScore: 0.5, differences: [], overallAssessment: 'Failed to parse' };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      similarityScore: typeof parsed.similarityScore === 'number' ? parsed.similarityScore : 0.5,
      differences: Array.isArray(parsed.differences) ? parsed.differences : [],
      overallAssessment: typeof parsed.overallAssessment === 'string' ? parsed.overallAssessment : '',
    };
  } catch {
    return { similarityScore: 0.5, differences: [], overallAssessment: 'Failed to parse JSON' };
  }
}
