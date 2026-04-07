import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLogger } from '../logging/logger.js';
import { AgentHubClient } from '../agenthub/client.js';
import type { EventBus } from '../triggers/event.js';
import type {
  Template,
  ChannelConfig,
  DeployResult,
  ExperimentLoop,
  ExperimentResult,
  GrowthEngineConfig,
} from './types.js';
import { ComplianceChecker } from './compliance.js';
import { Mutator } from './mutator.js';
import { Scorer } from './scorer.js';
import { Propagator } from './propagator.js';
import type { BaseChannel } from './channels/base-channel.js';

const log = createLogger('growth-engine');

/** Maximum consecutive mutation failures before pausing the loop */
const MAX_MUTATION_FAILURES = 5;
/** Maximum consecutive compliance rejections before pausing */
const MAX_COMPLIANCE_REJECTIONS = 10;
/** Timeout for waiting for human approval (ms) — 24 hours */
const APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

// ─── ExperimentEngine ─────────────────────────────────────────────────────────

/**
 * Runs autonomous experiment loops across multiple marketing channels.
 *
 * Each channel has its own loop running at its own cadence.
 * AgentHub is the experiment ledger — every variant is a DAG commit,
 * every result is a message board post.
 *
 * Completely independent of Builder, Ember, Scout, etc.
 */
export class ExperimentEngine {
  private readonly agentHub: AgentHubClient;
  private readonly compliance: ComplianceChecker;
  private readonly mutator: Mutator;
  private readonly scorer: Scorer;
  private readonly propagator: Propagator;
  private readonly channels = new Map<string, BaseChannel>();
  private readonly channelConfigs = new Map<string, ChannelConfig>();
  private readonly activeLoops = new Map<string, ExperimentLoop>();
  private readonly loopTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** F1: Pending approval resolvers keyed by "{channel}:{version}" */
  private readonly pendingApprovals = new Map<string, () => void>();
  private baseline = '';
  private stopped = false;

  constructor(
    private readonly config: GrowthEngineConfig,
    private readonly eventBus: EventBus,
  ) {
    this.agentHub = new AgentHubClient({
      baseUrl: config.agentHubUrl,
      apiKey: config.apiKey,
      agentId: config.agentId,
    });

    this.compliance = new ComplianceChecker();
    this.mutator = new Mutator();
    this.scorer = new Scorer(this.agentHub, this.channels);
    this.propagator = new Propagator(this.agentHub);
  }

  /** Register a channel adapter */
  registerChannel(channel: BaseChannel): void {
    this.channels.set(channel.name, channel);
  }

