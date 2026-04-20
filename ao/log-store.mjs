/**
 * log-store.mjs — Context Mode-style log offloading for the AO orchestrator.
 *
 * Problem: CI logs, build output, test failures, and GitHub API responses flood
 * Claude's context window in long-running agent sessions. This module sandboxes
 * raw output into external file storage and exposes a query interface so Claude
 * receives summaries by default, with on-demand access to specific chunks.
 *
 * Inspired by github.com/mksglu/context-mode.
 *
 * Storage layout:
 *   ~/.ao-logs/<refId>/
 *     raw.log       — Full verbatim content (always persisted)
 *     meta.json     — Summary metadata (line counts, error positions, sections)
 *
 * Usage:
 *   const store = LogStore.fromEnv();
 *   const { refId, summary } = await store.ingest(rawText, { label: 'CI output' });
 *   const excerpt = await store.getExcerpt(refId, 10, 30);
 *   const full    = await store.getRaw(refId);
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ─── Constants ────────────────────────────────────────────────────────────────

/** How many tail lines to include in every summary (cheap context). */
const SUMMARY_TAIL_LINES = 30;

/** How many error lines to surface in every summary. */
const SUMMARY_MAX_ERRORS = 20;

/** Maximum bytes accepted in a single ingest() call (16 MB). */
const MAX_INGEST_BYTES = 16 * 1024 * 1024;

/** Logs older than this are eligible for cleanup. Default: 48 hours. */
const DEFAULT_TTL_MS = parseInt(process.env.AO_LOG_TTL_MS || String(48 * 60 * 60 * 1000), 10);

// Error/warning signal patterns (case-insensitive where noted).
const ERROR_PATTERNS = [
  /\berror\b/i,
  /\bfailed\b/i,
  /\bfailure\b/i,
  /\bexception\b/i,
  /\bfatal\b/i,
  /✗/,
  /❌/,
  /FAIL/,
];

const WARNING_PATTERNS = [
  /\bwarn(ing)?\b/i,
  /⚠/,
  /WARN/,
  /deprecated/i,
];

