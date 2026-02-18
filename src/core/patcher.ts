import { readFile, writeFile, mkdir, cp, readdir } from 'fs/promises';
import { dirname, join } from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import type {
  ComparisonResult,
  DiffReport,
  PatchStrategy,
  PatchResult,
  ProjectContext,
} from '../types.js';
import { sendMessage, streamMessage, prepareImageForAPI } from '../llm/client.js';
import {
  buildSystemPrompt,
  buildCodeGenPrompt,
  buildFullRegenPrompt,
  buildSurgicalPatchPrompt,
  buildBuildErrorFixPrompt,
  extractCodeFromResponse,
} from '../llm/prompts.js';

export interface PatchOptions {
  client: Anthropic;
  strategy: PatchStrategy;
  designImage: Buffer;
  currentCode: Map<string, string>;
  comparisonResult: ComparisonResult;
  diffReport: DiffReport;
  projectContext: ProjectContext;
  heatmapImage?: Buffer;
  onStream?: (text: string) => void;
}

export async function generateInitialCode(
  client: Anthropic,
  designImage: Buffer,
  userRequest: string,
  context: ProjectContext,
  onStream?: (text: string) => void,
): Promise<Map<string, string>> {
  const systemPrompt = buildSystemPrompt(context);
  const textContent = buildCodeGenPrompt(userRequest, context);
  const prepared = await prepareImageForAPI(designImage);

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: prepared.mediaType, data: prepared.base64 } },
        { type: 'text', text: textContent },
      ],
    },
  ];

  let fullText = '';

  if (onStream) {
    const generator = streamMessage({ client, messages, systemPrompt });
    let result = await generator.next();
    while (!result.done) {
      onStream(result.value);
      fullText += result.value;
      result = await generator.next();
    }
  } else {
    fullText = await sendMessage({ client, messages, systemPrompt });
  }

  return extractCodeFromResponse(fullText);
}

async function fullRegeneration(options: PatchOptions): Promise<PatchResult> {
  const { client, currentCode, diffReport, projectContext, designImage, comparisonResult, heatmapImage, onStream } = options;

  const systemPrompt = buildSystemPrompt(projectContext);
  const textContent = buildFullRegenPrompt(currentCode, diffReport, projectContext);
  const designPrepared = await prepareImageForAPI(designImage);
  const screenshotPrepared = await prepareImageForAPI(comparisonResult.screenshotBuffer);

  const contentBlocks: Anthropic.ContentBlockParam[] = [
    { type: 'image', source: { type: 'base64', media_type: designPrepared.mediaType, data: designPrepared.base64 } },
    { type: 'image', source: { type: 'base64', media_type: screenshotPrepared.mediaType, data: screenshotPrepared.base64 } },
  ];

  if (heatmapImage) {
    const heatmapPrepared = await prepareImageForAPI(heatmapImage);
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: heatmapPrepared.mediaType, data: heatmapPrepared.base64 } });
  }

  contentBlocks.push({ type: 'text', text: textContent });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: contentBlocks }];

  let fullText = '';
  if (onStream) {
    const generator = streamMessage({ client, messages, systemPrompt });
    let result = await generator.next();
    while (!result.done) {
      onStream(result.value);
      fullText += result.value;
      result = await generator.next();
    }
  } else {
    fullText = await sendMessage({ client, messages, systemPrompt });
  }

  const newCode = extractCodeFromResponse(fullText);
  return {
    newCode,
    strategy: 'full_regen',
    filesModified: Array.from(newCode.keys()),
    tokensUsed: fullText.length,
  };
}

