# Issue #58 — Prompt Caching Wiring Specification

This document is now a historical implementation note. The wiring described here is live in the codebase on `master`.

## Current Status

Implemented in `packages/core`:

- `packages/core/src/agent/context-cache.ts` builds layered cacheable blocks
- `packages/core/src/agent/context.ts` wires `buildCacheableBlocks()` and `mergeBlocksToSystemContent()` into system-message construction
- `packages/core/src/agent/execution-cache-metrics.ts` tracks multi-round cache performance
- `packages/core/src/agent/executor.ts` records cache metrics into execution token usage
- `packages/core/src/llm/anthropic.ts` forwards `cacheableBlocks` to Anthropic requests

## Verification Surface

The implementation is covered by the existing tests in:

- `packages/core/src/agent/context-cache.test.ts`
- `packages/core/src/agent/execution-cache-metrics.test.ts`
- `packages/core/src/llm/anthropic.test.ts`
- `packages/core/src/agent/executor-cache.test.ts`

## Historical Outcome

The original wiring goals were completed:

- `ContextBuilder` now builds the system prompt once, preserves a plain-string fallback, and attaches `cacheableBlocks` for Anthropic-compatible requests
- The executor now accumulates cache metrics across all LLM rounds and persists them in the execution record
- The previous note about large-file manual wiring is obsolete because both target files already include the integration
