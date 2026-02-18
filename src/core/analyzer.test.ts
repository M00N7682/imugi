import { describe, it, expect } from 'vitest';
import {
  categorizeIteration,
  suggestStrategy,
  analyzeDifferences,
  generateReportText,
  buildIterationRecord,
} from './analyzer.js';
import type { ComparisonResult, IterationRecord } from '../types.js';
import type { ImugiConfig } from '../config/schema.js';

const mockConfig: ImugiConfig = {
  auth: { apiKey: null, oauth: true },
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
  project: { framework: null, css: null, language: null },
  timeouts: { overall: 1800, pageLoad: 15, devServer: 30 },
};

const mockComparisonResult: ComparisonResult = {
  ssim: { mssim: 0.85, performanceMs: 100 },
  pixelDiff: {
    diffCount: 500,
    totalPixels: 10000,
    diffPercentage: 0.05,
    diffImageBuffer: Buffer.alloc(0),
  },
  heatmapBuffer: Buffer.alloc(0),
  diffRegions: [
    {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      diffIntensity: 0.3,
      pixelCount: 300,
    },
    {
      x: 200,
      y: 200,
      width: 300,
      height: 300,
      diffIntensity: 0.7,
      pixelCount: 1000,
    },
  ],
  compositeScore: 0.85,
  designDimensions: { width: 1440, height: 900 },
  screenshotBuffer: Buffer.alloc(0),
  cropPairs: [],
};

describe('categorizeIteration', () => {
  it('returns "first" when previousScore is null', () => {
    expect(categorizeIteration(0.5, null, 0.95, 0.01)).toBe('first');
  });

  it('returns "achieved" when currentScore >= threshold', () => {
    expect(categorizeIteration(0.95, 0.8, 0.95, 0.01)).toBe('achieved');
  });

  it('returns "achieved" when currentScore equals threshold', () => {
    expect(categorizeIteration(0.95, 0.9, 0.95, 0.01)).toBe('achieved');
  });

  it('returns "improved" when improvement > improvementThreshold', () => {
    expect(categorizeIteration(0.85, 0.83, 0.95, 0.01)).toBe('improved');
  });

  it('returns "regressed" when currentScore < previousScore', () => {
    expect(categorizeIteration(0.8, 0.85, 0.95, 0.01)).toBe('regressed');
  });

  it('returns "stalled" when abs diff <= improvementThreshold', () => {
    expect(categorizeIteration(0.85, 0.845, 0.95, 0.01)).toBe('stalled');
  });

  it('returns "stalled" when scores are equal', () => {
    expect(categorizeIteration(0.85, 0.85, 0.95, 0.01)).toBe('stalled');
  });

  it('prioritizes "achieved" over "improved"', () => {
    expect(categorizeIteration(0.96, 0.8, 0.95, 0.01)).toBe('achieved');
  });

  it('handles edge case: improvement exactly at threshold', () => {
    expect(categorizeIteration(0.851, 0.84, 0.95, 0.01)).toBe('improved');
  });

  it('handles edge case: improvement just below threshold', () => {
    expect(categorizeIteration(0.8499, 0.84, 0.95, 0.01)).toBe('stalled');
  });
});