async function surgicalPatch(options: PatchOptions): Promise<PatchResult> {
  const { client, currentCode, diffReport, projectContext, onStream } = options;

  const systemPrompt = buildSystemPrompt(projectContext);
  const highMedRegions = diffReport.regions.filter((r) => r.priority !== 'low');
  const fixes = highMedRegions.map((r) => `${r.description}${r.cssSuggestion ? ` (suggestion: ${r.cssSuggestion})` : ''}`);
  const codeEntries = Array.from(currentCode.values()).join('\n\n');
  const textContent = buildSurgicalPatchPrompt(codeEntries, highMedRegions.map((r) => r.region), fixes);

  const contentBlocks: Anthropic.ContentBlockParam[] = [];

  for (const cropPair of options.comparisonResult.cropPairs.slice(0, 3)) {
    const designPrepared = await prepareImageForAPI(cropPair.design);
    const screenshotPrepared = await prepareImageForAPI(cropPair.screenshot);
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: designPrepared.mediaType, data: designPrepared.base64 } });
    contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: screenshotPrepared.mediaType, data: screenshotPrepared.base64 } });
  }

  contentBlocks.push({ type: 'text', text: textContent });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: contentBlocks }];

  let fullText = '';
  if (onStream) {
    const generator = streamMessage({ client, messages, systemPrompt });
    let result = await generator.next();
    while (!result.done) {
      onStream(result.value);
      fullText += result.value;
      result = await generator.next();
    }
  } else {
    fullText = await sendMessage({ client, messages, systemPrompt });
  }

  const patchedCode = extractCodeFromResponse(fullText);
  const mergedCode = new Map(currentCode);
  for (const [path, content] of patchedCode) {
    mergedCode.set(path, content);
  }

  return {
    newCode: mergedCode,
    strategy: 'surgical_patch',
    filesModified: Array.from(patchedCode.keys()),
    tokensUsed: fullText.length,
  };
}

export async function patchCode(options: PatchOptions): Promise<PatchResult> {
  if (options.strategy === 'full_regen') {
    return fullRegeneration(options);
  }
  return surgicalPatch(options);
}

export async function writeCodeToFiles(
  code: Map<string, string>,
  projectDir: string,
): Promise<void> {
  for (const [filePath, content] of code) {
    const fullPath = join(projectDir, filePath);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

export async function createBackup(
  filePaths: string[],
  projectDir: string,
  iterationNumber: number,
): Promise<string> {
  const backupDir = join(projectDir, '.imugi', 'backups', String(iterationNumber));
  await mkdir(backupDir, { recursive: true });

  for (const filePath of filePaths) {
    const srcPath = join(projectDir, filePath);
    const destPath = join(backupDir, filePath);
    try {
      await mkdir(dirname(destPath), { recursive: true });
      await cp(srcPath, destPath);
    } catch {
      // file may not exist yet
    }
  }

  return String(iterationNumber);
}

export async function rollbackToBackup(
  backupId: string,
  projectDir: string,
): Promise<Map<string, string>> {
  const backupDir = join(projectDir, '.imugi', 'backups', backupId);
  const code = new Map<string, string>();

  async function walkDir(dir: string, base: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = join(base, entry.name);
      if (entry.isDirectory()) {
        await walkDir(fullPath, relativePath);
      } else {
        const content = await readFile(fullPath, 'utf-8');
        code.set(relativePath, content);
        const destPath = join(projectDir, relativePath);
        await mkdir(dirname(destPath), { recursive: true });
        await writeFile(destPath, content, 'utf-8');
      }
    }
  }

  await walkDir(backupDir, '');
  return code;
}

export async function readCurrentCode(filePaths: string[], projectDir: string): Promise<Map<string, string>> {
  const code = new Map<string, string>();
  for (const filePath of filePaths) {
    try {
      const content = await readFile(join(projectDir, filePath), 'utf-8');
      code.set(filePath, content);
    } catch {
      // file may not exist
    }
  }
  return code;
}

export async function fixBuildError(
  client: Anthropic,
  errorMessage: string,
  code: Map<string, string>,
  context: ProjectContext,
): Promise<Map<string, string>> {
  const systemPrompt = buildSystemPrompt(context);
  const codeStr = Array.from(code.entries())
    .map(([p, c]) => `// ${p}\n${c}`)
    .join('\n\n');
  const textContent = buildBuildErrorFixPrompt(errorMessage, codeStr, context);

  const fullText = await sendMessage({
    client,
    messages: [{ role: 'user', content: textContent }],
    systemPrompt,
  });

  const fixedCode = extractCodeFromResponse(fullText);
  const merged = new Map(code);
  for (const [path, content] of fixedCode) {
    merged.set(path, content);
  }
  return merged;
}
