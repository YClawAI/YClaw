import { describe, it, expect } from 'vitest';
import { parseText, parseMarkdown } from '../src/onboarding/parsers/text.js';
import { parseJson, parseYaml, parseCsv } from '../src/onboarding/parsers/structured.js';
import { getParser, isTextParseable, parseContent } from '../src/onboarding/parsers/index.js';

describe('text parser', () => {
  it('extracts text and metadata from plain text', () => {
    const content = Buffer.from('Hello world\nThis is a test\nThird line');
    const result = parseText(content);
    expect(result.text).toBe('Hello world\nThis is a test\nThird line');
    expect(result.metadata['lineCount']).toBe(3);
    expect(result.metadata['wordCount']).toBe(8);
  });

  it('handles empty content', () => {
    const result = parseText(Buffer.from(''));
    expect(result.text).toBe('');
    expect(result.metadata['lineCount']).toBe(1);
    expect(result.metadata['wordCount']).toBe(0);
  });
});

describe('markdown parser', () => {
  it('counts headings and code blocks', () => {
    const md = '# Title\n\nSome text\n\n## Section\n\n```js\ncode\n```\n';
    const result = parseMarkdown(Buffer.from(md));
    expect(result.metadata['headingCount']).toBe(2);
    expect(result.metadata['codeBlockCount']).toBe(1);
  });
});

describe('JSON parser', () => {
  it('parses valid JSON', () => {
    const json = Buffer.from('{"name":"test","version":"1.0"}');
    const result = parseJson(json);
    expect(result.text).toContain('"name": "test"');
    expect(result.metadata['topLevelKeys']).toBe(2);
    expect(result.metadata['type']).toBe('object');
  });

  it('handles arrays', () => {
    const json = Buffer.from('[1, 2, 3]');
    const result = parseJson(json);
    expect(result.metadata['type']).toBe('array');
    expect(result.metadata['topLevelKeys']).toBe(0);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJson(Buffer.from('not json'))).toThrow();
  });
});

describe('YAML parser', () => {
  it('parses valid YAML', () => {
    const yaml = Buffer.from('name: test\nversion: 1.0\nitems:\n  - one\n  - two');
    const result = parseYaml(yaml);
    expect(result.metadata['topLevelKeys']).toBe(3);
    expect(result.text).toContain('name');
  });
});

describe('CSV parser', () => {
  it('parses CSV with headers', () => {
    const csv = Buffer.from('name,age,city\nAlice,30,NYC\nBob,25,LA');
    const result = parseCsv(csv);
    expect(result.metadata['columnCount']).toBe(3);
    expect(result.metadata['rowCount']).toBe(2);
    expect(result.metadata['headers']).toBe('name, age, city');
  });

  it('handles empty CSV', () => {
    const csv = Buffer.from('');
    const result = parseCsv(csv);
    expect(result.metadata['rowCount']).toBe(0);
  });
});

describe('parser registry', () => {
  it('returns parser for text/plain', () => {
    expect(getParser('text/plain')).toBeDefined();
  });

  it('returns parser for application/json', () => {
    expect(getParser('application/json')).toBeDefined();
  });

  it('returns undefined for image MIME types', () => {
    expect(getParser('image/png')).toBeUndefined();
  });

  it('isTextParseable returns true for supported types', () => {
    expect(isTextParseable('text/plain')).toBe(true);
    expect(isTextParseable('application/pdf')).toBe(true);
    expect(isTextParseable('text/csv')).toBe(true);
  });

  it('isTextParseable returns false for images', () => {
    expect(isTextParseable('image/png')).toBe(false);
    expect(isTextParseable('image/jpeg')).toBe(false);
  });

  it('parseContent returns null for non-text types', async () => {
    const result = await parseContent('image/png', Buffer.from('fake'));
    expect(result).toBeNull();
  });

  it('parseContent works for text types', async () => {
    const result = await parseContent('text/plain', Buffer.from('hello world'));
    expect(result).not.toBeNull();
    expect(result!.text).toBe('hello world');
  });
});
