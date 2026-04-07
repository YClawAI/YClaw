/**
 * Event Bus Security Errors
 *
 * Typed error codes for every rejection stage in the validation pipeline.
 */

export type EventBusErrorCode =
  | 'EVENT_TOO_LARGE'
  | 'MISSING_FIELD'
  | 'INVALID_AUTH'
  | 'UNKNOWN_KEY'
  | 'INVALID_SIGNATURE'
  | 'FUTURE_EVENT'
  | 'EXPIRED_EVENT'
  | 'REPLAY_DETECTED'
  | 'NONCE_REPLAY'
  | 'UNKNOWN_SOURCE'
  | 'UNAUTHORIZED_EVENT_TYPE'
  | 'NO_SCHEMA'
  | 'SCHEMA_VIOLATION'
  | 'DENIED_FIELD';

export class EventBusError extends Error {
  readonly code: EventBusErrorCode;

  constructor(code: EventBusErrorCode, message: string) {
    super(message);
    this.name = 'EventBusError';
    this.code = code;
  }
}
