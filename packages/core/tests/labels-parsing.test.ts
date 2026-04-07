/**
 * Tests for the parseLabelsParam utility.
 *
 * Validates robust label parsing for the various forms an LLM may send:
 * native arrays, JSON-stringified arrays, comma-separated strings,
 * single labels, and empty/undefined inputs.
 */

import { describe, expect, it } from 'vitest';
import { parseLabelsParam } from '../src/actions/github/issues.js';

describe('parseLabelsParam', () => {
  describe('native arrays', () => {
    it('should pass through a plain string array', () => {
      expect(parseLabelsParam(['bug', 'P1'])).toEqual(['bug', 'P1']);
    });

    it('should trim whitespace from array elements', () => {
      expect(parseLabelsParam(['  bug  ', ' P1 '])).toEqual(['bug', 'P1']);
    });

    it('should filter out empty elements from arrays', () => {
      expect(parseLabelsParam(['bug', '', 'P1', '  '])).toEqual(['bug', 'P1']);
    });

    it('should handle single-element array', () => {
      expect(parseLabelsParam(['bug'])).toEqual(['bug']);
    });

    it('should return empty array for empty array input', () => {
      expect(parseLabelsParam([])).toEqual([]);
    });
  });

  describe('JSON-stringified arrays', () => {
    it('should parse a JSON-stringified array', () => {
      expect(parseLabelsParam('["bug","P1"]')).toEqual(['bug', 'P1']);
    });

    it('should parse a JSON-stringified array with spaces', () => {
      expect(parseLabelsParam('["bug", "P1", "agent-work"]')).toEqual([
        'bug',
        'P1',
        'agent-work',
      ]);
    });

    it('should handle JSON array with extra whitespace around brackets', () => {
      expect(parseLabelsParam('  ["bug","P1"]  ')).toEqual(['bug', 'P1']);
    });

    it('should handle malformed JSON (fallback to comma-split)', () => {
      // '["P1"' — unclosed bracket — is invalid JSON, falls back to comma split
      const result = parseLabelsParam('["P1"');
      // comma-split of '["P1"' → ['"P1"'] – trimmed but not further cleaned;
      // the test confirms fallback happens rather than throwing
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('comma-separated strings', () => {
    it('should split comma-separated label string', () => {
      expect(parseLabelsParam('bug, P1')).toEqual(['bug', 'P1']);
    });

    it('should split comma-separated string without spaces', () => {
      expect(parseLabelsParam('bug,P1,agent-work')).toEqual([
        'bug',
        'P1',
        'agent-work',
      ]);
    });

    it('should trim whitespace from comma-split labels', () => {
      expect(parseLabelsParam('  bug  ,  P1  ')).toEqual(['bug', 'P1']);
    });

    it('should filter empty parts from comma split', () => {
      expect(parseLabelsParam('bug,,P1,')).toEqual(['bug', 'P1']);
    });
  });

  describe('single label strings', () => {
    it('should handle a single label string', () => {
      expect(parseLabelsParam('bug')).toEqual(['bug']);
    });

    it('should trim a single label string', () => {
      expect(parseLabelsParam('  bug  ')).toEqual(['bug']);
    });
  });

  describe('empty / undefined inputs', () => {
    it('should return empty array for undefined', () => {
      expect(parseLabelsParam(undefined)).toEqual([]);
    });

    it('should return empty array for null', () => {
      expect(parseLabelsParam(null)).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      expect(parseLabelsParam('')).toEqual([]);
    });

    it('should return empty array for whitespace-only string', () => {
      expect(parseLabelsParam('   ')).toEqual([]);
    });
  });
});
