/**
 * Memory Architecture — Write Gate
 * Anthropic Messages API-backed 3-check quality filter for memory writes.
 * The caller chooses the model string at runtime.
 * Checks: (1) verifiable fact, (2) specific enough, (3) conflicts with existing items
 */

import type { MemoryItem, WriteGateLogEntry } from './types.js';

export type FactCategory = 'permanent' | 'operational' | 'transient';

export interface WriteGateResult {
  decision: 'accept' | 'reject' | 'conflict';
  reason: string | null;
  confidence: number | null;
  categoryKey: string | null;
  conflictItemId: string | null;
  factCategory: FactCategory | null;
  latencyMs: number;
  tokensUsed: number | null;
}

const WRITE_GATE_PROMPT = `You are a memory quality gate for an AI agent system. Evaluate the candidate fact below.

## Step 1 — CLASSIFY the fact type (do this FIRST)

- PERMANENT: Architecture decisions, code conventions, team structure, process docs, learnings, API patterns, configuration rules, how-to procedures, tool behaviors, people/relationships.
  Examples: "Redis is on port 18067", "Builder uses Sonnet by default", "Troy prefers keto"

- OPERATIONAL: Task statuses, system health, current blockers, "working on X", incident states, queue depths, deployment states, sprint progress, KPI values, success rates, "N tasks pending".
  Examples: "Builder has 28 pending tasks", "System CPU at 90%", "PR #317 is open", "deep dives 5/6 complete"

- TRANSIENT: Session-specific observations, one-time notes, intermediate reasoning steps, acknowledgments.
  Examples: "Checked the logs, nothing found", "Waiting for response", "Will revisit tomorrow"

## Step 2 — Apply decision rules

- PERMANENT facts → proceed to quality checks (steps 3-5)
- OPERATIONAL facts → REJECT immediately (agents must query live systems for current state, never store it in memory)
- TRANSIENT facts → REJECT immediately (not worth storing)

The most dangerous facts are operational ones disguised as permanent:
- "Builder's success rate is 82.6%" → OPERATIONAL (changes constantly) → REJECT
- "Builder uses Sonnet by default" → PERMANENT (configuration decision) → check quality
- "Department deep dives are 5/6 complete" → OPERATIONAL (project status) → REJECT
- "Department deep dives require Elon+Troy approval" → PERMANENT (process rule) → check quality

When in doubt: "Will this still be true in 2 weeks?" If uncertain → REJECT.

## Step 3 — VERIFIABLE: Is this a verifiable, objective fact (not an opinion, feeling, or filler)?
## Step 4 — SPECIFIC: Is it specific enough to be useful on its own, without additional context?
## Step 5 — CONFLICT: Does it contradict any of the existing high-confidence facts provided?

Respond in JSON:
{
  "fact_category": "permanent" | "operational" | "transient",
  "decision": "accept" | "reject" | "conflict",
  "reason": "why rejected/conflicting, or null if accepted",
  "confidence": 0.0-1.0 (how confident this is a real fact),
  "category_key": "suggested category slug or null"
}`;

/**
 * Run a candidate fact through the Write Gate.
 */
export async function evaluate(
  candidateFact: string,
  existingItems: MemoryItem[],
  options: {
    apiKey: string;
    model?: string;
    maxBudgetCentsPerDay?: number;
  },
): Promise<WriteGateResult> {
  if (!candidateFact || candidateFact.trim().length === 0) {
    return {
      decision: 'reject',
      reason: 'Empty or whitespace-only input',
      confidence: null,
      categoryKey: null,
      conflictItemId: null,
      factCategory: null,
      latencyMs: 0,
      tokensUsed: null,
    };
  }

  const model = options.model ?? 'claude-haiku-4-20250514';
  const highConfidenceItems = existingItems
    .filter((item) => item.confidence >= 0.7)
    .map((item) => `[${item.id}] ${item.factText} (confidence: ${item.confidence})`)
    .join('\n');

  const userMessage = `CANDIDATE FACT: ${candidateFact}

EXISTING HIGH-CONFIDENCE FACTS:
${highConfidenceItems || '(none)'}`;

  const startMs = Date.now();

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': options.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 384,
        system: WRITE_GATE_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const latencyMs = Date.now() - startMs;
    const data = (await response.json()) as {
      content: Array<{ text: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const text = data.content?.[0]?.text ?? '';
    const tokensUsed = data.usage
      ? data.usage.input_tokens + data.usage.output_tokens
      : null;

    try {
      const parsed = JSON.parse(text) as {
        decision: string;
        reason: string | null;
        confidence: number;
        category_key: string | null;
        fact_category?: string;
      };

      const factCategory = (parsed.fact_category as FactCategory) ?? null;

      return {
        decision: parsed.decision as WriteGateResult['decision'],
        reason: parsed.reason,
        confidence: parsed.confidence,
        categoryKey: parsed.category_key,
        conflictItemId: null, // TODO: extract from conflict check
        factCategory,
        latencyMs,
        tokensUsed,
      };
    } catch {
      // Conservative: reject on parse failure
      return {
        decision: 'reject',
        reason: `Failed to parse Write Gate response: ${text.slice(0, 100)}`,
        confidence: null,
        categoryKey: null,
        conflictItemId: null,
        factCategory: null,
        latencyMs,
        tokensUsed,
      };
    }
  } catch (err) {
    return {
      decision: 'reject',
      reason: `Write Gate API error: ${(err as Error).message}`,
      confidence: null,
      categoryKey: null,
      conflictItemId: null,
      factCategory: null,
      latencyMs: Date.now() - startMs,
      tokensUsed: null,
    };
  }
}
