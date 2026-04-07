// ─── Config Diff Engine ──────────────────────────────────────────────────────
//
// Computes structured diffs between two ConfigSnapshots.
// For arrays: computes added/removed items.
// For scalars: shows from/to values.
// For hashes: flags as changed without exposing content.

import type { ConfigSnapshot, ConfigDiff, ConfigFieldChange } from './types.js';

/** Fields that contain sorted string arrays — diff via set operations */
const ARRAY_FIELDS: ReadonlyArray<keyof ConfigSnapshot> = [
  'availableActions',
  'triggers',
  'cronSchedules',
  'eventSubscriptions',
  'eventPublications',
  'dataSources',
  'reviewBypass',
  'systemPromptNames',
];

/** Fields that are simple scalars (string | number | boolean) */
const SCALAR_FIELDS: ReadonlyArray<keyof ConfigSnapshot> = [
  'modelProvider',
  'model',
  'maxTokens',
  'temperature',
  'systemPromptLength',
  'humanize',
  'yamlPath',
];

/** Fields that are hash strings (nullable) — compare as scalars */
const HASH_FIELDS: ReadonlyArray<keyof ConfigSnapshot> = [
  'systemPromptHash',
  'executorHash',
  'taskRoutingHash',
  'contentWeightsHash',
  'metadataHash',
];

/**
 * Compute the diff between a previous and current snapshot.
 * Returns an empty diff (no added/removed/changed) if snapshots are identical.
 */
export function computeDiff(
  prev: ConfigSnapshot,
  curr: ConfigSnapshot,
): ConfigDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: ConfigFieldChange[] = [];

  // Compare array fields — report which items were added/removed
  for (const field of ARRAY_FIELDS) {
    const prevArr = prev[field] as string[] | undefined;
    const currArr = curr[field] as string[] | undefined;
    const prevSet = new Set(prevArr ?? []);
    const currSet = new Set(currArr ?? []);

    for (const item of currSet) {
      if (!prevSet.has(item)) {
        added.push(`${field}:${item}`);
      }
    }
    for (const item of prevSet) {
      if (!currSet.has(item)) {
        removed.push(`${field}:${item}`);
      }
    }
  }

  // Compare scalar fields
  for (const field of SCALAR_FIELDS) {
    if (prev[field] !== curr[field]) {
      changed.push({ field, from: prev[field], to: curr[field] });
    }
  }

  // Compare hash fields
  for (const field of HASH_FIELDS) {
    if (prev[field] !== curr[field]) {
      changed.push({ field, from: prev[field], to: curr[field] });
    }
  }

  return { added, removed, changed };
}

/**
 * Check if a diff represents any actual changes.
 */
export function isDiffEmpty(diff: ConfigDiff): boolean {
  return diff.added.length === 0
    && diff.removed.length === 0
    && diff.changed.length === 0;
}

/**
 * Get a human-readable summary of changed fields for logging.
 */
export function summarizeDiff(diff: ConfigDiff): string {
  const parts: string[] = [];
  if (diff.added.length > 0) parts.push(`+${diff.added.length} added`);
  if (diff.removed.length > 0) parts.push(`-${diff.removed.length} removed`);
  if (diff.changed.length > 0) {
    const fields = diff.changed.map(c => c.field).join(', ');
    parts.push(`changed: ${fields}`);
  }
  return parts.join('; ') || 'no changes';
}
