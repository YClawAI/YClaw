import { createLogger } from '../logging/logger.js';
import { CacheObserver } from '../logging/cache-observer.js';
import { SelfModTools } from '../self/tools.js';
import { SafetyGate } from '../self/safety.js';
import { ReviewGate } from '../review/reviewer.js';
import { HumanizationGate } from '../review/humanizer.js';
import { OutboundSafetyGate } from '../review/outbound-safety.js';
import { DataResolver } from '../data/resolver.js';
import { ActionRegistryImpl } from '../actions/registry.js';
import { TwitterExecutor } from '../actions/twitter.js';
import { TelegramExecutor } from '../actions/telegram.js';
import { SlackExecutor } from '../actions/slack.js';
import { DiscordExecutor } from '../actions/discord.js';
import type { DiscordChannelAdapter } from '../adapters/channels/DiscordChannelAdapter.js';
import { GitHubExecutor } from '../actions/github/index.js';
import { EmailExecutor } from '../actions/email.js';
import { EventActionExecutor } from '../actions/event.js';
import { CodegenExecutor } from '../actions/codegen.js';
import { DeployExecutor } from '../actions/deploy/index.js';
import { RepoExecutor } from '../actions/repo.js';
import { XSearchExecutor } from '../actions/x-search.js';
import { FluxExecutor } from '../actions/flux.js';
import { FigmaExecutor } from '../actions/figma.js';
import { StitchExecutor } from '../actions/stitch.js';
import { VideoExecutor } from '../actions/video.js';
import { TaskExecutor } from '../actions/task.js';
import { VaultExecutor } from '../actions/vault.js';
import { VaultReader } from '../knowledge/vault-reader.js';
import { Redis as IORedis } from 'ioredis';
import type { ServiceContext } from './services.js';

const logger = createLogger('bootstrap:actions');

export interface ActionContext {
  actionRegistry: ActionRegistryImpl;
  selfModTools: SelfModTools;
  safetyGate: SafetyGate;
  reviewGate: ReviewGate;
  humanizationGate: HumanizationGate;
  outboundSafety: OutboundSafetyGate;
  dataResolver: DataResolver;
  cacheObserver: CacheObserver;
}

export async function initActions(services: ServiceContext): Promise<ActionContext> {
  const { auditLog, agentMemory, memoryIndex, eventBus, repoRegistry, deployRedis } = services;

  // ─── Core Systems ────────────────────────────────────────────────────
  const selfModTools = new SelfModTools(auditLog, agentMemory, memoryIndex);
  const safetyGate = new SafetyGate();
  const reviewGate = new ReviewGate();
  await reviewGate.initialize();
  const humanizationGate = new HumanizationGate();
  await humanizationGate.initialize();
  const outboundSafety = new OutboundSafetyGate();
  const dataResolver = new DataResolver();
  const cacheObserver = new CacheObserver(auditLog);

  // ─── Action Registry ─────────────────────────────────────────────────
  const actionRegistry = new ActionRegistryImpl();

  actionRegistry.register('twitter', new TwitterExecutor());
  actionRegistry.register('telegram', new TelegramExecutor());

  // Slack dedup Redis
  let slackDedupRedis: IORedis | null = null;
  const slackRedisUrl = process.env.REDIS_URL;
  if (slackRedisUrl && (slackRedisUrl.startsWith('redis://') || slackRedisUrl.startsWith('rediss://'))) {
    try {
      slackDedupRedis = new IORedis(slackRedisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
      await slackDedupRedis.connect();
      logger.info('Slack dedup Redis connected');
    } catch (redisErr) {
      logger.warn('Slack dedup Redis unavailable — dedup disabled', {
        error: redisErr instanceof Error ? redisErr.message : String(redisErr),
      });
      slackDedupRedis = null;
    }
  }

  actionRegistry.register('slack', new SlackExecutor(slackDedupRedis));

  // ─── Discord Executor ────────────────────────────────────────────────
  // Reuse the shared DiscordChannelAdapter created by InfrastructureFactory
  // so we do not open a second Discord gateway connection. The adapter is
  // auto-enabled when DISCORD_BOT_TOKEN is set; when the token is absent we
  // skip registration entirely. Redis (if available) is shared with Slack
  // for dedup and rate-limit state.
  const discordAdapter = services.infrastructure?.channels.get('discord') as
    | DiscordChannelAdapter
    | undefined;
  if (discordAdapter) {
    actionRegistry.register('discord', new DiscordExecutor(discordAdapter, slackDedupRedis));
    logger.info('Discord executor registered (sharing adapter from infrastructure.channels)');
  } else {
    logger.info('Discord executor skipped — no shared DiscordChannelAdapter (set DISCORD_BOT_TOKEN to enable)');
  }

  actionRegistry.register('github', new GitHubExecutor());
  actionRegistry.register('email', new EmailExecutor());
  actionRegistry.register('event', new EventActionExecutor(eventBus));
  actionRegistry.register('codegen', new CodegenExecutor(auditLog, repoRegistry));
  actionRegistry.register('deploy', new DeployExecutor(auditLog, repoRegistry, outboundSafety, eventBus, deployRedis ?? undefined));
  actionRegistry.register('repo', new RepoExecutor(repoRegistry));
  actionRegistry.register('x', new XSearchExecutor());
  actionRegistry.register('flux', new FluxExecutor());
  actionRegistry.register('figma', new FigmaExecutor());
  actionRegistry.register('stitch', new StitchExecutor());
  actionRegistry.register('video', new VideoExecutor());
  actionRegistry.register('task', new TaskExecutor(process.env.REDIS_URL));

  // Vault executor — optional, requires VAULT_PATH env var
  const vaultPath = process.env.VAULT_PATH;
  if (vaultPath) {
    const vaultReader = new VaultReader({ vaultBasePath: vaultPath });
    const vaultExecutor = new VaultExecutor(vaultReader, vaultPath);
    if (services.knowledgeGraph) {
      vaultExecutor.setGraphService(services.knowledgeGraph);
      logger.info('Vault graph query enabled');
    }
    actionRegistry.register('vault', vaultExecutor);
    logger.info('Vault executor registered', { vaultPath });
  } else {
    logger.info('Vault executor skipped — VAULT_PATH not set');
  }

  logger.info('Action executors registered');

  return {
    actionRegistry, selfModTools, safetyGate, reviewGate,
    humanizationGate, outboundSafety, dataResolver, cacheObserver,
  };
}
