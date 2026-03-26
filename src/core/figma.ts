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

// ── Figma Design Spec Extraction ──

export interface FigmaStyleSpec {
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  styles: Record<string, string>;
  children?: FigmaStyleSpec[];
}

function rgbaToHex(c: { r: number; g: number; b: number; a?: number }): string {
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function extractNodeStyles(node: Record<string, unknown>): Record<string, string> {
  const styles: Record<string, string> = {};
  const abs = node.absoluteBoundingBox as { x: number; y: number; width: number; height: number } | undefined;

  // Typography
  const ts = node.style as Record<string, unknown> | undefined;
  if (ts) {
    if (ts.fontSize) styles.fontSize = `${ts.fontSize}px`;
    if (ts.fontWeight) styles.fontWeight = String(ts.fontWeight);
    if (ts.fontFamily) styles.fontFamily = String(ts.fontFamily);
    if (ts.letterSpacing && Number(ts.letterSpacing) !== 0) styles.letterSpacing = `${ts.letterSpacing}px`;
    if (ts.lineHeightPx) styles.lineHeight = `${ts.lineHeightPx}px`;
    if (ts.textAlignHorizontal) styles.textAlign = String(ts.textAlignHorizontal).toLowerCase();
  }

  // Fills (background/text color)
  const fills = node.fills as Array<{ type: string; color?: { r: number; g: number; b: number; a?: number }; visible?: boolean }> | undefined;
  if (fills && fills.length > 0) {
    const solidFill = fills.find(f => f.type === 'SOLID' && f.visible !== false);
    if (solidFill?.color) {
      const hex = rgbaToHex(solidFill.color);
      if (node.type === 'TEXT') {
        styles.color = hex;
      } else {
        styles.backgroundColor = hex;
      }
    }
  }

  // Corner radius
  const cr = node.cornerRadius as number | undefined;
  if (cr && cr > 0) styles.borderRadius = `${cr}px`;
  const crArray = node.rectangleCornerRadii as number[] | undefined;
  if (crArray && crArray.some(r => r > 0)) {
    styles.borderRadius = crArray.map(r => `${r}px`).join(' ');
  }

  // Padding
  const pt = node.paddingTop as number | undefined;
  const pr = node.paddingRight as number | undefined;
  const pb = node.paddingBottom as number | undefined;
  const pl = node.paddingLeft as number | undefined;
  if (pt || pr || pb || pl) {
    styles.padding = `${pt ?? 0}px ${pr ?? 0}px ${pb ?? 0}px ${pl ?? 0}px`;
  }

  // Gap (auto-layout)
  const gap = node.itemSpacing as number | undefined;
  if (gap && gap > 0) styles.gap = `${gap}px`;

  // Layout mode
  const layoutMode = node.layoutMode as string | undefined;
  if (layoutMode === 'HORIZONTAL') styles.display = 'flex';
  if (layoutMode === 'VERTICAL') { styles.display = 'flex'; styles.flexDirection = 'column'; }

  // Alignment
  const primaryAlign = node.primaryAxisAlignItems as string | undefined;
  const counterAlign = node.counterAxisAlignItems as string | undefined;
  if (primaryAlign === 'CENTER') styles.justifyContent = 'center';
  if (primaryAlign === 'SPACE_BETWEEN') styles.justifyContent = 'space-between';
  if (counterAlign === 'CENTER') styles.alignItems = 'center';

  // Strokes (border)
  const strokes = node.strokes as Array<{ type: string; color?: { r: number; g: number; b: number } }> | undefined;
  const strokeWeight = node.strokeWeight as number | undefined;
  if (strokes && strokes.length > 0 && strokeWeight) {
    const stroke = strokes.find(s => s.type === 'SOLID');
    if (stroke?.color) {
      styles.border = `${strokeWeight}px solid ${rgbaToHex(stroke.color)}`;
    }
  }

  // Size
  if (abs) {
    styles.width = `${Math.round(abs.width)}px`;
    styles.height = `${Math.round(abs.height)}px`;
  }

  return styles;
}

function flattenNodes(
  node: Record<string, unknown>,
  parentBox?: { x: number; y: number },
): FigmaStyleSpec[] {
  const results: FigmaStyleSpec[] = [];
  const abs = node.absoluteBoundingBox as { x: number; y: number; width: number; height: number } | undefined;
  if (!abs || (abs.width === 0 && abs.height === 0)) return results;

  const type = node.type as string;
  const name = (node.name as string) ?? '';

  // Skip invisible nodes
  if ((node.visible as boolean | undefined) === false) return results;

  const styles = extractNodeStyles(node);
  const offsetX = parentBox?.x ?? abs.x;
  const offsetY = parentBox?.y ?? abs.y;

  if (Object.keys(styles).length > 0) {
    results.push({
      name,
      type,
      x: Math.round(abs.x - offsetX),
      y: Math.round(abs.y - offsetY),
      width: Math.round(abs.width),
      height: Math.round(abs.height),
      styles,
    });
  }

  const children = node.children as Record<string, unknown>[] | undefined;
  if (children) {
    for (const child of children) {
      results.push(...flattenNodes(child, { x: offsetX, y: offsetY }));
    }
  }

  return results;
}

/**
 * Fetch the design spec (styles, layout, typography) for a Figma node
 * via the REST API. Returns flattened element specs with CSS-like properties.
 * No image export — just the structured design data.
 */
export async function fetchFigmaSpecs(options: {
  fileKey: string;
  nodeId: string;
  token: string;
  _retryBaseDelay?: number;
}): Promise<FigmaStyleSpec[]> {
  const { fileKey, nodeId, token, _retryBaseDelay = 1000 } = options;
  const apiUrl = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`;

  const response = await fetchWithRetry(apiUrl, {
    headers: { 'X-Figma-Token': token },
  }, { baseDelay: _retryBaseDelay });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Figma API error ${response.status}: ${body}`);
  }

  const data = await response.json() as { nodes?: Record<string, { document?: Record<string, unknown> }> };
  const nodeData = data.nodes?.[nodeId]?.document;
  if (!nodeData) {
    throw new Error(`Figma API: node "${nodeId}" not found in file "${fileKey}"`);
  }

  return flattenNodes(nodeData);
}

