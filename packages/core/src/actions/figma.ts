import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('figma-executor');

const FIGMA_API_BASE = 'https://api.figma.com/v1';

/**
 * Figma action executor.
 * Provides read/write access to Figma files via the REST API.
 * Used by the Designer agent to ground PR reviews in Figma source of truth.
 *
 * Actions:
 *   figma:get_file        — Get a Figma file's metadata and structure
 *   figma:get_node        — Get specific nodes from a Figma file
 *   figma:get_images      — Export nodes as PNG/SVG/PDF images
 *   figma:get_components  — List components in a Figma file
 *   figma:get_styles      — List styles (colors, text, effects) in a Figma file
 *   figma:get_variables   — List local variables (design tokens) in a Figma file
 *   figma:get_comments    — List comments on a Figma file
 *   figma:post_comment    — Post a comment on a Figma file
 *
 * Requires: FIGMA_ACCESS_TOKEN env var (Personal Access Token or OAuth token)
 */
export class FigmaExecutor implements ActionExecutor {
  readonly name = 'figma';
  private token: string | null;

  constructor() {
    this.token = process.env.FIGMA_ACCESS_TOKEN || null;

    if (!this.token) {
      logger.warn('FIGMA_ACCESS_TOKEN not configured. Figma actions will be unavailable.');
    }
  }

