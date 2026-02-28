import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseFigmaUrl, resolveToken, exportFigmaImage } from './figma.js';

// ---------------------------------------------------------------------------
// parseFigmaUrl
// ---------------------------------------------------------------------------

describe('parseFigmaUrl', () => {
  it('parses a /design/ URL with node-id', () => {
    const result = parseFigmaUrl(
      'https://www.figma.com/design/AbC123xYz/My-File?node-id=42-1234',
    );
    expect(result).toEqual({ fileKey: 'AbC123xYz', nodeId: '42:1234' });
  });

  it('parses a /file/ URL with node-id', () => {
    const result = parseFigmaUrl(
      'https://www.figma.com/file/XyZ789abc/Another-File?node-id=10-500',
    );
    expect(result).toEqual({ fileKey: 'XyZ789abc', nodeId: '10:500' });
  });

  it('parses a /proto/ URL with node-id', () => {
    const result = parseFigmaUrl(
      'https://www.figma.com/proto/Def456ghi/Proto-File?node-id=7-99',
    );
    expect(result).toEqual({ fileKey: 'Def456ghi', nodeId: '7:99' });
  });

  it('parses a /board/ URL with node-id', () => {
    const result = parseFigmaUrl(
      'https://www.figma.com/board/Jkl012mno/Board-File?node-id=1-2',
    );
    expect(result).toEqual({ fileKey: 'Jkl012mno', nodeId: '1:2' });
  });

  it('returns nodeId as null when URL has no node-id param', () => {
    const result = parseFigmaUrl('https://www.figma.com/design/AbC123xYz/My-File');
    expect(result).toEqual({ fileKey: 'AbC123xYz', nodeId: null });
  });

  it('converts node-id dash format to colon format (42-1234 -> 42:1234)', () => {
    const result = parseFigmaUrl(
      'https://www.figma.com/file/Key123/Name?node-id=100-2000',
    );
    expect(result.nodeId).toBe('100:2000');
  });

  it('throws on invalid URL (not a URL at all)', () => {
    expect(() => parseFigmaUrl('not-a-url')).toThrow('Invalid URL: not-a-url');
  });

  it('throws on non-Figma URL (valid URL but wrong domain)', () => {
    expect(() => parseFigmaUrl('https://example.com/design/AbC123/Name')).toThrow(
      'Not a Figma URL',
    );
  });

  it('throws when file key cannot be extracted from URL path', () => {
    expect(() => parseFigmaUrl('https://www.figma.com/community/plugin/12345')).toThrow(
      'Could not extract file key from URL',
    );
  });
});

// ---------------------------------------------------------------------------
// resolveToken
// ---------------------------------------------------------------------------