  /**
   * Start the experiment engine.
   *
   * 1. Load baseline.md (shared, immutable)
   * 2. For each registered channel, load config and start loop
   */
  async start(configDir: string): Promise<void> {
    if (this.stopped) return;

    // Load shared baseline
    this.baseline = safeReadFile(join(configDir, 'baseline.md'));
    if (!this.baseline) {
      log.error('baseline.md not found or empty — cannot start experiment engine');
      return;
    }

    log.info('Growth engine starting', {
      channels: [...this.channels.keys()],
      humanApprovalCount: this.config.humanApprovalCount,
    });

    // Subscribe to kill switch events
    this.eventBus.subscribe('strategist:growth_pause', async (event) => {
      const channelName = event.payload?.channel as string | undefined;
      if (channelName) {
        this.pauseChannel(channelName);
      } else {
        this.stopAll();
      }
    });

    this.eventBus.subscribe('strategist:growth_resume', async (event) => {
      const channelName = event.payload?.channel as string | undefined;
      if (channelName) {
        void this.resumeChannel(channelName);
      } else {
        void this.resumeAll();
      }
    });

    // F1: Subscribe to approval events
    this.eventBus.subscribe('strategist:growth_approved', async (event) => {
      const key = event.payload?.approval_key as string | undefined;
      if (key) {
        const resolver = this.pendingApprovals.get(key);
        if (resolver) {
          resolver();
          this.pendingApprovals.delete(key);
          log.info('Approval received', { key });
        }
      }
    });

    // Load each channel's config and start its loop
    for (const [channelName, channel] of this.channels) {
      // F5: Skip channels whose adapters are not implemented
      if (!channel.isImplemented()) {
        log.warn('Channel adapter not yet implemented, skipping', { channel: channelName });
        continue;
      }

      try {
        const channelDir = join(configDir, 'channels', channelName);
        const programMd = safeReadFile(join(channelDir, 'program.md'));
        const templateJson = safeReadFile(join(channelDir, 'template.json'));

        if (!programMd || !templateJson) {
          log.warn('Missing config files for channel, skipping', {
            channel: channelName,
            hasProgram: !!programMd,
            hasTemplate: !!templateJson,
          });
          continue;
        }

        const channelConfig = channel.parseProgram(programMd);
        this.channelConfigs.set(channelName, channelConfig);

        const champion = JSON.parse(templateJson) as Template;

        const loop: ExperimentLoop = {
          channelName,
          champion,
          championScore: -1, // F3: -1 signals "no score yet" — first scored variant auto-wins
          championHash: '',
          variableIndex: 0,
          running: true,
          experimentsRun: 0,
          humanApprovalRemaining: this.config.humanApprovalCount,
        };
        this.activeLoops.set(channelName, loop);

        // F4: Commit initial champion to AgentHub DAG
        const hash = await this.commitToDAG(channelName, champion, 'Initial champion').catch((err) => {
          log.warn('Failed to commit initial champion to DAG', {
            channel: channelName,
            error: (err as Error).message,
          });
          return '';
        });
        loop.championHash = hash;

        // Start the loop (non-blocking)
        this.scheduleNextExperiment(channelName, 0);

        log.info('Channel loop started', {
          channel: channelName,
          goal: channelConfig.goal,
          scoringWindow: `${channelConfig.scoringWindowMs / 3600000}h`,
          cooldown: `${channelConfig.cooldownMs / 3600000}h`,
          variables: channelConfig.variablesToTest,
        });
      } catch (err) {
        log.error('Failed to start channel loop', {
          channel: channelName,
          error: (err as Error).message,
        });
      }
    }

    log.info('Growth engine running', { activeChannels: this.activeLoops.size });
  }

  /** Stop all experiment loops */
  stopAll(): void {
    this.stopped = true;
    for (const [name, timer] of this.loopTimers) {
      clearTimeout(timer);
      log.info('Channel loop stopped', { channel: name });
    }
    this.loopTimers.clear();
    for (const loop of this.activeLoops.values()) {
      loop.running = false;
    }
    // Reject all pending approvals
    for (const resolver of this.pendingApprovals.values()) {
      resolver();
    }
    this.pendingApprovals.clear();
    log.info('Growth engine stopped');
  }

  /** Pause a single channel */
  pauseChannel(channelName: string): void {
    const loop = this.activeLoops.get(channelName);
    if (loop) {
      loop.running = false;
      const timer = this.loopTimers.get(channelName);
      if (timer) {
        clearTimeout(timer);
        this.loopTimers.delete(channelName);
      }
      const scoringTimer = this.loopTimers.get(`${channelName}:scoring`);
      if (scoringTimer) {
        clearTimeout(scoringTimer);
        this.loopTimers.delete(`${channelName}:scoring`);
      }
      log.info('Channel paused', { channel: channelName });
    }
  }

  /** Resume a paused channel */
  async resumeChannel(channelName: string): Promise<void> {
    const loop = this.activeLoops.get(channelName);
    if (loop && !loop.running) {
      loop.running = true;
      this.stopped = false;
      this.scheduleNextExperiment(channelName, 0);
      log.info('Channel resumed', { channel: channelName });
    }
  }

  /** Resume every registered channel after a global pause. */
  resumeAll(): void {
    this.stopped = false;
    let idx = 0;
    for (const [channelName, loop] of this.activeLoops) {
      if (!loop.running) {
        loop.running = true;
      }
      if (!this.loopTimers.has(channelName)) {
        this.scheduleNextExperiment(channelName, idx * 5_000);
        idx++;
      }
    }
    log.info('Growth engine resumed', { activeChannels: this.activeLoops.size });
  }

