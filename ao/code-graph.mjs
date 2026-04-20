/**
 * code-graph.mjs — AST-approximate code context selector.
 *
 * Extracts only the functions/methods containing changed lines (from git diff),
 * plus their external call sites. Used as a preprocessing step before review
 * and remediation to provide focused context instead of full-file dumps.
 *
 * No binary dependencies — uses Node.js built-ins + git CLI.
 * Supports: .js, .mjs, .cjs, .ts, .tsx, .jsx, .py
 *
 * Expected token reduction: 3–10× on typical PR review tasks.
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

// ── Configuration ─────────────────────────────────────────────────────────────

const MAX_FUNCTION_LINES = 80;    // Cap lines extracted per function
const MAX_CALL_SITES_PER_FN = 3; // External call-site references shown
const MAX_FILES = 8;              // Changed files to analyse (largest first)
const MAX_FNS_PER_FILE = 4;      // Functions extracted per file
const GIT_TIMEOUT_MS = 20_000;

const SUPPORTED_EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.py']);

// JS/TS reserved words that are never function names but can appear before `(`
const RESERVED = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'else', 'do', 'return',
  'throw', 'typeof', 'instanceof', 'new', 'delete', 'void', 'in', 'of',
  'await', 'yield', 'import', 'export', 'from', 'class', 'extends',
]);

// ── Git helpers ───────────────────────────────────────────────────────────────

/**
 * Run git with given args in cwd; resolve stdout (including exit code 1 from
 * git-grep no-match) or reject on any other error.
 */
function spawnGit(args, cwd) {
  return new Promise((resolve, reject) => {
    let out = '';
    let err = '';
    const proc = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
    });
    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('close', (code) => {
      // git grep exits 1 when there are no matches — treat as success
      if (code === 0 || code === 1) resolve(out);
      else reject(new Error(`git ${args[0]} failed (${code}): ${err.slice(0, 200)}`));
    });
    proc.on('error', reject);
  });
}

// ── Diff parsing ──────────────────────────────────────────────────────────────

/**
 * Parse unified diff text into per-file new-side line ranges.
 *
 * @param {string} diffText   Output of `git diff --unified=0`
 * @returns {{ file: string, ranges: { start: number, end: number }[] }[]}
 */
export function parseHunkRanges(diffText) {
  const fileRanges = new Map();
  let currentFile = null;

  for (const line of diffText.split('\n')) {
    // +++ b/path header
    const fileHeader = line.match(/^\+\+\+ b\/(.+)$/);
    if (fileHeader) {
      currentFile = fileHeader[1];
      if (!fileRanges.has(currentFile)) fileRanges.set(currentFile, []);
      continue;
    }
    if (!currentFile) continue;

    // @@ -old +new[,count] @@
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (hunk) {
      const start = parseInt(hunk[1], 10);
      const count = hunk[2] !== undefined ? parseInt(hunk[2], 10) : 1;
      if (count > 0) {
        fileRanges.get(currentFile).push({ start, end: start + count - 1 });
      }
    }
  }

  return [...fileRanges.entries()]
    .filter(([, ranges]) => ranges.length > 0)
    .map(([file, ranges]) => ({ file, ranges }));
}

// ── Brace counting ────────────────────────────────────────────────────────────

/**
 * Net brace depth contributed by a single line, skipping string literals.
 */
function lineBraceDepth(line) {
  let depth = 0;
  let inStr = null;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; } // escaped char
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch;
    } else if (ch === '/' && line[i + 1] === '/') {
      break; // line comment — stop scanning
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
    }
    i++;
  }
  return depth;
}

/**
 * Find the inclusive end line (1-indexed) of the block starting at startIndex (0-indexed).
 * Uses brace counting for JS/TS and indentation for Python.
 */
