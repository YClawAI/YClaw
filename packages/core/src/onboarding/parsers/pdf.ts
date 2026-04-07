/**
 * PDF text extraction using pdf-parse.
 *
 * Extracts text content from PDF files. No OCR — only embedded text.
 */

import type { ParseResult } from './text.js';

export async function parsePdf(content: Buffer): Promise<ParseResult> {
  // Dynamic import to keep pdf-parse optional at startup
  const pdfParse = await import('pdf-parse');
  const parse = pdfParse.default ?? pdfParse;

  const result = await parse(content);

  return {
    text: result.text,
    metadata: {
      pageCount: result.numpages,
      charCount: result.text.length,
      wordCount: result.text.split(/\s+/).filter(Boolean).length,
    },
  };
}
