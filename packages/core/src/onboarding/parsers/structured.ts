/**
 * Structured data parsers — JSON, YAML, CSV.
 *
 * Converts structured formats to readable text representations
 * suitable for LLM context.
 */

import YAML from 'yaml';
import type { ParseResult } from './text.js';

export function parseJson(content: Buffer): ParseResult {
  const raw = content.toString('utf8');
  const parsed = JSON.parse(raw);
  const pretty = JSON.stringify(parsed, null, 2);

  return {
    text: pretty,
    metadata: {
      type: Array.isArray(parsed) ? 'array' : typeof parsed,
      topLevelKeys: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? Object.keys(parsed).length
        : 0,
      charCount: pretty.length,
    },
  };
}

export function parseYaml(content: Buffer): ParseResult {
  const raw = content.toString('utf8');
  const parsed = YAML.parse(raw) as unknown;
  // Re-serialize for consistent formatting
  const text = typeof parsed === 'object' && parsed !== null
    ? YAML.stringify(parsed)
    : raw;

  return {
    text,
    metadata: {
      charCount: text.length,
      topLevelKeys: typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? Object.keys(parsed).length
        : 0,
    },
  };
}

export function parseCsv(content: Buffer): ParseResult {
  const raw = content.toString('utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const headerLine = lines[0] ?? '';
  const headers = headerLine.split(',').map(h => h.trim());
  const rowCount = Math.max(0, lines.length - 1);

  // Convert CSV to a more readable format for LLM context
  const text = lines.join('\n');

  return {
    text,
    metadata: {
      columnCount: headers.length,
      rowCount,
      headers: headers.join(', '),
      charCount: text.length,
    },
  };
}