describe('suggestStrategy', () => {
  it('returns shouldStop true with stopReason "success" when score >= threshold', () => {
    const result = suggestStrategy(0.96, [], mockConfig);
    expect(result.shouldStop).toBe(true);
    expect(result.stopReason).toBe('success');
  });

  it('returns shouldStop true with stopReason "max_iterations" when history length >= maxIterations', () => {
    const history: IterationRecord[] = Array.from({ length: 10 }, (_, i) => ({
      iteration: i + 1,
      score: 0.5 + i * 0.01,
      strategy: 'full_regen',
      filesModified: [],
      elapsedMs: 1000,
      category: 'improved',
      timestamp: Date.now(),
    }));
    const result = suggestStrategy(0.6, history, mockConfig);
    expect(result.shouldStop).toBe(true);
    expect(result.stopReason).toBe('max_iterations');
  });

  it('returns shouldStop true with stopReason "converged" when 3 consecutive stalled', () => {
    const history: IterationRecord[] = [
      {
        iteration: 1,
        score: 0.5,
        strategy: 'full_regen',
        filesModified: [],
        elapsedMs: 1000,
        category: 'stalled',
        timestamp: Date.now(),
      },
      {
        iteration: 2,
        score: 0.501,
        strategy: 'full_regen',
        filesModified: [],
        elapsedMs: 1000,
        category: 'stalled',
        timestamp: Date.now(),
      },
      {
        iteration: 3,
        score: 0.502,
        strategy: 'full_regen',
        filesModified: [],
        elapsedMs: 1000,
        category: 'stalled',
        timestamp: Date.now(),
      },
    ];
    const result = suggestStrategy(0.503, history, mockConfig);
    expect(result.shouldStop).toBe(true);
    expect(result.stopReason).toBe('converged');
  });

  it('returns shouldRollback true when score regresses', () => {
    const history: IterationRecord[] = [
      {
        iteration: 1,
        score: 0.8,
        strategy: 'full_regen',
        filesModified: [],
        elapsedMs: 1000,
        category: 'first',
        timestamp: Date.now(),
      },
    ];
    const result = suggestStrategy(0.75, history, mockConfig);
    expect(result.shouldRollback).toBe(true);
    expect(result.rollbackTo).toBe(1);
  });

  it('flips strategy on regression from full_regen to surgical_patch', () => {
    const history: IterationRecord[] = [
      {
        iteration: 1,
        score: 0.8,
        strategy: 'full_regen',
        filesModified: [],
        elapsedMs: 1000,
        category: 'first',
        timestamp: Date.now(),
      },
    ];
    const result = suggestStrategy(0.75, history, mockConfig);
    expect(result.strategy).toBe('surgical_patch');
  });

  it('flips strategy on regression from surgical_patch to full_regen', () => {
    const history: IterationRecord[] = [
      {
        iteration: 1,
        score: 0.8,
        strategy: 'surgical_patch',
        filesModified: [],
        elapsedMs: 1000,
        category: 'first',
        timestamp: Date.now(),
      },
    ];
    const result = suggestStrategy(0.75, history, mockConfig);
    expect(result.strategy).toBe('full_regen');
  });

  it('returns "full_regen" strategy when score below patchSwitchThreshold', () => {
    const result = suggestStrategy(0.65, [], mockConfig);
    expect(result.strategy).toBe('full_regen');
  });

  it('returns "surgical_patch" strategy when score above patchSwitchThreshold', () => {
    const result = suggestStrategy(0.75, [], mockConfig);
    expect(result.strategy).toBe('surgical_patch');
  });

  it('returns "surgical_patch" strategy when score equals patchSwitchThreshold', () => {
    const result = suggestStrategy(0.7, [], mockConfig);
    expect(result.strategy).toBe('surgical_patch');
  });

  it('does not stop when score is below threshold and history is short', () => {
    const result = suggestStrategy(0.5, [], mockConfig);
    expect(result.shouldStop).toBe(false);
  });

  it('finds best iteration for rollback', () => {
    const history: IterationRecord[] = [
      {
        iteration: 1,
        score: 0.7,
        strategy: 'full_regen',
        filesModified: [],
        elapsedMs: 1000,
        category: 'first',
        timestamp: Date.now(),
      },
      {
        iteration: 2,
        score: 0.85,
        strategy: 'full_regen',
        filesModified: [],
        elapsedMs: 1000,
        category: 'improved',
        timestamp: Date.now(),
      },
      {
        iteration: 3,
        score: 0.8,
        strategy: 'full_regen',
        filesModified: [],
        elapsedMs: 1000,
        category: 'regressed',
        timestamp: Date.now(),
      },
    ];
    const result = suggestStrategy(0.75, history, mockConfig);
    expect(result.rollbackTo).toBe(2);
  });
});

describe('analyzeDifferences', () => {
  it('returns DiffReport with correct structure', () => {
    const report = analyzeDifferences(mockComparisonResult);
    expect(report).toHaveProperty('overallScore');
    expect(report).toHaveProperty('regionCount');
    expect(report).toHaveProperty('regions');
    expect(report).toHaveProperty('summary');
    expect(report).toHaveProperty('suggestedStrategy');
  });

  it('sorts regions by priority (high > medium > low)', () => {
    const report = analyzeDifferences(mockComparisonResult);
    const priorities = report.regions.map((r) => r.priority);
    for (let i = 1; i < priorities.length; i++) {
      const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
      expect(priorityOrder[priorities[i - 1]]).toBeLessThanOrEqual(priorityOrder[priorities[i]]);
    }
  });

  it('returns correct regionCount', () => {
    const report = analyzeDifferences(mockComparisonResult);
    expect(report.regionCount).toBe(2);
  });

  it('uses compositeScore when visionAnalysis is not provided', () => {
    const report = analyzeDifferences(mockComparisonResult);
    expect(report.overallScore).toBe(0.85);
  });

  it('suggests "full_regen" when score < 0.7', () => {
    const lowScoreComparison: ComparisonResult = {
      ...mockComparisonResult,
      compositeScore: 0.65,
    };
    const report = analyzeDifferences(lowScoreComparison);
    expect(report.suggestedStrategy).toBe('full_regen');
  });

  it('suggests "surgical_patch" when score >= 0.7', () => {
    const report = analyzeDifferences(mockComparisonResult);
    expect(report.suggestedStrategy).toBe('surgical_patch');
  });

  it('handles zero regions', () => {
    const noRegionsComparison: ComparisonResult = {
      ...mockComparisonResult,
      diffRegions: [],
    };
    const report = analyzeDifferences(noRegionsComparison);
    expect(report.regionCount).toBe(0);
    expect(report.regions.length).toBe(0);
  });

  it('generates correct summary for zero regions', () => {
    const noRegionsComparison: ComparisonResult = {
      ...mockComparisonResult,
      diffRegions: [],
    };
    const report = analyzeDifferences(noRegionsComparison);
    expect(report.summary).toBe('No significant differences found.');
  });

  it('generates correct summary for multiple regions', () => {
    const report = analyzeDifferences(mockComparisonResult);
    expect(report.summary).toContain('Found 2 differences');
  });
});