function findBlockEnd(lines, startIndex) {
  const startLine = lines[startIndex] || '';

  // Python: indentation-delimited
  if (/^[ \t]*(?:async\s+)?def\s+\w/.test(startLine) && startLine.trimEnd().endsWith(':')) {
    const baseIndent = (startLine.match(/^(\s*)/) || ['', ''])[1].length;
    for (let i = startIndex + 1; i < lines.length; i++) {
      const trimmed = lines[i].trimEnd();
      if (trimmed.length === 0) continue; // blank lines don't end a block
      const indent = (lines[i].match(/^(\s*)/) || ['', ''])[1].length;
      if (indent <= baseIndent) return i; // exclusive end → last line is i-1+1=i (1-indexed)
    }
    return lines.length;
  }

  // JS/TS: brace-delimited
  let depth = 0;
  let foundOpen = false;
  for (let i = startIndex; i < lines.length; i++) {
    depth += lineBraceDepth(lines[i]);
    if (!foundOpen && depth > 0) foundOpen = true;
    if (foundOpen && depth <= 0) return i + 1; // 1-indexed inclusive end
  }
  return Math.min(startIndex + MAX_FUNCTION_LINES + 1, lines.length);
}

// ── Function boundary detection ───────────────────────────────────────────────

// Ordered from most to least specific to minimise false positives.
const FN_PATTERNS = [
  // Python def
  /^[ \t]*(?:async\s+)?def\s+(\w+)\s*\(/,
  // Standard JS/TS function declaration (top-level or exported)
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*(\w+)\s*[(<]/,
  // Arrow-function variable assignment
  /^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$]\w*)\s*=>/,
  // Class / object method (indented 2–8 spaces, optional modifiers, name followed by '(')
  /^[ \t]{2,8}(?:(?:async|static|public|private|protected|override|abstract|readonly|declare)\s+)*(?:get\s+|set\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(/,
];

/**
 * Scan source lines and return all function/method definition boundaries.
 *
 * @param {string[]} lines  File content split on '\n'
 * @returns {{ name: string, startLine: number, endLine: number }[]}  (1-indexed, inclusive)
 */
export function findFunctionBoundaries(lines) {
  const result = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    let fnName = null;

    for (const pat of FN_PATTERNS) {
      const m = line.match(pat);
      if (m && m[1] && !RESERVED.has(m[1])) {
        fnName = m[1];
        break;
      }
    }

    if (fnName) {
      const endLine = findBlockEnd(lines, i);
      result.push({ name: fnName, startLine: i + 1, endLine });
      i = endLine; // skip inside the detected block
    } else {
      i++;
    }
  }

  return result;
}

/**
 * Extract functions/methods that overlap with any of the given line ranges.
 *
 * @param {string} source  Full file content
 * @param {{ start: number, end: number }[]} ranges  Changed ranges (1-indexed)
 * @returns {{ name: string, startLine: number, endLine: number, body: string }[]}
 */
export function extractFunctionsForRanges(source, ranges) {
  const lines = source.split('\n');
  const boundaries = findFunctionBoundaries(lines);

  return boundaries
    .filter(fn => ranges.some(r => fn.startLine <= r.end && fn.endLine >= r.start))
    .slice(0, MAX_FNS_PER_FILE)
    .map(fn => {
      const bodyLines = lines.slice(fn.startLine - 1, fn.endLine);
      const truncated = bodyLines.length > MAX_FUNCTION_LINES;
      return {
        name: fn.name,
        startLine: fn.startLine,
        endLine: fn.endLine,
        body:
          bodyLines.slice(0, MAX_FUNCTION_LINES).join('\n') +
          (truncated ? '\n  // … [truncated]' : ''),
      };
    });
}

// ── Call-site lookup ──────────────────────────────────────────────────────────

/**
 * Find external call sites for `fnName` via git-grep on HEAD.
 * Excludes the defining file (`skipFile`) from results.
 *
 * @param {string} worktreePath
 * @param {string} fnName
 * @param {string} skipFile  Relative path of the defining file
 * @returns {Promise<{ file: string, lineNum: number, snippet: string }[]>}
 */
async function findCallSites(worktreePath, fnName, skipFile) {
  if (!fnName || fnName === '<anonymous>') return [];

  try {
    const out = await spawnGit(
      ['grep', '-n', '--max-count', '5', '-E', `\\b${fnName}\\s*\\(`, 'HEAD', '--'],
      worktreePath,
    );

    return out
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => {
        // Format: HEAD:path/to/file:linenum:content
        const m = line.match(/^HEAD:(.+?):(\d+):(.*)$/);
        return m ? { file: m[1], lineNum: parseInt(m[2], 10), snippet: m[3].trim() } : null;
      })
      .filter(x => x !== null && x.file !== skipFile)
      .slice(0, MAX_CALL_SITES_PER_FN);
  } catch {
    return [];
  }
}