describe('resolveToken', () => {
  beforeEach(() => {
    vi.stubEnv('FIGMA_TOKEN', '');
    vi.stubEnv('FIGMA_PERSONAL_ACCESS_TOKEN', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the explicit param when provided', () => {
    expect(resolveToken('explicit-token')).toBe('explicit-token');
  });

  it('returns FIGMA_TOKEN env var when no explicit param', () => {
    vi.stubEnv('FIGMA_TOKEN', 'env-figma-token');
    expect(resolveToken()).toBe('env-figma-token');
  });

  it('returns FIGMA_PERSONAL_ACCESS_TOKEN env var when no explicit param and no FIGMA_TOKEN', () => {
    vi.stubEnv('FIGMA_PERSONAL_ACCESS_TOKEN', 'env-personal-token');
    expect(resolveToken()).toBe('env-personal-token');
  });

  it('prioritizes explicit param over FIGMA_TOKEN env var', () => {
    vi.stubEnv('FIGMA_TOKEN', 'env-figma-token');
    expect(resolveToken('explicit-token')).toBe('explicit-token');
  });

  it('prioritizes FIGMA_TOKEN over FIGMA_PERSONAL_ACCESS_TOKEN', () => {
    vi.stubEnv('FIGMA_TOKEN', 'env-figma-token');
    vi.stubEnv('FIGMA_PERSONAL_ACCESS_TOKEN', 'env-personal-token');
    expect(resolveToken()).toBe('env-figma-token');
  });

  it('prioritizes explicit param over both env vars', () => {
    vi.stubEnv('FIGMA_TOKEN', 'env-figma-token');
    vi.stubEnv('FIGMA_PERSONAL_ACCESS_TOKEN', 'env-personal-token');
    expect(resolveToken('explicit-token')).toBe('explicit-token');
  });

  it('throws a descriptive error when no token is found', () => {
    expect(() => resolveToken()).toThrow('Figma token not found');
    expect(() => resolveToken()).toThrow('FIGMA_TOKEN');
    expect(() => resolveToken()).toThrow('FIGMA_PERSONAL_ACCESS_TOKEN');
    expect(() => resolveToken()).toThrow('imugi.config.json');
  });

  it('treats null param the same as no param', () => {
    vi.stubEnv('FIGMA_TOKEN', 'env-figma-token');
    expect(resolveToken(null)).toBe('env-figma-token');
  });

  it('treats empty string param the same as no param (falsy)', () => {
    vi.stubEnv('FIGMA_TOKEN', 'env-figma-token');
    expect(resolveToken('')).toBe('env-figma-token');
  });
});

// ---------------------------------------------------------------------------
// exportFigmaImage  (mock fetch)
// ---------------------------------------------------------------------------

describe('exportFigmaImage', () => {
  const defaultOptions = {
    fileKey: 'testFileKey',
    nodeId: '42:1234',
    token: 'test-token',
    _retryBaseDelay: 0,
  };

  const fakeImageBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG magic bytes

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('successfully exports an image (mock both API call and image download)', async () => {
    const imageUrl = 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/test.png';
    const mockFetch = vi.mocked(fetch);

    // First call: Figma API images endpoint
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: { '42:1234': imageUrl } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // Second call: download the actual image
    mockFetch.mockResolvedValueOnce(
      new Response(fakeImageBytes, { status: 200 }),
    );

    const buffer = await exportFigmaImage(defaultOptions);

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(fakeImageBytes.length);

    // Verify the first fetch was called with the correct API URL and token header
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [apiUrl, apiInit] = mockFetch.mock.calls[0];
    expect(String(apiUrl)).toContain('https://api.figma.com/v1/images/testFileKey');
    expect(String(apiUrl)).toContain('ids=42%3A1234');
    expect((apiInit as RequestInit).headers).toEqual({ 'X-Figma-Token': 'test-token' });

    // Verify the second fetch was called with the image URL
    expect(mockFetch.mock.calls[1][0]).toBe(imageUrl);
  });

  it('throws on 403 error (bad token)', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response('Forbidden', { status: 403 }),
    );

    await expect(exportFigmaImage(defaultOptions)).rejects.toThrow(
      'Invalid or expired token (403 Forbidden)',
    );
  });

  it('throws on 404 error (file not found)', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response('Not Found', { status: 404 }),
    );

    await expect(exportFigmaImage(defaultOptions)).rejects.toThrow(
      'File not found',
    );
  });

  it('throws on 429 error (rate limit) after retries', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response('Too Many Requests', { status: 429 }),
    );

    await expect(exportFigmaImage(defaultOptions)).rejects.toThrow('Rate limited');
  });

  it('throws a generic error for other non-ok status codes after retries', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    await expect(exportFigmaImage(defaultOptions)).rejects.toThrow('Figma API error 500');
  });

  it('throws when API response contains an err field', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ err: 'Invalid node ID', images: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(exportFigmaImage(defaultOptions)).rejects.toThrow(
      'Figma API error: Invalid node ID',
    );
  });

  it('throws when API returns null image URL for the requested node', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ images: { '42:1234': null } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(exportFigmaImage(defaultOptions)).rejects.toThrow(
      'returned no image for node "42:1234"',
    );
  });

  it('throws when API returns empty images map (node not present)', async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ images: {} }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(exportFigmaImage(defaultOptions)).rejects.toThrow(
      'returned no image for node "42:1234"',
    );
  });

  it('throws when the image download itself fails', async () => {
    const imageUrl = 'https://figma-alpha-api.s3.us-west-2.amazonaws.com/images/test.png';
    const mockFetch = vi.mocked(fetch);

    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes('api.figma.com')) {
        return new Response(JSON.stringify({ images: { '42:1234': imageUrl } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Service Unavailable', { status: 503 });
    });

    await expect(exportFigmaImage(defaultOptions)).rejects.toThrow(
      'Failed to download exported image: 503',
    );
  });

  it('uses default scale=2 and format=png when not specified', async () => {
    const imageUrl = 'https://s3.example.com/image.png';
    const mockFetch = vi.mocked(fetch);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: { '42:1234': imageUrl } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(fakeImageBytes, { status: 200 }),
    );

    await exportFigmaImage(defaultOptions);

    const apiUrl = String(mockFetch.mock.calls[0][0]);
    expect(apiUrl).toContain('scale=2');
    expect(apiUrl).toContain('format=png');
  });

  it('respects custom scale and format options', async () => {
    const imageUrl = 'https://s3.example.com/image.svg';
    const mockFetch = vi.mocked(fetch);

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ images: { '42:1234': imageUrl } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    mockFetch.mockResolvedValueOnce(
      new Response(fakeImageBytes, { status: 200 }),
    );

    await exportFigmaImage({ ...defaultOptions, scale: 4, format: 'svg' });

    const apiUrl = String(mockFetch.mock.calls[0][0]);
    expect(apiUrl).toContain('scale=4');
    expect(apiUrl).toContain('format=svg');
  });
});
