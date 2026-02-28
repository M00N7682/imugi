import { writeFile } from 'fs/promises';

export interface FigmaParsedUrl {
  fileKey: string;
  nodeId: string | null;
}

export interface FigmaExportOptions {
  fileKey: string;
  nodeId: string;
  token: string;
  scale?: number;
  format?: 'png' | 'jpg' | 'svg' | 'pdf';
  /** @internal Base delay in ms for retry backoff (default: 1000). Set to 0 in tests. */
  _retryBaseDelay?: number;
}

/**
 * Parse a Figma URL into its file key and optional node ID.
 * Supports /design/, /file/, /proto/, and /board/ URL formats.
 */
export function parseFigmaUrl(url: string): FigmaParsedUrl {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!parsed.hostname.includes('figma.com')) {
    throw new Error(`Not a Figma URL: ${url}`);
  }

  // Match paths like /design/FILE_KEY/..., /file/FILE_KEY/..., /proto/FILE_KEY/..., /board/FILE_KEY/...
  const pathMatch = parsed.pathname.match(/^\/(design|file|proto|board)\/([a-zA-Z0-9]+)/);
  if (!pathMatch) {
    throw new Error(
      `Could not extract file key from URL: ${url}\nExpected format: https://www.figma.com/design/FILE_KEY/...`,
    );
  }

  const fileKey = pathMatch[2];

  // Extract node-id from query params (format: 42-1234) and convert to API format (42:1234)
  const nodeIdParam = parsed.searchParams.get('node-id');
  const nodeId = nodeIdParam ? nodeIdParam.replace('-', ':') : null;

  return { fileKey, nodeId };
}

/**
 * Resolve a Figma personal access token from multiple sources.
 * Priority: explicit param > FIGMA_TOKEN env > FIGMA_PERSONAL_ACCESS_TOKEN env
 */
export function resolveToken(configToken?: string | null): string {
  if (configToken) return configToken;

  const envToken = process.env.FIGMA_TOKEN || process.env.FIGMA_PERSONAL_ACCESS_TOKEN;
  if (envToken) return envToken;

  throw new Error(
    'Figma token not found. Set one of:\n' +
      '  - FIGMA_TOKEN environment variable\n' +
      '  - FIGMA_PERSONAL_ACCESS_TOKEN environment variable\n' +
      '  - figma.token in imugi.config.json',
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  { maxRetries = 3, baseDelay = 1000 }: { maxRetries?: number; baseDelay?: number } = {},
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init);

    if (response.ok) return response;
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`HTTP ${response.status}`);
      if (attempt < maxRetries) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }

    return response;
  }
  throw lastError ?? new Error('fetchWithRetry: unexpected state');
}

/**
 * Export a Figma node as an image buffer via the Figma REST API.
 * Retries on 429 (rate limit) and 5xx errors with exponential backoff.
 */
export async function exportFigmaImage(options: FigmaExportOptions): Promise<Buffer> {
  const { fileKey, nodeId, token, scale = 2, format = 'png', _retryBaseDelay = 1000 } = options;

  const apiUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&scale=${scale}&format=${format}`;

  const response = await fetchWithRetry(apiUrl, {
    headers: { 'X-Figma-Token': token },
  }, { baseDelay: _retryBaseDelay });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 403) {
      throw new Error('Figma API: Invalid or expired token (403 Forbidden)');
    }
    if (response.status === 404) {
      throw new Error(`Figma API: File not found — check the file key "${fileKey}" (404)`);
    }
    if (response.status === 429) {
      throw new Error('Figma API: Rate limited after retries — try again later (429)');
    }
    throw new Error(`Figma API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { images?: Record<string, string | null>; err?: string };

  if (data.err) {
    throw new Error(`Figma API error: ${data.err}`);
  }

  const imageUrl = data.images?.[nodeId];
  if (!imageUrl) {
    throw new Error(`Figma API returned no image for node "${nodeId}". Check that the node ID exists in the file.`);
  }

  const imageResponse = await fetchWithRetry(imageUrl, {}, { baseDelay: _retryBaseDelay });
  if (!imageResponse.ok) {
    throw new Error(`Failed to download exported image: ${imageResponse.status}`);
  }

  return Buffer.from(await imageResponse.arrayBuffer());
}

/**
 * Export a Figma frame and optionally save to disk.
 * Returns the image buffer regardless.
 */
export async function exportAndSave(options: FigmaExportOptions & { outputPath?: string }): Promise<Buffer> {
  const { outputPath, ...exportOpts } = options;
  const buffer = await exportFigmaImage(exportOpts);

  if (outputPath) {
    await writeFile(outputPath, buffer);
  }

  return buffer;
}
