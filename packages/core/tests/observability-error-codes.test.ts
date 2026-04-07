import { describe, it, expect } from 'vitest';
import {
  ERROR_CODES,
  getErrorCode,
  getErrorCodesByCategory,
  getErrorCodesBySeverity,
  type ErrorCode,
  type ErrorCategory,
  type ErrorSeverity,
} from '../src/observability/error-codes.js';

describe('Error Taxonomy', () => {
  it('exports all expected error codes', () => {
    const codes = Object.keys(ERROR_CODES);
    expect(codes.length).toBeGreaterThanOrEqual(16);

    // Spot-check key codes
    expect(ERROR_CODES.STATE_STORE_UNREACHABLE).toBeDefined();
    expect(ERROR_CODES.LLM_TIMEOUT).toBeDefined();
    expect(ERROR_CODES.AGENT_TASK_FAILED).toBeDefined();
    expect(ERROR_CODES.OPERATOR_AUTH_FAILED).toBeDefined();
    expect(ERROR_CODES.CHANNEL_DISCONNECTED).toBeDefined();
  });

  it('every error code has category, severity, and action', () => {
    const validCategories: ErrorCategory[] = ['infra', 'llm', 'agent', 'security', 'channel'];
    const validSeverities: ErrorSeverity[] = ['critical', 'warning', 'info'];

    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(validCategories).toContain(entry.category);
      expect(validSeverities).toContain(entry.severity);
      expect(entry.action.length).toBeGreaterThan(0);
    }
  });

  it('getErrorCode returns entry for valid code', () => {
    const entry = getErrorCode('LLM_TIMEOUT');
    expect(entry).toBeDefined();
    expect(entry!.category).toBe('llm');
    expect(entry!.severity).toBe('warning');
    expect(entry!.action).toBe('Retry or switch provider');
  });

  it('getErrorCode returns undefined for unknown code', () => {
    expect(getErrorCode('DOES_NOT_EXIST')).toBeUndefined();
  });

  it('getErrorCodesByCategory filters correctly', () => {
    const infraCodes = getErrorCodesByCategory('infra');
    expect(infraCodes.length).toBeGreaterThanOrEqual(3);
    for (const { entry } of infraCodes) {
      expect(entry.category).toBe('infra');
    }

    const securityCodes = getErrorCodesByCategory('security');
    expect(securityCodes.length).toBeGreaterThanOrEqual(3);
    for (const { entry } of securityCodes) {
      expect(entry.category).toBe('security');
    }
  });

  it('getErrorCodesBySeverity filters at minimum severity', () => {
    const criticalOnly = getErrorCodesBySeverity('critical');
    for (const { entry } of criticalOnly) {
      expect(entry.severity).toBe('critical');
    }

    const warningAndAbove = getErrorCodesBySeverity('warning');
    for (const { entry } of warningAndAbove) {
      expect(['warning', 'critical']).toContain(entry.severity);
    }

    const all = getErrorCodesBySeverity('info');
    expect(all.length).toBe(Object.keys(ERROR_CODES).length);
  });

  it('infrastructure critical codes include state store and event bus', () => {
    expect(ERROR_CODES.STATE_STORE_UNREACHABLE.severity).toBe('critical');
    expect(ERROR_CODES.EVENT_BUS_UNREACHABLE.severity).toBe('critical');
  });

  it('action strings are human-readable instructions', () => {
    // Every action should be a sentence or short phrase
    for (const entry of Object.values(ERROR_CODES)) {
      expect(entry.action.length).toBeGreaterThan(5);
      // No empty or placeholder actions
      expect(entry.action).not.toBe('TODO');
    }
  });
});
