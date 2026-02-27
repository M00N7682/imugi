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

/**
 * Export a Figma node as an image buffer via the Figma REST API.
 */
export async function exportFigmaImage(options: FigmaExportOptions): Promise<Buffer> {
  const { fileKey, nodeId, token, scale = 2, format = 'png' } = options;

  const apiUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&scale=${scale}&format=${format}`;

  const response = await fetch(apiUrl, {
    headers: { 'X-Figma-Token': token },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 403) {
      throw new Error('Figma API: Invalid or expired token (403 Forbidden)');
    }
    if (response.status === 404) {
      throw new Error(`Figma API: File not found — check the file key "${fileKey}" (404)`);
    }
    if (response.status === 429) {
      throw new Error('Figma API: Rate limited — wait a moment and try again (429)');
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

  const imageResponse = await fetch(imageUrl);
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