  /** Get status of all active loops */
  getStatus(): Map<string, ExperimentLoop> {
    return new Map(this.activeLoops);
  }

  /** Return the currently pending approval keys. */
  getPendingApprovalKeys(): string[] {
    return [...this.pendingApprovals.keys()];
  }

  // ─── Experiment Loop ────────────────────────────────────────────────────────

  private scheduleNextExperiment(channelName: string, delayMs: number): void {
    if (this.stopped) return;

    const timer = setTimeout(() => {
      void this.runExperiment(channelName).catch((err) => {
        log.error('Experiment loop error', {
          channel: channelName,
          error: (err as Error).message,
          stack: (err as Error).stack,
        });
      });
    }, delayMs);
    timer.unref();
    this.loopTimers.set(channelName, timer);
  }

  /**
   * Run a single experiment iteration for a channel.
   *
   * 1. MUTATE — Generate variant (change one variable)
   * 2. COMPLIANCE — Check against baseline.md
   * 3. COMMIT — Push variant to AgentHub DAG
   * 4. APPROVAL — Wait for human approval (first N experiments)
   * 5. DEPLOY — Send variant into the world
   * 6. WAIT — Sleep for scoring window
   * 7. SCORE — Pull metrics, compute score
   * 8. DECIDE — Keep or discard
   * 9. SCHEDULE — Cool-down before next experiment
   */
  private async runExperiment(channelName: string): Promise<void> {
    const loop = this.activeLoops.get(channelName);
    const channelConfig = this.channelConfigs.get(channelName);
    if (!loop || !channelConfig || !loop.running) return;

    log.info('Starting experiment', {
      channel: channelName,
      experiment: loop.experimentsRun + 1,
      variableIndex: loop.variableIndex,
      championVersion: loop.champion.version,
    });

    // F7: Check kill switch (fail-closed — AgentHub errors = paused)
    const paused = await this.checkKillSwitch(channelName);
    if (paused) {
      log.info('Kill switch active, pausing channel', { channel: channelName });
      this.pauseChannel(channelName);
      return;
    }

    // 1. MUTATE
    let variant: Template;
    let mutationAttempts = 0;
    let complianceRejections = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!loop.running || this.stopped) return;

      try {
        const insights = await this.propagator.getRecentInsights(5);
        variant = await this.mutator.mutate(
          channelConfig,
          loop.champion,
          loop.variableIndex,
          this.baseline,
          insights,
        );
      } catch (err) {
        mutationAttempts++;
        log.warn('Mutation failed', {
          channel: channelName,
          attempt: mutationAttempts,
          error: (err as Error).message,
        });
        if (mutationAttempts >= MAX_MUTATION_FAILURES) {
          log.error('Too many mutation failures, pausing channel', { channel: channelName });
          this.pauseChannel(channelName);
          return;
        }
        continue;
      }

      // 2. COMPLIANCE
      const complianceResult = await this.compliance.check(variant, this.baseline);
      if (!complianceResult.passed) {
        complianceRejections++;
        await this.agentHub.createPost(
          'alerts',
          `Compliance REJECT on ${channelName}/v${variant.version}: ${complianceResult.reason}`,
        ).catch(() => { /* best-effort */ });

        if (complianceRejections >= MAX_COMPLIANCE_REJECTIONS) {
          log.error('Too many compliance rejections, pausing channel', { channel: channelName });
          this.pauseChannel(channelName);
          return;
        }
        continue;
      }

