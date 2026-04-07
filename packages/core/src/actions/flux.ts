import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('flux-executor');

const XAI_BASE_URL = 'https://api.x.ai/v1';
const DEFAULT_MODEL = 'grok-imagine-image';

/** Map common aspect ratios to xAI's supported values. */
const ASPECT_RATIOS: Record<string, string> = {
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '4:3': '4:3',
  '3:4': '3:4',
  '3:2': '3:2',
  '2:3': '2:3',
};

/**
 * Image generation action executor.
 * Generates images via xAI's Grok Imagine API (Aurora model, Flux-based).
 * Uses the already-live XAI_API_KEY — no additional credentials needed.
 *
 * Actions:
 *   flux:generate — Generate an image from a text prompt
 *
 * Params:
 *   prompt       (string, required)  — Image description
 *   n            (number, default 1) — Number of images (1-10)
 *   aspectRatio  (string, default "1:1") — 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3
 *   resolution   (string, default "1k") — "1k" or "2k"
 *   model        (string, default "grok-imagine-image")
 */
export class FluxExecutor implements ActionExecutor {
  readonly name = 'flux';
  private apiKey: string | null;

  constructor() {
    this.apiKey = process.env.XAI_API_KEY || null;

    if (!this.apiKey) {
      logger.warn('XAI_API_KEY not configured. Image generation will be unavailable.');
    }
  }

  // ─── Tool Definitions (colocated schemas) ─────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'flux:generate',
        description: 'Generate an image from a text prompt via xAI Grok Imagine API (Aurora/Flux-based)',
        parameters: {
          prompt: { type: 'string', description: 'Image description / generation prompt', required: true },
          n: { type: 'number', description: 'Number of images to generate (1-10, default: 1)' },
          aspectRatio: { type: 'string', description: 'Aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, or 2:3 (default: 1:1)' },
          resolution: { type: 'string', description: 'Image resolution: "1k" or "2k" (default: 1k)' },
          model: { type: 'string', description: 'Model name (default: grok-imagine-image)' },
        },
      },
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case 'generate':
        return this.generate(params);
      default:
        return { success: false, error: `Unknown flux action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    return !!this.apiKey;
  }

  private async generate(params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.apiKey) {
      return { success: false, error: 'Image generation not initialized: missing XAI_API_KEY' };
    }

    const prompt = params.prompt as string | undefined;
    if (!prompt) {
      return { success: false, error: 'Missing required parameter: prompt' };
    }

    const model = (params.model as string) || DEFAULT_MODEL;
    const n = Math.max(1, Math.min(10, (params.n as number) || 1));
    const aspectRatio = ASPECT_RATIOS[(params.aspectRatio as string) || '1:1'] || '1:1';
    const resolution = (params.resolution as string) === '2k' ? '2k' : '1k';

    logger.info('Generating image via xAI', { model, n, aspectRatio, resolution, promptLength: prompt.length });

    try {
      const response = await fetch(`${XAI_BASE_URL}/images/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          prompt,
          model,
          n,
          aspect_ratio: aspectRatio,
          resolution,
          response_format: 'url',
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `xAI image API failed (${response.status}): ${errorBody}` };
      }

      const data = await response.json() as {
        data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
      };

      if (!data.data || data.data.length === 0) {
        return { success: false, error: 'xAI image API returned no images' };
      }

      const firstImage = data.data[0];
      const imageUrl = firstImage.url || '';

      if (!imageUrl) {
        return { success: false, error: 'xAI image API returned no image URL' };
      }

      logger.info('Image generated successfully', { model, n: data.data.length, aspectRatio });

      return {
        success: true,
        data: {
          imageUrl,
          prompt,
          revisedPrompt: firstImage.revised_prompt,
          aspectRatio,
          resolution,
          imageCount: data.data.length,
          // Include all image URLs if multiple were requested
          ...(data.data.length > 1 ? {
            allImageUrls: data.data.map(img => img.url),
          } : {}),
        },
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Image generation failed', { error: errorMsg });
      return { success: false, error: `Image generation failed: ${errorMsg}` };
    }
  }
}