  // ─── Tool Definitions ─────────────────────────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'figma:get_file',
        description: 'Get a Figma file metadata and page structure. Returns file name, pages, and top-level nodes. Use depth param to control how deep into the node tree to go.',
        parameters: {
          file_key: { type: 'string', description: 'Figma file key (from URL: figma.com/file/<file_key>/...)', required: true },
          depth: { type: 'number', description: 'How deep to traverse the node tree (default: 1, max: 4). Higher = more detail but larger response.' },
        },
      },
      {
        name: 'figma:get_node',
        description: 'Get specific nodes from a Figma file by their IDs. Returns node properties, children, styles, and layout details.',
        parameters: {
          file_key: { type: 'string', description: 'Figma file key', required: true },
          node_ids: { type: 'string', description: 'Comma-separated node IDs (e.g., "1:2,3:4"). Find IDs via get_file or Figma URL hash.', required: true },
          depth: { type: 'number', description: 'How deep to traverse children (default: full depth)' },
        },
      },
      {
        name: 'figma:get_images',
        description: 'Export Figma nodes as images (PNG, SVG, JPG, PDF). Returns download URLs for each node.',
        parameters: {
          file_key: { type: 'string', description: 'Figma file key', required: true },
          node_ids: { type: 'string', description: 'Comma-separated node IDs to export', required: true },
          format: { type: 'string', description: 'Export format: png, svg, jpg, or pdf (default: png)' },
          scale: { type: 'number', description: 'Export scale: 0.01-4.0 (default: 1)' },
        },
      },
      {
        name: 'figma:get_components',
        description: 'List all components published in a Figma file. Returns component names, descriptions, and keys.',
        parameters: {
          file_key: { type: 'string', description: 'Figma file key', required: true },
        },
      },
      {
        name: 'figma:get_styles',
        description: 'List all styles (colors, text styles, effects, grids) in a Figma file. Use to verify design system compliance.',
        parameters: {
          file_key: { type: 'string', description: 'Figma file key', required: true },
        },
      },
      {
        name: 'figma:get_variables',
        description: 'List local variables (design tokens) in a Figma file. Returns variable names, types, values, and collections. Use to compare Figma tokens against CSS custom properties.',
        parameters: {
          file_key: { type: 'string', description: 'Figma file key', required: true },
        },
      },
      {
        name: 'figma:get_comments',
        description: 'List all comments on a Figma file. Returns comment text, author, timestamp, and resolved status.',
        parameters: {
          file_key: { type: 'string', description: 'Figma file key', required: true },
        },
      },
      {
        name: 'figma:post_comment',
        description: 'Post a comment on a Figma file. Optionally pin to a specific location or reply to an existing comment.',
        parameters: {
          file_key: { type: 'string', description: 'Figma file key', required: true },
          message: { type: 'string', description: 'Comment text (supports basic markdown)', required: true },
          node_id: { type: 'string', description: 'Pin comment to a specific node (optional)' },
          x: { type: 'number', description: 'X coordinate for pinned comment (requires node_id)' },
          y: { type: 'number', description: 'Y coordinate for pinned comment (requires node_id)' },
          comment_id: { type: 'string', description: 'Reply to an existing comment by ID (optional)' },
        },
      },
    ];
  }

  // ─── Execute ──────────────────────────────────────────────────────────────

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.token) {
      return { success: false, error: 'FIGMA_ACCESS_TOKEN not configured' };
    }

    const actionName = action.replace('figma:', '');

    try {
      switch (actionName) {
        case 'get_file':
          return await this.getFile(params);
        case 'get_node':
          return await this.getNode(params);
        case 'get_images':
          return await this.getImages(params);
        case 'get_components':
          return await this.getComponents(params);
        case 'get_styles':
          return await this.getStyles(params);
        case 'get_variables':
          return await this.getVariables(params);
        case 'get_comments':
          return await this.getComments(params);
        case 'post_comment':
          return await this.postComment(params);
        default:
          return { success: false, error: `Unknown figma action: ${actionName}` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Figma action ${actionName} failed`, { error: message });
      return { success: false, error: `Figma API error: ${message}` };
    }
  }

  // ─── Health Check ─────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    if (!this.token) return false;
    try {
      const res = await this.figmaFetch('/me');
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── API Methods ──────────────────────────────────────────────────────────

  private async getFile(params: Record<string, unknown>): Promise<ActionResult> {
    const fileKey = params.file_key as string;
    if (!fileKey) return { success: false, error: 'file_key is required' };

    const depth = (params.depth as number) || 1;
    const res = await this.figmaFetch(`/files/${fileKey}?depth=${depth}`);
    const data: any = await res.json();

    if (!res.ok) {
      return { success: false, error: `Figma API ${res.status}: ${data.err || data.message || 'Unknown error'}` };
    }

    return {
      success: true,
      data: {
        name: data.name,
        lastModified: data.lastModified,
        version: data.version,
        pages: data.document?.children?.map((page: any) => ({
          id: page.id,
          name: page.name,
          childCount: page.children?.length || 0,
          children: page.children?.map((child: any) => ({
            id: child.id,
            name: child.name,
            type: child.type,
          })),
        })),
      },
    };
  }

  private async getNode(params: Record<string, unknown>): Promise<ActionResult> {
    const fileKey = params.file_key as string;
    const nodeIds = params.node_ids as string;
    if (!fileKey || !nodeIds) return { success: false, error: 'file_key and node_ids are required' };

    const depth = params.depth !== undefined ? `&depth=${params.depth}` : '';
    const res = await this.figmaFetch(`/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeIds)}${depth}`);
    const data: any = await res.json();

    if (!res.ok) {
      return { success: false, error: `Figma API ${res.status}: ${data.err || data.message || 'Unknown error'}` };
    }

    return { success: true, data: { nodes: data.nodes } };
  }

  private async getImages(params: Record<string, unknown>): Promise<ActionResult> {
    const fileKey = params.file_key as string;
    const nodeIds = params.node_ids as string;
    if (!fileKey || !nodeIds) return { success: false, error: 'file_key and node_ids are required' };

    const format = (params.format as string) || 'png';
    const scale = (params.scale as number) || 1;
    const res = await this.figmaFetch(`/images/${fileKey}?ids=${encodeURIComponent(nodeIds)}&format=${format}&scale=${scale}`);
    const data: any = await res.json();

    if (!res.ok) {
      return { success: false, error: `Figma API ${res.status}: ${data.err || data.message || 'Unknown error'}` };
    }

    return { success: true, data: { images: data.images } };
  }

  private async getComponents(params: Record<string, unknown>): Promise<ActionResult> {
    const fileKey = params.file_key as string;
    if (!fileKey) return { success: false, error: 'file_key is required' };

    const res = await this.figmaFetch(`/files/${fileKey}/components`);
    const data: any = await res.json();

    if (!res.ok) {
      return { success: false, error: `Figma API ${res.status}: ${data.err || data.message || 'Unknown error'}` };
    }

    return {
      success: true,
      data: {
        components: data.meta?.components?.map((c: any) => ({
          key: c.key,
          name: c.name,
          description: c.description,
          node_id: c.node_id,
          containing_frame: c.containing_frame?.name,
        })) || [],
      },
    };
  }

  private async getStyles(params: Record<string, unknown>): Promise<ActionResult> {
    const fileKey = params.file_key as string;
    if (!fileKey) return { success: false, error: 'file_key is required' };

    const res = await this.figmaFetch(`/files/${fileKey}/styles`);
    const data: any = await res.json();

    if (!res.ok) {
      return { success: false, error: `Figma API ${res.status}: ${data.err || data.message || 'Unknown error'}` };
    }

    return {
      success: true,
      data: {
        styles: data.meta?.styles?.map((s: any) => ({
          key: s.key,
          name: s.name,
          description: s.description,
          style_type: s.style_type,
          node_id: s.node_id,
        })) || [],
      },
    };
  }

  private async getVariables(params: Record<string, unknown>): Promise<ActionResult> {
    const fileKey = params.file_key as string;
    if (!fileKey) return { success: false, error: 'file_key is required' };

    const res = await this.figmaFetch(`/files/${fileKey}/variables/local`);
    const data: any = await res.json();

    if (!res.ok) {
      return { success: false, error: `Figma API ${res.status}: ${data.err || data.message || 'Unknown error'}` };
    }

    // Structure the response: collections + variables with resolved values
    const collections = Object.values(data.meta?.variableCollections || {}).map((c: any) => ({
      id: c.id,
      name: c.name,
      modes: c.modes,
      variableIds: c.variableIds,
    }));

    const variables = Object.values(data.meta?.variables || {}).map((v: any) => ({
      id: v.id,
      name: v.name,
      resolvedType: v.resolvedType,
      description: v.description,
      valuesByMode: v.valuesByMode,
      scopes: v.scopes,
    }));

    return {
      success: true,
      data: { collections, variables, variableCount: variables.length },
    };
  }

  private async getComments(params: Record<string, unknown>): Promise<ActionResult> {
    const fileKey = params.file_key as string;
    if (!fileKey) return { success: false, error: 'file_key is required' };

    const res = await this.figmaFetch(`/files/${fileKey}/comments`);
    const data: any = await res.json();

    if (!res.ok) {
      return { success: false, error: `Figma API ${res.status}: ${data.err || data.message || 'Unknown error'}` };
    }

    return {
      success: true,
      data: {
        comments: data.comments?.map((c: any) => ({
          id: c.id,
          message: c.message,
          created_at: c.created_at,
          resolved_at: c.resolved_at,
          user: c.user?.handle,
          order_id: c.order_id,
        })) || [],
      },
    };
  }

  private async postComment(params: Record<string, unknown>): Promise<ActionResult> {
    const fileKey = params.file_key as string;
    const message = params.message as string;
    if (!fileKey || !message) return { success: false, error: 'file_key and message are required' };

    const body: Record<string, unknown> = { message };

    // Pin to specific node + coordinates
    if (params.node_id) {
      body.client_meta = {
        node_id: params.node_id as string,
        node_offset: {
          x: (params.x as number) || 0,
          y: (params.y as number) || 0,
        },
      };
    }

    // Reply to existing comment
    if (params.comment_id) {
      body.comment_id = params.comment_id as string;
    }

    const res = await this.figmaFetch(`/files/${fileKey}/comments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data: any = await res.json();

    if (!res.ok) {
      return { success: false, error: `Figma API ${res.status}: ${data.err || data.message || 'Unknown error'}` };
    }

    return {
      success: true,
      data: {
        comment_id: data.id,
        message: data.message,
        created_at: data.created_at,
      },
    };
  }

  // ─── HTTP Helper ──────────────────────────────────────────────────────────

  private async figmaFetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${FIGMA_API_BASE}${path}`;
    logger.info(`Figma API: ${init?.method || 'GET'} ${path}`);

    return fetch(url, {
      ...init,
      headers: {
        'X-Figma-Token': this.token!,
        'Content-Type': 'application/json',
        ...(init?.headers || {}),
      },
    });
  }
}
