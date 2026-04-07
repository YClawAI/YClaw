/**
 * Tests for observability utilities.
 */

import { describe, it, expect } from 'vitest';
import {
  generateCorrelationId,
  extractOrGenerateCorrelationId,
  withCorrelationId,
  getCorrelationId,
} from '../src/observability/correlation.js';

describe('Correlation ID', () => {
  it('generates a UUID v4', () => {
    const id = generateCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()));
    expect(ids.size).toBe(100);
  });

  it('extracts correlationId from source', () => {
    const id = extractOrGenerateCorrelationId({ correlationId: 'test-123' });
    expect(id).toBe('test-123');
  });

  it('extracts correlation_id (snake_case) from source', () => {
    const id = extractOrGenerateCorrelationId({ correlation_id: 'test-456' });
    expect(id).toBe('test-456');
  });

  it('extracts from x-correlation-id header', () => {
    const id = extractOrGenerateCorrelationId({
      headers: { 'x-correlation-id': 'header-789' },
    });
    expect(id).toBe('header-789');
  });

  it('generates new ID when no source', () => {
    const id = extractOrGenerateCorrelationId();
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  it('generates new ID when source has no correlation fields', () => {
    const id = extractOrGenerateCorrelationId({ headers: {} });
    expect(id).toMatch(/^[0-9a-f]{8}-/);
  });

  it('propagates through async context', () => {
    expect(getCorrelationId()).toBeUndefined();

    withCorrelationId('ctx-test', () => {
      expect(getCorrelationId()).toBe('ctx-test');
    });

    expect(getCorrelationId()).toBeUndefined();
  });
});
