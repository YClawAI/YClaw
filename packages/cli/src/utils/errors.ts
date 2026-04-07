/**
 * Structured CLI errors — every failure reports what/why/fix.
 */

import * as output from './output.js';

export class CliError extends Error {
  constructor(
    public what: string,
    public why: string,
    public fix: string,
  ) {
    super(`${what}: ${why}`);
    this.name = 'CliError';
  }
}

/**
 * Top-level error handler for commander actions.
 * Formats errors and exits with appropriate code.
 */
export function handleError(err: unknown): never {
  if (err instanceof CliError) {
    output.fail(err.what);
    console.error(`  Why: ${err.why}`);
    console.error(`  Fix: ${err.fix}`);
    process.exit(1);
  }

  // Inquirer Ctrl+C throws ExitPromptError
  if (err && typeof err === 'object' && 'name' in err
    && (err as Error).name === 'ExitPromptError') {
    console.log('');
    output.info('Cancelled by user.');
    process.exit(130);
  }

  // Unknown error
  const msg = err instanceof Error ? err.message : String(err);
  output.fail(`Unexpected error: ${msg}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
}