// ── Fallback: raw hunk context ────────────────────────────────────────────────

function buildRawHunkContext(source, ranges) {
  const lines = source.split('\n');
  return ranges
    .slice(0, 2)
    .map(r => {
      const s = Math.max(0, r.start - 3);
      const e = Math.min(lines.length, r.end + 3);
      return lines
        .slice(s, e)
        .map((l, i) => `${s + i + 1} | ${l}`)
        .join('\n');
    })
    .join('\n⋯\n');
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Build a targeted code graph for the current branch vs `baseBranch`.
 *
 * Extracts only the functions that contain changed lines and their external
 * call sites. Returns a markdown-formatted string for prompt injection, or
 * `null` when the graph is empty or analysis fails.
 *
 * @param {string} worktreePath  Absolute path to the git worktree
 * @param {string} baseBranch    Branch to diff against (e.g. 'main')
 * @returns {Promise<string|null>}
 */
export async function buildCodeGraph(worktreePath, baseBranch) {
  try {
    const diffText = await spawnGit(
      ['diff', `${baseBranch}...HEAD`, '--unified=0'],
      worktreePath,
    );
    if (!diffText.trim()) return null;

    const fileRanges = parseHunkRanges(diffText).slice(0, MAX_FILES);
    if (fileRanges.length === 0) return null;

    const sections = [];

    for (const { file, ranges } of fileRanges) {
      const absPath = join(worktreePath, file);
      if (!existsSync(absPath)) continue;

      const ext = extname(file).toLowerCase();
      if (!SUPPORTED_EXTS.has(ext)) {
        sections.push(`## \`${file}\`\n_Unsupported file type — skipped._\n`);
        continue;
      }

      let source;
      try {
        source = readFileSync(absPath, 'utf-8');
      } catch {
        continue;
      }

      const fns = extractFunctionsForRanges(source, ranges);

      if (fns.length === 0) {
        // No recognized function boundaries — show raw hunk context
        const raw = buildRawHunkContext(source, ranges);
        sections.push(`## \`${file}\`\n\`\`\`\n${raw}\n\`\`\``);
        continue;
      }

      const fileSections = [`## \`${file}\``];

      for (const fn of fns) {
        fileSections.push(
          `### \`${fn.name}\` (lines ${fn.startLine}–${fn.endLine})\n` +
          `\`\`\`\n${fn.body}\n\`\`\``,
        );

        const callSites = await findCallSites(worktreePath, fn.name, file);
        if (callSites.length > 0) {
          const list = callSites
            .map(cs => `- \`${cs.file}:${cs.lineNum}\`: \`${cs.snippet.slice(0, 120)}\``)
            .join('\n');
          fileSections.push(`**Call sites:**\n${list}`);
        }
      }

      sections.push(fileSections.join('\n\n'));
    }

    if (sections.length === 0) return null;

    return [
      '# Code Graph — Targeted Context',
      '',
      'Only the functions containing changed lines are shown, with their call sites.',
      'Review these targeted excerpts rather than loading entire files.',
      '',
      sections.join('\n\n---\n\n'),
    ].join('\n');
  } catch (err) {
    console.warn(`[code-graph] buildCodeGraph failed: ${err?.message}`);
    return null;
  }
}

/**
 * Rough token estimate for logging (≈4 chars per token).
 *
 * @param {string|null} text
 * @returns {number}
 */
export function estimateTokens(text) {
  return Math.ceil((text?.length || 0) / 4);
}
