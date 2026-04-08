import { randomUUID } from 'node:crypto';
import { ContextCompressor } from './middleware/context-compressor.js';
import { PromptSnapshotStore } from './prompt-snapshot.js';
import {
  estimateMessagesTokens,
  getContextWindow,
} from '../utils/token-estimator.js';
import type {
  AgentConfig,
  ExecutionRecord,
  ReviewResult,
  ToolDefinition,
} from '../config/schema.js';
import { createProvider, type LLMMessage, type LLMResponse, type ToolCall } from '../llm/provider.js';
import { calculateCacheMetrics, type CacheMetrics } from '../llm/types.js';
import { ContextBuilder } from './context.js';
import { ManifestBuilder } from './manifest.js';
import { ExecutionCacheTracker, toTokenUsage } from './execution-cache-metrics.js';
import { ACTION_SCHEMAS, ACTION_DEFAULTS } from '../actions/schemas.js';
import { SELF_MOD_TOOLS, REVIEW_TOOL } from './tool-definitions.js';
import type { AgentRouter } from './router.js';
import type { SelfModTools } from '../self/tools.js';
import type { SafetyGate } from '../self/safety.js';
import type { ReviewGate } from '../review/reviewer.js';
import type { HumanizationGate } from '../review/humanizer.js';
import type { OutboundSafetyGate } from '../review/outbound-safety.js';
import type { ActionRegistry } from '../actions/types.js';
import type { AuditLog } from '../logging/audit.js';
import type { EventBus } from '../triggers/event.js';
import type { MemoryIndexLike } from '../self/memory-index.js';
import type { DataResolver } from '../data/resolver.js';
import type { MemoryManager } from '@yclaw/memory';
import type { CostTracker } from '../costs/cost-tracker.js';
import type { BudgetEnforcer } from '../costs/budget-enforcer.js';
import type { CheckpointManager } from '../checkpoint/checkpoint-manager.js';
import type { CheckpointState } from '../checkpoint/types.js';
import type { ApprovalManager } from '../approvals/approval-manager.js';
import type { ObjectiveManager } from '../objectives/objective-manager.js';
import type { StaleLoopDetector } from '../objectives/stale-loop-detector.js';
import type { SettingsOverlay } from '../config/settings-overlay.js';
import type { YclawConfig } from '../infrastructure/config-schema.js';
import { resolveCommunicationStyle } from '../config/communication-style.js';
import type { Redis as IORedis } from 'ioredis';
import { createLogger } from '../logging/logger.js';
import { AGENT_IDENTITIES } from '../actions/slack.js';
import { SLACK_CHANNELS, getChannelForAgent as getRoutingChannelForAgent } from '../utils/channel-routing.js';

const MAX_TOOL_ROUNDS = 25;

export class AgentExecutor {
  private contextBuilder: ContextBuilder;
  private manifestBuilder: ManifestBuilder;
  private logger = createLogger('executor');
  // Maps API-safe tool names → original names (e.g., "self_read_config" → "self.read_config")
  private toolNameMap = new Map<string, string>();
  private humanizationGate: HumanizationGate | null = null;
  private router: AgentRouter | null = null;
  private costTracker: CostTracker | null = null;
  private budgetEnforcer: BudgetEnforcer | null = null;
  private checkpointManager: CheckpointManager | null = null;
  private approvalManager: ApprovalManager | null = null;
  private objectiveManager: ObjectiveManager | null = null;
  private staleLoopDetector: StaleLoopDetector | null = null;
  private settingsOverlay: SettingsOverlay | null = null;
  private yclawConfig: YclawConfig | null = null;
  private redis: IORedis | null = null;
  private shuttingDown = false;
  // Tracks active execution state for SIGTERM checkpoint writes
  private activeExecution: {
    agentId: string;
    taskKey: string;
    toolCallsCompleted: number;
    lastToolAction: string;
    partialResult: string;
    startedAt: string;
  } | null = null;

  constructor(
    private auditLog: AuditLog,
    private selfModTools: SelfModTools,
    private safetyGate: SafetyGate,
    private reviewGate: ReviewGate,
    private outboundSafety: OutboundSafetyGate,
    private actionRegistry: ActionRegistry,
    private eventBus: EventBus,
    private memoryIndex?: MemoryIndexLike,
    private dataResolver?: DataResolver,
    private memoryManager?: MemoryManager,
  ) {
    this.contextBuilder = new ContextBuilder();
    this.manifestBuilder = new ManifestBuilder(auditLog);
  }

  setHumanizationGate(gate: HumanizationGate): void {
    this.humanizationGate = gate;
  }

  setRouter(router: AgentRouter): void {
    this.router = router;
  }

  setCostTracker(tracker: CostTracker): void {
    this.costTracker = tracker;
  }

  setBudgetEnforcer(enforcer: BudgetEnforcer): void {
    this.budgetEnforcer = enforcer;
  }

  setCheckpointManager(mgr: CheckpointManager): void {
    this.checkpointManager = mgr;
    this.registerSigtermHandler();
  }

  setApprovalManager(mgr: ApprovalManager): void {
    this.approvalManager = mgr;
  }

  setObjectiveManager(mgr: ObjectiveManager): void {
    this.objectiveManager = mgr;
  }

