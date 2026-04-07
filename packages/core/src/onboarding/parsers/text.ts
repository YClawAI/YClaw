/**
 * Plain text and markdown parser.
 *
 * Simply reads UTF-8 content. No special processing needed —
 * text and markdown are already in a usable format.
 */

export interface ParseResult {
  text: string;
  metadata: Record<string, string | number>;
}

export function parseText(content: Buffer): ParseResult {
  const text = content.toString('utf8');
  const lines = text.split('\n');
  const words = text.split(/\s+/).filter(Boolean);

  return {
    text,
    metadata: {
      lineCount: lines.length,
      wordCount: words.length,
      charCount: text.length,
    },
  };
}

export function parseMarkdown(content: Buffer): ParseResult {
  // Markdown is treated as text with metadata extraction
  const text = content.toString('utf8');
  const lines = text.split('\n');
  const headings = lines.filter(l => l.startsWith('#')).length;
  const codeBlocks = (text.match(/```/g) ?? []).length / 2;

  return {
    text,
    metadata: {
      lineCount: lines.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      headingCount: headings,
      codeBlockCount: Math.floor(codeBlocks),
    },
  };
}
