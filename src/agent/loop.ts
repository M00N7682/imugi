import { readFile, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import type Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import type {
  ProjectContext,
  IterationState,
  IterationRecord,
  BoulderLoopResult,
  PatchStrategy,
  ComparisonResult,
} from '../types.js';
import type { ImugiConfig } from '../config/schema.js';
import type { Renderer } from '../core/renderer.js';
import { resizeToMatch, inferRoute } from '../core/renderer.js';
import { compareImages, computeCompositeScore } from '../core/comparator.js';
import { analyzeDifferences, categorizeIteration, suggestStrategy, buildIterationRecord, generateReportText } from '../core/analyzer.js';
import { sendVisionComparison } from '../llm/client.js';
import { generateInitialCode, patchCode, writeCodeToFiles, createBackup, rollbackToBackup, readCurrentCode, fixBuildError } from '../core/patcher.js';

export interface BoulderLoopOptions {
  client: Anthropic;
  designImagePath: string;
  userRequest: string;
  outputPath: string;
  projectDir: string;
  config: ImugiConfig;
  projectContext: ProjectContext;
  renderer: Renderer;
  onProgress: (state: IterationState) => void;
  onStream?: (text: string) => void;
  existingCode?: Map<string, string>;
}

function createIterationState(
  iteration: number,
  maxIterations: number,
  status: IterationState['status'],
  score: number,
  previousScore: number | null,
  strategy: PatchStrategy,
  diffCount: number,
  elapsedMs: number,
  history: IterationRecord[],
): IterationState {
  return {
    iteration,
    maxIterations,
    status,
    score,
    previousScore,
    improvement: previousScore !== null ? score - previousScore : 0,
    strategy,
    stopReason: null,
    diffCount,
    elapsedMs,
    history,
  };
}

async function saveIterationArtifacts(
  reportDir: string,
  iteration: number,
  screenshot: Buffer,
  heatmap: Buffer,
): Promise<void> {
  await mkdir(reportDir, { recursive: true });
  await writeFile(join(reportDir, `iteration-${iteration}.png`), screenshot);
  await writeFile(join(reportDir, `heatmap-${iteration}.png`), heatmap);
}

export async function runBoulderLoop(options: BoulderLoopOptions): Promise<BoulderLoopResult> {
  const {
    client, designImagePath, userRequest, outputPath, projectDir,
    config, projectContext, renderer, onProgress, onStream,
  } = options;

  const designImage = await readFile(designImagePath);
  const designMeta = await sharp(designImage).metadata();
  const designWidth = designMeta.width ?? config.rendering.viewport.width;
  const designHeight = designMeta.height ?? config.rendering.viewport.height;

  const route = inferRoute(outputPath, projectContext);
  const reportDir = join(projectDir, '.imugi', 'reports', `run-${Date.now()}`);
  const startTime = Date.now();

  let currentCode = options.existingCode ?? null;
  let filePaths: string[] = [];

  if (!currentCode) {
    onProgress(createIterationState(0, config.comparison.maxIterations, 'patching', 0, null, 'full_regen', 0, 0, []));
    currentCode = await generateInitialCode(client, designImage, userRequest, projectContext, onStream);
    await writeCodeToFiles(currentCode, projectDir);
    filePaths = Array.from(currentCode.keys());
  } else {
    filePaths = Array.from(currentCode.keys());
  }

  const history: IterationRecord[] = [];
  let previousScore: number | null = null;
  let strategy: PatchStrategy = 'full_regen';

  for (let iteration = 1; iteration <= config.comparison.maxIterations; iteration++) {
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs > config.timeouts.overall * 1000) {
      return {
        finalScore: previousScore ?? 0,
        totalIterations: iteration - 1,
        stopReason: 'timeout',
        finalCode: currentCode,
        reportDir,
        history,
        elapsedMs,
      };
    }

    if (iteration > 1) {
      await createBackup(filePaths, projectDir, iteration - 1);
    }

    onProgress(createIterationState(iteration, config.comparison.maxIterations, 'capturing', previousScore ?? 0, previousScore, strategy, 0, elapsedMs, history));

    let screenshot: Buffer;
    if (iteration === 1 || !renderer.browserHandle?.page) {
      screenshot = await renderer.capture(route);
    } else {
      screenshot = await renderer.captureHMR();
    }

    const resizedScreenshot = await resizeToMatch(screenshot, designWidth, designHeight);

    onProgress(createIterationState(iteration, config.comparison.maxIterations, 'comparing', previousScore ?? 0, previousScore, strategy, 0, Date.now() - startTime, history));

    const comparison: ComparisonResult = await compareImages(designImage, resizedScreenshot);

    let visionScore: number | undefined;
    if (comparison.ssim.mssim < 0.98) {
      try {
        const visionResult = await sendVisionComparison({
          client,
          designImage,
          screenshotImage: resizedScreenshot,
          heatmapImage: comparison.heatmapBuffer,
          cropImages: comparison.cropPairs.slice(0, 3).map((p) => p.design),
        });
        visionScore = visionResult.similarityScore;
      } catch {
        // vision comparison optional, continue without it
      }
    }

    const compositeScore = computeCompositeScore({
      ssim: comparison.ssim.mssim,
      vision: visionScore,
    });

    onProgress(createIterationState(iteration, config.comparison.maxIterations, 'analyzing', compositeScore, previousScore, strategy, comparison.diffRegions.length, Date.now() - startTime, history));

    const diffReport = analyzeDifferences(comparison, visionScore !== undefined ? {
      similarityScore: visionScore,
      differences: [],
      overallAssessment: '',
    } : undefined);

    const category = categorizeIteration(compositeScore, previousScore, config.comparison.threshold, config.comparison.improvementThreshold);
    const recommendation = suggestStrategy(compositeScore, history, config);

    const record = buildIterationRecord(iteration, compositeScore, strategy, filePaths, Date.now() - startTime, category);
    history.push(record);

    await saveIterationArtifacts(reportDir, iteration, screenshot, comparison.heatmapBuffer);

    if (recommendation.shouldStop) {
      return {
        finalScore: compositeScore,
        totalIterations: iteration,
        stopReason: recommendation.stopReason!,
        finalCode: currentCode,
        reportDir,
        history,
        elapsedMs: Date.now() - startTime,
      };
    }

    if (recommendation.shouldRollback && recommendation.rollbackTo !== undefined) {
      currentCode = await rollbackToBackup(String(recommendation.rollbackTo), projectDir);
      filePaths = Array.from(currentCode.keys());
      strategy = recommendation.strategy;
    } else {
      strategy = recommendation.strategy;
    }

    onProgress(createIterationState(iteration, config.comparison.maxIterations, 'patching', compositeScore, previousScore, strategy, comparison.diffRegions.length, Date.now() - startTime, history));

    const patchResult = await patchCode({
      client,
      strategy,
      designImage,
      currentCode,
      comparisonResult: comparison,
      diffReport,
      projectContext,
      heatmapImage: comparison.heatmapBuffer,
      onStream,
    });

    await writeCodeToFiles(patchResult.newCode, projectDir);
    currentCode = patchResult.newCode;
    filePaths = Array.from(currentCode.keys());
    previousScore = compositeScore;
  }

  return {
    finalScore: previousScore ?? 0,
    totalIterations: config.comparison.maxIterations,
    stopReason: 'max_iterations',
    finalCode: currentCode,
    reportDir,
    history,
    elapsedMs: Date.now() - startTime,
  };
}