  setStaleLoopDetector(detector: StaleLoopDetector): void {
    this.staleLoopDetector = detector;
  }

  setSettingsOverlay(overlay: SettingsOverlay): void {
    this.settingsOverlay = overlay;
  }

  setYclawConfig(config: YclawConfig): void {
    this.yclawConfig = config;
  }

  setRedis(redis: IORedis): void {
    this.redis = redis;
  }

  private registerSigtermHandler(): void {
    process.on('SIGTERM', () => {
      this.logger.info('SIGTERM received — will checkpoint after current tool call');
      this.shuttingDown = true;
    });
  }

  async execute(
    config: AgentConfig,
    taskName: string,
    triggerType: string,
    triggerPayload?: Record<string, unknown>,
    modelOverride?: import("../config/schema.js").ModelConfig,
    abortSignal?: AbortSignal,
    promptsOverride?: string[],
    operatorDirective?: string,
  ): Promise<ExecutionRecord> {
    const executionId = randomUUID();
    const sessionId = executionId; // 1:1 mapping for Phase 1
    const agentLogger = createLogger(config.name);

    agentLogger.info(`Starting execution: ${taskName} (trigger: ${triggerType})`);

    const record: ExecutionRecord = {
      id: executionId,
      agent: config.name,
      trigger: triggerType,
      task: taskName,
      startedAt: new Date().toISOString(),
      status: 'running',
      actionsTaken: [],
      selfModifications: [],
    };

    try {
      this.router?.trackExecution(executionId);

      if (this.router?.isShuttingDown) {
        agentLogger.warn('Rejecting execution: shutdown in progress');
        throw new Error('Shutdown in progress');
      }

      // Write 'running' status to Redis for MC dashboard (#430)
      if (this.redis) {
        const nowMs = Date.now();
        this.redis.hset(`agent:status:${config.name}`, { state: 'running', lastRunAt: String(nowMs) })
          .catch((err: unknown) => agentLogger.warn(`Redis status write failed: ${err instanceof Error ? err.message : String(err)}`));
      }

      // Objective pause check — skip execution if the parent objective is paused
      const objectiveId = triggerPayload?.objectiveId as string | undefined;
      if (objectiveId && this.objectiveManager) {
        const paused = await this.objectiveManager.isPaused(objectiveId);
        if (paused) {
          agentLogger.info(`Skipping execution: objective ${objectiveId} is paused`);
          record.status = 'failed';
          record.error = `Objective ${objectiveId} is paused`;
          return record;
        }
      }

      // Budget check — reject execution if agent is over budget
      if (this.budgetEnforcer) {
        const budgetCheck = await this.budgetEnforcer.check(config.name);
        if (!budgetCheck.allowed) {
          agentLogger.warn(`Execution rejected: ${budgetCheck.reason}`);
          record.status = 'failed';
          record.error = budgetCheck.reason;
          return record;
        }
      }
      // Apply Mission Control settings overlay (MongoDB org_settings)
      let effectiveConfig = config;
      let directiveOverride: string | undefined;
      if (this.settingsOverlay) {
        const overrides = await this.settingsOverlay.getAgentOverrides(config.department, config.name);
        if (overrides) {
          directiveOverride = overrides.directive;
          if (overrides.model || overrides.temperature !== undefined) {
            effectiveConfig = {
              ...config,
              model: {
                ...config.model,
                ...(overrides.model ? { model: overrides.model } : {}),
                ...(overrides.temperature !== undefined ? { temperature: overrides.temperature } : {}),
              },
            };
            if (overrides.model) {
              agentLogger.info(`Model overridden by MC: ${config.model.model} → ${overrides.model}`);
            }
            if (overrides.temperature !== undefined) {
              agentLogger.info(`Temperature overridden by MC: ${config.model.temperature} → ${overrides.temperature}`);
            }
          }
        }
      }

      // 0. Resume check — restore context from a previous interrupted execution
      let resumeRound = 0;
      const existingCheckpoint = await this.checkpointManager?.get(config.name, taskName);
      if (existingCheckpoint) {
        resumeRound = existingCheckpoint.toolCallsCompleted;
        agentLogger.info(
          `Resuming from checkpoint: state=${existingCheckpoint.state}, ` +
          `${existingCheckpoint.toolCallsCompleted} tool calls completed, ` +
          `last action: ${existingCheckpoint.lastToolAction}`,
        );
      }

      // Track active execution for SIGTERM checkpoint
      this.activeExecution = {
        agentId: config.name,
        taskKey: taskName,
        toolCallsCompleted: resumeRound,
        lastToolAction: '',
        partialResult: '',
        startedAt: new Date().toISOString(),
      };

      // 1. Resolve data sources (fetch live data before LLM runs)
      let resolvedData: Map<string, unknown> | undefined;
      if (this.dataResolver && config.data_sources?.length) {
        agentLogger.info(`Resolving ${config.data_sources.length} data sources...`);
        try {
          resolvedData = await this.dataResolver.resolve(config.data_sources);
          agentLogger.info(`Resolved ${resolvedData.size} data sources successfully`);
        } catch (err) {
          agentLogger.warn(`Data source resolution failed: ${err}`);
        }
      }

      // 2. Build self-awareness manifest
      const manifest = await this.manifestBuilder.build(effectiveConfig);

      // 3. Load memory categories for prompt context (Postgres-backed)
      // Skip heavy memory loading for lightweight monitoring tasks
      const LIGHTWEIGHT_TASKS = ['heartbeat', 'ack_pr'];
      const skipMemory = LIGHTWEIGHT_TASKS.includes(taskName);
      let memoryCategories: import('@yclaw/memory').Category[] | undefined;
      if (this.memoryManager && !skipMemory) {
        try {
          memoryCategories = await this.memoryManager.getContext({
            agentId: config.name,
            departmentId: config.department,
          });
          agentLogger.info(`Loaded ${memoryCategories.length} memory categories`);
        } catch (err) {
          agentLogger.warn(`Memory category load failed (non-fatal): ${err}`);
        }
      } else if (skipMemory) {
        agentLogger.info(`Skipping memory categories for lightweight task: ${taskName}`);
      }

      // 4. Build context (system prompts + task instruction + auto-recall + memory)
      // Combine MC directive with operator directive (both go into system prompt)
      const combinedDirective = [directiveOverride, operatorDirective]
        .filter(Boolean).join('\n\n') || undefined;

      // 4a. Resolve communication style
      const communicationStyle = resolveCommunicationStyle(
        effectiveConfig.name,
        effectiveConfig.department,
        this.yclawConfig ?? undefined,
        effectiveConfig,
      );

      // 4b. Resolve graph prompt hint — only for agents with vault:graph_query
      const graphPromptHint = Boolean(
        this.yclawConfig?.librarian?.graph?.prompt_hint?.enabled &&
        effectiveConfig.actions.includes('vault:graph_query'),
      );

      let messages = await this.contextBuilder.buildMessages(
        effectiveConfig,
        manifest,
        taskName,
        triggerPayload,
        skipMemory ? undefined : this.memoryIndex,
        memoryCategories,
        promptsOverride,
        combinedDirective,
        communicationStyle,
        graphPromptHint,
      );

      // 5. Inject resolved data into context
      if (resolvedData?.size) {
        const dataBlock = Array.from(resolvedData.entries())
          .map(([name, result]) => `### ${name}\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``)
          .join('\n\n');
        messages.push({
          role: 'user',
          content: `## Live Data (auto-resolved from configured data_sources)\n\n${dataBlock}\n\n> Use this data to complete your task. This data was fetched moments ago and is current.`,
        });
      }

      // 5b. Inject resume context from checkpoint (if resuming)
      if (existingCheckpoint) {
        messages.push({
          role: 'user',
          content: [
            'RESUME CONTEXT: You were previously working on this task and were interrupted.',
            `Here is where you left off: [state=${existingCheckpoint.state}, ` +
            `completed ${existingCheckpoint.toolCallsCompleted} tool calls, ` +
            `last action: ${existingCheckpoint.lastToolAction}].`,
            existingCheckpoint.partialResult
              ? `Partial result so far: ${existingCheckpoint.partialResult}`
              : '',
            'Continue from where you left off. Do NOT repeat already-completed actions.',
          ].filter(Boolean).join(' '),
        });
      }

      // 6. Build tool definitions (actions + self-modification)
      const tools = this.buildToolDefinitions(config);

      // 6b. Store trigger payload as a Resource (Phase 2 audit trail)
      if (this.memoryManager && triggerPayload) {
        try {
          const resource = await this.memoryManager.storeResource(config.name, {
            rawContent: JSON.stringify(triggerPayload),
            sourceType: `trigger:${triggerType}`,
            sourceMetadata: { task: taskName, trigger: triggerType },
            conversationId: sessionId,
          });
          agentLogger.debug(`Trigger stored as resource: ${resource.id}`);
        } catch (err) {
          agentLogger.warn(`Resource store failed (non-fatal): ${err}`);
        }
      }

      // 7. LLM execution loop (with tool use)
      const effectiveModel = modelOverride ?? effectiveConfig.model;
      if (modelOverride) {
        agentLogger.info(`Using trigger-level model override: ${modelOverride.model}`);
      }
      const provider = createProvider(effectiveModel);
      const cacheTracker = new ExecutionCacheTracker(config.name, taskName);

      // Context compression (FF_CONTEXT_COMPRESSION=true to enable)
      const compressionEnabled = process.env['FF_CONTEXT_COMPRESSION'] === 'true';
      const compressor = compressionEnabled ? new ContextCompressor() : null;
      let totalTokensSaved = 0;
      let totalTurnsCompressed = 0;

      // Prompt caching enabled by default — disable with FF_PROMPT_CACHING=false
      const cachingEnabled = process.env['FF_PROMPT_CACHING'] !== 'false';
      let snapshotId: string | undefined;

      if (cachingEnabled) {
        agentLogger.info('Prompt caching enabled — using frozen snapshots + cache_control markers');
      }

      if (cachingEnabled) {
        // Freeze the system prompt — compute hash, store snapshot so every round
        // sends the exact same bytes and Anthropic's cache_control can hit.
        const systemMsg = messages[0];
        if (systemMsg && systemMsg.role === 'system') {
          const snapshotStore = new PromptSnapshotStore();
          const snap = snapshotStore.freeze(sessionId, systemMsg.content);
          snapshotId = snap.snapshotId;
          // Reconstruct to guarantee identical bytes (idempotent for first call)
          messages[0] = { ...systemMsg, content: snap.content };
          agentLogger.info(
            `Prompt snapshot frozen: ${snapshotId} (~${Math.round(systemMsg.content.length / 4)} tokens)`,
          );
        }
      }

      // Execution-scoped dedup cache for read-only actions (e.g., github:get_contents).
      // Prevents the LLM from re-fetching the same file multiple times in one execution.
      const actionResultCache = new Map<string, unknown>();

      let round = resumeRound;

      while (round < MAX_TOOL_ROUNDS) {
        // Check abort signal before each LLM round
        if (abortSignal?.aborted) {
          agentLogger.info('Execution aborted via signal');
          throw new Error('Execution aborted');
        }

        // Maybe compress context before calling the LLM (FF_CONTEXT_COMPRESSION=true)
        if (compressor) {
          const cr = await compressor.maybeCompress(messages, effectiveModel.model, {
            eventBus: this.eventBus,
            agentId: config.name,
          });
          if (cr.compressed) {
            messages = cr.messages;
            totalTokensSaved += cr.tokensSaved;
            totalTurnsCompressed += cr.turnsCompressed;
          }
        }

        round++;
        agentLogger.debug(`LLM round ${round}`);

        // Pre-flight token estimation (FF_PROMPT_CACHING)
        let preflightEstimate: number | undefined;
        if (cachingEnabled) {
          preflightEstimate = estimateMessagesTokens(messages);
          const windowSize = getContextWindow(effectiveModel.model);
          agentLogger.debug(
            `Pre-flight: ~${preflightEstimate} tokens (${Math.round((preflightEstimate / windowSize) * 100)}% of ${windowSize} window)`,
          );
        }

        const llmRoundStart = Date.now();
        const response = await provider.chat(messages, {
          model: effectiveModel.model,
          temperature: effectiveModel.temperature,
          maxTokens: effectiveModel.maxTokens,
          tools,
          cacheStrategy: cachingEnabled ? 'system_and_3' : undefined,
        });

        // Log estimation accuracy for tuning (FF_PROMPT_CACHING)
        if (cachingEnabled && preflightEstimate !== undefined) {
          const actual = response.usage.inputTokens;
          if (actual > 0) {
            const errorPct = Math.round(
              (Math.abs(preflightEstimate - actual) / actual) * 100,
            );
            agentLogger.debug(
              `Token estimation accuracy: predicted ${preflightEstimate}, actual ${actual} (${errorPct}% error)`,
            );
          }
        }

        // Record cost event for this round
        if (this.costTracker) {
          void this.costTracker.record({
            agentId: config.name,
            department: config.department,
            taskType: taskName,
            executionId,
            modelId: effectiveModel.model,
            provider: effectiveModel.provider,
            inputTokens: response.usage.inputTokens,
            outputTokens: response.usage.outputTokens,
            cacheReadTokens: response.usage.cacheReadInputTokens ?? 0,
            cacheWriteTokens: response.usage.cacheCreationInputTokens ?? 0,
            latencyMs: Date.now() - llmRoundStart,
          });
        }

        // Record cache metrics for this round
        cacheTracker.recordRound(response);

        // No tool calls — execution complete
        if (response.toolCalls.length === 0) {
          agentLogger.info('Execution complete (no more tool calls)');
          break;
        }

        // Add assistant message with tool calls
        messages.push({
          role: 'assistant',
          content: response.content,
          toolCalls: response.toolCalls,
        });

        // Process each tool call
        for (const toolCall of response.toolCalls) {
          const result = await this.handleToolCall(
            config,
            toolCall,
            record,
            agentLogger,
            actionResultCache,
          );

          // Truncate large binary data (e.g., base64 images) to prevent context overflow
          const resultForContext = this.truncateToolResult(result as Record<string, unknown>);
          messages.push({
            role: 'tool',
            content: JSON.stringify(resultForContext),
            toolCallId: toolCall.id,
          });
        }

        // Update active execution tracking
        if (this.activeExecution) {
          this.activeExecution.toolCallsCompleted = round;
          const lastTc = response.toolCalls[response.toolCalls.length - 1];
          if (lastTc) {
            this.activeExecution.lastToolAction = this.toolNameMap.get(lastTc.name) || lastTc.name;
          }
          if (response.content) {
            this.activeExecution.partialResult = response.content.slice(-4096);
          }
        }

        // SIGTERM received — write checkpoint and exit gracefully
        if (this.shuttingDown && this.activeExecution) {
          // Only attempt checkpoint if Redis is available
          let saved = false;
          if (this.checkpointManager?.hasRedis) {
            const ecsTaskArn = process.env.ECS_TASK_ARN || '';
            saved = await this.checkpointManager.save({
              agentId: this.activeExecution.agentId,
              taskKey: this.activeExecution.taskKey,
              state: 'in_progress' as CheckpointState,
              toolCallsCompleted: this.activeExecution.toolCallsCompleted,
              lastToolAction: this.activeExecution.lastToolAction,
              partialResult: this.activeExecution.partialResult,
              ecsTaskArn,
              startedAt: this.activeExecution.startedAt,
              checkpointedAt: new Date().toISOString(),
            });
          }
          // Clear flag so if process survives, future executions aren't broken
          this.shuttingDown = false;
          const suffix = saved ? 'checkpointed' : 'no Redis, checkpoint skipped';
          agentLogger.info(
            `Agent ${config.name} shutting down task ${taskName} (${suffix})`,
          );
          throw new Error(`SIGTERM: ${suffix}`);
        }

        // Phase 2: Save checkpoint after each tool round
        if (this.memoryManager) {
          try {
            const currentMetrics = cacheTracker.getCurrentMetrics();
            await this.memoryManager.saveCheckpoint(config.name, sessionId, round, {
              toolCalls: response.toolCalls.map(tc => ({ name: tc.name, id: tc.id })),
              llmOutput: response.content?.substring(0, 2000), // Truncate to save space
              internalState: {
                actionsCount: record.actionsTaken.length,
                selfModsCount: record.selfModifications.length,
                tokens: {
                  input: response.usage.inputTokens,
                  output: response.usage.outputTokens,
                },
                cache: currentMetrics,
              },
            });
          } catch (err) {
            agentLogger.debug(`Checkpoint save failed (non-fatal): ${err}`);
          }
        }
      }

      if (round >= MAX_TOOL_ROUNDS) {
        agentLogger.warn(`Hit max tool rounds (${MAX_TOOL_ROUNDS})`);
      }

      if (totalTurnsCompressed > 0) {
        agentLogger.info(
          `Execution context compression total: ${totalTurnsCompressed} turns, ~${totalTokensSaved} tokens saved`,
        );
      }

      // Finalize cache metrics and attach to execution record
      const cacheResult = cacheTracker.finalize();

      record.status = 'completed';
      record.tokenUsage = toTokenUsage(cacheResult);

      // Objective integration — cost rollup + stale loop detection
      if (objectiveId) {
        // Roll up this execution's cost to the parent objective (scoped by executionId)
        if (this.objectiveManager && this.costTracker) {
          void (async () => {
            try {
              const costCents = await this.costTracker!.getExecutionCostCents(executionId);
              if (costCents > 0) {
                await this.objectiveManager!.rollupCost(objectiveId, costCents);
              }
            } catch (err) {
              agentLogger.warn(`Objective cost rollup failed (non-fatal): ${err}`);
            }
          })();
        }

        // Check for stale loops — fingerprint the execution's actions taken
        if (this.staleLoopDetector && record.actionsTaken.length > 0) {
          const outputFingerprint = JSON.stringify(
            record.actionsTaken.map(a => ({ action: a.action, result: a.result })),
          );
          void this.staleLoopDetector.record({
            objectiveId,
            agentId: config.name,
            taskName,
            output: outputFingerprint,
          }).catch(err => {
            agentLogger.warn(`Stale loop check failed (non-fatal): ${err}`);
          });
        }
      }

      // Clean up checkpoint on successful completion
      if (this.checkpointManager) {
        await this.checkpointManager.delete(config.name, taskName);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      agentLogger.error(`Execution failed: ${errMsg}`);
      record.status = 'failed';
      record.error = errMsg;
    } finally {
      record.completedAt = new Date().toISOString();
      this.activeExecution = null;

      // Update Redis status and execution count for MC dashboard (#430, #552)
      if (this.redis) {
        const nowMs = Date.now();
        const finalState = record.status === 'completed' ? 'idle' : 'error';
        const tsField = record.status === 'completed' ? 'lastSuccessAt' : 'lastErrorAt';
        const statusUpdate: Record<string, string> = { state: finalState };
        statusUpdate[tsField] = String(nowMs);
        this.redis.hset(`agent:status:${config.name}`, statusUpdate)
          .catch((err: unknown) => agentLogger.warn(`Redis status write failed: ${err instanceof Error ? err.message : String(err)}`));
        this.redis.zadd(`agent:executions:${config.name}`, String(nowMs), executionId)
          .catch((err: unknown) => agentLogger.warn(`Redis execution count write failed: ${err instanceof Error ? err.message : String(err)}`));
      }

      // Flush working memory at session end (Phase 1: accept crash data loss)
      if (this.memoryManager) {
        try {
          const flushResult = await this.memoryManager.flushWorkingMemory(
            { agentId: config.name, departmentId: config.department },
            sessionId,
          );
          if (flushResult.flushed > 0) {
            agentLogger.info(
              `Working memory flushed: ${flushResult.stored} stored, ${flushResult.merged ?? 0} merged, ${flushResult.rejected} rejected (of ${flushResult.flushed} facts)`
            );
          }
        } catch (err) {
          agentLogger.warn(`Working memory flush failed (non-fatal): ${err}`);
        }
      }

      // Record execution in audit log
      try {
        await this.auditLog.recordExecution(record);
      } catch (err) {
        this.logger.error('Failed to write audit log', { error: err });
      }

      agentLogger.info(
        `Execution ${record.status}: ${record.actionsTaken.length} actions, ` +
        `${record.selfModifications.length} self-mods`
      );

      this.router?.untrackExecution(executionId);
    }

    return record;
  }