describe('generateReportText', () => {
  it('includes overall score and region count in header', () => {
    const report = analyzeDifferences(mockComparisonResult);
    const text = generateReportText(report);
    expect(text).toContain('Overall Score:');
    expect(text).toContain('Differences:');
  });

  it('returns "No significant differences found." for zero regions', () => {
    const noRegionsComparison: ComparisonResult = {
      ...mockComparisonResult,
      diffRegions: [],
    };
    const report = analyzeDifferences(noRegionsComparison);
    const text = generateReportText(report);
    expect(text).toContain('No significant differences found.');
  });

  it('includes region descriptions with priority badges', () => {
    const report = analyzeDifferences(mockComparisonResult);
    const text = generateReportText(report);
    expect(text).toContain('[HIGH]');
  });

  it('includes CSS suggestions when available', () => {
    const report = analyzeDifferences(mockComparisonResult);
    const text = generateReportText(report);
    expect(text).toContain('Difference in region');
  });

  it('formats regions with numbering', () => {
    const report = analyzeDifferences(mockComparisonResult);
    const text = generateReportText(report);
    expect(text).toContain('1.');
    expect(text).toContain('2.');
  });

  it('handles single region correctly', () => {
    const singleRegionComparison: ComparisonResult = {
      ...mockComparisonResult,
      diffRegions: [mockComparisonResult.diffRegions[0]],
    };
    const report = analyzeDifferences(singleRegionComparison);
    const text = generateReportText(report);
    expect(text).toContain('Differences: 1');
  });

  it('handles multiple regions correctly', () => {
    const report = analyzeDifferences(mockComparisonResult);
    const text = generateReportText(report);
    expect(text).toContain('Differences: 2');
  });
});

describe('buildIterationRecord', () => {
  it('creates record with all required fields', () => {
    const record = buildIterationRecord(1, 0.85, 'full_regen', ['file1.ts'], 5000, 'first');
    expect(record).toHaveProperty('iteration', 1);
    expect(record).toHaveProperty('score', 0.85);
    expect(record).toHaveProperty('strategy', 'full_regen');
    expect(record).toHaveProperty('filesModified');
    expect(record).toHaveProperty('elapsedMs', 5000);
    expect(record).toHaveProperty('category', 'first');
    expect(record).toHaveProperty('timestamp');
  });

  it('sets iteration number correctly', () => {
    const record = buildIterationRecord(5, 0.9, 'surgical_patch', [], 1000, 'improved');
    expect(record.iteration).toBe(5);
  });

  it('sets score correctly', () => {
    const record = buildIterationRecord(1, 0.75, 'full_regen', [], 1000, 'first');
    expect(record.score).toBe(0.75);
  });

  it('sets strategy correctly', () => {
    const record = buildIterationRecord(1, 0.8, 'surgical_patch', [], 1000, 'first');
    expect(record.strategy).toBe('surgical_patch');
  });

  it('sets filesModified correctly', () => {
    const files = ['src/App.tsx', 'src/styles.css'];
    const record = buildIterationRecord(1, 0.8, 'full_regen', files, 1000, 'first');
    expect(record.filesModified).toEqual(files);
  });

  it('sets elapsedMs correctly', () => {
    const record = buildIterationRecord(1, 0.8, 'full_regen', [], 12345, 'first');
    expect(record.elapsedMs).toBe(12345);
  });

  it('sets category correctly', () => {
    const record = buildIterationRecord(1, 0.8, 'full_regen', [], 1000, 'regressed');
    expect(record.category).toBe('regressed');
  });

  it('sets timestamp to current time', () => {
    const before = Date.now();
    const record = buildIterationRecord(1, 0.8, 'full_regen', [], 1000, 'first');
    const after = Date.now();
    expect(record.timestamp).toBeGreaterThanOrEqual(before);
    expect(record.timestamp).toBeLessThanOrEqual(after);
  });

  it('handles empty filesModified array', () => {
    const record = buildIterationRecord(1, 0.8, 'full_regen', [], 1000, 'first');
    expect(record.filesModified).toEqual([]);
  });

  it('handles multiple files modified', () => {
    const files = ['file1.ts', 'file2.tsx', 'file3.css', 'file4.json'];
    const record = buildIterationRecord(1, 0.8, 'full_regen', files, 1000, 'first');
    expect(record.filesModified).toHaveLength(4);
    expect(record.filesModified).toEqual(files);
  });

  it('handles zero elapsed time', () => {
    const record = buildIterationRecord(1, 0.8, 'full_regen', [], 0, 'first');
    expect(record.elapsedMs).toBe(0);
  });

  it('handles large elapsed time', () => {
    const record = buildIterationRecord(1, 0.8, 'full_regen', [], 999999, 'first');
    expect(record.elapsedMs).toBe(999999);
  });
});
