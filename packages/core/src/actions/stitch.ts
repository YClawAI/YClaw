import type { ActionResult, ActionExecutor } from './types.js';
import type { ToolDefinition } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';
import { StitchClient, StitchError } from '../services/stitch-client.js';

const logger = createLogger('stitch-executor');

/**
 * Stitch action executor.
 * Provides access to Google Stitch AI for generating UI screens.
 * Used by the Designer agent to generate visual designs via the Stitch API.
 *
 * Actions:
 *   stitch:create_project          — Create a new Stitch project
 *   stitch:list_projects           — List existing Stitch projects
 *   stitch:generate_screen         — Generate a screen from a text prompt
 *   stitch:edit_screens            — Edit existing screens with a prompt
 *   stitch:generate_variants       — Generate design variants of existing screens
 *   stitch:get_screen              — Get a specific screen's details and code
 *   stitch:list_screens            — List all screens in a project
 *
 * Requires: STITCH_API_KEY env var
 */
export class StitchExecutor implements ActionExecutor {
  readonly name = 'stitch';
  private client: StitchClient | null = null;

  constructor() {
    if (process.env.STITCH_API_KEY) {
      try {
        this.client = new StitchClient();
        logger.info('StitchExecutor initialized');
      } catch (err) {
        logger.warn('Failed to initialize StitchClient', { error: (err as Error).message });
      }
    } else {
      logger.warn('STITCH_API_KEY not configured. Stitch actions will be unavailable.');
    }
  }

  // ─── Health Check ──────────────────────────────────────────────────────────

  async healthCheck(): Promise<boolean> {
    if (!this.client) return false;
    try {
      await this.client.listProjects();
      return true;
    } catch {
      return false;
    }
  }

  // ─── Tool Definitions ─────────────────────────────────────────────────────

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'stitch:create_project',
        description: 'Create a new Google Stitch project for generating UI designs.',
        parameters: {
          title: { type: 'string', description: 'Project title (e.g., "YClaw Landing Page")', required: true },
        },
      },
      {
        name: 'stitch:list_projects',
        description: 'List existing Stitch projects.',
        parameters: {
          filter: { type: 'string', description: 'Optional filter string' },
        },
      },
      {
        name: 'stitch:generate_screen',
        description: 'Generate a UI screen from a text prompt using Google Stitch AI. This is the primary tool for creating visual designs. Include brand guidelines, color tokens, typography, and specific UI requirements in the prompt.',
        parameters: {
          projectId: { type: 'string', description: 'Stitch project ID (from create_project result)', required: true },
          prompt: { type: 'string', description: 'Detailed design prompt including brand guidelines, colors, typography, layout, and content', required: true },
          deviceType: { type: 'string', description: 'Target device: MOBILE, DESKTOP, TABLET, or AGNOSTIC (default: DESKTOP)' },
          modelId: { type: 'string', description: 'Model to use: GEMINI_3_PRO or GEMINI_3_FLASH (default: GEMINI_3_PRO)' },
        },
      },
      {
        name: 'stitch:edit_screens',
        description: 'Edit existing Stitch screens with a prompt. Use to refine generated designs.',
        parameters: {
          projectId: { type: 'string', description: 'Stitch project ID', required: true },
          selectedScreenIds: { type: 'array', description: 'Array of screen IDs to edit', required: true },
          prompt: { type: 'string', description: 'Edit instructions (e.g., "Make the header larger", "Change accent color to amber")', required: true },
          deviceType: { type: 'string', description: 'Target device type' },
          modelId: { type: 'string', description: 'Model to use' },
        },
      },
      {
        name: 'stitch:generate_variants',
        description: 'Generate design variants of existing screens. Use to explore different directions.',
        parameters: {
          projectId: { type: 'string', description: 'Stitch project ID', required: true },
          selectedScreenIds: { type: 'array', description: 'Array of screen IDs to create variants from', required: true },
          prompt: { type: 'string', description: 'Variant direction prompt', required: true },
          variantCount: { type: 'number', description: 'Number of variants to generate (default: 3)' },
          creativeRange: { type: 'string', description: 'How different variants should be: REFINE, EXPLORE, or REIMAGINE' },
        },
      },
      {
        name: 'stitch:get_screen',
        description: 'Get a specific screen including its generated code. Use after generate_screen to retrieve the HTML/CSS/React code.',
        parameters: {
          projectId: { type: 'string', description: 'Stitch project ID', required: true },
          screenId: { type: 'string', description: 'Screen ID to retrieve', required: true },
        },
      },
      {
        name: 'stitch:list_screens',
        description: 'List all screens in a Stitch project.',
        parameters: {
          projectId: { type: 'string', description: 'Stitch project ID', required: true },
        },
      },
    ];
  }

  // ─── Execute ──────────────────────────────────────────────────────────────

  async execute(action: string, params: Record<string, unknown>): Promise<ActionResult> {
    if (!this.client) {
      return {
        success: false,
        error: 'Stitch is not configured. STITCH_API_KEY environment variable is missing.',
      };
    }

    const actionName = action.replace('stitch:', '');
    logger.info('Stitch action', { action: actionName, params: Object.keys(params) });

    try {
      switch (actionName) {
        case 'create_project':
          return this.wrapResult(await this.client.createProject(params.title as string));

        case 'list_projects':
          return this.wrapResult(await this.client.listProjects(params.filter as string | undefined));

        case 'generate_screen':
          return this.wrapResult(
            await this.client.generateScreen(
              params.projectId as string,
              params.prompt as string,
              (params.deviceType as 'MOBILE' | 'DESKTOP' | 'TABLET' | 'AGNOSTIC') ?? 'DESKTOP',
              (params.modelId as 'GEMINI_3_PRO' | 'GEMINI_3_FLASH') ?? 'GEMINI_3_PRO',
            ),
          );

        case 'edit_screens':
          return this.wrapResult(
            await this.client.editScreens(
              params.projectId as string,
              params.selectedScreenIds as string[],
              params.prompt as string,
              params.deviceType as string | undefined,
              params.modelId as string | undefined,
            ),
          );

        case 'generate_variants':
          return this.wrapResult(
            await this.client.generateVariants(
              params.projectId as string,
              params.selectedScreenIds as string[],
              params.prompt as string,
              {
                variantCount: (params.variantCount as number) ?? 3,
                creativeRange: (params.creativeRange as 'REFINE' | 'EXPLORE' | 'REIMAGINE') ?? 'EXPLORE',
              },
            ),
          );

        case 'get_screen':
          return this.wrapResult(
            await this.client.getScreen(params.projectId as string, params.screenId as string),
          );

        case 'list_screens':
          return this.wrapResult(await this.client.listScreens(params.projectId as string));

        default:
          return { success: false, error: `Unknown stitch action: ${actionName}` };
      }
    } catch (err) {
      if (err instanceof StitchError) {
        logger.error('Stitch action failed', { action: actionName, code: err.code, message: err.message });
        return { success: false, error: `Stitch error (${err.code}): ${err.message}` };
      }
      logger.error('Stitch action unexpected error', { action: actionName, error: (err as Error).message });
      return { success: false, error: `Stitch error: ${(err as Error).message}` };
    }
  }

  private wrapResult(data: unknown): ActionResult {
    return { success: true, data: data as Record<string, unknown> };
  }
}
