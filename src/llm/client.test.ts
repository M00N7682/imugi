import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createClaudeClient, sendMessage, withRetry } from './client.js';

vi.mock('@anthropic-ai/sdk', () => {
  function MockAnthropic(this: Record<string, unknown>, opts: Record<string, unknown>) {
    this.apiKey = opts.apiKey;
    this.messages = {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Hello world' }],
      }),
      stream: vi.fn(),
    };
  }
  return { default: MockAnthropic };
});

vi.mock('../agent/auth.js', () => ({
  createAuthenticatedFetch: vi.fn().mockReturnValue(() => Promise.resolve(new Response())),
  refreshAccessToken: vi.fn().mockResolvedValue({ access_token: 'new', refresh_token: 'new', expires_in: 3600, token_type: 'bearer' }),
  saveToken: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sharp', () => ({
  default: vi.fn().mockReturnValue({
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 600, format: 'png' }),
    resize: vi.fn().mockReturnValue({
      png: vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1000)),
      }),
      jpeg: vi.fn().mockReturnValue({
        toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(500)),
      }),
    }),
    png: vi.fn().mockReturnValue({
      toBuffer: vi.fn().mockResolvedValue(Buffer.alloc(1000)),
    }),
  }),
}));

describe('createClaudeClient', () => {
  it('creates client with API key auth', () => {
    const client = createClaudeClient({ type: 'api_key', apiKey: 'sk-test-123' });
    expect(client).toBeDefined();
    expect(client.apiKey).toBe('sk-test-123');
  });

  it('creates client with OAuth auth', () => {
    const client = createClaudeClient({
      type: 'oauth',
      token: { access_token: 'at', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' },
    });
    expect(client).toBeDefined();
  });
});

describe('sendMessage', () => {
  it('sends message and returns concatenated text', async () => {
    const client = createClaudeClient({ type: 'api_key', apiKey: 'test' });
    const result = await sendMessage({
      client,
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result).toBe('Hello world');
  });

  it('passes system prompt when provided', async () => {
    const client = createClaudeClient({ type: 'api_key', apiKey: 'test' });
    await sendMessage({
      client,
      messages: [{ role: 'user', content: 'Hello' }],
      systemPrompt: 'Be helpful',
    });
    expect(client.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({ system: 'Be helpful' }),
    );
  });

  it('filters for text blocks only', async () => {
    const client = createClaudeClient({ type: 'api_key', apiKey: 'test' });
    (client.messages.create as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: [
        { type: 'text', text: 'Part 1' },
        { type: 'tool_use', id: '123', name: 'test', input: {} },
        { type: 'text', text: ' Part 2' },
      ],
    });
    const result = await sendMessage({
      client,
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result).toBe('Part 1 Part 2');
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws non-retryable errors immediately', async () => {
    const error = Object.assign(new Error('Bad request'), { status: 400 });
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn)).rejects.toThrow('Bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 500 errors and succeeds', async () => {
    // Mock setTimeout to resolve immediately
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb: () => void) => { cb(); return 0 as unknown as NodeJS.Timeout; });
    const error = Object.assign(new Error('Server error'), { status: 500 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 rate limit', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb: () => void) => { cb(); return 0 as unknown as NodeJS.Timeout; });
    const error = Object.assign(new Error('Rate limited'), { status: 429, headers: { 'retry-after': '1' } });
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('ok');
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries exceeded', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb: () => void) => { cb(); return 0 as unknown as NodeJS.Timeout; });
    const error = Object.assign(new Error('Server error'), { status: 500 });
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, { maxRetries: 2 })).rejects.toThrow('Server error');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('attempts OAuth token refresh on 401', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb: () => void) => { cb(); return 0 as unknown as NodeJS.Timeout; });
    const { refreshAccessToken } = await import('../agent/auth.js');
    const error = Object.assign(new Error('Unauthorized'), { status: 401 });
    const fn = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce('ok');
    const auth = {
      type: 'oauth' as const,
      token: { access_token: 'old', refresh_token: 'rt', expires_in: 3600, token_type: 'bearer' as const },
    };
    const result = await withRetry(fn, { maxRetries: 3, auth });
    expect(result).toBe('ok');
    expect(refreshAccessToken).toHaveBeenCalledWith('rt');
  });

  it('uses default maxRetries of 3', async () => {
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((cb: () => void) => { cb(); return 0 as unknown as NodeJS.Timeout; });
    const error = Object.assign(new Error('Server error'), { status: 500 });
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