// Section-header heuristics: blank line followed by an all-caps or title-like line.
const SECTION_HEADER_RE = /^(?:[A-Z][A-Z\s_-]{2,}|#{1,3}\s+\S)/;

// ─── LogStore ─────────────────────────────────────────────────────────────────

export class LogStore {
  /**
   * @param {string} rootDir - Base directory for log storage.
   */
  constructor(rootDir) {
    this.rootDir = rootDir;
    mkdirSync(rootDir, { recursive: true });
  }

  /**
   * Build a LogStore instance using the AO_HOME env var (or system defaults).
   * @returns {LogStore}
   */
  static fromEnv() {
    const base = process.env.AO_LOG_DIR
      || join(process.env.HOME || process.env.AO_HOME || tmpdir(), '.ao-logs');
    return new LogStore(base);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Ingest raw text content. Stores the full content externally and returns a
   * stable refId plus a compact summary suitable for Claude's context.
   *
   * @param {string} rawText - The full raw log content to offload.
   * @param {{ label?: string, sessionId?: string }} [meta] - Optional metadata.
   * @returns {{ refId: string, summary: LogSummary }}
   */
  ingest(rawText, meta = {}) {
    if (typeof rawText !== 'string') {
      throw new TypeError('[log-store] ingest() requires a string argument');
    }

    const content = rawText.slice(0, MAX_INGEST_BYTES);
    const refId = this._computeRefId(content, meta);
    const logDir = this._logDir(refId);

    // Idempotent: if already stored, just return the existing summary.
    if (existsSync(join(logDir, 'meta.json'))) {
      return { refId, summary: this._readMeta(refId) };
    }

    mkdirSync(logDir, { recursive: true });

    // 1. Persist full content.
    writeFileSync(join(logDir, 'raw.log'), content, 'utf-8');

    // 2. Analyse and persist summary metadata.
    const summary = this._analyse(content, { ...meta, refId });
    writeFileSync(join(logDir, 'meta.json'), JSON.stringify(summary, null, 2), 'utf-8');

    return { refId, summary };
  }

  /**
   * Return the summary metadata for a stored log.
   * Throws if the refId is unknown.
   *
   * @param {string} refId
   * @returns {LogSummary}
   */
  getSummary(refId) {
    this._assertExists(refId);
    return this._readMeta(refId);
  }

  /**
   * Return a specific line range from a stored log (1-based, inclusive).
   * Lines outside the stored range are silently clamped.
   *
   * @param {string} refId
   * @param {number} from - First line to return (1-based).
   * @param {number} to   - Last line to return (1-based, inclusive).
   * @returns {{ lines: string[], totalLines: number, from: number, to: number }}
   */
  getExcerpt(refId, from, to) {
    this._assertExists(refId);
    const allLines = this._readLines(refId);
    const total = allLines.length;

    const safeFrom = Math.max(1, Math.min(from, total));
    const safeTo   = Math.max(safeFrom, Math.min(to, total));

    return {
      lines: allLines.slice(safeFrom - 1, safeTo),
      totalLines: total,
      from: safeFrom,
      to: safeTo,
    };
  }

  /**
   * Return the full raw content of a stored log.
   * Falls back to an empty string if the file cannot be read.
   *
   * @param {string} refId
   * @returns {string}
   */
  getRaw(refId) {
    try {
      this._assertExists(refId);
      return readFileSync(join(this._logDir(refId), 'raw.log'), 'utf-8');
    } catch {
      return '';
    }
  }

  /**
   * Check whether a refId exists in the store.
   *
   * @param {string} refId
   * @returns {boolean}
   */
  has(refId) {
    return existsSync(join(this._logDir(refId), 'meta.json'));
  }

  /**
   * Delete logs older than `ttlMs`. Safe to call on a schedule.
   *
   * @param {number} [ttlMs] - Age threshold in milliseconds.
   * @returns {number} Number of log entries deleted.
   */
  cleanup(ttlMs = DEFAULT_TTL_MS) {
    let deleted = 0;
    try {
      const entries = readdirSync(this.rootDir, { withFileTypes: true });
      const threshold = Date.now() - ttlMs;
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const metaPath = join(this.rootDir, entry.name, 'meta.json');
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
          const capturedAt = new Date(meta.capturedAt).getTime();
          if (Number.isFinite(capturedAt) && capturedAt < threshold) {
            rmSync(join(this.rootDir, entry.name), { recursive: true, force: true });
            deleted++;
          }
        } catch {
          // Skip unreadable entries.
        }
      }
    } catch {
      // Root dir doesn't exist yet or is unreadable — nothing to clean.
    }
    return deleted;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  _logDir(refId) {
    return join(this.rootDir, refId);
  }

  _assertExists(refId) {
    if (!this.has(refId)) {
      throw new Error(`[log-store] Unknown refId: ${refId}`);
    }
  }

  _computeRefId(content, meta) {
    return createHash('sha256')
      .update(content)
      .update(meta.label || '')
      .update(meta.sessionId || '')
      .digest('hex')
      .slice(0, 16);
  }

  _readMeta(refId) {
    return JSON.parse(readFileSync(join(this._logDir(refId), 'meta.json'), 'utf-8'));
  }

  _readLines(refId) {
    const raw = readFileSync(join(this._logDir(refId), 'raw.log'), 'utf-8');
    return raw.split('\n');
  }

  /**
   * Analyse raw text and return a compact LogSummary.
   *
   * @param {string} content
   * @param {{ refId: string, label?: string, sessionId?: string }} meta
   * @returns {LogSummary}
   */
  _analyse(content, meta) {
    const lines = content.split('\n');
    const totalLines = lines.length;
    const totalBytes = Buffer.byteLength(content, 'utf-8');

    // Detect error and warning lines.
    const errorLines = [];
    const warningLines = [];
    const sections = [];
    let lastSectionStart = 1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNo = i + 1;

      if (ERROR_PATTERNS.some(re => re.test(line))) {
        if (errorLines.length < SUMMARY_MAX_ERRORS) {
          errorLines.push({ line: lineNo, content: line.slice(0, 200) });
        }
      } else if (WARNING_PATTERNS.some(re => re.test(line))) {
        if (warningLines.length < SUMMARY_MAX_ERRORS) {
          warningLines.push({ line: lineNo, content: line.slice(0, 200) });
        }
      }

      // Detect section boundaries: non-empty header after a blank line.
      const prevIsBlank = i > 0 && lines[i - 1].trim() === '';
      if (prevIsBlank && SECTION_HEADER_RE.test(line.trim())) {
        // Close the previous section.
        if (sections.length > 0) {
          sections[sections.length - 1].end = lineNo - 2;
        }
        sections.push({ start: lineNo, end: totalLines, header: line.trim().slice(0, 80) });
        lastSectionStart = lineNo;
      }
    }

    // If no sections were detected, treat the whole content as one block.
    if (sections.length === 0 && totalLines > 0) {
      sections.push({ start: 1, end: totalLines, header: meta.label || 'Output' });
    }

    // Tail lines for quick inline context.
    const tailLines = lines.slice(-SUMMARY_TAIL_LINES).map(l => l.slice(0, 300));

    /** @type {LogSummary} */
    const summary = {
      refId: meta.refId,
      label: meta.label || null,
      sessionId: meta.sessionId || null,
      capturedAt: new Date().toISOString(),
      totalLines,
      totalBytes,
      errorCount: errorLines.length,
      warningCount: warningLines.length,
      sections,
      errorLines,
      warningLines,
      tailLines,
    };

    return summary;
  }
}

