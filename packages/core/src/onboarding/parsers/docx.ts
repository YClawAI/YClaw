/**
 * DOCX text extraction using mammoth.
 *
 * Converts DOCX to plain text. Strips formatting, keeps structure.
 */

import type { ParseResult } from './text.js';

export async function parseDocx(content: Buffer): Promise<ParseResult> {
  // Dynamic import to keep mammoth optional at startup
  const mammoth = await import('mammoth');

  const result = await mammoth.extractRawText({ buffer: content });
  const text = result.value;

  return {
    text,
    metadata: {
      charCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      warnings: result.messages.length,
    },
  };
}