  /**
   * Truncate large binary data in tool results to prevent context overflow.
   * Base64 image/video data can be 400k+ tokens — way over the 200k context limit.
   * We keep a short reference instead of the full blob.
   */
  private truncateToolResult(result: Record<string, unknown>): Record<string, unknown> {
    const MAX_FIELD_LENGTH = 500; // characters, not tokens — conservative
    const truncated = { ...result };

    if (truncated.data && typeof truncated.data === 'object') {
      const data = { ...(truncated.data as Record<string, unknown>) };

      // Truncate known large binary fields
      for (const field of ['imageBase64', 'videoBase64', 'audioBase64']) {
        if (typeof data[field] === 'string' && (data[field] as string).length > MAX_FIELD_LENGTH) {
          const original = data[field] as string;
          data[field] = `[BASE64_DATA:${original.length} chars — use github:commit_file to save]`;
          // Store a flag so the agent knows the data was generated successfully
          data[`${field}_generated`] = true;
          data[`${field}_size`] = original.length;
        }
      }

      // Truncate allImages array if present
      if (Array.isArray(data.allImages)) {
        data.allImages = `[${(data.allImages as string[]).length} images generated — truncated from context]`;
      }

      // Generic safety net: truncate any string field over 10k chars
      for (const [key, value] of Object.entries(data)) {
        if (typeof value === 'string' && value.length > 10000 && !key.endsWith('_generated') && !key.endsWith('_size')) {
          data[key] = `[TRUNCATED:${value.length} chars]`;
        }
      }

      truncated.data = data;
    }

    return truncated;
  }

