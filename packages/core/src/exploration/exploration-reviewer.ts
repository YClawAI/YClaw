import { createLogger } from '../logging/logger.js';
import { createProvider } from '../llm/provider.js';
import type { LLMMessage } from '../llm/types.js';
import type { AgentHubClient } from '../agenthub/client.js';
import { AgentHubPromoter } from '../agenthub/promoter.js';
import type { Commit, ExplorationTask, ReviewResult } from '../agenthub/types.js';

// ─── ExplorationReviewer ───────────────────────────────────────────────────

/**
 * Compares competing approaches and picks a winner.
 *
 * STANDALONE reviewer — does NOT extend or import Architect's reviewer.
 * Operates purely on AgentHub data (commits, diffs, message board).
 *
 * Its ONLY output to the existing pipeline is: opening a GitHub PR via the promoter.
 */
export class ExplorationReviewer {
  private readonly log = createLogger('exploration-reviewer');
  private readonly promoter: AgentHubPromoter;

  constructor(
    private readonly agentHub: AgentHubClient,
    githubToken: string,
  ) {
    this.promoter = new AgentHubPromoter(agentHub, githubToken);
  }

  async review(task: ExplorationTask): Promise<ReviewResult> {
    this.log.info('Starting review', {
      taskId: task.taskId,
      rootHash: task.rootHash.slice(0, 7),
    });

    // 1. Get all leaves and filter to those descending from our root
    const allLeaves = await this.agentHub.getLeaves();
    const taskLeaves = await this.filterByLineage(allLeaves, task.rootHash);

    if (taskLeaves.length === 0) {
      this.log.warn('No leaves found for task', { taskId: task.taskId });
      return { decision: 'rejected', rationale: 'No approaches were submitted.' };
    }

    // 2. Fetch diffs from root for each leaf
    const approaches: Array<{
      leaf: Commit;
      diff: string;
    }> = [];

    for (const leaf of taskLeaves) {
      try {
        const diff = await this.agentHub.diff(task.rootHash, leaf.hash);
        approaches.push({ leaf, diff });
      } catch (err) {
        this.log.warn('Failed to get diff for leaf', {
          hash: leaf.hash.slice(0, 7),
          error: (err as Error).message,
        });
      }
    }

    if (approaches.length === 0) {
      return { decision: 'rejected', rationale: 'Could not retrieve diffs for any approach.' };
    }

    // 3. Feed approaches to LLM for comparative review
    const llmDecision = await this.comparativeReview(task, approaches);

    // 4. Post decision to #build-decisions
    const approachSummaries = approaches.map((a) =>
      `- \`${a.leaf.hash.slice(0, 7)}\` by ${a.leaf.agent_id}: ${a.leaf.message}`
    ).join('\n');

    const decisionPost = `## Exploration Review — ${task.description}\n\n` +
      `Reviewed ${approaches.length} approaches:\n${approachSummaries}\n\n` +
      `**Decision: ${llmDecision.decision.toUpperCase()}` +
      (llmDecision.winnerHash ? ` commit \`${llmDecision.winnerHash.slice(0, 7)}\`` : '') +
      `**\n\nReason: ${llmDecision.rationale}`;

    await this.agentHub.createPost('build-decisions', decisionPost).catch((err) => {
      this.log.warn('Failed to post review decision', { error: (err as Error).message });
    });

    // 5. Act on decision
    if (llmDecision.decision === 'promoted' && llmDecision.winnerHash) {
      try {
        const { prNumber, prUrl } = await this.promoter.promote({
          winningHash: llmDecision.winnerHash,
          taskId: task.taskId,
          taskDescription: task.description,
          targetRepo: task.targetRepo,
          targetBranch: task.targetBranch,
          reviewDecision: llmDecision.rationale,
          competingApproaches: approaches.map((a) => ({
            hash: a.leaf.hash,
            agent: a.leaf.agent_id,
            message: a.leaf.message,
          })),
        });

        return {
          decision: 'promoted',
          prUrl,
          prNumber,
          rationale: llmDecision.rationale,
        };
      } catch (err) {
        this.log.error('Promotion failed', { error: (err as Error).message });
        return {
          decision: 'rejected',
          rationale: `Promotion failed: ${(err as Error).message}`,
        };
      }
    }

    return {
      decision: llmDecision.decision,
      rationale: llmDecision.rationale,
    };
  }

