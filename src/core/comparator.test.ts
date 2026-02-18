import { describe, it, expect } from 'vitest';
import { computeCompositeScore } from './comparator.js';

describe('computeCompositeScore', () => {
  describe('SSIM only', () => {
    it('returns ssim value directly when only ssim is provided', () => {
      expect(computeCompositeScore({ ssim: 0.85 })).toBe(0.85);
    });

    it('returns 0 for ssim 0', () => {
      expect(computeCompositeScore({ ssim: 0 })).toBe(0);
    });

    it('returns 1 for ssim 1', () => {
      expect(computeCompositeScore({ ssim: 1 })).toBe(1);
    });

    it('clamps negative ssim to 0', () => {
      expect(computeCompositeScore({ ssim: -0.5 })).toBe(0);
    });

    it('clamps ssim > 1 to 1', () => {
      expect(computeCompositeScore({ ssim: 1.5 })).toBe(1);
    });
  });

  describe('SSIM + vision', () => {
    it('computes ssim * 0.4 + vision * 0.6', () => {
      const result = computeCompositeScore({ ssim: 0.8, vision: 0.9 });
      const expected = 0.8 * 0.4 + 0.9 * 0.6;
      expect(result).toBeCloseTo(expected, 5);
    });

    it('clamps result to [0, 1]', () => {
      expect(computeCompositeScore({ ssim: 2, vision: 2 })).toBe(1);
    });

    it('clamps negative result to 0', () => {
      expect(computeCompositeScore({ ssim: -1, vision: -1 })).toBe(0);
    });

    it('handles edge case: ssim 0, vision 1', () => {
      const result = computeCompositeScore({ ssim: 0, vision: 1 });
      expect(result).toBeCloseTo(0.6, 5);
    });

    it('handles edge case: ssim 1, vision 0', () => {
      const result = computeCompositeScore({ ssim: 1, vision: 0 });
      expect(result).toBeCloseTo(0.4, 5);
    });
  });

  describe('SSIM + layout', () => {
    it('computes ssim * 0.5 + layout * 0.5', () => {
      const result = computeCompositeScore({ ssim: 0.7, layout: 0.9 });
      const expected = 0.7 * 0.5 + 0.9 * 0.5;
      expect(result).toBeCloseTo(expected, 5);
    });

    it('clamps result to [0, 1]', () => {
      expect(computeCompositeScore({ ssim: 2, layout: 2 })).toBe(1);
    });

    it('clamps negative result to 0', () => {
      expect(computeCompositeScore({ ssim: -1, layout: -1 })).toBe(0);
    });

    it('handles equal weights correctly', () => {
      const result = computeCompositeScore({ ssim: 0.6, layout: 0.8 });
      expect(result).toBeCloseTo(0.7, 5);
    });
  });

  describe('SSIM + layout + vision', () => {
    it('computes ssim * 0.3 + layout * 0.3 + vision * 0.4', () => {
      const result = computeCompositeScore({ ssim: 0.8, layout: 0.7, vision: 0.9 });
      const expected = 0.8 * 0.3 + 0.7 * 0.3 + 0.9 * 0.4;
      expect(result).toBeCloseTo(expected, 5);
    });

    it('clamps result to [0, 1]', () => {
      expect(computeCompositeScore({ ssim: 2, layout: 2, vision: 2 })).toBe(1);
    });

    it('clamps negative result to 0', () => {
      expect(computeCompositeScore({ ssim: -1, layout: -1, vision: -1 })).toBe(0);
    });

    it('handles all zeros', () => {
      expect(computeCompositeScore({ ssim: 0, layout: 0, vision: 0 })).toBe(0);
    });

    it('handles all ones', () => {
      expect(computeCompositeScore({ ssim: 1, layout: 1, vision: 1 })).toBe(1);
    });

    it('handles mixed values', () => {
      const result = computeCompositeScore({ ssim: 0.5, layout: 0.75, vision: 0.95 });
      const expected = 0.5 * 0.3 + 0.75 * 0.3 + 0.95 * 0.4;
      expect(result).toBeCloseTo(expected, 5);
    });

    it('vision has highest weight', () => {
      const result = computeCompositeScore({ ssim: 0, layout: 0, vision: 1 });
      expect(result).toBeCloseTo(0.4, 5);
    });

    it('ssim and layout have equal weight', () => {
      const result = computeCompositeScore({ ssim: 1, layout: 1, vision: 0 });
      expect(result).toBeCloseTo(0.6, 5);
    });
  });

  describe('boundary conditions', () => {
    it('handles very small positive values', () => {
      const result = computeCompositeScore({ ssim: 0.001 });
      expect(result).toBeCloseTo(0.001, 5);
    });

    it('handles values very close to 1', () => {
      const result = computeCompositeScore({ ssim: 0.9999 });
      expect(result).toBeCloseTo(0.9999, 5);
    });

    it('handles mixed boundary values with all three scores', () => {
      const result = computeCompositeScore({ ssim: 0, layout: 0.5, vision: 1 });
      const expected = 0 * 0.3 + 0.5 * 0.3 + 1 * 0.4;
      expect(result).toBeCloseTo(expected, 5);
    });
  });
});
