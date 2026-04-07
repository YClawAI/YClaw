/**
 * Parser registry — maps MIME types to parser functions.
 *
 * Each parser takes a Buffer and returns a ParseResult with
 * extracted text and metadata.
 */

import type { ParseResult } from './text.js';
import { parseText, parseMarkdown } from './text.js';
import { parsePdf } from './pdf.js';
import { parseDocx } from './docx.js';
import { parseJson, parseYaml, parseCsv } from './structured.js';

export type { ParseResult } from './text.js';

export type ParserFn = (content: Buffer) => ParseResult | Promise<ParseResult>;

const PARSER_MAP: Record<string, ParserFn> = {
  'text/plain': parseText,
  'text/markdown': parseMarkdown,
  'text/csv': parseCsv,
  'text/html': parseText, // Treat HTML as text — strip tags in source layer
  'application/pdf': parsePdf,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': parseDocx,
  'application/json': parseJson,
  'application/x-yaml': parseYaml,
  'text/yaml': parseYaml,
};

/** Get a parser for the given MIME type. Returns undefined for unsupported types. */
export function getParser(mimeType: string): ParserFn | undefined {
  return PARSER_MAP[mimeType];
}

/** Check if a MIME type has a registered parser (vs image-only storage). */
export function isTextParseable(mimeType: string): boolean {
  return mimeType in PARSER_MAP;
}

/**
 * Parse content using the appropriate parser for the MIME type.
 * Returns null for non-text MIME types (images, etc.).
 */
export async function parseContent(mimeType: string, content: Buffer): Promise<ParseResult | null> {
  const parser = getParser(mimeType);
  if (!parser) return null;
  return parser(content);
}
