import crypto from 'node:crypto';
import { createLogger } from '../logging/logger.js';

const STITCH_ENDPOINT = 'https://stitch.googleapis.com/mcp';

const logger = createLogger('stitch-client');

// ─── Error Class ─────────────────────────────────────────────────────────────

export class StitchError extends Error {
  readonly code: number;
  readonly recoverable: boolean;

  constructor(message: string, code: number, recoverable: boolean) {
    super(message);
    this.name = 'StitchError';
    this.code = code;
    this.recoverable = recoverable;
  }
}

// ─── Response Types ──────────────────────────────────────────────────────────

export interface StitchProject {
  name: string;
  title: string;
  createTime?: string;
  updateTime?: string;
}

export interface StitchScreen {
  name: string;
  title: string;
  deviceType?: string;
  code?: string;
  createTime?: string;
  updateTime?: string;
}

export interface ListProjectsResult {
  projects: StitchProject[];
  nextPageToken?: string;
}

export interface CreateProjectResult {
  name: string;
  title: string;
  createTime?: string;
  updateTime?: string;
}

export interface GenerateScreenResult {
  screens: StitchScreen[];
}

export interface EditScreensResult {
  screens: StitchScreen[];
}

export interface GenerateVariantsResult {
  screens: StitchScreen[];
}

export interface ListScreensResult {
  screens: StitchScreen[];
  nextPageToken?: string;
}

export interface GenerateVariantOptions {
  variantCount?: number;
  creativeRange?: 'REFINE' | 'EXPLORE' | 'REIMAGINE';
  aspects?: string[];
}

// ─── JSON-RPC Wire Types ─────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: 'tools/call';
  params: {
    name: string;
    arguments: Record<string, unknown>;
  };
  id: string;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: JsonRpcError;
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class StitchClient {
  private readonly apiKey: string;

  constructor() {
    const key = process.env.STITCH_API_KEY;
    if (!key) {
      throw new Error('STITCH_API_KEY environment variable is required');
    }
    this.apiKey = key;
  }

  private async rpcCall<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
    const requestId = crypto.randomUUID();
    const body: JsonRpcRequest = {
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: requestId,
    };

    logger.debug('Stitch RPC call', { tool: toolName, id: requestId });

    const res = await fetch(STITCH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'X-Goog-Api-Key': this.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new StitchError(
        `Stitch HTTP error: ${res.status} ${res.statusText}`,
        res.status,
        res.status >= 500,
      );
    }

    const json = (await res.json()) as JsonRpcResponse<T>;

    if (json.error !== undefined) {
      const recoverable = json.error.code >= 500 || json.error.code === -32603;
      throw new StitchError(
        `Stitch RPC error (${json.error.code}): ${json.error.message}`,
        json.error.code,
        recoverable,
      );
    }

    if (json.result === undefined) {
      throw new StitchError('Stitch RPC returned no result', -1, false);
    }

    logger.debug('Stitch RPC success', { tool: toolName, id: requestId });
    return json.result;
  }

  listProjects(filter?: string): Promise<ListProjectsResult> {
    const args: Record<string, unknown> = {};
    if (filter !== undefined) args['filter'] = filter;
    return this.rpcCall<ListProjectsResult>('list_projects', args);
  }

  createProject(title?: string): Promise<CreateProjectResult> {
    const args: Record<string, unknown> = {};
    if (title !== undefined) args['title'] = title;
    return this.rpcCall<CreateProjectResult>('create_project', args);
  }

  generateScreen(
    projectId: string,
    prompt: string,
    deviceType?: 'MOBILE' | 'DESKTOP' | 'TABLET' | 'AGNOSTIC',
    modelId?: 'GEMINI_3_PRO' | 'GEMINI_3_FLASH',
  ): Promise<GenerateScreenResult> {
    const args: Record<string, unknown> = { projectId, prompt };
    if (deviceType !== undefined) args['deviceType'] = deviceType;
    if (modelId !== undefined) args['modelId'] = modelId;
    return this.rpcCall<GenerateScreenResult>('generate_screen_from_text', args);
  }

  editScreens(
    projectId: string,
    selectedScreenIds: string[],
    prompt: string,
    deviceType?: string,
    modelId?: string,
  ): Promise<EditScreensResult> {
    const args: Record<string, unknown> = { projectId, selectedScreenIds, prompt };
    if (deviceType !== undefined) args['deviceType'] = deviceType;
    if (modelId !== undefined) args['modelId'] = modelId;
    return this.rpcCall<EditScreensResult>('edit_screens', args);
  }

  generateVariants(
    projectId: string,
    selectedScreenIds: string[],
    prompt: string,
    variantOptions: GenerateVariantOptions,
  ): Promise<GenerateVariantsResult> {
    return this.rpcCall<GenerateVariantsResult>('generate_variants', {
      projectId,
      selectedScreenIds,
      prompt,
      variantOptions,
    });
  }

  getScreen(projectId: string, screenId: string): Promise<StitchScreen> {
    return this.rpcCall<StitchScreen>('get_screen', {
      name: `projects/${projectId}/screens/${screenId}`,
      projectId,
      screenId,
    });
  }

  listScreens(projectId: string): Promise<ListScreensResult> {
    return this.rpcCall<ListScreensResult>('list_screens', { projectId });
  }
}