      break;
    }

    // 3. COMMIT to AgentHub DAG
    const commitHash = await this.commitToDAG(
      channelName,
      variant!,
      `${channelName}/v${variant!.version} — ${variant!.metadata.mutationDescription ?? 'mutation'}`,
    ).catch((err) => {
      log.error('Failed to commit variant to DAG — aborting experiment', {
        channel: channelName,
        error: (err as Error).message,
      });
      return '';
    });

    // F4: Abort if DAG commit failed — experiment ledger is the source of truth
    if (!commitHash) {
      this.scheduleNextExperiment(channelName, channelConfig.cooldownMs);
      return;
    }

    // 4. F1: HUMAN APPROVAL GATE — blocks until approved or timed out
    if (loop.humanApprovalRemaining > 0) {
      const approvalKey = `${channelName}:${variant!.version}`;
      log.info('Human approval required — waiting for approval event', {
        channel: channelName,
        remaining: loop.humanApprovalRemaining,
        approvalKey,
      });

      await this.agentHub.createPost(
        'alerts',
        `APPROVAL NEEDED: ${channelName}/v${variant!.version}\n` +
        `Variable: ${variant!.metadata.mutationVariable}\n` +
        `Change: ${variant!.metadata.mutationDescription}\n` +
        `Remaining approvals: ${loop.humanApprovalRemaining}\n` +
        `Approve via event: strategist:growth_approved { approval_key: "${approvalKey}" }`,
      ).catch(() => { /* best-effort */ });

      const approved = await this.waitForApproval(approvalKey);
      if (!approved || !loop.running || this.stopped) {
        log.warn('Approval timed out or engine stopped — skipping deploy', {
          channel: channelName,
          version: variant!.version,
        });
        this.scheduleNextExperiment(channelName, channelConfig.cooldownMs);
        return;
      }

      loop.humanApprovalRemaining--;
      log.info('Approval granted, proceeding to deploy', {
        channel: channelName,
        version: variant!.version,
        remainingApprovals: loop.humanApprovalRemaining,
      });
    }

    // 5. DEPLOY
    const channel = this.channels.get(channelName)!;
    let deployResult: DeployResult;
    try {
      deployResult = await channel.deploy(variant!);
    } catch (err) {
      log.error('Deploy failed', {
        channel: channelName,
        error: (err as Error).message,
      });
      this.scheduleNextExperiment(channelName, channelConfig.cooldownMs);
      return;
    }

    // 6. WAIT for scoring window
    log.info('Waiting for scoring window', {
      channel: channelName,
      windowMs: channelConfig.scoringWindowMs,
      windowHours: channelConfig.scoringWindowMs / 3600000,
    });

    // Schedule the scoring phase after the scoring window
    const scoringTimer = setTimeout(() => {
      void this.scoreAndDecide(
        channelName,
        channelConfig,
        loop,
        variant!,
        deployResult,
        commitHash,
      ).catch((err) => {
        log.error('Scoring phase failed', {
          channel: channelName,
          error: (err as Error).message,
        });
        this.scheduleNextExperiment(channelName, channelConfig.cooldownMs);
      });
    }, channelConfig.scoringWindowMs);
    scoringTimer.unref();
    this.loopTimers.set(`${channelName}:scoring`, scoringTimer);
  }

  /**
   * F1: Wait for human approval with timeout.
   * Returns true if approved, false if timed out or engine stopped.
   */
  private waitForApproval(approvalKey: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingApprovals.delete(approvalKey);
        resolve(false);
      }, APPROVAL_TIMEOUT_MS);
      timer.unref();

      this.pendingApprovals.set(approvalKey, () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /**
   * Score a deployed variant and decide whether to keep or discard.
   */
  private async scoreAndDecide(
    channelName: string,
    channelConfig: ChannelConfig,
    loop: ExperimentLoop,
    variant: Template,
    deployResult: { deployId: string },
    commitHash: string,
  ): Promise<void> {
    if (!loop.running || this.stopped) return;

    // 7. SCORE
    const score = await this.scorer.score(channelConfig, deployResult.deployId, loop.championScore);

    // 8. DECIDE
    const experimentResult: ExperimentResult = {
      channel: channelName,
      version: variant.version,
      mutationVariable: variant.metadata.mutationVariable,
      mutationDescription: variant.metadata.mutationDescription,
      score: score.value,
      lift: score.lift,
      isWinner: score.isWinner,
      metrics: score.metrics.raw,
      deployId: deployResult.deployId,
      scoredAt: new Date().toISOString(),
    };

    await this.scorer.postResult(experimentResult);

    if (score.isWinner) {
      log.info('New champion!', {
        channel: channelName,
        version: variant.version,
        lift: `+${score.lift.toFixed(1)} pp`,
        variable: variant.metadata.mutationVariable,
      });

      loop.champion = variant;
      loop.championScore = score.value;
      loop.championHash = commitHash;

      // Propagate insight to other channels
      await this.propagator.propagateInsight(channelName, variant, score);
    } else {
      log.info('Variant discarded', {
        channel: channelName,
        version: variant.version,
        lift: `${score.lift.toFixed(1)} pp`,
        variable: variant.metadata.mutationVariable,
      });
    }

    // Advance to next variable (round-robin)
    loop.variableIndex = (loop.variableIndex + 1) % channelConfig.variablesToTest.length;
    loop.experimentsRun++;

    // 9. Schedule next experiment after cool-down
    this.scheduleNextExperiment(channelName, channelConfig.cooldownMs);
  }

  // ─── AgentHub DAG Integration ───────────────────────────────────────────────

  /**
   * F4: Commit a template to the AgentHub DAG as a real git commit.
   * Creates a temporary repo, writes template.json + results.json,
   * bundles it, and pushes to AgentHub.
   */
  private async commitToDAG(
    channelName: string,
    template: Template,
    message: string,
  ): Promise<string> {
    const tmpDir = mkdtempSync(join(tmpdir(), `growth-${channelName}-`));

    try {
      const repoDir = join(tmpDir, 'work');
      mkdirSync(repoDir);
      git(repoDir, 'init');
      git(repoDir, 'config', 'user.email', 'growth-engine@yclaw.ai');
      git(repoDir, 'config', 'user.name', 'growth-engine');

      // If we have a parent hash, fetch and checkout
      const parentHash = this.activeLoops.get(channelName)?.championHash;
      if (parentHash) {
        try {
          const bundlePath = join(tmpDir, 'parent.bundle');
          await this.agentHub.fetchCommit(parentHash, bundlePath);
          AgentHubClient.unbundle(repoDir, bundlePath);
          git(repoDir, 'checkout', parentHash);
        } catch (err) {
          log.warn('Could not fetch parent commit, starting fresh', {
            parentHash,
            error: (err as Error).message,
          });
        }
      }

      // Write template.json
      const channelDir = join(repoDir, channelName);
      mkdirSync(channelDir, { recursive: true });
      writeFileSync(
        join(channelDir, 'template.json'),
        JSON.stringify(template, null, 2),
      );

      git(repoDir, 'add', '-A');

      try {
        git(repoDir, 'commit', '-m', message);
      } catch {
        log.info('Nothing to commit to DAG', { channel: channelName });
        return parentHash ?? '';
      }

      const bundlePath = join(tmpDir, 'push.bundle');
      AgentHubClient.createBundle(repoDir, bundlePath, 'HEAD');
      const pushResult = await this.agentHub.pushBundle(bundlePath);

      if (pushResult.hashes.length === 0) {
        log.warn('DAG push returned no hashes', { channel: channelName });
        return '';
      }

      const hash = pushResult.hashes[pushResult.hashes.length - 1]!;

      // Also post to message board for human readability
      await this.agentHub.createPost(
        `experiments-${channelName}`,
        `Commit ${hash.slice(0, 7)}: ${message}`,
      ).catch(() => { /* best-effort */ });

      log.info('Template committed to AgentHub DAG', {
        channel: channelName,
        version: template.version,
        hash: hash.slice(0, 7),
      });

      return hash;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * F7: Check kill switch — fail-CLOSED on errors.
   * If AgentHub is unreachable, assume paused (safety-first).
   */
  private async checkKillSwitch(channelName: string): Promise<boolean> {
    try {
      const posts = await this.agentHub.readPosts('alerts', 10);
      for (const post of posts) {
        if (post.content.startsWith(`PAUSE:${channelName}`)) {
          return true;
        }
      }
      return false;
    } catch (err) {
      log.warn('Kill switch check failed — pausing channel (fail-closed)', {
        channel: channelName,
        error: (err as Error).message,
      });
      return true;
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function safeReadFile(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    timeout: 30_000,
    encoding: 'utf-8',
    stdio: 'pipe',
  }).trim();
}