  /**
   * Filter leaves to those that descend from the given root hash.
   */
  private async filterByLineage(leaves: Commit[], rootHash: string): Promise<Commit[]> {
    const results: Commit[] = [];
    for (const leaf of leaves) {
      try {
        const lineage = await this.agentHub.getLineage(leaf.hash);
        if (lineage.some((c) => c.hash === rootHash)) {
          results.push(leaf);
        }
      } catch {
        // Skip leaves we can't trace
      }
    }
    return results;
  }

  /**
   * Use LLM to compare approaches and pick a winner.
   */
  private async comparativeReview(
    task: ExplorationTask,
    approaches: Array<{ leaf: Commit; diff: string }>,
  ): Promise<{ decision: 'promoted' | 'changes_requested' | 'rejected'; winnerHash?: string; rationale: string }> {
    const provider = createProvider({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      temperature: 0.1,
      maxTokens: 4096,
    });

    // Build comparison prompt
    let approachesText = '';
    for (let i = 0; i < approaches.length; i++) {
      const a = approaches[i]!;
      approachesText += `### Approach ${String.fromCharCode(65 + i)} — ${a.leaf.agent_id} (commit ${a.leaf.hash.slice(0, 7)})\n`;
      approachesText += `Message: ${a.leaf.message}\n\n`;
      approachesText += `\`\`\`diff\n${a.diff.slice(0, 8000)}\n\`\`\`\n\n`;
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `You are an expert code reviewer. Compare competing approaches to a coding task and make a decision.

Respond in this exact JSON format:
\`\`\`json
{
  "decision": "promoted" | "changes_requested" | "rejected",
  "winnerIndex": <0-based index of the best approach, or null>,
  "rationale": "Clear explanation of your decision"
}
\`\`\`

Decision guide:
- "promoted": One approach is clearly good enough to ship as a PR.
- "changes_requested": Approaches have potential but need improvement.
- "rejected": All approaches are fundamentally flawed.`,
      },
      {
        role: 'user',
        content: `## Task: ${task.description}\n\n${approachesText}\n\nCompare these approaches on: correctness, architecture, performance, readability. Pick the best one or reject all.`,
      },
    ];

    const result = await provider.chat(messages, {
      model: 'claude-sonnet-4-6',
      temperature: 0.1,
      maxTokens: 4096,
    });

    // Parse the LLM decision
    const fenceMatch = result.content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = fenceMatch ? fenceMatch[1]! : result.content;

    try {
      const parsed = JSON.parse(jsonStr) as {
        decision?: string;
        winnerIndex?: number | null;
        rationale?: string;
      };

      const decision = (['promoted', 'changes_requested', 'rejected'].includes(parsed.decision ?? '')
        ? parsed.decision as 'promoted' | 'changes_requested' | 'rejected'
        : 'rejected');

      const winnerHash = (
        decision === 'promoted' &&
        parsed.winnerIndex != null &&
        parsed.winnerIndex >= 0 &&
        parsed.winnerIndex < approaches.length
      )
        ? approaches[parsed.winnerIndex]!.leaf.hash
        : undefined;

      return {
        decision,
        winnerHash,
        rationale: parsed.rationale ?? 'No rationale provided.',
      };
    } catch {
      this.log.warn('Failed to parse review LLM response', {
        contentLength: result.content.length,
      });
      return {
        decision: 'rejected',
        rationale: 'Failed to parse reviewer response.',
      };
    }
  }
}