/**
 * @typedef {Object} LogSummary
 * @property {string}   refId
 * @property {string|null} label
 * @property {string|null} sessionId
 * @property {string}   capturedAt   - ISO 8601 timestamp.
 * @property {number}   totalLines
 * @property {number}   totalBytes
 * @property {number}   errorCount
 * @property {number}   warningCount
 * @property {{ start: number, end: number, header: string }[]} sections
 * @property {{ line: number, content: string }[]} errorLines
 * @property {{ line: number, content: string }[]} warningLines
 * @property {string[]} tailLines    - Last N lines for inline context.
 */

// ─── Singleton for bridge-server use ─────────────────────────────────────────
export const defaultLogStore = LogStore.fromEnv();

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * Build the offload notice that replaces raw log content in task prompts.
 * Claude receives a compact summary and clear retrieval instructions.
 *
 * @param {LogSummary} summary
 * @param {string} retrievalBaseUrl - Base URL of the AO bridge server.
 * @returns {string}
 */
export function buildOffloadNotice(summary, retrievalBaseUrl) {
  const base = retrievalBaseUrl.replace(/\/$/, '');
  const refId = summary.refId;

  const sections = [
    `## 📦 Log Offloaded (Context Mode)`,
    ``,
    `**refId:** \`${refId}\`${summary.label ? `  **label:** ${summary.label}` : ''}`,
    `**Size:** ${summary.totalLines} lines / ${formatBytes(summary.totalBytes)}`,
    `**Errors:** ${summary.errorCount}  **Warnings:** ${summary.warningCount}`,
    `**Captured:** ${summary.capturedAt}`,
  ];

  // Surface sections as a map so Claude can request specific ranges.
  if (summary.sections.length > 1) {
    sections.push(``, `**Sections:**`);
    for (const s of summary.sections) {
      sections.push(`- Lines ${s.start}–${s.end}: ${s.header}`);
    }
  }

  // Surface top error lines inline so Claude has actionable signal immediately.
  if (summary.errorLines.length > 0) {
    sections.push(``, `**Key errors (first ${summary.errorLines.length}):**`);
    for (const e of summary.errorLines.slice(0, 10)) {
      sections.push(`- L${e.line}: \`${e.content}\``);
    }
  }

  // Always include tail lines — the most recent output is the most relevant.
  if (summary.tailLines.length > 0) {
    sections.push(``, `**Last ${summary.tailLines.length} lines:**`);
    sections.push('```');
    sections.push(...summary.tailLines);
    sections.push('```');
  }

  sections.push(
    ``,
    `**Retrieval endpoints** (call these if you need more detail):`,
    `- Summary:  \`GET ${base}/logs/${refId}/summary\``,
    `- Excerpt:  \`GET ${base}/logs/${refId}/excerpt?from=<N>&to=<M>\``,
    `- Full log: \`GET ${base}/logs/${refId}\``,
  );

  return sections.join('\n');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
