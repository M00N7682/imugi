import Anthropic from '@anthropic-ai/sdk';
import sharp from 'sharp';
import type { AuthResult } from '../agent/auth.js';
import { createAuthenticatedFetch, refreshAccessToken, saveToken } from '../agent/auth.js';
import type { TokenResponse, VisionAnalysis } from '../types.js';

export function createClaudeClient(auth: AuthResult): Anthropic {
  if (auth.type === 'api_key') {
    return new Anthropic({ apiKey: auth.apiKey });
  }

  return new Anthropic({
    apiKey: '',
    fetch: createAuthenticatedFetch(auth),
  });
}

export interface StreamMessageOptions {
  client: Anthropic;
  messages: Anthropic.MessageParam[];
  systemPrompt?: string;
  maxTokens?: number;
  model?: string;
}

export async function* streamMessage(
  options: StreamMessageOptions,
): AsyncGenerator<string, Anthropic.Message> {
  const { client, messages, systemPrompt, maxTokens = 8192, model = 'claude-sonnet-4-5-20250514' } = options;

  const stream = client.messages.stream({
    model,
    max_tokens: maxTokens,
    messages,
    ...(systemPrompt ? { system: systemPrompt } : {}),
  });

  let fullText = '';

  stream.on('text', (text) => {
    fullText += text;
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }

  return await stream.finalMessage();
}

export async function sendMessage(options: StreamMessageOptions): Promise<string> {
  const { client, messages, systemPrompt, maxTokens = 8192, model = 'claude-sonnet-4-5-20250514' } = options;

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages,
    ...(systemPrompt ? { system: systemPrompt } : {}),
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

export async function prepareImageForAPI(
  imageBuffer: Buffer,
): Promise<{ base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' }> {
  const metadata = await sharp(imageBuffer).metadata();
  let processed = sharp(imageBuffer);

  const maxDim = 1568;
  if ((metadata.width && metadata.width > maxDim) || (metadata.height && metadata.height > maxDim)) {
    processed = processed.resize({
      width: maxDim,
      height: maxDim,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const outputBuffer = await processed.png().toBuffer();

  if (outputBuffer.length > 5 * 1024 * 1024) {
    const jpegBuffer = await sharp(imageBuffer)
      .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { base64: jpegBuffer.toString('base64'), mediaType: 'image/jpeg' };
  }

  return { base64: outputBuffer.toString('base64'), mediaType: 'image/png' };
}

export interface VisionComparisonOptions {
  client: Anthropic;
  designImage: Buffer;
  screenshotImage: Buffer;
  heatmapImage?: Buffer;
  cropImages?: Buffer[];
  model?: string;
}

export async function sendVisionComparison(
  options: VisionComparisonOptions,
): Promise<VisionAnalysis> {
  const { client, designImage, screenshotImage, heatmapImage, cropImages, model = 'claude-sonnet-4-5-20250514' } = options;

  const content: Anthropic.ContentBlockParam[] = [];

  content.push({ type: 'text', text: 'Image 1 (TARGET DESIGN):' });
  const designPrepared = await prepareImageForAPI(designImage);
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: designPrepared.mediaType, data: designPrepared.base64 },
  });

  content.push({ type: 'text', text: 'Image 2 (CURRENT IMPLEMENTATION):' });
  const screenshotPrepared = await prepareImageForAPI(screenshotImage);
  content.push({
    type: 'image',
    source: { type: 'base64', media_type: screenshotPrepared.mediaType, data: screenshotPrepared.base64 },
  });

  if (heatmapImage) {
    content.push({ type: 'text', text: 'Image 3 (DIFFERENCE HEATMAP):' });
    const heatmapPrepared = await prepareImageForAPI(heatmapImage);
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: heatmapPrepared.mediaType, data: heatmapPrepared.base64 },
    });
  }

  if (cropImages) {
    for (let i = 0; i < cropImages.length; i++) {
      content.push({ type: 'text', text: `Detail crop ${i + 1}:` });
      const cropPrepared = await prepareImageForAPI(cropImages[i]);
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: cropPrepared.mediaType, data: cropPrepared.base64 },
      });
    }
  }

  content.push({
    type: 'text',
    text: `Compare these images of a web page.
Image 1 is the TARGET design. Image 2 is the CURRENT implementation.
${heatmapImage ? 'Image 3 shows pixel-level differences as a heatmap.' : ''}

Analyze and respond with ONLY valid JSON (no markdown):
{
  "similarityScore": <number 0.0-1.0>,
  "differences": [
    {
      "area": "<which part: header, sidebar, button, etc.>",
      "type": "<color|spacing|size|position|missing|extra|font>",
      "description": "<what exactly is different>",
      "cssSuggestion": "<specific CSS fix>"
    }
  ],
  "overallAssessment": "<one sentence summary>"
}`,
  });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseVisionResponse(text);
}

function parseVisionResponse(text: string): VisionAnalysis {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      similarityScore: 0.5,
      differences: [],
      overallAssessment: 'Failed to parse vision response',
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      similarityScore: typeof parsed.similarityScore === 'number' ? parsed.similarityScore : 0.5,
      differences: Array.isArray(parsed.differences) ? parsed.differences : [],
      overallAssessment: typeof parsed.overallAssessment === 'string' ? parsed.overallAssessment : '',
    };
  } catch {
    return {
      similarityScore: 0.5,
      differences: [],
      overallAssessment: 'Failed to parse vision JSON',
    };
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: { maxRetries?: number; auth?: AuthResult },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err as Error;
      const error = err as { status?: number; headers?: Record<string, string> };

      if (error.status === 429) {
        const retryAfter = error.headers?.['retry-after'];
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (error.status === 401 && options?.auth?.type === 'oauth' && attempt === 0) {
        try {
          const refreshed = await refreshAccessToken(options.auth.token.refresh_token);
          await saveToken(refreshed);
          options.auth.token = refreshed;
          continue;
        } catch {
          throw lastError;
        }
      }

      if (error.status && error.status >= 500) {
        const waitMs = Math.pow(2, attempt) * 2000;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      throw err;
    }
  }

  throw lastError ?? new Error('Max retries exceeded');
}
