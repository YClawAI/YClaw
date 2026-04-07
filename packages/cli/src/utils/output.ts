/**
 * Terminal output utilities — chalk + ora, TTY-aware.
 * Disables colors/spinners when not connected to a TTY or in --json mode.
 */

import chalk from 'chalk';
import ora from 'ora';

const isStdoutTTY = process.stdout.isTTY === true;
const isStderrTTY = process.stderr.isTTY === true;

/** Force plain output (set by --json flag). */
let forcePlain = false;

export function setPlainOutput(plain: boolean): void {
  forcePlain = plain;
}

/** Color for stdout (console.log). */
function isStdoutColorEnabled(): boolean {
  return isStdoutTTY && !forcePlain;
}

/** Color for stderr (console.error). */
function isStderrColorEnabled(): boolean {
  return isStderrTTY && !forcePlain;
}

// ─── Styled output ──────────────────────────────────────────────────────────

export function success(msg: string): void {
  if (isStdoutColorEnabled()) {
    console.log(chalk.green('✔ ') + msg);
  } else {
    console.log(`PASS ${msg}`);
  }
}

export function warn(msg: string): void {
  if (isStdoutColorEnabled()) {
    console.log(chalk.yellow('⚠ ') + msg);
  } else {
    console.log(`WARN ${msg}`);
  }
}

export function fail(msg: string): void {
  if (isStderrColorEnabled()) {
    console.error(chalk.red('✖ ') + msg);
  } else {
    console.error(`FAIL ${msg}`);
  }
}

export function info(msg: string): void {
  if (isStdoutColorEnabled()) {
    console.log(chalk.blue('ℹ ') + msg);
  } else {
    console.log(`INFO ${msg}`);
  }
}

export function heading(msg: string): void {
  if (isStdoutColorEnabled()) {
    console.log('\n' + chalk.bold.underline(msg));
  } else {
    console.log(`\n${msg}`);
  }
}

export function dim(msg: string): string {
  return isStdoutColorEnabled() ? chalk.dim(msg) : msg;
}

export function bold(msg: string): string {
  return isStdoutColorEnabled() ? chalk.bold(msg) : msg;
}

// ─── Spinner ────────────────────────────────────────────────────────────────

export function spinner(text: string): ReturnType<typeof ora> {
  return ora({
    text,
    isEnabled: isStderrTTY && !forcePlain,
  });
}