/**
 * Compare Figma design specs against DOM computed styles.
 * Returns a list of concrete CSS differences per element.
 */
export function diffFigmaVsDom(
  figmaSpecs: FigmaStyleSpec[],
  domElements: Array<{
    tag: string; text: string;
    x: number; y: number; width: number; height: number;
    styles: Record<string, string>;
  }>,
): Array<{ figmaElement: string; domElement: string; differences: Array<{ property: string; figma: string; dom: string }> }> {
  const results: Array<{ figmaElement: string; domElement: string; differences: Array<{ property: string; figma: string; dom: string }> }> = [];

  for (const spec of figmaSpecs) {
    if (spec.type !== 'TEXT' && spec.type !== 'FRAME' && spec.type !== 'RECTANGLE' && spec.type !== 'INSTANCE' && spec.type !== 'COMPONENT') continue;

    // Match by overlapping bounding box (within 30px tolerance)
    const tolerance = 30;
    const matched = domElements.find(el =>
      Math.abs(el.x - spec.x) < tolerance &&
      Math.abs(el.y - spec.y) < tolerance &&
      Math.abs(el.width - spec.width) < tolerance * 2
    );

    if (!matched) continue;

    const diffs: Array<{ property: string; figma: string; dom: string }> = [];
    const compareProps = ['fontSize', 'fontWeight', 'color', 'backgroundColor', 'borderRadius', 'padding', 'gap', 'lineHeight', 'letterSpacing'];

    for (const prop of compareProps) {
      const figmaVal = spec.styles[prop];
      const domVal = matched.styles[prop];
      if (!figmaVal || !domVal) continue;

      // Normalize for comparison
      const normalize = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalize(figmaVal) !== normalize(domVal)) {
        diffs.push({ property: prop, figma: figmaVal, dom: domVal });
      }
    }

    if (diffs.length > 0) {
      results.push({
        figmaElement: `${spec.type} "${spec.name}" (${spec.x},${spec.y} ${spec.width}x${spec.height})`,
        domElement: `<${matched.tag}> "${matched.text}" (${matched.x},${matched.y} ${matched.width}x${matched.height})`,
        differences: diffs,
      });
    }
  }

  return results;
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
