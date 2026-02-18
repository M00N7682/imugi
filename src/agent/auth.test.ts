import { describe, it, expect } from 'vitest';
import { generateCodeVerifier, generateCodeChallenge } from './auth.js';

describe('generateCodeVerifier', () => {
  it('returns URL-safe base64 string without +, /, =', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).not.toMatch(/[+/=]/);
  });

  it('returns string of reasonable length (32+ chars)', () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(32);
  });

  it('each call returns different value', () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });
});

describe('generateCodeChallenge', () => {
  it('returns URL-safe base64 string', () => {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    expect(challenge).not.toMatch(/[+/=]/);
  });

  it('same input produces same output (deterministic)', () => {
    const verifier = 'test-verifier-string';
    const c1 = generateCodeChallenge(verifier);
    const c2 = generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  it('different inputs produce different outputs', () => {
    const c1 = generateCodeChallenge('verifier1');
    const c2 = generateCodeChallenge('verifier2');
    expect(c1).not.toBe(c2);
  });
});
