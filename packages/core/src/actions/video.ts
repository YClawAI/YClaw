import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('video-executor');

const XAI_BASE_URL = 'https://api.x.ai/v1';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const ASPECT_RATIOS: Record<string, string> = {
  '1:1': '1:1',
  '16:9': '16:9',
  '9:16': '9:16',
  '4:3': '4:3',
  '3:4': '3:4',
  '3:2': '3:2',
  '2:3': '2:3',
};

const MAX_POLL_ATTEMPTS = 60; // 5 minutes at 5s intervals
const POLL_INTERVAL_MS = 5000;

/**
 * Video generation action executor.
 *
 * Actions:
 *   video:text_to_video   — Generate video from text prompt (xAI Grok Imagine)
 *   video:image_to_video  — Animate a static image into video (xAI Grok Imagine)
 *   video:edit            — Edit existing video with natural language (xAI Grok Imagine)
 *   video:veo_generate    — Generate high-fidelity 1080p video with audio (Google Veo 3.1)
 */
export class VideoExecutor implements ActionExecutor {
  readonly name = 'video';
  private xaiApiKey: string | null;
  private geminiApiKey: string | null;

  constructor() {
    this.xaiApiKey = process.env.XAI_API_KEY || null;
    this.geminiApiKey = process.env.GEMINI_API_KEY || null;

    if (!this.xaiApiKey) {
      logger.warn('XAI_API_KEY not configured. xAI video generation unavailable.');
    }
    if (!this.geminiApiKey) {
      logger.warn('GEMINI_API_KEY not configured. Veo video generation unavailable.');
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'video:text_to_video',
        description: 'Generate a short video from a text prompt via xAI Grok Imagine Video. Returns video URL. Async — may take 1-3 minutes.',
        parameters: {
          prompt: { type: 'string', description: 'Video description prompt', required: true },
          duration: { type: 'number', description: 'Duration in seconds, 1-15 (default: 5)' },
          aspectRatio: { type: 'string', description: 'Aspect ratio: 16:9, 9:16, 1:1, 4:3, 3:4, 3:2, 2:3 (default: 16:9)' },
          resolution: { type: 'string', description: 'Resolution: "480p" or "720p" (default: 480p)' },
        },
      },
      {
        name: 'video:image_to_video',
        description: 'Animate a static image into a short video via xAI Grok Imagine. Provide image URL and optional motion prompt.',
        parameters: {
          imageUrl: { type: 'string', description: 'Public URL of the source image', required: true },
          prompt: { type: 'string', description: 'Optional motion/animation guidance (e.g., "slow zoom in, clouds moving")' },
          duration: { type: 'number', description: 'Duration in seconds, 1-15 (default: 5)' },
        },
      },
      {
        name: 'video:edit',
        description: 'Edit an existing video using natural language instructions via xAI Grok Imagine.',
        parameters: {
          videoUrl: { type: 'string', description: 'Public URL of the source video', required: true },
          prompt: { type: 'string', description: 'Edit instruction (e.g., "add warm sunset filter, slow to 50% speed")', required: true },
        },
      },
      {
        name: 'video:veo_generate',
        description: 'Generate a high-fidelity 1080p video with synced audio via Google Veo 3.1. Best for cinematic/hero content. Async — may take 3-5 minutes.',
        parameters: {
          prompt: { type: 'string', description: 'Video description prompt', required: true },
          aspectRatio: { type: 'string', description: 'Aspect ratio: "16:9" or "9:16" (default: 16:9)' },
        },
      },
    ];
  }

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    switch (action) {
      case 'text_to_video':
        return this.textToVideo(params);
      case 'image_to_video':
        return this.imageToVideo(params);
      case 'edit':
        return this.editVideo(params);
      case 'veo_generate':
        return this.veoGenerate(params);
      default:
        return { success: false, error: `Unknown video action: ${action}` };
    }
  }

  async healthCheck(): Promise<boolean> {
    return !!(this.xaiApiKey || this.geminiApiKey);
  }

  // ─── xAI Grok Imagine Video ───────────────────────────────────────────────

  private async textToVideo(params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.xaiApiKey) {
      return { success: false, error: 'Video generation not initialized: missing XAI_API_KEY' };
    }

    const prompt = params.prompt as string | undefined;
    if (!prompt) {
      return { success: false, error: 'Missing required parameter: prompt' };
    }

    const duration = Math.max(1, Math.min(15, (params.duration as number) || 5));
    const aspectRatio = ASPECT_RATIOS[(params.aspectRatio as string) || '16:9'] || '16:9';
    const resolution = (params.resolution as string) === '720p' ? '720p' : '480p';

    logger.info('Generating video via xAI', { duration, aspectRatio, resolution, promptLength: prompt.length });

    try {
      const response = await fetch(`${XAI_BASE_URL}/videos/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.xaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-imagine-video',
          prompt,
          duration,
          aspect_ratio: aspectRatio,
          resolution,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `xAI video API failed (${response.status}): ${errorBody}` };
      }

      const data = await response.json() as { request_id?: string; id?: string };
      const requestId = data.request_id || data.id;

      if (!requestId) {
        return { success: false, error: 'xAI video API returned no request ID' };
      }

      // Poll for completion
      return this.pollXaiVideo(requestId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Text-to-video failed', { error: errorMsg });
      return { success: false, error: `Text-to-video failed: ${errorMsg}` };
    }
  }

  private async imageToVideo(params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.xaiApiKey) {
      return { success: false, error: 'Video generation not initialized: missing XAI_API_KEY' };
    }

    const imageUrl = params.imageUrl as string | undefined;
    if (!imageUrl) {
      return { success: false, error: 'Missing required parameter: imageUrl' };
    }

    const prompt = (params.prompt as string) || '';
    const duration = Math.max(1, Math.min(15, (params.duration as number) || 5));

    logger.info('Generating image-to-video via xAI', { duration, promptLength: prompt.length });

    try {
      const response = await fetch(`${XAI_BASE_URL}/videos/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.xaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-imagine-video',
          prompt,
          image: { url: imageUrl },
          duration,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `xAI image-to-video failed (${response.status}): ${errorBody}` };
      }

      const data = await response.json() as { request_id?: string; id?: string };
      const requestId = data.request_id || data.id;

      if (!requestId) {
        return { success: false, error: 'xAI video API returned no request ID' };
      }

      return this.pollXaiVideo(requestId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Image-to-video failed', { error: errorMsg });
      return { success: false, error: `Image-to-video failed: ${errorMsg}` };
    }
  }

  private async editVideo(params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.xaiApiKey) {
      return { success: false, error: 'Video generation not initialized: missing XAI_API_KEY' };
    }

    const videoUrl = params.videoUrl as string | undefined;
    const prompt = params.prompt as string | undefined;
    if (!videoUrl || !prompt) {
      return { success: false, error: 'Missing required parameters: videoUrl and prompt' };
    }

    logger.info('Editing video via xAI', { promptLength: prompt.length });

    try {
      const response = await fetch(`${XAI_BASE_URL}/videos/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.xaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'grok-imagine-video',
          prompt,
          video: { url: videoUrl },
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `xAI video edit failed (${response.status}): ${errorBody}` };
      }

      const data = await response.json() as { request_id?: string; id?: string };
      const requestId = data.request_id || data.id;

      if (!requestId) {
        return { success: false, error: 'xAI video API returned no request ID' };
      }

      return this.pollXaiVideo(requestId);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Video edit failed', { error: errorMsg });
      return { success: false, error: `Video edit failed: ${errorMsg}` };
    }
  }

  private async pollXaiVideo(requestId: string): Promise<ActionResult> {
    logger.info('Polling for xAI video completion', { requestId });

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const response = await fetch(`${XAI_BASE_URL}/videos/generations/${requestId}`, {
          headers: { 'Authorization': `Bearer ${this.xaiApiKey}` },
        });

        if (!response.ok) {
          const errorBody = await response.text();
          logger.warn('Poll request failed', { attempt, status: response.status, error: errorBody });
          continue;
        }

        const data = await response.json() as {
          status?: string;
          state?: string;
          video?: { url?: string };
          data?: Array<{ url?: string }>;
          error?: string;
          error_code?: string;
        };

        const status = data.status || data.state || '';

        if (status === 'failed' || data.error) {
          return { success: false, error: `Video generation failed: ${data.error || data.error_code || 'unknown error'}` };
        }

        // Check for completion — API may use different response shapes
        const videoUrl = data.video?.url || data.data?.[0]?.url;
        if (videoUrl || status === 'completed' || status === 'succeeded') {
          logger.info('Video generation completed', { requestId, attempt });
          return {
            success: true,
            data: {
              videoUrl: videoUrl || '',
              requestId,
              provider: 'xai',
              pollAttempts: attempt + 1,
            },
          };
        }

        logger.info('Video still generating', { requestId, attempt, status });
      } catch (err) {
        logger.warn('Poll error', { attempt, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { success: false, error: `Video generation timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s (request: ${requestId})` };
  }

  // ─── Google Veo 3.1 ──────────────────────────────────────────────────────

  private async veoGenerate(params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.geminiApiKey) {
      return { success: false, error: 'Veo generation not initialized: missing GEMINI_API_KEY' };
    }

    const prompt = params.prompt as string | undefined;
    if (!prompt) {
      return { success: false, error: 'Missing required parameter: prompt' };
    }

    const aspectRatio = (params.aspectRatio as string) === '9:16' ? '9:16' : '16:9';

    logger.info('Generating video via Veo 3.1', { aspectRatio, promptLength: prompt.length });

    try {
      const response = await fetch(
        `${GEMINI_BASE_URL}/models/veo-3.0-generate-preview:predictLongRunning`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': this.geminiApiKey,
          },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              aspectRatio,
              personGeneration: 'dont_allow',
            },
          }),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text();
        return { success: false, error: `Veo API failed (${response.status}): ${errorBody}` };
      }

      const data = await response.json() as { name?: string };
      const operationName = data.name;

      if (!operationName) {
        return { success: false, error: 'Veo API returned no operation name' };
      }

      // Poll for completion
      return this.pollVeoVideo(operationName);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Veo generation failed', { error: errorMsg });
      return { success: false, error: `Veo generation failed: ${errorMsg}` };
    }
  }

  private async pollVeoVideo(operationName: string): Promise<ActionResult> {
    logger.info('Polling for Veo completion', { operationName });

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const response = await fetch(
          `${GEMINI_BASE_URL}/${operationName}`,
          {
            headers: { 'X-goog-api-key': this.geminiApiKey! },
          }
        );

        if (!response.ok) {
          logger.warn('Veo poll failed', { attempt, status: response.status });
          continue;
        }

        const data = await response.json() as {
          done?: boolean;
          response?: {
            generateVideoResponse?: {
              generatedSamples?: Array<{ video?: { uri?: string } }>;
            };
          };
          error?: { message?: string };
        };

        if (data.error) {
          return { success: false, error: `Veo generation failed: ${data.error.message || 'unknown error'}` };
        }

        if (data.done) {
          const videoUri = data.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
          logger.info('Veo generation completed', { operationName, attempt });
          return {
            success: true,
            data: {
              videoUrl: videoUri || '',
              operationName,
              provider: 'veo',
              pollAttempts: attempt + 1,
            },
          };
        }

        logger.info('Veo still generating', { operationName, attempt });
      } catch (err) {
        logger.warn('Veo poll error', { attempt, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return { success: false, error: `Veo generation timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000}s (op: ${operationName})` };
  }
}