  private async handleToolCall(
    config: AgentConfig,
    toolCall: ToolCall,
    record: ExecutionRecord,
    agentLogger: ReturnType<typeof createLogger>,
    actionResultCache?: Map<string, unknown>,
  ): Promise<unknown> {
    // Desanitize the API-safe name back to the original (e.g., "self_read_config" → "self.read_config")
    const name = this.toolNameMap.get(toolCall.name) || toolCall.name;
    const args = toolCall.arguments;

    agentLogger.debug(`Tool call: ${name}`, { args });

    // Self-modification tools
    if (name.startsWith('self.')) {
      return this.handleSelfModTool(config, name, args, record, agentLogger);
    }

    // Review submission
    if (name === 'submit_for_review') {
      return this.handleReviewSubmission(config, args, record, agentLogger);
    }

    // Action execution
    if (name.includes(':')) {
      return this.handleAction(config, name, args, record, agentLogger, actionResultCache);
    }

    agentLogger.warn(`Unknown tool: ${name}`);
    return { error: `Unknown tool: ${name}` };
  }

  private async handleSelfModTool(
    config: AgentConfig,
    toolName: string,
    args: Record<string, unknown>,
    record: ExecutionRecord,
    agentLogger: ReturnType<typeof createLogger>,
  ): Promise<unknown> {
    const method = toolName.replace('self.', '');

    // Read-only tools — always allowed
    const readOnlyMethods = [
      'read_config', 'read_prompt', 'read_source', 'read_history',
      'read_org_chart', 'memory_read', 'search_memory',
    ];

    if (readOnlyMethods.includes(method)) {
      return this.selfModTools.execute(config.name, method, args);
    }

    // Write tools — go through safety gate
    const modification = {
      id: randomUUID(),
      agent: config.name,
      type: this.mapMethodToModType(method),
      description: `${config.name} called self.${method}`,
      changes: args,
      safetyLevel: this.safetyGate.classify(method, args),
      status: 'pending' as const,
      timestamp: new Date().toISOString(),
    };

    const approved = await this.safetyGate.evaluate(modification);

    if (!approved) {
      agentLogger.warn(`Self-modification denied: ${method}`, { args });
      record.selfModifications.push({
        type: method,
        description: modification.description,
        approved: false,
      });
      return { error: 'Modification denied by safety gate', safetyLevel: modification.safetyLevel };
    }

    const result = await this.selfModTools.execute(config.name, method, args);

    record.selfModifications.push({
      type: method,
      description: modification.description,
      approved: true,
    });

    // Audit the modification
    try {
      await this.auditLog.recordSelfModification({
        ...modification,
        status: 'applied',
        appliedAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.error('Failed to audit self-modification', { error: err });
    }

    agentLogger.info(`Self-modification applied: ${method}`);
    return result;
  }

  private async handleReviewSubmission(
    config: AgentConfig,
    args: Record<string, unknown>,
    record: ExecutionRecord,
    agentLogger: ReturnType<typeof createLogger>,
  ): Promise<unknown> {
    let content = args.content as string;
    const contentType = args.contentType as string;
    const targetPlatform = args.targetPlatform as string;

    // Check if this content type bypasses review
    if (config.review_bypass.includes(contentType)) {
      agentLogger.info(`Review bypassed for content type: ${contentType}`);
      return { approved: true, bypassed: true };
    }

    // Humanization pass — rewrite AI patterns before review (fail-open)
    let humanizationMeta: Record<string, unknown> | undefined;
    if (config.humanize && this.humanizationGate) {
      const humanResult = await this.humanizationGate.humanize({
        content,
        agent: config.name,
        contentType,
        targetPlatform,
        metadata: args.metadata as Record<string, unknown> | undefined,
      });
      if (humanResult.changed) {
        agentLogger.info(
          `Content humanized — ${humanResult.patternsFound.length} pattern(s) rewritten`
        );
        humanizationMeta = {
          originalContent: humanResult.original,
          patternsFound: humanResult.patternsFound,
          humanizedAt: humanResult.humanizedAt,
        };
        content = humanResult.humanized;
      }
    }

    const reviewRequest = {
      id: randomUUID(),
      agent: config.name,
      contentType,
      content,
      targetPlatform,
      metadata: {
        ...(args.metadata as Record<string, unknown> | undefined),
        ...(humanizationMeta ? { humanization: humanizationMeta } : {}),
      } as Record<string, unknown> | undefined,
      timestamp: new Date().toISOString(),
    };

    const result = await this.reviewGate.review(reviewRequest);

    record.reviewResult = {
      approved: result.approved,
      flags: result.flags,
      severity: result.severity,
      rewrite: result.rewrite,
    };

    // Audit the review
    try {
      await this.auditLog.recordReview(reviewRequest, result);
    } catch (err) {
      this.logger.error('Failed to audit review', { error: err });
    }

    agentLogger.info(
      `Review result: ${result.approved ? 'approved' : 'flagged'}` +
      (result.flags.length ? ` (${result.flags.join(', ')})` : '')
    );

    return result;
  }

  private async handleAction(
    config: AgentConfig,
    actionName: string,
    args: Record<string, unknown>,
    record: ExecutionRecord,
    agentLogger: ReturnType<typeof createLogger>,
    actionResultCache?: Map<string, unknown>,
  ): Promise<unknown> {
    // Unwrap nested `params` object — the generic (untyped) tool schema defines
    // a single `params` parameter, so the LLM wraps actual params inside args.params.
    // Typed schemas send params directly at the top level — skip unwrap for those.
    if (args.params && typeof args.params === 'object' && !Array.isArray(args.params)) {
      args = args.params as Record<string, unknown>;
    }

    // Inject defaults for typed actions (e.g., owner/repo for GitHub)
    const defaults = ACTION_DEFAULTS[actionName];
    if (defaults) {
      for (const [key, value] of Object.entries(defaults)) {
        if (args[key] === undefined || args[key] === null || args[key] === '') {
          args[key] = value;
        }
      }
    }

    // Verify agent has permission for this action
    const actionPrefix = actionName.split(':')[0] + ':*';
    const hasPermission = config.actions.some(
      a => a === actionName || a === actionPrefix || a.startsWith(actionName.split(':')[0] + ':')
    );

    if (!hasPermission) {
      agentLogger.warn(`Unauthorized action: ${actionName}`);
      record.actionsTaken.push({
        action: actionName,
        result: 'failure',
        details: { error: 'Unauthorized action' },
      });
      return { error: `Agent ${config.name} is not authorized to execute ${actionName}` };
    }

    // Outbound safety check — block exploited agents before they reach external services
    const safetyResult = await this.outboundSafety.check(config.name, actionName, args);
    if (!safetyResult.safe) {
      agentLogger.warn(`Action blocked by outbound safety: ${actionName}`, {
        reason: safetyResult.reason,
        details: safetyResult.details,
      });
      record.actionsTaken.push({
        action: actionName,
        result: 'failure',
        details: { error: `Blocked by outbound safety: ${safetyResult.reason}` },
      });
      return { error: `Action blocked by safety gate: ${safetyResult.reason}` };
    }

    // Approval gate check — intercept high-impact actions before execution
    if (this.approvalManager) {
      // Estimate running cost for cost-based auto-gating
      let runningCostCents: number | undefined;
      if (this.costTracker) {
        try {
          const costs = await this.costTracker.queryCosts({ agentId: config.name });
          runningCostCents = costs.totalCents;
        } catch {
          // Non-fatal — cost estimation failure shouldn't block the approval check
        }
      }
      const estimatedCostCents = typeof args.estimatedCostCents === 'number'
        ? args.estimatedCostCents
        : (runningCostCents ?? 0);

      const gate = this.approvalManager.requiresApproval(actionName, estimatedCostCents);
      if (gate) {
        const reasoning = typeof args.reasoning === 'string'
          ? args.reasoning
          : `Agent ${config.name} requested ${actionName}`;

        try {
          const requestId = await this.approvalManager.createRequest({
            actionType: actionName,
            agentId: config.name,
            department: config.department,
            payload: args,
            reasoning,
            estimatedCostCents,
            gate,
          });

          agentLogger.info(`Action gated for approval: ${actionName}`, { requestId, riskLevel: gate.riskLevel });
          record.actionsTaken.push({
            action: actionName,
            result: 'failure',
            details: { approvalPending: true, requestId, gatedAction: actionName },
          });

          return {
            success: true,
            data: {
              approvalPending: true,
              requestId,
              message: `Your request for ${actionName} is pending approval. Request ID: ${requestId}`,
            },
          };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          agentLogger.warn(`Approval request creation failed: ${errMsg}`);
          // Fail-closed: if we can't create the approval request, block the action
          record.actionsTaken.push({
            action: actionName,
            result: 'failure',
            details: { error: `Approval gate error: ${errMsg}` },
          });
          return { error: `Approval gate error: ${errMsg}` };
        }
      }
    }

    // Auto-inject agent identity for Slack actions (chat:write.customize)
    if (actionName.startsWith('slack:')) {
      const identity = AGENT_IDENTITIES[config.name];
      if (identity) {
        if (!args.username) args.username = identity.username;
        if (!args.icon_emoji) args.icon_emoji = identity.icon_emoji;
      }
      // Default channel to the agent's department channel if not specified.
      // Resolve via channel-routing so SLACK_CHANNEL_* env overrides apply.
      if (!args.channel) {
        const fromEnv = getRoutingChannelForAgent(config.name, 'slack');
        const fallback = SLACK_CHANNELS[config.department as keyof typeof SLACK_CHANNELS];
        const resolved = fromEnv || fallback;
        if (resolved) args.channel = resolved;
      }
    }

    // Same default-channel behavior for direct discord:* action calls so
    // agents can emit `discord:message` without hardcoding a channel ID.
    if (actionName.startsWith('discord:') && !args.channel) {
      const resolved = getRoutingChannelForAgent(config.name, 'discord');
      if (resolved) args.channel = resolved;
    }

    // Dedup read-only actions within a single execution (e.g., github:get_contents)
    const CACHEABLE_ACTIONS = ['github:get_contents'];
    const cacheKey = CACHEABLE_ACTIONS.includes(actionName)
      ? `${actionName}:${args.owner ?? ''}/${args.repo ?? ''}:${args.path ?? ''}:${args.ref ?? ''}`
      : undefined;

    if (cacheKey && actionResultCache?.has(cacheKey)) {
      agentLogger.info(`Action cache hit (skipping duplicate fetch): ${actionName}`, { path: args.path });
      record.actionsTaken.push({
        action: actionName,
        result: 'success',
        details: { cached: true, path: args.path },
      });
      return actionResultCache.get(cacheKey);
    }

    const result = await this.actionRegistry.execute(actionName, args);

    // Cache successful read-only results for dedup
    if (cacheKey && result.success && actionResultCache) {
      actionResultCache.set(cacheKey, result);
    }

    record.actionsTaken.push({
      action: actionName,
      result: result.success ? 'success' : 'failure',
      details: result.data || (result.error ? { error: result.error } : undefined),
    });

    if (result.success) {
      agentLogger.info(`Action executed: ${actionName}`);
    } else {
      agentLogger.warn(`Action failed: ${actionName}`, { error: result.error });
    }

    return result;
  }

  /**
   * Sanitize a tool name to be API-safe: replace . and : with _
   * Anthropic requires tool names matching ^[a-zA-Z0-9_-]{1,128}$
   */
  private sanitizeToolName(name: string): string {
    const sanitized = name.replace(/[.:]/g, '_');
    this.toolNameMap.set(sanitized, name);
    return sanitized;
  }

  private buildToolDefinitions(config: AgentConfig): ToolDefinition[] {
    // Don't clear — concurrent executions share this map. Entries are deterministic
    // (same action name always produces same sanitized name) so accumulation is safe.
    const tools: ToolDefinition[] = [];

    // Self-modification tools (available to all agents)
    for (const tool of SELF_MOD_TOOLS) {
      tools.push({ ...tool, name: this.sanitizeToolName(tool.name) });
    }

    // Review submission tool (already API-safe, but register in map)
    tools.push({ ...REVIEW_TOOL, name: this.sanitizeToolName(REVIEW_TOOL.name) });

    // Action tools (based on agent's config)
    for (const action of config.actions) {
      const schema = ACTION_SCHEMAS[action];
      if (schema) {
        // Typed schema available — LLM sees individual parameters
        tools.push({
          name: this.sanitizeToolName(action),
          description: schema.description,
          parameters: schema.parameters,
        });
      } else {
        // Fallback for untyped actions — generic params object
        const [prefix, method] = action.split(':');
        tools.push({
          name: this.sanitizeToolName(action),
          description: `Execute ${prefix} action: ${method}`,
          parameters: {
            params: {
              type: 'object',
              description: `Parameters for ${action}`,
              required: true,
            },
          },
        });
      }
    }

    // Event publish tool
    if (!config.actions.includes('event:publish')) {
      tools.push({
        name: this.sanitizeToolName('event:publish'),
        description: 'Publish an event to the event bus for other agents to consume',
        parameters: {
          source: { type: 'string', description: 'Event source (your agent name)', required: true },
          type: { type: 'string', description: 'Event type', required: true },
          payload: { type: 'object', description: 'Event payload data', required: true },
        },
      });
    }

    return tools;
  }

  private mapMethodToModType(method: string): 'config' | 'prompt' | 'tool' | 'code' | 'schedule' | 'model' | 'memory' | 'new_agent' {
    const map: Record<string, 'config' | 'prompt' | 'tool' | 'code' | 'schedule' | 'model' | 'memory' | 'new_agent'> = {
      update_config: 'config',
      update_prompt: 'prompt',
      update_schedule: 'schedule',
      update_model: 'model',
      memory_write: 'memory',
      cross_write_memory: 'memory',
      request_new_data_source: 'config',
    };
    return map[method] || 'config';
  }
}
