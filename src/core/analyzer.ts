import type {
  ComparisonResult,
  VisionAnalysis,
  DiffReport,
  DiffRegion,
  AnalyzedRegion,
  PatchStrategy,
  IterationRecord,
  IterationCategory,
  StopReason,
  StrategyRecommendation,
} from '../types.js';
import type { ImugiConfig } from '../config/schema.js';

function classifyRegion(
  region: DiffRegion,
  visionDiff?: VisionAnalysis['differences'][number],
): AnalyzedRegion['classification'] {
  if (visionDiff) {
    const typeMap: Record<string, AnalyzedRegion['classification']> = {
      color: 'color',
      spacing: 'spacing',
      size: 'size',
      position: 'position',
      missing: 'missing',
      extra: 'extra',
      font: 'font',
    };
    return typeMap[visionDiff.type] ?? 'unknown';
  }

  if (region.width > 200 || region.height > 200) return 'position';
  if (region.diffIntensity > 0.5) return 'color';
  return 'unknown';
}

function assignPriority(classification: AnalyzedRegion['classification']): AnalyzedRegion['priority'] {
  switch (classification) {
    case 'missing':
    case 'extra':
    case 'position':
      return 'high';
    case 'size':
    case 'spacing':
      return 'medium';
    case 'color':
    case 'font':
    case 'unknown':
      return 'low';
  }
}

export function analyzeDifferences(
  comparison: ComparisonResult,
  visionAnalysis?: VisionAnalysis,
): DiffReport {
  const regions: AnalyzedRegion[] = comparison.diffRegions.map((region, i) => {
    const visionDiff = visionAnalysis?.differences[i];
    const classification = classifyRegion(region, visionDiff);
    const priority = assignPriority(classification);

    return {
      region,
      classification,
      priority,
      description: visionDiff?.description ?? `Difference in region at (${region.x}, ${region.y})`,
      cssSuggestion: visionDiff?.cssSuggestion,
    };
  });

  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  regions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const score = visionAnalysis?.similarityScore ?? comparison.compositeScore;
  const suggestedStrategy: PatchStrategy = score < 0.7 ? 'full_regen' : 'surgical_patch';

  const summary = regions.length === 0
    ? 'No significant differences found.'
    : `Found ${regions.length} difference${regions.length > 1 ? 's' : ''}: ${regions.filter((r) => r.priority === 'high').length} high, ${regions.filter((r) => r.priority === 'medium').length} medium, ${regions.filter((r) => r.priority === 'low').length} low priority.`;

  return {
    overallScore: score,
    regionCount: regions.length,
    regions,
    summary,
    suggestedStrategy,
  };
}

export function generateReportText(report: DiffReport): string {
  const lines: string[] = [
    `Overall Score: ${report.overallScore.toFixed(3)} | Differences: ${report.regionCount} regions`,
    '',
  ];

  if (report.regions.length === 0) {
    lines.push('No significant differences found.');
    return lines.join('\n');
  }

  report.regions.forEach((r, i) => {
    const badge = r.priority === 'high' ? '[HIGH]' : r.priority === 'medium' ? '[MED]' : '[LOW]';
    lines.push(`${i + 1}. ${badge} ${r.description}`);
    if (r.cssSuggestion) {
      lines.push(`   Fix: ${r.cssSuggestion}`);
    }
  });

  return lines.join('\n');
}

export function categorizeIteration(
  currentScore: number,
  previousScore: number | null,
  threshold: number,
  improvementThreshold: number,
): IterationCategory {
  if (previousScore === null) return 'first';
  if (currentScore >= threshold) return 'achieved';
  if (currentScore - previousScore > improvementThreshold) return 'improved';
  if (currentScore < previousScore) return 'regressed';
  if (Math.abs(currentScore - previousScore) <= improvementThreshold) return 'stalled';
  return 'stalled';
}

export function suggestStrategy(
  currentScore: number,
  history: IterationRecord[],
  config: ImugiConfig,
): StrategyRecommendation {
  if (currentScore >= config.comparison.threshold) {
    return {
      strategy: 'surgical_patch',
      reason: 'Target threshold reached',
      shouldStop: true,
      stopReason: 'success',
      shouldRollback: false,
    };
  }

  if (history.length >= config.comparison.maxIterations) {
    return {
      strategy: 'surgical_patch',
      reason: 'Maximum iterations reached',
      shouldStop: true,
      stopReason: 'max_iterations',
      shouldRollback: false,
    };
  }

  const recentHistory = history.slice(-3);
  if (recentHistory.length >= 3) {
    const allStalled = recentHistory.every((r) => r.category === 'stalled');
    if (allStalled) {
      return {
        strategy: 'surgical_patch',
        reason: 'Score converged — 3 consecutive iterations without improvement',
        shouldStop: true,
        stopReason: 'converged',
        shouldRollback: false,
      };
    }
  }

  if (history.length > 0) {
    const lastRecord = history[history.length - 1];
    if (lastRecord.score > currentScore) {
      const bestIteration = history.reduce((best, r) => (r.score > best.score ? r : best), history[0]);
      const alternateStrategy: PatchStrategy = lastRecord.strategy === 'full_regen' ? 'surgical_patch' : 'full_regen';
      return {
        strategy: alternateStrategy,
        reason: `Score regressed from ${lastRecord.score.toFixed(3)} to ${currentScore.toFixed(3)} — rolling back to iteration ${bestIteration.iteration}`,
        shouldStop: false,
        shouldRollback: true,
        rollbackTo: bestIteration.iteration,
      };
    }
  }

  const strategy: PatchStrategy = currentScore < config.comparison.patchSwitchThreshold
    ? 'full_regen'
    : 'surgical_patch';

  return {
    strategy,
    reason: strategy === 'full_regen'
      ? `Score ${currentScore.toFixed(3)} below patch threshold ${config.comparison.patchSwitchThreshold}`
      : `Score ${currentScore.toFixed(3)} above patch threshold — using surgical fixes`,
    shouldStop: false,
    shouldRollback: false,
  };
}

export function buildIterationRecord(
  iteration: number,
  score: number,
  strategy: PatchStrategy,
  filesModified: string[],
  elapsedMs: number,
  category: IterationCategory,
): IterationRecord {
  return {
    iteration,
    score,
    strategy,
    filesModified,
    elapsedMs,
    category,
    timestamp: Date.now(),
  };
}
