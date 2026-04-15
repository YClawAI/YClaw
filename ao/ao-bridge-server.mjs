import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { getToken } from './token-manager.mjs';
import { AoQueueStore } from './queue-store.mjs';
import {
  buildSpawnIssueBody,
  buildSpawnIssueTitle,
  extractSpawnedSessionId,
} from './spawn-followup.mjs';
import {
  shouldRunReview,
  reviewAndRemediateLoop,
  reviewOnly,
  evaluateReviewResult,
  convertPrToDraft,
  disableAutoMerge,
  addReviewComment,
  addLabel,
  logReviewMetrics,
} from './review-gate.mjs';

const PORT = parseInt(process.env.AO_BRIDGE_PORT || '8420');
const AUTH_TOKEN = process.env.AO_AUTH_TOKEN;
const AO_CALLBACK_URL = process.env.AO_CALLBACK_URL || 'http://localhost:3000/api/ao/callback';
const AO_CALLBACK_FALLBACK_URL = process.env.AO_CALLBACK_FALLBACK_URL || null;
const MAX_CONCURRENT = parseInt(process.env.AO_MAX_CONCURRENT || '2', 10);
const MAX_QUEUE = parseInt(process.env.AO_MAX_QUEUE || '100');
const AO_BIN = process.env.AO_BIN || '/usr/local/bin/ao';
const REPO_ROOT = '/data/worktrees';
const REPO_LOCK_ROOT = '/data/ao-state/repo-locks';
const REPO_LOCK_TIMEOUT_MS = parseInt(process.env.AO_REPO_LOCK_TIMEOUT_MS || '60000', 10);
const REPO_LOCK_STALE_MS = parseInt(process.env.AO_REPO_LOCK_STALE_MS || '900000', 10);
const AO_MIN_FREE_KB = parseInt(process.env.AO_MIN_FREE_KB || '1048576', 10);
const queueStore = AoQueueStore.fromEnv();
const AO_HOME = process.env.HOME || '/data/ao-home';
const SESSION_POLL_INTERVAL_MS = parseInt(process.env.AO_SESSION_POLL_INTERVAL_MS || '10000', 10);
const SESSION_POLL_TIMEOUT_MS = parseInt(process.env.AO_SESSION_POLL_TIMEOUT_MS || '1200000', 10);
const SESSION_HARVEST_FALLBACK_MS = parseInt(process.env.AO_SESSION_HARVEST_FALLBACK_MS || '600000', 10);
const SESSION_SWEEP_INTERVAL_MS = parseInt(process.env.AO_SESSION_SWEEP_INTERVAL_MS || '60000', 10);

// --- Track active spawns for cleanup ---
const activeProcesses = new Map();
const pendingSpawnQueue = [];
let activeSpawns = 0;
let shuttingDown = false;
let githubAuthRefreshPromise = null;
let drainLoopActive = false;
const activeHarvests = new Set();

// --- In-memory session lock fallback (used when Redis is unavailable) ---
const SESSION_LOCK_TTL_MS = 3600 * 1000; // 1 hour
const SESSION_LOCK_RENEW_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const inMemorySessionLocks = new Map(); // sessionId → expiresAtMs

function _acquireSessionLockInMemory(sessionId) {
  const existing = inMemorySessionLocks.get(sessionId);
  if (existing !== undefined && Date.now() < existing) {
    return false; // lock already held
  }
  inMemorySessionLocks.set(sessionId, Date.now() + SESSION_LOCK_TTL_MS);
  return true;
}

function _renewSessionLockInMemory(sessionId) {
  inMemorySessionLocks.set(sessionId, Date.now() + SESSION_LOCK_TTL_MS);
}

function _releaseSessionLockInMemory(sessionId) {
  inMemorySessionLocks.delete(sessionId);
}

function _listActiveSessionLocksInMemory() {
  const now = Date.now();
  const active = [];
  for (const [sessionId, expiresAt] of inMemorySessionLocks) {
    if (now < expiresAt) {
      active.push(sessionId);
    } else {
      inMemorySessionLocks.delete(sessionId);
    }
  }
  return active;
}

async function acquireSessionLock(sessionId) {
  if (queueStore?.redis) {
    try {
      return await queueStore.acquireSessionLock(sessionId);
    } catch (err) {
      console.warn(`[ao-bridge] Redis session lock acquire failed for ${sessionId}, falling back to in-memory: ${err?.message}`);
    }
  }
  return _acquireSessionLockInMemory(sessionId);
}

async function renewSessionLock(sessionId) {
  if (queueStore?.redis) {
    try {
      await queueStore.renewSessionLock(sessionId);
      return;
    } catch (err) {
      console.warn(`[ao-bridge] Redis session lock renew failed for ${sessionId}, falling back to in-memory: ${err?.message}`);
    }
  }
  _renewSessionLockInMemory(sessionId);
}

async function releaseSessionLock(sessionId) {
  if (queueStore?.redis) {
    try {
      await queueStore.releaseSessionLock(sessionId);
    } catch (err) {
      console.warn(`[ao-bridge] Redis session lock release failed for ${sessionId}, falling back to in-memory: ${err?.message}`);
    }
  }
  // Always clean up in-memory lock too (belt-and-suspenders for fallback case)
  _releaseSessionLockInMemory(sessionId);
}

async function listActiveSessionLocks() {
  const lockIds = new Set(_listActiveSessionLocksInMemory());
  if (queueStore?.redis) {
    try {
      const redisIds = await queueStore.listActiveSessionLocks();
      for (const id of redisIds) {
        lockIds.add(id);
      }
    } catch (err) {
      console.warn(`[ao-bridge] Redis session lock list failed, using in-memory only: ${err?.message}`);
    }
  }
  return [...lockIds];
}

function trimOutput(value, max = 4000) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return trimmed.slice(-max);
}

function createProcessError(command, args, cwd, timeoutMs, code, stdout, stderr) {
  const error = new Error(
    `${command} exited with code ${code}: ${trimOutput(stderr) || trimOutput(stdout) || 'no output'}`,
  );
  error.command = command;
  error.args = Array.isArray(args) ? [...args] : [];
  error.cwd = cwd;
  error.timeoutMs = timeoutMs;
  error.code = code;
  error.stdout = trimOutput(stdout);
  error.stderr = trimOutput(stderr);
  return error;
}

function serializeError(err) {
  if (!err) {
    return { message: 'unknown error' };
  }

  return {
    message: err.message || String(err),
    stack: err.stack || null,
    command: err.command || null,
    args: Array.isArray(err.args) ? err.args : null,
    cwd: err.cwd || null,
    timeoutMs: typeof err.timeoutMs === 'number' ? err.timeoutMs : null,
    code: typeof err.code === 'number' ? err.code : null,
    stdout: typeof err.stdout === 'string' ? err.stdout : null,
    stderr: typeof err.stderr === 'string' ? err.stderr : null,
  };
}

/**
 * Convert a full "owner/name" repo slug into a filesystem-safe directory name.
 * Using double-underscore as a separator avoids collisions between repos that
 * share the same basename but belong to different organisations (e.g.
 * "OrgA/foo" → "OrgA__foo", "OrgB/foo" → "OrgB__foo").
 */
function repoSlug(repo) {
  return repo.replace(/\//g, '__');
}

function repoPathFor(repo) {
  return join(REPO_ROOT, repoSlug(repo));
}

function sessionWorktreePath(repo, sessionId) {
  // AO creates worktrees at $AO_HOME/.worktrees/<projectKey>/<sessionId>
  // where projectKey is the YAML key (e.g. "yclaw"), NOT the repo slug.
  const key = projectKeyForRepo(repo) || repoSlug(repo);
  return join(AO_HOME, '.worktrees', key, sessionId);
}

function resolveSessionWorktreePath(repo, sessionId) {
  const direct = sessionWorktreePath(repo, sessionId);
  if (existsSync(join(direct, '.git'))) {
    return direct;
  }

  // Fallback: also check the repo-slug-based path for backwards compat
  const slugPath = join(AO_HOME, '.worktrees', repoSlug(repo), sessionId);
  if (slugPath !== direct && existsSync(join(slugPath, '.git'))) {
    return slugPath;
  }

  const repoRoot = repoSessionRoot(repo);
  const candidates = listRepoSessionDirs(repo);
  const match = candidates.find((name) => (
    name === sessionId
    || sessionId.endsWith(`-${name}`)
  ));

  if (match) {
    return join(repoRoot, match);
  }

  return direct;
}

function repoSessionRoot(repo) {
  const key = projectKeyForRepo(repo) || repoSlug(repo);
  return join(AO_HOME, '.worktrees', key);
}

function sessionArtifactRoot() {
  return join(AO_HOME, '.ao-sessions');
}

function sessionMonitorRoot() {
  return join(AO_HOME, '.ao-monitor');
}

function sessionMonitorPath(sessionId) {
  return join(sessionMonitorRoot(), `${sessionId}.json`);
}

function writeSessionMonitorState(state) {
  mkdirSync(sessionMonitorRoot(), { recursive: true });
  writeFileSync(sessionMonitorPath(state.sessionId), JSON.stringify(state, null, 2));
}

function deleteSessionMonitorState(sessionId) {
  try {
    unlinkSync(sessionMonitorPath(sessionId));
  } catch {
    // Ignore already-removed state.
  }
}

function listSessionMonitorStates() {
  try {
    return readdirSync(sessionMonitorRoot())
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const raw = readFileSync(join(sessionMonitorRoot(), name), 'utf-8');
        return JSON.parse(raw);
      })
      .filter((state) => state?.sessionId && state?.repo);
  } catch {
    return [];
  }
}

function listRepoSessionDirs(repo) {
  try {
    return readdirSync(repoSessionRoot(repo), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function detectNewSessionId(repo, existingSessionDirs) {
  const current = listRepoSessionDirs(repo);
  const prior = new Set(existingSessionDirs);
  const added = current.filter((name) => !prior.has(name));
  if (added.length === 0) {
    return null;
  }

  const ranked = added
    .map((name) => {
      try {
        return {
          name,
          mtimeMs: statSync(sessionWorktreePath(repo, name)).mtimeMs,
        };
      } catch {
        return { name, mtimeMs: 0 };
      }
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return ranked[0]?.name || null;
}

async function ensureFreeDiskSpace() {
  const result = await runCommand('df', ['-Pk', '/data'], '/app', 5000);
  const lines = result.stdout.split('\n').filter(Boolean);
  const dataLine = lines[lines.length - 1] || '';
  const columns = dataLine.trim().split(/\s+/);
  const availableKb = Number.parseInt(columns[3] || '', 10);

  if (!Number.isFinite(availableKb)) {
    throw new Error('Unable to determine free disk space for /data');
  }
  if (availableKb < AO_MIN_FREE_KB) {
    throw new Error(`Insufficient disk space for repo bootstrap: ${availableKb}KB available`);
  }
}

async function withRepoLock(repoName, fn) {
  mkdirSync(REPO_LOCK_ROOT, { recursive: true });
  const lockPath = join(REPO_LOCK_ROOT, `${repoName}.lock`);
  const deadline = Date.now() + REPO_LOCK_TIMEOUT_MS;

  while (true) {
    try {
      mkdirSync(lockPath);
      writeFileSync(join(lockPath, 'owner'), String(process.pid));
      break;
    } catch (err) {
      if (err?.code !== 'EEXIST') {
        throw err;
      }

      try {
        const stats = statSync(lockPath);
        if (Date.now() - stats.mtimeMs > REPO_LOCK_STALE_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for repo lock for ${repoName}`);
      }
      await sleep(250);
    }
  }

  try {
    return await fn();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

async function detectDefaultBranch(repoPath) {
  try {
    const result = await runCommand('git', ['remote', 'show', 'origin'], repoPath, 15000);
    const line = result.stdout.split('\n').find((entry) => entry.includes('HEAD branch:'));
    const branch = line?.split(':').pop()?.trim();
    if (branch) {
      return branch;
    }
  } catch {
    // Fall through to defaults below.
  }

  try {
    const result = await runCommand('git', ['config', 'init.defaultBranch'], repoPath, 5000);
    if (result.stdout) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore and use hard-coded fallback.
  }

  return 'main';
}

async function syncRepoMirror(repo, repoPath) {
  const repoUrl = `https://github.com/${repo}.git`;
  const originUrlResult = await runCommand('git', ['remote', 'get-url', 'origin'], repoPath, 5000).catch(() => ({ stdout: '' }));
  if (/^git@github\.com:|^ssh:\/\/git@github\.com\//.test(originUrlResult.stdout)) {
    console.log(`[ao-bridge] Rewriting ${repo} origin from SSH to HTTPS`);
    await runCommand('git', ['remote', 'set-url', 'origin', repoUrl], repoPath, 10000);
  }

  const defaultBranch = await detectDefaultBranch(repoPath);
  await runCommand('git', ['fetch', 'origin', defaultBranch, '--prune'], repoPath, 120000);
  await runCommand('git', ['checkout', defaultBranch], repoPath, 20000).catch(async () => {
    await runCommand('git', ['checkout', '-b', defaultBranch, `origin/${defaultBranch}`], repoPath, 20000);
  });
  await runCommand('git', ['reset', '--hard', `origin/${defaultBranch}`], repoPath, 30000);
  await runCommand('git', ['clean', '-ffd'], repoPath, 30000);
}

async function ensureRepoMirror(repo) {
  const repoPath = repoPathFor(repo);
  const repoName = repoSlug(repo);
  const repoUrl = `https://github.com/${repo}.git`;

  mkdirSync(REPO_ROOT, { recursive: true });
  await refreshGitHubCliAuth();

  return withRepoLock(repoName, async () => {
    await ensureFreeDiskSpace();

    if (existsSync(repoPath)) {
      // Validate it's actually a working git repo
      try {
        await runCommand('git', ['-C', repoPath, 'rev-parse', '--is-inside-work-tree'], null, 10000);
        console.log(`[ao-bridge] Valid repo mirror found at ${repoPath}`);
      } catch {
        // Directory exists but isn't a valid git repo — corrupt/partial clone
        console.warn(`[ao-bridge] Invalid repo at ${repoPath}, removing and recloning...`);
        rmSync(repoPath, { recursive: true, force: true });
        console.log(`[ao-bridge] Bootstrapping fresh repo mirror for ${repo}`);
        await runCommand('git', ['clone', '--depth', '50', repoUrl, repoPath], REPO_ROOT, 180000);
      }
    } else {
      console.log(`[ao-bridge] Bootstrapping missing repo mirror for ${repo}`);
      await runCommand('git', ['clone', '--depth', '50', repoUrl, repoPath], REPO_ROOT, 180000);
    }

    await syncRepoMirror(repo, repoPath);
    await ensureAoProject(repo, repoPath);
    return repoPath;
  });
}

function aoConfigIncludesRepo(repo, repoPath) {
  try {
    const config = readFileSync('/app/agent-orchestrator.yaml', 'utf-8');
    const hasRepo = config.includes(`repo: ${repo}`);
    const hasPath = config.includes(`path: ${repoPath}`);

    // If the repo is known but points at an older/stale path, force re-registration
    // so AO's project config matches the actual mirror/worktree directory.
    if (hasRepo && !hasPath) {
      return false;
    }

    return hasRepo || hasPath;
  } catch {
    return false;
  }
}

function parseConfiguredProjects(config) {
  const lines = config.split(/\r?\n/);
  const projects = [];
  let inProjects = false;
  let current = null;

  for (const line of lines) {
    if (!inProjects) {
      if (/^projects:\s*$/.test(line)) {
        inProjects = true;
      }
      continue;
    }

    if (/^\S/.test(line)) {
      break;
    }

    const projectStart = line.match(/^  ([^:\s]+):\s*$/);
    if (projectStart) {
      if (current) {
        projects.push(current);
      }
      current = { name: projectStart[1], repo: null, path: null };
      continue;
    }

    if (!current) {
      continue;
    }

    const repoMatch = line.match(/^    repo:\s*(.+?)\s*$/);
    if (repoMatch) {
      current.repo = repoMatch[1];
      continue;
    }

    const pathMatch = line.match(/^    path:\s*(.+?)\s*$/);
    if (pathMatch) {
      current.path = pathMatch[1];
    }
  }

  if (current) {
    projects.push(current);
  }

  return projects;
}

/** Look up the AO project key (e.g. "yclaw") for a given repo slug. */
function projectKeyForRepo(repo) {
  try {
    const config = readFileSync('/app/agent-orchestrator.yaml', 'utf-8');
    for (const project of parseConfiguredProjects(config)) {
      if (project.repo === repo) {
        return project.name;
      }
    }
  } catch {}
  return null;
}

function validateConfiguredProjectContracts() {
  mkdirSync(REPO_ROOT, { recursive: true });
  const configPath = '/app/agent-orchestrator.yaml';
  const config = readFileSync(configPath, 'utf-8');

  for (const project of parseConfiguredProjects(config)) {
    if (!project.repo || !project.path) {
      continue;
    }

    const expectedPath = repoPathFor(project.repo);
    if (project.path !== expectedPath) {
      // Path format mismatch — warn but don't crash; ensureRepoMirror will
      // reconcile at request time when a spawn targets this repo.
      console.warn(`[ao-bridge] WARN: project ${project.repo} path mismatch — expected ${expectedPath}, YAML has ${project.path}`);
      continue;
    }

    if (!existsSync(expectedPath)) {
      mkdirSync(expectedPath, { recursive: true });
      console.warn(`[ao-bridge] WARN: auto-reconciled missing repo directory ${expectedPath} for ${project.repo}`);
    }

    if (!existsSync(join(expectedPath, '.git'))) {
      console.warn(`[ao-bridge] WARN: mirror not yet present at ${expectedPath} — will clone on first request`);
    }
  }
}

async function ensureAoProject(repo, repoPath) {
  if (aoConfigIncludesRepo(repo, repoPath)) {
    return;
  }

  console.log(`[ao-bridge] Registering AO project for ${repo} from ${repoPath}`);
  await runAo(['start', '--no-dashboard', '--no-orchestrator', repoPath], '/app', 120000);

  if (!aoConfigIncludesRepo(repo, repoPath)) {
    throw new Error(`AO project registration did not persist for ${repo}`);
  }
}

function runCommand(command, args, cwd, timeoutMs = 600000, stdinText = null, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(command, args, {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, ...envOverrides },
    });

    const MAX_OUTPUT = 1024 * 1024;

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(-MAX_OUTPUT);
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT) {
        stderr = stderr.slice(-MAX_OUTPUT);
      }
    });

    if (stdinText !== null) {
      proc.stdin.write(stdinText);
      proc.stdin.end();
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
      } else {
        reject(createProcessError(command, args, cwd, timeoutMs, code, stdout, stderr));
      }
    });

    proc.on('error', (err) => {
      err.command = command;
      err.args = Array.isArray(args) ? [...args] : [];
      err.cwd = cwd;
      err.timeoutMs = timeoutMs;
      err.stdout = trimOutput(stdout);
      err.stderr = trimOutput(stderr);
      reject(err);
    });
  });
}

function runAoUntilSessionId(args, cwd, repo, timeoutMs = 600000, extraEnv = {}) {
  return refreshGitHubCliAuth().then(() => new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let resolved = false;
    let timedOut = false;
    const existingSessionDirs = repo ? listRepoSessionDirs(repo) : [];

    const proc = spawn(AO_BIN, args, {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env, ...extraEnv },
    });

    activeProcesses.set(proc.pid, proc);

    const MAX_OUTPUT = 1024 * 1024;

    const maybeResolve = () => {
      if (resolved) {
        return;
      }
      const sessionId = extractSpawnedSessionId(stdout);
      if (sessionId) {
        resolved = true;
        resolve({
          sessionId,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          pid: proc.pid,
          resolvedBy: 'stdout',
        });
      }
    };

    const pollForSessionId = () => {
      if (resolved || !repo) {
        return;
      }
      const sessionId = detectNewSessionId(repo, existingSessionDirs);
      if (sessionId) {
        resolved = true;
        resolve({
          sessionId,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          pid: proc.pid,
          resolvedBy: 'worktree',
        });
      }
    };

    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(-MAX_OUTPUT);
      }
      maybeResolve();
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_OUTPUT) {
        stderr = stderr.slice(-MAX_OUTPUT);
      }
    });

    proc.on('close', (code) => {
      activeProcesses.delete(proc.pid);

      if (resolved) {
        if (code !== 0) {
          console.warn(`[ao-bridge] ao spawn process exited after session extraction with code ${code}`);
        }
        return;
      }

      reject(createProcessError('ao', args, cwd, timeoutMs, code, stdout, stderr));
    });

    proc.on('error', (err) => {
      activeProcesses.delete(proc.pid);
      if (resolved) {
        console.warn(`[ao-bridge] ao spawn process error after session extraction: ${err.message}`);
        return;
      }
      err.command = 'ao';
      err.args = Array.isArray(args) ? [...args] : [];
      err.cwd = cwd;
      err.timeoutMs = timeoutMs;
      err.stdout = trimOutput(stdout);
      err.stderr = trimOutput(stderr);
      reject(err);
    });

    proc.on('spawn', () => {
      const sessionPoll = setInterval(pollForSessionId, 1000);
      const timeout = setTimeout(() => {
        timedOut = true;
        if (!resolved) {
          try {
            proc.kill('SIGTERM');
          } catch {}
          reject(new Error(`ao spawn did not emit a session id within ${timeoutMs}ms`));
        }
      }, timeoutMs);

      const clearTimers = () => {
        clearTimeout(timeout);
        clearInterval(sessionPoll);
      };
      proc.on('close', clearTimers);
      proc.on('error', clearTimers);
      proc.stdout.on('data', () => {
        if (resolved || timedOut) {
          clearTimers();
        }
      });
    });
  }));
}

async function refreshGitHubCliAuth() {
  if (githubAuthRefreshPromise) {
    return githubAuthRefreshPromise;
  }

  githubAuthRefreshPromise = (async () => {
    const token = await getToken();
    await runCommand(
      'gh',
      ['auth', 'login', '--hostname', 'github.com', '--with-token'],
      '/app',
      15000,
      `${token}\n`,
      {
        GH_TOKEN: '',
        GITHUB_TOKEN: '',
      },
    );

    process.env.GH_TOKEN = token;
    process.env.GITHUB_TOKEN = token;

    try {
      await runCommand(
        'gh',
        ['auth', 'setup-git'],
        '/app',
        15000,
        null,
        {
          GH_TOKEN: '',
          GITHUB_TOKEN: '',
        },
      );
    } catch (err) {
      console.warn('[ao-bridge] gh auth setup-git failed:', err.message);
    }

    console.log('[ao-bridge] GitHub CLI auth refreshed');
  })().finally(() => {
    githubAuthRefreshPromise = null;
  });

  return githubAuthRefreshPromise;
}

async function postAoCallback(event) {
  const urls = [AO_CALLBACK_URL, AO_CALLBACK_FALLBACK_URL].filter(Boolean);
  const body = JSON.stringify(event);
  const headers = { 'Content-Type': 'application/json', 'X-AO-TOKEN': AUTH_TOKEN || '' };

  for (const url of urls) {
    try {
      console.log(`[ao-bridge] Posting AO callback ${event.type} for session ${event.sessionId || 'unknown'}${event.issueNumber ? ` (#${event.issueNumber})` : ''} → ${url}`);
      const res = await fetch(url, { method: 'POST', headers, body });
      if (!res.ok) {
        console.warn(`[ao-bridge] AO callback failed with HTTP ${res.status} for ${event.type} (${url})`);
        continue;
      }
      console.log(`[ao-bridge] AO callback delivered for ${event.type}`);
      return; // success — done
    } catch (err) {
      console.warn(`[ao-bridge] AO callback request failed (${url}):`, err?.message || String(err));
    }
  }
  console.error(`[ao-bridge] AO callback FAILED for ${event.type} — all URLs exhausted`);
}

async function runTrackedHarvest(meta, reason) {
  const key = `${meta.repo}:${meta.sessionId}`;
  if (activeHarvests.has(key)) {
    console.log(`[ao-bridge] Harvest already in progress for ${meta.sessionId}; skipping duplicate trigger (${reason})`);
    return;
  }

  activeHarvests.add(key);
  try {
    console.log(`[ao-bridge] Harvest trigger for ${meta.sessionId}: ${reason}`);
    await harvestSessionWorktree({
      sessionId: meta.sessionId,
      repo: meta.repo,
      issueNumber: meta.issueNumber,
      claimPr: meta.claimPr,
    });
    deleteSessionMonitorState(meta.sessionId);
  } catch (err) {
    console.error(`[ao-bridge] Harvest failed for session ${meta.sessionId}:`, err?.message || String(err));
    console.error('[ao-bridge] Harvest failure details:', JSON.stringify({
      sessionId: meta.sessionId,
      repo: meta.repo,
      issueNumber: meta.issueNumber ?? null,
      claimPr: meta.claimPr ?? null,
      reason,
      error: serializeError(err),
    }));
    await postAoCallback({
      type: 'session.failed',
      sessionId: meta.sessionId,
      issueNumber: meta.issueNumber,
      repo: meta.repo,
      error: err?.message || String(err),
    });
  } finally {
    activeHarvests.delete(key);
  }
}

async function isSessionActive(sessionId) {
  try {
    const result = await runAo(['session', 'ls'], '/app', 10000);
    return result.stdout.includes(sessionId);
  } catch (err) {
    // Cannot determine session state — assume alive.
    // The monitor deadline will catch truly dead sessions via timeout.
    console.warn(`[ao-bridge] isSessionActive check failed for ${sessionId}, assuming alive:`, err?.message || String(err));
    return true;
  }
}

function findSessionArtifactDir(sessionId) {
  try {
    const entries = readdirSync(sessionArtifactRoot(), { withFileTypes: true });
    const match = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(`-${sessionId}`));
    return match ? join(sessionArtifactRoot(), match.name) : null;
  } catch {
    return null;
  }
}

function readSessionOutcome(sessionId) {
  const artifactDir = findSessionArtifactDir(sessionId);
  const outcome = {
    artifactDir,
    subtype: null,
    result: null,
    stderr: '',
  };

  if (!artifactDir) {
    return outcome;
  }

  try {
    const outputPath = join(artifactDir, 'output.jsonl');
    const lines = readFileSync(outputPath, 'utf-8')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines.reverse()) {
      try {
        const parsed = JSON.parse(line);
        if (!outcome.subtype && typeof parsed?.subtype === 'string') {
          outcome.subtype = parsed.subtype;
        }
        if (!outcome.result && typeof parsed?.result === 'string') {
          outcome.result = parsed.result;
        }
        if (outcome.subtype || outcome.result) {
          break;
        }
      } catch {
        // Ignore malformed lines.
      }
    }
  } catch {
    // Ignore missing output logs.
  }

  try {
    outcome.stderr = trimOutput(readFileSync(join(artifactDir, 'stderr.log'), 'utf-8'));
  } catch {
    // Ignore missing stderr log.
  }

  return outcome;
}

async function cleanupSessionWorktree(worktreePath) {
  if (!existsSync(join(worktreePath, '.git'))) {
    return;
  }
  try {
    await runCommand('git', ['reset', '--hard'], worktreePath, 30000);
    await runCommand('git', ['clean', '-fdx'], worktreePath, 30000);
  } catch (err) {
    console.warn('[ao-bridge] Failed to clean session worktree:', err?.message || String(err));
  }
}

function extractPrFromGhOutput(output) {
  const match = output.match(/\/pull\/(\d+)/);
  if (!match?.[1]) {
    return null;
  }
  const prNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(prNumber) && prNumber > 0 ? prNumber : null;
}

async function armPrAutoMerge({ repo, pullNumber, cwd, attempts = 2 }) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await runCommand(
        'gh',
        ['pr', 'merge', String(pullNumber), '--repo', repo, '--auto', '--squash'],
        cwd,
        60000,
      );
      console.log(`[ao-bridge] Auto-merge armed for PR #${pullNumber}: true`);
      return { armed: true };
    } catch (err) {
      lastError = err;
      console.warn(`[ao-bridge] Auto-merge arm failed for PR #${pullNumber} on attempt ${attempt}: ${err?.message || String(err)}`);
      if (attempt < attempts) {
        await sleep(3000);
      }
    }
  }

  console.warn('[ao-bridge] Auto-merge arm ultimately failed:', JSON.stringify({
    repo,
    pullNumber,
    error: serializeError(lastError),
  }));
  console.log(`[ao-bridge] Auto-merge armed for PR #${pullNumber}: false`);
  return {
    armed: false,
    error: lastError?.message || String(lastError),
  };
}

// ─── Sensitive Path Detection ────────────────────────────────────────────────

const SENSITIVE_PATHS = [
  '.github/workflows/',
  '.github/',
  'packages/core/src/security/',
  'packages/core/src/review/',
  'deploy/',
  'Dockerfile',
  'docker-compose',
  'yclaw-event-policy.yaml',
  'SECURITY.md',
];

function touchesSensitivePaths(changedFiles) {
  return changedFiles.some(file =>
    SENSITIVE_PATHS.some(prefix => file.startsWith(prefix) || file === prefix)
  );
}

async function getChangedFiles(repo, pullNumber, cwd) {
  try {
    const result = await runCommand(
      'gh',
      ['pr', 'diff', String(pullNumber), '--repo', repo, '--name-only'],
      cwd,
      30000,
    );
    return (result.stdout || '').split('\n').map(f => f.trim()).filter(Boolean);
  } catch (err) {
    console.warn(`[ao-bridge] Failed to get changed files for PR #${pullNumber}: ${err?.message}`);
    return [];
  }
}

/**
 * Check if a PR touches sensitive paths. If so, block auto-merge and
 * request human review. Returns true if the PR was blocked.
 */
async function blockIfSensitivePaths({ repo, pullNumber, cwd, sessionId, issueNumber }) {
  const changedFiles = await getChangedFiles(repo, pullNumber, cwd);
  if (changedFiles.length === 0) return false;

  if (!touchesSensitivePaths(changedFiles)) return false;

  const sensitiveHits = changedFiles.filter(file =>
    SENSITIVE_PATHS.some(prefix => file.startsWith(prefix) || file === prefix)
  );
  console.log(`[ao-bridge] PR #${pullNumber} touches sensitive paths: ${sensitiveHits.join(', ')} — requesting human review`);

  await addLabel(repo, pullNumber, 'human-review-required', cwd);
  // Request review from admin
  await runCommand(
    'gh',
    ['pr', 'edit', String(pullNumber), '--repo', repo, '--add-reviewer', 'DannyDesert'],
    cwd,
    15000,
  ).catch(err => console.warn(`[ao-bridge] Failed to request review: ${err?.message}`));
  await disableAutoMerge(repo, pullNumber, cwd);

  await postAoCallback({
    type: 'task.blocked',
    sessionId,
    issueNumber,
    repo,
    error: `PR touches sensitive paths — human review required: ${sensitiveHits.join(', ')}`,
  });

  return true;
}

async function ensureSessionPr({ repo, issueNumber, branch, cwd, draft = false, bodyOverride = null }) {
  const existing = await runCommand(
    'gh',
    ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number,url'],
    cwd,
    30000,
  );

  try {
    const parsed = JSON.parse(existing.stdout || '[]');
    if (Array.isArray(parsed) && parsed[0]?.number && parsed[0]?.url) {
      return { prNumber: parsed[0].number, prUrl: parsed[0].url, created: false };
    }
  } catch {
    // Fall through to create.
  }

  const defaultBranch = await detectDefaultBranch(cwd);
  const title = issueNumber
    ? `fix(#${issueNumber}): apply AO changes`
    : `fix: apply AO changes`;
  const body = bodyOverride || (issueNumber
    ? `Automated changes for issue #${issueNumber}.\n\nCloses #${issueNumber}`
    : 'Automated changes from AO.');

  const prCreateArgs = ['pr', 'create', '--repo', repo, '--head', branch, '--base', defaultBranch, '--title', title, '--body', body];
  if (draft) prCreateArgs.push('--draft');

  const created = await runCommand(
    'gh',
    prCreateArgs,
    cwd,
    60000,
  );
  const prNumber = extractPrFromGhOutput(created.stdout);
  if (!prNumber) {
    throw new Error('Failed to parse created PR number from gh pr create output');
  }
  return { prNumber, prUrl: trimOutput(created.stdout), created: true };
}

/**
 * Graceful degradation: when a session's worktree is missing, attempt to
 * recover by finding an already-pushed branch on the remote and locating an
 * open or merged PR for it.  Returns `{ prNumber, prUrl, branch, state }` or `null`.
 * `state` is `'OPEN'` or `'MERGED'`.
 */
async function recoverPrFromRemote(repo, sessionId, issueNumber) {
  const repoPath = repoPathFor(repo);

  // Build candidate glob patterns that match branches AO would have created.
  const patterns = [];
  if (issueNumber) {
    patterns.push(`*issue-${issueNumber}*`, `*-${issueNumber}-*`);
  }
  patterns.push(`*${sessionId}*`);

  for (const pattern of patterns) {
    try {
      const result = await runCommand(
        'git', ['ls-remote', '--heads', 'origin', pattern], repoPath, 15000,
      );
      if (!result.stdout.trim()) {
        continue;
      }

      const branchRef = result.stdout.split('\n').filter(Boolean)[0]?.split('\t')[1];
      const branch = branchRef?.replace('refs/heads/', '');
      if (!branch) {
        continue;
      }

      console.log(`[ao-bridge] Graceful degradation: found remote branch ${branch} for session ${sessionId} (pattern: ${pattern})`);

      // Check open PRs first — if open, we can still arm auto-merge.
      const openPrList = await runCommand(
        'gh',
        ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'number,url'],
        repoPath,
        30000,
      ).catch(() => ({ stdout: '[]' }));

      let openPrs;
      try {
        openPrs = JSON.parse(openPrList.stdout || '[]');
      } catch {
        openPrs = [];
      }

      if (Array.isArray(openPrs) && openPrs[0]?.number) {
        console.log(`[ao-bridge] Graceful degradation: open PR #${openPrs[0].number} found for branch ${branch}`);
        return { prNumber: openPrs[0].number, prUrl: openPrs[0].url, branch, state: 'OPEN' };
      }

      // Also check merged PRs — a merged PR is the strongest completion signal.
      const mergedPrList = await runCommand(
        'gh',
        ['pr', 'list', '--repo', repo, '--head', branch, '--state', 'merged', '--json', 'number,url'],
        repoPath,
        30000,
      ).catch(() => ({ stdout: '[]' }));

      let mergedPrs;
      try {
        mergedPrs = JSON.parse(mergedPrList.stdout || '[]');
      } catch {
        mergedPrs = [];
      }

      if (Array.isArray(mergedPrs) && mergedPrs[0]?.number) {
        console.log(`[ao-bridge] Graceful degradation: merged PR #${mergedPrs[0].number} found for branch ${branch}`);
        return { prNumber: mergedPrs[0].number, prUrl: mergedPrs[0].url, branch, state: 'MERGED' };
      }
    } catch (err) {
      console.warn(`[ao-bridge] Graceful degradation: branch/PR lookup failed for pattern ${pattern}: ${err?.message}`);
    }
  }

  return null;
}

async function harvestSessionWorktree({ sessionId, repo, issueNumber, claimPr }) {
  const worktreePath = resolveSessionWorktreePath(repo, sessionId);
  const outcome = readSessionOutcome(sessionId);
  console.log(`[ao-bridge] Worktree lifecycle: harvest starting for session ${sessionId} at ${worktreePath}`);
  console.log(`[ao-bridge] Harvesting session ${sessionId} for ${repo}${issueNumber ? ` (#${issueNumber})` : ''}`, JSON.stringify({
    worktreePath,
    artifactDir: outcome.artifactDir,
    subtype: outcome.subtype,
    hasStderr: Boolean(outcome.stderr),
  }));

  const worktreeGitPath = join(worktreePath, '.git');
  const worktreePresent = existsSync(worktreeGitPath);
  console.log(`[ao-bridge] Worktree lifecycle: existence check for ${sessionId}: present=${worktreePresent} path=${worktreePath}`);

  if (!worktreePresent) {
    // Provide actionable diagnostics: list candidate dirs for debugging
    const sessionDirs = listRepoSessionDirs(repo);
    const artifactRoot = sessionArtifactRoot();
    console.error(`[ao-bridge] Worktree lifecycle: MISSING for session ${sessionId}`, JSON.stringify({
      sessionId,
      expectedPath: worktreePath,
      checkedGitPath: worktreeGitPath,
      repo,
      issueNumber: issueNumber ?? null,
      sessionDirsFound: sessionDirs,
      artifactDir: outcome.artifactDir ?? null,
      artifactRoot,
      subtype: outcome.subtype ?? null,
      stderrSnippet: outcome.stderr ? outcome.stderr.slice(0, 500) : null,
    }));

    // Before declaring failure, check whether the session already pushed a branch
    // and created/merged a PR.  This handles the "stdin timeout false-negative"
    // pattern: the AO session completes successfully (commits pushed, PR created)
    // but the worktree is cleaned up before harvest, causing a spurious failure.
    const recoveredPr = await recoverPrFromRemote(repo, sessionId, issueNumber).catch((err) => {
      console.warn(`[ao-bridge] Graceful degradation: PR recovery failed for session ${sessionId}: ${err?.message}`);
      return null;
    });

    if (recoveredPr) {
      console.log(
        `[ao-bridge] Graceful degradation: recovered ${recoveredPr.state} PR #${recoveredPr.prNumber} ` +
        `for session ${sessionId} despite missing worktree — reporting session.completed`,
      );

      // Arm auto-merge if the PR is still open (merged PRs cannot be re-merged).
      if (recoveredPr.state === 'OPEN') {
        const recoveredCwd = repoPathFor(repo);
        const recoveredBlocked = await blockIfSensitivePaths({
          repo,
          pullNumber: recoveredPr.prNumber,
          cwd: recoveredCwd,
          sessionId,
          issueNumber,
        });
        if (recoveredBlocked) {
          console.log(
            `[ao-bridge] Graceful degradation: recovered PR #${recoveredPr.prNumber} blocked for human review due to sensitive paths`,
          );
        } else {
          await armPrAutoMerge({ repo, pullNumber: recoveredPr.prNumber, cwd: recoveredCwd }).catch((err) => {
            console.warn(
              `[ao-bridge] Graceful degradation: auto-merge arm failed for recovered PR #${recoveredPr.prNumber}: ${err?.message}`,
            );
          });
        }
      }

      // Emit pr.ready (deduplicated via Redis when available).
      const prReadyDedup = queueStore?.redis
        ? await queueStore.redis.set(`ao:pr-ready:${sessionId}`, '1', 'EX', 3600, 'NX').catch(() => 'ERROR')
        : 'OK';
      if (prReadyDedup) {
        await postAoCallback({
          type: 'pr.ready',
          sessionId,
          issueNumber,
          repo,
          prNumber: recoveredPr.prNumber,
          prUrl: recoveredPr.prUrl,
        });
      } else {
        console.log(`[ao-bridge] Graceful degradation: pr.ready already emitted for ${sessionId}, skipping duplicate`);
      }

      await postAoCallback({
        type: 'session.completed',
        sessionId,
        issueNumber,
        repo,
        prNumber: recoveredPr.prNumber,
        prUrl: recoveredPr.prUrl,
      });
      return;
    }

    // No recoverable PR found — genuine failure.
    await postAoCallback({
      type: 'session.failed',
      sessionId,
      issueNumber,
      repo,
      error: outcome.stderr || `Session worktree missing after AO run (expected: ${worktreePath})`,
    });
    return;
  }

  console.log(`[ao-bridge] Worktree lifecycle: worktree confirmed present for ${sessionId}, proceeding with harvest`);

  const status = await runCommand('git', ['status', '--porcelain'], worktreePath, 10000).catch(() => ({ stdout: '' }));
  const dirty = Boolean(status.stdout.trim());
  console.log(`[ao-bridge] Harvest status for ${sessionId}: dirty=${dirty}`);

  if (!dirty) {
    console.log(`[ao-bridge] Harvest found no uncommitted changes for ${sessionId} — checking if Claude Code already pushed/created a PR`);

    // ── Clean-path PR resolution: Claude Code in interactive mode commits,
    // pushes, and creates PRs internally. Detect that and arm auto-merge.
    let resolvedPr = null;

    try {
      // 1. Check claimPr first (spawn request already supplied a PR number)
      if (claimPr) {
        console.log(`[ao-bridge] Clean harvest: using claimed PR #${claimPr} for ${sessionId}`);
        try {
          const prView = await runCommand('gh', ['pr', 'view', String(claimPr), '--repo', repo, '--json', 'number,url,state'], worktreePath, 30000);
          const parsed = JSON.parse(prView.stdout || '{}');
          if (parsed.state === 'OPEN') {
            resolvedPr = { prNumber: parsed.number || claimPr, prUrl: parsed.url, created: false };
          }
        } catch (err) {
          console.warn(`[ao-bridge] Clean harvest: claimPr #${claimPr} lookup failed: ${err?.message}`);
        }
      }

      // 2. Fall back to branch-based PR lookup — check if on a feature branch
      // regardless of subtype (error_max_turns sessions can still have valid PRs)
      if (!resolvedPr) {
        const branch = (await runCommand('git', ['branch', '--show-current'], worktreePath, 10000).catch(() => ({ stdout: '' }))).stdout.trim();
        const defaultBranch = branch ? await detectDefaultBranch(worktreePath).catch(() => 'main') : null;
        const isFeatureBranch = branch && branch !== defaultBranch;

        if (isFeatureBranch) {
          // Unconditional push: git push -u is idempotent, and a branch with
          // no upstream tracking ref (@{u}) would silently skip if we tried
          // to check rev-list first. Better to always push.
          console.log(`[ao-bridge] Clean harvest: ensuring branch ${branch} is pushed to origin`);
          await runCommand('git', ['push', '-u', 'origin', branch], worktreePath, 120000).catch((err) => {
            console.warn(`[ao-bridge] Clean harvest: push failed for ${branch}: ${err?.message}`);
          });

          // Bounded retry: 2 attempts, 3s delay (PR may still be creating)
          for (let attempt = 0; attempt < 2 && !resolvedPr; attempt++) {
            if (attempt > 0) {
              console.log(`[ao-bridge] Clean harvest: retry ${attempt + 1} for PR lookup on ${branch}`);
              await new Promise(r => setTimeout(r, 3000));
            }
            try {
              const pr = await ensureSessionPr({ repo, issueNumber, branch, cwd: worktreePath });
              resolvedPr = { prNumber: pr.prNumber, prUrl: pr.prUrl, created: pr.created };
            } catch (err) {
              console.warn(`[ao-bridge] Clean harvest: ensureSessionPr attempt ${attempt + 1} failed: ${err?.message}`);
            }
          }
        } else if (!branch) {
          console.log(`[ao-bridge] Clean harvest: session ${sessionId} has detached HEAD, skipping PR logic`);
        } else {
          console.log(`[ao-bridge] Clean harvest: session ${sessionId} on default branch (${branch}), skipping PR logic`);
        }
      }
    } catch (err) {
      console.warn(`[ao-bridge] Clean harvest PR resolution failed for ${sessionId}: ${err?.message}`);
    }

    // ── Codex Review Gate (clean path: post-push, pre-auto-merge) ──────
    if (resolvedPr) {
      let cleanReviewGate = null;
      const cleanBaseBranch = await detectDefaultBranch(worktreePath).catch(() => 'master');

      if (await shouldRunReview(worktreePath)) {
        cleanReviewGate = await reviewOnly({ worktreePath, baseBranch: cleanBaseBranch, issueNumber });
        logReviewMetrics(cleanReviewGate, { issueNumber, repo, path: 'clean', sessionId });
      }

      const cleanReviewFailed = cleanReviewGate && (cleanReviewGate.verdict === 'fail' || cleanReviewGate.verdict === 'fail-closed');
      const cleanReviewError = cleanReviewGate && cleanReviewGate.verdict === 'error';

      if (cleanReviewFailed) {
        // Review failed — block auto-merge, convert to draft, post findings
        console.warn(`[ao-bridge] Clean harvest: review ${cleanReviewGate.verdict} for PR #${resolvedPr.prNumber}`);
        let disableOk = await disableAutoMerge(repo, resolvedPr.prNumber, worktreePath);
        let draftOk = await convertPrToDraft(repo, resolvedPr.prNumber, worktreePath);
        // Retry once if blocking failed
        if (!disableOk) {
          console.warn(`[ao-bridge] Retrying disableAutoMerge for PR #${resolvedPr.prNumber}`);
          disableOk = await disableAutoMerge(repo, resolvedPr.prNumber, worktreePath);
        }
        if (!draftOk) {
          console.warn(`[ao-bridge] Retrying convertPrToDraft for PR #${resolvedPr.prNumber}`);
          draftOk = await convertPrToDraft(repo, resolvedPr.prNumber, worktreePath);
        }
        await addReviewComment(repo, resolvedPr.prNumber, cleanReviewGate, worktreePath);
        await addLabel(repo, resolvedPr.prNumber, 'review-failed', worktreePath);
        if (!disableOk || !draftOk) {
          console.error(`[ao-bridge] CRITICAL: Failed to block PR #${resolvedPr.prNumber} after review failure (disable=${disableOk}, draft=${draftOk}) — emitting session.failed`);
          await postAoCallback({
            type: 'session.failed', sessionId, issueNumber, repo,
            prNumber: resolvedPr.prNumber, prUrl: resolvedPr.prUrl,
            error: `Review failed but could not block PR #${resolvedPr.prNumber}`,
          });
          return;
        }
        // Do NOT emit pr.ready — PR is blocked
      } else {
        // Review passed or error (fail-open) — arm auto-merge
        if (cleanReviewError) {
          await addLabel(repo, resolvedPr.prNumber, 'review-skipped', worktreePath);
        }

        // Sensitive path guard — block auto-merge if PR touches protected paths
        const cleanBlocked = await blockIfSensitivePaths({ repo, pullNumber: resolvedPr.prNumber, cwd: worktreePath, sessionId, issueNumber });
        if (cleanBlocked) {
          console.log(`[ao-bridge] Clean harvest: PR #${resolvedPr.prNumber} blocked — sensitive paths, skipping auto-merge`);
        } else {
          console.log(`[ao-bridge] Clean harvest: arming auto-merge on PR #${resolvedPr.prNumber} for ${sessionId}`);
          const autoMergeResult = await armPrAutoMerge({ repo, pullNumber: resolvedPr.prNumber, cwd: worktreePath }).catch((err) => ({
            armed: false, error: err?.message,
          }));
          console.log(`[ao-bridge] Clean harvest auto-merge result for ${sessionId}: ${autoMergeResult.armed}`, JSON.stringify({
            repo, pullNumber: resolvedPr.prNumber, error: autoMergeResult.error || null,
          }));
        }

        // Emit pr.ready (routes to ao:pr_ready → deliverable submission)
        // Dedup via Redis to prevent duplicate events on repeat harvest
        const prReadyDedup = queueStore?.redis
          ? await queueStore.redis.set(`ao:pr-ready:${sessionId}`, '1', 'EX', 3600, 'NX').catch(() => 'ERROR')
          : 'OK'; // No Redis = always emit (hygiene cron is the safety net)
        if (prReadyDedup) {
          await postAoCallback({
            type: resolvedPr.created ? 'pr.created' : 'pr.ready',
            sessionId, issueNumber, repo,
            prNumber: resolvedPr.prNumber, prUrl: resolvedPr.prUrl,
          });
        } else {
          console.log(`[ao-bridge] Clean harvest: pr.ready already emitted for ${sessionId}, skipping duplicate`);
        }
      }
    }

    // Always emit session completion/failure callback
    await postAoCallback({
      type: outcome.subtype === 'error_max_turns' ? 'session.failed' : 'session.completed',
      sessionId,
      issueNumber,
      repo,
      prNumber: resolvedPr?.prNumber || undefined,
      prUrl: resolvedPr?.prUrl || undefined,
      error: outcome.subtype === 'error_max_turns' ? (outcome.stderr || 'AO session hit max turns with no changes') : undefined,
    });
    return;
  }

  const branch = (await runCommand('git', ['branch', '--show-current'], worktreePath, 10000)).stdout.trim();
  const commitMessage = issueNumber
    ? `fix(#${issueNumber}): apply AO changes`
    : 'fix: apply AO changes';
  console.log(`[ao-bridge] Harvest preparing commit on ${branch} for ${sessionId}`);

  console.log(`[ao-bridge] Harvest git add for ${sessionId}`);
  await runCommand('git', ['add', '-A'], worktreePath, 30000);
  console.log(`[ao-bridge] Harvest git commit for ${sessionId}`);
  await runCommand('git', ['commit', '-m', commitMessage], worktreePath, 60000).catch(async (err) => {
    const statusRetry = await runCommand('git', ['status', '--porcelain'], worktreePath, 10000).catch(() => ({ stdout: '' }));
    if (!statusRetry.stdout.trim()) {
      console.log(`[ao-bridge] Harvest commit skipped for ${sessionId}; tree clean after add`);
      return;
    }
    throw err;
  });
  // ── Codex Review Gate (dirty path: pre-push) ──────────────────────────
  const defaultBranchForReview = await detectDefaultBranch(worktreePath).catch(() => 'master');
  let dirtyReviewGate = null;
  if (await shouldRunReview(worktreePath)) {
    dirtyReviewGate = await reviewAndRemediateLoop({
      worktreePath,
      baseBranch: defaultBranchForReview,
      issueNumber,
      renewLock: () => renewSessionLock(sessionId),
    });
    logReviewMetrics(dirtyReviewGate, { issueNumber, repo, path: 'dirty', sessionId });

    // Fail-closed: P0 findings — do NOT push, create draft PR with findings
    if (dirtyReviewGate.verdict === 'fail-closed') {
      console.error(`[ao-bridge] Review gate FAIL-CLOSED for ${sessionId} — pushing as draft`);
      await runCommand('git', ['push', '-u', 'origin', branch], worktreePath, 120000);
      const findingsBody = formatReviewFindingsForPr(dirtyReviewGate, issueNumber);
      const pr = await ensureSessionPr({ repo, issueNumber, branch, cwd: worktreePath, draft: true, bodyOverride: findingsBody });
      // Enforce blocking even on existing PRs
      await disableAutoMerge(repo, pr.prNumber, worktreePath);
      await convertPrToDraft(repo, pr.prNumber, worktreePath);
      await addLabel(repo, pr.prNumber, 'review-failed', worktreePath);
      await postAoCallback({
        type: 'session.completed', sessionId, issueNumber, repo,
        prNumber: pr.prNumber, prUrl: pr.prUrl,
      });
      return;
    }
  }

  console.log(`[ao-bridge] Harvest git push for ${sessionId}`);
  await runCommand('git', ['push', '-u', 'origin', branch], worktreePath, 120000);

  let harvestPrNumber = null;
  let harvestPrUrl = null;
  // If review failed (but not fail-closed), still push + create PR, but as draft with no auto-merge
  const reviewFailed = dirtyReviewGate && dirtyReviewGate.verdict === 'fail';
  const reviewError = dirtyReviewGate && dirtyReviewGate.verdict === 'error';

  if (claimPr) {
    console.log(`[ao-bridge] Harvest reusing claimed PR #${claimPr} for ${sessionId}`);
    const prView = await runCommand('gh', ['pr', 'view', String(claimPr), '--repo', repo, '--json', 'number,url'], worktreePath, 30000);
    const parsed = JSON.parse(prView.stdout || '{}');
    harvestPrNumber = parsed.number || claimPr;
    harvestPrUrl = parsed.url;
    if (reviewFailed) {
      await disableAutoMerge(repo, harvestPrNumber, worktreePath);
      const draftOk = await convertPrToDraft(repo, harvestPrNumber, worktreePath);
      await addReviewComment(repo, harvestPrNumber, dirtyReviewGate, worktreePath);
      await addLabel(repo, harvestPrNumber, 'review-failed', worktreePath);
      if (!draftOk) {
        console.error(`[ao-bridge] CRITICAL: Failed to convert claimed PR #${harvestPrNumber} to draft after review failure`);
      }
    } else if (reviewError) {
      await addLabel(repo, harvestPrNumber, 'review-skipped', worktreePath);
      // Fail-open: still arm auto-merge (unless sensitive paths)
      const blocked = await blockIfSensitivePaths({ repo, pullNumber: harvestPrNumber, cwd: worktreePath, sessionId, issueNumber });
      if (!blocked) {
        const autoMergeResult = await armPrAutoMerge({ repo, pullNumber: harvestPrNumber, cwd: worktreePath });
        console.log(`[ao-bridge] Harvest auto-merge armed result for ${sessionId}: ${autoMergeResult.armed}`);
      }
      await postAoCallback({ type: 'pr.ready', sessionId, issueNumber, repo, prNumber: harvestPrNumber, prUrl: harvestPrUrl });
    } else {
      const blocked = await blockIfSensitivePaths({ repo, pullNumber: harvestPrNumber, cwd: worktreePath, sessionId, issueNumber });
      if (!blocked) {
        const autoMergeResult = await armPrAutoMerge({ repo, pullNumber: harvestPrNumber, cwd: worktreePath });
        console.log(`[ao-bridge] Harvest auto-merge armed result for ${sessionId}: ${autoMergeResult.armed}`, JSON.stringify({
          repo, pullNumber: harvestPrNumber, error: autoMergeResult.error || null,
        }));
      }
      await postAoCallback({ type: 'pr.ready', sessionId, issueNumber, repo, prNumber: harvestPrNumber, prUrl: harvestPrUrl });
    }
  } else {
    console.log(`[ao-bridge] Harvest ensuring PR for ${sessionId}`);
    if (reviewFailed) {
      const findingsBody = formatReviewFindingsForPr(dirtyReviewGate, issueNumber);
      const pr = await ensureSessionPr({ repo, issueNumber, branch, cwd: worktreePath, draft: true, bodyOverride: findingsBody });
      harvestPrNumber = pr.prNumber;
      harvestPrUrl = pr.prUrl;
      // Enforce blocking even on existing PRs (ensureSessionPr may have found one)
      await disableAutoMerge(repo, harvestPrNumber, worktreePath);
      await convertPrToDraft(repo, harvestPrNumber, worktreePath);
      await addLabel(repo, harvestPrNumber, 'review-failed', worktreePath);
    } else {
      const pr = await ensureSessionPr({ repo, issueNumber, branch, cwd: worktreePath });
      harvestPrNumber = pr.prNumber;
      harvestPrUrl = pr.prUrl;
      if (reviewError) {
        await addLabel(repo, harvestPrNumber, 'review-skipped', worktreePath);
      }
      const blocked = await blockIfSensitivePaths({ repo, pullNumber: harvestPrNumber, cwd: worktreePath, sessionId, issueNumber });
      if (!blocked) {
        const autoMergeResult = await armPrAutoMerge({ repo, pullNumber: harvestPrNumber, cwd: worktreePath });
        console.log(`[ao-bridge] Harvest auto-merge armed result for ${sessionId}: ${autoMergeResult.armed}`, JSON.stringify({
          repo, pullNumber: harvestPrNumber, created: pr.created, error: autoMergeResult.error || null,
        }));
      }
      await postAoCallback({
        type: pr.created ? 'pr.created' : 'pr.ready', sessionId, issueNumber, repo,
        prNumber: harvestPrNumber, prUrl: harvestPrUrl,
      });
    }
  }

  console.log(`[ao-bridge] Harvest completed for ${sessionId} (review: ${dirtyReviewGate?.verdict || 'skipped'})`);
  await postAoCallback({
    type: 'session.completed', sessionId, issueNumber, repo,
    prNumber: harvestPrNumber || undefined, prUrl: harvestPrUrl || undefined,
  });
}

/** Format review findings for inclusion in a PR body */
function formatReviewFindingsForPr(gateResult, issueNumber) {
  const r = gateResult.result;
  const header = issueNumber
    ? `Automated changes for issue #${issueNumber}.\n\nCloses #${issueNumber}`
    : 'Automated changes from AO.';
  if (!r) return header;

  const findingsText = r.findings
    .map(f => `- **${f.title}**: ${f.body?.slice(0, 300) || 'No details'}`)
    .join('\n');

  return [
    header,
    '',
    '---',
    `## ⚠️ Codex Review: ${r.overall_correctness}`,
    `Confidence: ${((r.overall_confidence_score || 0) * 100).toFixed(0)}% | Findings: ${r.findings.length}`,
    '',
    r.overall_explanation || '',
    '',
    findingsText,
  ].join('\n');
}

async function monitorSpawnedSession({ sessionId, repo, issueNumber, claimPr }) {
  const deadline = Date.now() + SESSION_POLL_TIMEOUT_MS;
  console.log(`[ao-bridge] Monitoring spawned session ${sessionId} for ${repo}${issueNumber ? ` (#${issueNumber})` : ''}`);
  let finished = false;
  let tick = 0;
  const meta = { sessionId, repo, issueNumber, claimPr };

  // Acquire session lock to prevent premature cleanup of this session's worktree.
  // The lock is held for the full monitoring lifetime and released after harvest.
  const lockAcquired = await acquireSessionLock(sessionId).catch((err) => {
    console.warn(`[ao-bridge] Failed to acquire session lock for ${sessionId}: ${err?.message}`);
    return false;
  });
  console.log(`[ao-bridge] Worktree lifecycle: session lock ${lockAcquired ? 'acquired' : 'already held'} for ${sessionId}`);

  // Periodically renew the lock so it does not expire for long-running sessions.
  const lockRenewal = setInterval(async () => {
    try {
      await renewSessionLock(sessionId);
      console.log(`[ao-bridge] Worktree lifecycle: session lock renewed for ${sessionId}`);
    } catch (err) {
      console.warn(`[ao-bridge] Failed to renew session lock for ${sessionId}: ${err?.message}`);
    }
  }, SESSION_LOCK_RENEW_INTERVAL_MS);

  const triggerHarvest = async (reason) => {
    if (finished) {
      return;
    }
    finished = true;
    console.log(`[ao-bridge] Monitor completion for ${sessionId}: ${reason}; triggering harvest`);
    await runTrackedHarvest(meta, reason);
  };

  const fallbackTimer = setTimeout(() => {
    void triggerHarvest(`fallback-timeout:${Math.floor(SESSION_HARVEST_FALLBACK_MS / 1000)}s`);
  }, SESSION_HARVEST_FALLBACK_MS);

  // Initial delay: let the session register in `ao session ls` before polling.
  // Without this, the first tick fires before AO registers the session, causing
  // isSessionActive() to return false and triggering an immediate false harvest.
  const MONITOR_INITIAL_DELAY_MS = 10000;
  console.log(`[ao-bridge] Monitor waiting ${MONITOR_INITIAL_DELAY_MS / 1000}s for session ${sessionId} to register`);
  await sleep(MONITOR_INITIAL_DELAY_MS);

  try {
    while (!finished && Date.now() < deadline) {
      tick += 1;
      console.log(`[ao-bridge] Monitor poll start ${tick} for ${sessionId}`);
      let active = false;
      try {
        active = await isSessionActive(sessionId);
      } catch (err) {
        console.warn(`[ao-bridge] Monitor session check failed for ${sessionId} on tick ${tick}: ${err?.message || String(err)}`);
      }

      const outcome = readSessionOutcome(sessionId);
      console.log(`[ao-bridge] Monitor tick ${tick} for ${sessionId}: active=${active} subtype=${outcome.subtype || 'none'} artifactDir=${outcome.artifactDir || 'none'}`);

      if (!active) {
        await triggerHarvest('session-gone');
        return;
      }

      if (outcome.subtype && ['completed', 'exited', 'error_max_turns'].includes(outcome.subtype)) {
        await triggerHarvest(`outcome:${outcome.subtype}`);
        return;
      }

      await sleep(SESSION_POLL_INTERVAL_MS);
    }

    if (!finished) {
      console.warn(`[ao-bridge] Session ${sessionId} timed out after ${Math.floor(SESSION_POLL_TIMEOUT_MS / 1000)}s`);
      await triggerHarvest(`monitor-timeout:${Math.floor(SESSION_POLL_TIMEOUT_MS / 1000)}s`);
      await cleanupSessionWorktree(resolveSessionWorktreePath(repo, sessionId));
    }
  } finally {
    clearInterval(lockRenewal);
    clearTimeout(fallbackTimer);
    await releaseSessionLock(sessionId).catch((err) => {
      console.warn(`[ao-bridge] Failed to release session lock for ${sessionId}: ${err?.message}`);
    });
    console.log(`[ao-bridge] Worktree lifecycle: session lock released for ${sessionId}`);
  }
}

async function resumeSessionMonitors() {
  const states = listSessionMonitorStates();
  if (states.length === 0) {
    console.log('[ao-bridge] No persisted session monitor states to resume.');
    return;
  }

  console.log(`[ao-bridge] Resuming monitors for ${states.length} persisted session(s)...`);

  let sessionList = '';
  try {
    const result = await runAo(['session', 'ls'], '/app', 10000);
    sessionList = result.stdout;
  } catch (err) {
    console.warn('[ao-bridge] resumeSessionMonitors could not list sessions:', err?.message || String(err));
  }

  for (const state of states) {
    const { sessionId, repo, issueNumber, claimPr } = state;
    if (!sessionList.includes(sessionId)) {
      // Session is already gone — hand off directly to the harvest path.
      console.log(`[ao-bridge] Resumed session ${sessionId} is no longer active; triggering harvest`);
      void runTrackedHarvest(state, 'resume-gone').catch((err) => {
        console.error(`[ao-bridge] Harvest on resume failed for ${sessionId}:`, err?.message || String(err));
      });
    } else {
      // Session is still running — reattach the monitor so it gets
      // a fresh fallback timer and normal harvest handling.
      console.log(`[ao-bridge] Reattaching monitor for resumed session ${sessionId}`);
      void monitorSpawnedSession({ sessionId, repo, issueNumber, claimPr }).catch(async (err) => {
        console.error(`[ao-bridge] Resumed monitorSpawnedSession crashed for ${sessionId}:`, err?.message || String(err));
        await postAoCallback({
          type: 'session.failed',
          sessionId,
          issueNumber,
          repo,
          error: err?.message || String(err),
        });
      });
    }
  }
}

async function sweepOrphanedSessionHarvests() {
  const states = listSessionMonitorStates();
  if (states.length === 0) {
    return;
  }

  let sessionList = '';
  try {
    const result = await runAo(['session', 'ls'], '/app', 10000);
    sessionList = result.stdout;
  } catch (err) {
    console.warn('[ao-bridge] Session harvest sweeper could not list sessions (fail-open, skipping sweep):', err?.message || String(err));
    return; // No data = no action. Never kill sessions when we can't see the ground truth.
  }

  for (const state of states) {
    const orphanMissCount = state._orphanMissCount || 0;
    if (!sessionList.includes(state.sessionId)) {
      // Require consecutive confirmed misses before harvesting
      state._orphanMissCount = orphanMissCount + 1;
      writeSessionMonitorState(state);
      if (state._orphanMissCount >= 2) {
        console.log(`[ao-bridge] Orphan confirmed after ${state._orphanMissCount} consecutive misses: ${state.sessionId}`);
        void runTrackedHarvest(state, 'orphan-sweeper');
      } else {
        console.warn(`[ao-bridge] Sweeper miss ${state._orphanMissCount}/2 for ${state.sessionId}; deferring harvest`);
      }
    } else if (orphanMissCount !== 0) {
      state._orphanMissCount = 0; // Reset on successful sighting
      writeSessionMonitorState(state);
    }
  }
}

async function executeSpawnJob(job) {
  const {
    id: spawnId,
    repo,
    issueNumber,
    cleanupIssueNumber,
    claimPr,
    directive,
    context,
    orchestrator,
  } = job;
  const safeRepo = sanitizeRepo(repo) || 'your-org/your-project';
  let cwd = repoPathFor(safeRepo);
  const issue = sanitizeIssue(issueNumber);
  const cleanupIssue = sanitizeIssue(cleanupIssueNumber || issue);
  const claimedPr = sanitizeIssue(claimPr);
  const hasDirective = typeof directive === 'string' && directive.trim().length > 0;

  let args;
  let callbackIssue = cleanupIssue || issue;

  try {
    cwd = await ensureRepoMirror(safeRepo);

    // ── Pre-spawn guard: skip if issue already has a merged PR ────────────────
    // When an AO session reports session.failed due to a stdin-timeout but the
    // work was actually done (branch pushed, PR merged), the orchestrator may
    // re-dispatch the same issue.  Detect this by checking for a merged PR
    // associated with the issue before spawning a new session.  We only do this
    // for plain issue spawns (no directive, no claimed PR) to avoid blocking
    // legitimate repair cycles.
    if (issue && !hasDirective && !claimedPr) {
      const mergedPr = await (async () => {
        const issuePatterns = [`*issue-${issue}*`, `*-${issue}-*`];
        for (const pattern of issuePatterns) {
          try {
            const lsResult = await runCommand('git', ['ls-remote', '--heads', 'origin', pattern], cwd, 15000);
            const branchRef = lsResult.stdout.split('\n').filter(Boolean)[0]?.split('\t')[1];
            const branch = branchRef?.replace('refs/heads/', '');
            if (!branch) continue;

            const mergedResult = await runCommand(
              'gh',
              ['pr', 'list', '--repo', safeRepo, '--head', branch, '--state', 'merged', '--json', 'number,url'],
              cwd,
              30000,
            ).catch(() => ({ stdout: '[]' }));
            const prs = JSON.parse(mergedResult.stdout || '[]');
            if (Array.isArray(prs) && prs[0]?.number) {
              return { prNumber: prs[0].number, prUrl: prs[0].url };
            }
          } catch {
            // Pattern not found or gh call failed — try the next pattern.
          }
        }
        return null;
      })().catch((err) => {
        console.warn(`[ao-bridge] Pre-spawn merged-PR check failed for issue #${issue}: ${err?.message}`);
        return null;
      });

      if (mergedPr) {
        console.log(
          `[ao-bridge] Pre-spawn: issue #${issue} already has merged PR #${mergedPr.prNumber} — ` +
          `skipping spawn and reporting session.completed to prevent duplicate retry`,
        );
        await postAoCallback({
          type: 'session.completed',
          sessionId: spawnId,
          issueNumber: callbackIssue || issue,
          repo: safeRepo,
          prNumber: mergedPr.prNumber,
          prUrl: mergedPr.prUrl,
        });
        return;
      }
    }
    // ── End pre-spawn guard ───────────────────────────────────────────────────

    if (hasDirective && claimedPr) {
      const title = buildSpawnIssueTitle({ directive, claimPr: claimedPr, issueNumber: cleanupIssue || issue });
      const body = buildSpawnIssueBody({
        directive,
        context,
        claimPr: claimedPr,
        issueNumber: cleanupIssue || issue,
      });

      console.log(`[ao-bridge] Creating repair issue in ${safeRepo} for PR #${claimedPr}`);
      const createdIssue = await createDirectiveIssue({ repo: safeRepo, title, body, cwd });
      args = ['spawn', String(createdIssue), '--claim-pr', String(claimedPr)];
      callbackIssue = cleanupIssue || issue || createdIssue;
      console.log(`[ao-bridge] Created repair issue #${createdIssue}, spawning with claimed PR #${claimedPr}`);
    } else if (issue) {
      args = ['spawn', String(issue)];
    } else if (hasDirective) {
      const title = buildSpawnIssueTitle({ directive });
      const body = buildSpawnIssueBody({ directive, context });

      console.log(`[ao-bridge] No issue provided — creating issue in ${safeRepo} for directive`);
      const createdIssue = await createDirectiveIssue({ repo: safeRepo, title, body, cwd });
      args = ['spawn', String(createdIssue)];
      callbackIssue = createdIssue;
      console.log(`[ao-bridge] Created issue #${createdIssue}, spawning`);
    } else {
      throw new Error('issueNumber, issueUrl, or directive required');
    }

    // Note: 'codex' is intentionally excluded – the shipped adapter (ao/adapters/agent-codex.mjs)
    // is a placeholder and the AO image does not register a codex plugin in the plugin-registry.
    // Re-add 'codex' here only after the adapter is implemented and registered in register-plugins.sh.
    const validAgents = ['claude-code', 'aider', 'opencode', 'pi-rpc', 'claude-code-headless'];
    if (orchestrator && validAgents.includes(orchestrator)) {
      args.push('--agent', orchestrator);
    }

    // Resolve AO project key so `ao spawn` doesn't fail with
    // "Multiple projects configured. Specify one: ..."
    // AO 0.2.1 uses AO_PROJECT_ID env var, not a --project flag.
    const projectKey = projectKeyForRepo(safeRepo);

    const issueForCleanup = sanitizeIssue(cleanupIssue || args[1]);
    if (issueForCleanup) {
      await cleanupWorktreesForIssue(issueForCleanup);
    }

    // Snapshot all existing session artifact dirs BEFORE spawn. After spawn
    // resolves, we only delete dirs that existed before this run — never dirs
    // that AO created for the current session (fixes TOCTOU race).
    const preSpawnArtifactDirs = new Set();
    try {
      const artifactRoot = resolve(sessionArtifactRoot());
      for (const entry of readdirSync(artifactRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) preSpawnArtifactDirs.add(join(artifactRoot, entry.name));
      }
    } catch { /* no artifact root yet */ }

    await refreshGitHubCliAuth();

    const spawnEnv = projectKey ? { AO_PROJECT_ID: projectKey } : {};
    console.log(`[ao-bridge] Spawning (async): ao ${args.join(' ')} (cwd: ${cwd})${projectKey ? ` [project: ${projectKey}]` : ''}`);
    const result = await runAoUntilSessionId(args, cwd, safeRepo, 600000, spawnEnv);
    console.log('[ao-bridge] ao spawn raw result:', JSON.stringify({
      spawnId,
      repo: safeRepo,
      issueNumber: issue ?? null,
      callbackIssue: callbackIssue ?? null,
      stdout: trimOutput(result.stdout, 2000),
      stderr: trimOutput(result.stderr, 2000),
      resolvedBy: result.resolvedBy || 'unknown',
    }));
    const sessionId = result.sessionId;
    console.log(`[ao-bridge] Extracted session id for ${spawnId}: ${sessionId}`);

    // Clean stale session artifacts (output.jsonl, stderr.log) from prior sessions
    // with the same session ID. Without this, the monitor reads a stale output.jsonl
    // from a previous run and immediately triggers harvest with a false subtype.
    // Only delete dirs that existed BEFORE this spawn (pre-spawn snapshot) to avoid
    // a TOCTOU race where we'd delete fresh artifacts AO just created.
    const staleArtifactDir = findSessionArtifactDir(sessionId);
    const resolvedArtifactRoot = resolve(sessionArtifactRoot()) + '/';
    if (staleArtifactDir
        && preSpawnArtifactDirs.has(staleArtifactDir)
        && resolve(staleArtifactDir).startsWith(resolvedArtifactRoot)) {
      console.log(`[ao-bridge] Cleaning stale session artifacts (pre-spawn snapshot): ${staleArtifactDir}`);
      try {
        rmSync(staleArtifactDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[ao-bridge] Failed to clean stale artifacts for ${sessionId}: ${err?.message}`);
      }
    } else if (staleArtifactDir && !preSpawnArtifactDirs.has(staleArtifactDir)) {
      console.log(`[ao-bridge] Artifact dir for ${sessionId} was created during spawn — skipping cleanup (not stale)`);
    }

    writeSessionMonitorState({
      sessionId,
      repo: safeRepo,
      issueNumber: callbackIssue || issue,
      claimPr: claimedPr,
      startedAt: new Date().toISOString(),
    });

    console.log(`[ao-bridge] Starting monitor for ${spawnId} -> session ${sessionId}`);
    void monitorSpawnedSession({
      sessionId,
      repo: safeRepo,
      issueNumber: callbackIssue || issue,
      claimPr: claimedPr,
    }).catch(async (err) => {
      console.error(`[ao-bridge] monitorSpawnedSession crashed for ${sessionId}:`, err?.message || String(err));
      console.error('[ao-bridge] monitorSpawnedSession crash details:', JSON.stringify({
        sessionId,
        repo: safeRepo,
        issueNumber: callbackIssue || issue || null,
        claimPr: claimedPr ?? null,
        error: serializeError(err),
      }));
      await postAoCallback({
        type: 'session.failed',
        sessionId,
        issueNumber: callbackIssue || issue,
        repo: safeRepo,
        error: err?.message || String(err),
      });
    });
    console.log(`[ao-bridge] Spawn ${spawnId} completed: ${result.stdout.slice(0, 200)}`);
  } catch (err) {
    const errorDetails = serializeError(err);
    console.error(`[ao-bridge] Spawn ${spawnId} failed: ${errorDetails.message}`);
    console.error('[ao-bridge] Spawn failure details:', JSON.stringify({
      spawnId,
      repo: safeRepo,
      issueNumber: issue ?? null,
      cleanupIssueNumber: cleanupIssue ?? null,
      claimPr: claimedPr ?? null,
      callbackIssue: callbackIssue ?? null,
      cwd,
      args,
      error: errorDetails,
    }));
    // AO's webhook notifier handles failure notification to yclaw.
    // Safety net: manually call the callback endpoint
    fetch(AO_CALLBACK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AO-TOKEN': AUTH_TOKEN || '',
      },
      body: JSON.stringify({
        type: 'session.failed',
        sessionId: spawnId,
        issueNumber: callbackIssue,
        repo: safeRepo,
        error: err.message,
      }),
    }).catch(() => {}); // Best effort
  } finally {
    activeSpawns = Math.max(0, activeSpawns - 1);
    await completeSpawnJob(job);
    setImmediate(() => {
      void drainSpawnQueue();
    });
  }
}

async function getQueueMetrics() {
  if (queueStore) {
    return queueStore.metrics();
  }
  const oldest = pendingSpawnQueue[0];
  const oldestQueuedAgeSec = oldest?.queuedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(oldest.queuedAt).getTime()) / 1000))
    : 0;
  return {
    pendingCount: pendingSpawnQueue.length,
    runningCount: activeSpawns,
    oldestQueuedAgeSec,
  };
}

async function queueSpawnJob(job) {
  if (queueStore) {
    // Pass MAX_QUEUE so the admission check and the LPUSH happen atomically
    // inside a Lua script – prevents concurrent requests from overfilling the queue.
    const result = await queueStore.enqueue(job, MAX_QUEUE);
    if (result.duplicate) {
      console.log(`[ao-bridge] Duplicate spawn ignored for ${result.id}`);
    } else if (result.queueFull) {
      console.log(`[ao-bridge] Spawn rejected – queue full (max ${MAX_QUEUE})`);
    } else {
      console.log(`[ao-bridge] Queued spawn ${job.id} at position ${result.queuePosition} (active: ${activeSpawns}/${MAX_CONCURRENT})`);
    }
    return result;
  }

  // In-memory path: synchronous check + push is atomic in single-threaded Node.js.
  if (pendingSpawnQueue.length >= MAX_QUEUE) {
    return {
      accepted: false,
      duplicate: false,
      queueFull: true,
      id: job.id,
      queuePosition: null,
    };
  }

  pendingSpawnQueue.push(job);
  console.log(`[ao-bridge] Queued spawn ${job.id} at position ${pendingSpawnQueue.length} (active: ${activeSpawns}/${MAX_CONCURRENT})`);
  return {
    accepted: true,
    duplicate: false,
    id: job.id,
    queuePosition: pendingSpawnQueue.length,
  };
}

async function dequeueSpawnJob() {
  if (queueStore) {
    // Pass MAX_CONCURRENT so the admission check against the global running
    // list and the LMOVE happen atomically inside a Lua script.  This
    // prevents multiple bridge processes from each dequeuing up to
    // MAX_CONCURRENT jobs and silently overrunning the intended global cap.
    return queueStore.dequeue(MAX_CONCURRENT);
  }
  const job = pendingSpawnQueue.shift();
  return job || null;
}

async function completeSpawnJob(job) {
  if (queueStore) {
    await queueStore.complete(job);
  }
}

async function drainSpawnQueue() {
  if (drainLoopActive || shuttingDown) {
    return;
  }

  drainLoopActive = true;
  try {
    while (!shuttingDown && activeSpawns < MAX_CONCURRENT) {
      const job = await dequeueSpawnJob();
      if (!job) {
        break;
      }

      const queueMetrics = await getQueueMetrics();
      activeSpawns++;
      console.log(
        `[ao-bridge] Dequeued spawn ${job.id} (queue depth: ${queueMetrics.pendingCount}, active: ${activeSpawns}/${MAX_CONCURRENT})`,
      );

      void executeSpawnJob(job);
    }
  } finally {
    drainLoopActive = false;
  }
}

// --- Graceful shutdown ---
process.on('SIGTERM', () => {
  console.log('[ao-bridge] SIGTERM received, draining...');
  shuttingDown = true;
  // Kill active child processes
  for (const [pid, proc] of activeProcesses) {
    proc.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 5000);
});

// --- Token refresh: update GH_TOKEN every 45 minutes ---
setInterval(async () => {
  try {
    await refreshGitHubCliAuth();
  } catch (err) {
    console.error('[ao-bridge] Token refresh failed:', err.message);
  }
}, 45 * 60 * 1000);

setInterval(() => {
  void sweepOrphanedSessionHarvests().catch((err) => {
    console.error('[ao-bridge] Orphan harvest sweeper failed:', err?.message || String(err));
  });
}, SESSION_SWEEP_INTERVAL_MS);

// --- Helper: run ao CLI command via spawn ---
async function runAo(args, cwd, timeoutMs = 600000) {
  await refreshGitHubCliAuth();

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(AO_BIN, args, {
      cwd,
      timeout: timeoutMs,
      env: { ...process.env },  // Pass current env (includes refreshed GH_TOKEN)
    });

    activeProcesses.set(proc.pid, proc);

    const MAX_OUTPUT = 1024 * 1024;

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(-MAX_OUTPUT);
      }
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
      if (stderr.length > MAX_OUTPUT) {
        stderr = stderr.slice(-MAX_OUTPUT);
      }
    });

    proc.on('close', (code) => {
      activeProcesses.delete(proc.pid);
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
      } else {
        reject(createProcessError('ao', args, cwd, timeoutMs, code, stdout, stderr));
      }
    });

    proc.on('error', (err) => {
      activeProcesses.delete(proc.pid);
      err.command = 'ao';
      err.args = Array.isArray(args) ? [...args] : [];
      err.cwd = cwd;
      err.timeoutMs = timeoutMs;
      err.stdout = trimOutput(stdout);
      err.stderr = trimOutput(stderr);
      reject(err);
    });
  });
}

function extractIssueNumberFromGhOutput(output) {
  const match = output.match(/\/issues\/(\d+)/);
  if (!match?.[1]) {
    return null;
  }

  const issueNumber = Number.parseInt(match[1], 10);
  return Number.isFinite(issueNumber) && issueNumber > 0 ? issueNumber : null;
}

async function createDirectiveIssue({ repo, title, body, cwd }) {
  await refreshGitHubCliAuth();
  const result = await runCommand(
    'gh',
    ['issue', 'create', '--repo', repo, '--title', title, '--body', body],
    cwd,
    30000,
  );

  const createdIssue = extractIssueNumberFromGhOutput(result.stdout);
  if (!createdIssue) {
    throw new Error('Failed to parse created issue number from gh issue create output');
  }

  return createdIssue;
}

// --- Helper: parse JSON body ---
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 10240) { // 10KB limit
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

// --- Helper: validate and sanitize issue number ---
function sanitizeIssue(val) {
  const num = parseInt(String(val), 10);
  if (isNaN(num) || num < 1 || num > 999999) return null;
  return num;
}

// --- Helper: validate repo name ---
function sanitizeRepo(val) {
  if (typeof val !== 'string') return null;
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(val)) return null;
  return val;
}

// --- Helper: run a git command and reject on non-zero exit or spawn error ---
function runGit(args, cwd, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const p = spawn('git', args, { cwd, timeout: timeoutMs });
    p.stderr && p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(' ')} exited with code ${code} in ${cwd}: ${stderr.trim()}`));
      } else {
        resolve();
      }
    });
    p.on('error', (err) => reject(new Error(`git ${args.join(' ')} spawn error in ${cwd}: ${err.message}`)));
  });
}

// --- Helper: run a git command, capture stdout, and reject on non-zero exit ---
function runGitCapture(args, cwd, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const p = spawn('git', args, { cwd, timeout: timeoutMs });
    p.stdout.on('data', (c) => { stdout += c; });
    p.stderr && p.stderr.on('data', (c) => { stderr += c; });
    p.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git ${args.join(' ')} exited with code ${code} in ${cwd}: ${stderr.trim()}`));
      } else {
        resolve(stdout);
      }
    });
    p.on('error', (err) => reject(new Error(`git ${args.join(' ')} spawn error in ${cwd}: ${err.message}`)));
  });
}

// --- Helper: clean up worktrees and session state for a specific issue ---
// Runs before every spawn to prevent "already checked out" errors.
// Uses git worktree remove (not rm -rf) to keep .git/worktrees metadata clean.
async function cleanupWorktreesForIssue(issueNum) {
  console.log(`[ao-bridge] Cleaning up worktrees for issue #${issueNum}`);

  // Collect active session IDs from both Redis locks and monitor state files.
  // These sessions are actively running — their worktrees must NOT be removed.
  let activeSessionIds = new Set();
  try {
    const lockIds = await listActiveSessionLocks();
    for (const id of lockIds) {
      activeSessionIds.add(id);
    }
    // Also protect sessions tracked via monitor state files (belt-and-suspenders)
    for (const state of listSessionMonitorStates()) {
      if (state?.sessionId) {
        activeSessionIds.add(state.sessionId);
      }
    }
    if (activeSessionIds.size > 0) {
      console.log(`[ao-bridge] Worktree lifecycle: protecting ${activeSessionIds.size} active session(s) from cleanup: ${[...activeSessionIds].join(', ')}`);
    }
  } catch (err) {
    console.warn(`[ao-bridge] Could not determine active sessions for cleanup protection (proceeding with no protection): ${err?.message}`);
    activeSessionIds = new Set();
  }

  let repos;
  try {
    repos = readdirSync('/data/worktrees', { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  } catch {
    repos = [];
  }

  const repoErrors = [];

  for (const repoName of repos) {
    const repoPath = `/data/worktrees/${repoName}`;

    // Step 1: Prune stale worktree metadata
    try {
      await runGit(['worktree', 'prune', '--expire', 'now'], repoPath, 5000);
    } catch (err) {
      console.error(`[ao-bridge] worktree prune failed for ${repoName}: ${err.message}`);
      repoErrors.push(err.message);
      continue; // repo is in an uncertain state — skip further cleanup for it
    }

    // Step 2: List worktrees and remove issue-related ones via git worktree remove
    let listOutput;
    try {
      listOutput = await runGitCapture(['worktree', 'list', '--porcelain'], repoPath, 5000);
    } catch (err) {
      console.error(`[ao-bridge] worktree list failed for ${repoName}: ${err.message}`);
      repoErrors.push(err.message);
      continue;
    }

    const worktrees = listOutput.split('\n\n').filter(Boolean);
    for (const wt of worktrees) {
      const pathMatch = wt.match(/^worktree (.+)$/m);
      const branchMatch = wt.match(/^branch refs\/heads\/(.+)$/m);
      if (pathMatch && branchMatch) {
        const wtPath = pathMatch[1];
        const branch = branchMatch[1];
        if (branch.includes(`issue-${issueNum}`) || branch.includes(`-${issueNum}-`)) {
          // Protect worktrees that belong to an active session
          const isActiveWorktree = [...activeSessionIds].some((sid) => wtPath.includes(sid));
          if (isActiveWorktree) {
            console.warn(`[ao-bridge] Worktree lifecycle: SKIPPING removal of ${wtPath} (branch: ${branch}) — belongs to an active session`);
            continue;
          }

          console.log(`[ao-bridge] Worktree lifecycle: removing ${wtPath} (branch: ${branch}) for issue #${issueNum}`);
          try {
            await runGit(['worktree', 'remove', '--force', wtPath], repoPath, 10000);
            console.log(`[ao-bridge] Worktree lifecycle: removed ${wtPath} successfully`);
          } catch (err) {
            // "Directory not empty" — rm -rf then prune metadata
            console.warn(`[ao-bridge] worktree remove failed for ${wtPath}, falling back to rm + prune: ${err.message}`);
            // Safety: only rm paths under known AO-managed roots
            const safeRoots = ['/data/worktrees/', '/data/ao-home/.worktrees/'];
            if (!safeRoots.some(root => wtPath.startsWith(root))) {
              console.error(`[ao-bridge] Refusing to rm worktree outside safe roots: ${wtPath}`);
              repoErrors.push(`unsafe path: ${wtPath}`);
            } else {
              try {
                rmSync(wtPath, { recursive: true, force: true });
                await runGit(['worktree', 'prune', '--expire', 'now'], repoPath, 5000);
                console.log(`[ao-bridge] Worktree lifecycle: rm+prune fallback succeeded for ${wtPath}`);
              } catch (rmErr) {
                console.error(`[ao-bridge] rm + prune fallback failed for ${wtPath}: ${rmErr.message}`);
                repoErrors.push(rmErr.message);
              }
            }
          }
        }
      }
    }

    // Step 3: Delete leftover issue branches
    let branchOutput;
    try {
      branchOutput = await runGitCapture(['branch', '--list', `*issue-${issueNum}*`], repoPath, 5000);
    } catch (err) {
      console.error(`[ao-bridge] branch list failed for ${repoName}: ${err.message}`);
      repoErrors.push(err.message);
      continue;
    }

    const branches = branchOutput.split('\n').map(b => b.replace(/^[\s*+]+/, '').trim()).filter(Boolean);
    for (const branch of branches) {
      try {
        await runGit(['branch', '-D', branch], repoPath, 5000);
      } catch (err) {
        // If the branch is still checked out in a worktree (e.g. the session finished but
        // the worktree wasn't removed above because it was still in activeSessionIds at the
        // time of Step 2), extract the path from the error and remove the worktree first,
        // then retry the branch deletion.
        const checkedOutMatch = err.message.match(/checked out at '([^']+)'/);
        if (checkedOutMatch) {
          const stalePath = checkedOutMatch[1];
          console.warn(`[ao-bridge] branch delete failed for ${branch} — still checked out at ${stalePath}; attempting worktree removal and retry`);
          try {
            // Safety: only rm paths under known AO-managed roots
            const safeRoots = ['/data/worktrees/', '/data/ao-home/.worktrees/'];
            if (!safeRoots.some(root => stalePath.startsWith(root))) {
              throw new Error(`refusing to remove worktree outside safe roots: ${stalePath}`);
            }
            // Prefer git worktree remove; fall back to rm + prune if it fails
            try {
              await runGit(['worktree', 'remove', '--force', stalePath], repoPath, 10000);
              console.log(`[ao-bridge] Retry worktree remove succeeded for ${stalePath}`);
            } catch (wtErr) {
              console.warn(`[ao-bridge] git worktree remove failed for ${stalePath}, falling back to rm + prune: ${wtErr.message}`);
              rmSync(stalePath, { recursive: true, force: true });
              await runGit(['worktree', 'prune', '--expire', 'now'], repoPath, 5000);
              console.log(`[ao-bridge] Retry rm+prune succeeded for ${stalePath}`);
            }
            // Now retry the branch deletion
            await runGit(['branch', '-D', branch], repoPath, 5000);
            console.log(`[ao-bridge] branch delete retry succeeded for ${branch}`);
          } catch (retryErr) {
            console.error(`[ao-bridge] branch delete retry failed for ${branch} in ${repoName}: ${retryErr.message}`);
            repoErrors.push(retryErr.message);
          }
        } else {
          console.error(`[ao-bridge] branch delete failed for ${branch} in ${repoName}: ${err.message}`);
          repoErrors.push(err.message);
          // Continue attempting to delete remaining branches
        }
      }
    }

    // Step 4: Final prune after removals
    try {
      await runGit(['worktree', 'prune', '--expire', 'now'], repoPath, 5000);
    } catch (err) {
      console.error(`[ao-bridge] final worktree prune failed for ${repoName}: ${err.message}`);
      repoErrors.push(err.message);
    }
  }

  // Step 5: Clean only this issue's session state (not all sessions)
  try {
    await new Promise((resolveCleanup, rejectCleanup) => {
      let stderr = '';
      const p = spawn('find', ['/data/ao-state', '-maxdepth', '3', '-type', 'd', '-name', `*issue-${issueNum}*`,
        '-exec', 'rm', '-rf', '{}', '+'], { timeout: 5000 });
      p.stderr && p.stderr.on('data', (c) => { stderr += c; });
      p.on('close', (code) => {
        if (code !== 0 && code !== null) {
          rejectCleanup(new Error(`find/rm session cleanup for issue #${issueNum} exited with code ${code}: ${stderr.trim()}`));
        } else {
          resolveCleanup();
        }
      });
      p.on('error', (err) => rejectCleanup(new Error(`find/rm session cleanup spawn error for issue #${issueNum}: ${err.message}`)));
    });
  } catch (err) {
    console.error(`[ao-bridge] session state cleanup failed for issue #${issueNum}: ${err.message}`);
    repoErrors.push(err.message);
  }

  if (repoErrors.length > 0) {
    const summary = `Cleanup for issue #${issueNum} completed with ${repoErrors.length} git error(s): ${repoErrors.join('; ')}`;
    console.error(`[ao-bridge] ${summary}`);
    throw new Error(summary);
  }

  console.log(`[ao-bridge] Cleanup complete for issue #${issueNum}`);
}

const server = http.createServer(async (req, res) => {
  // Reject if shutting down
  if (shuttingDown && req.method === 'POST') {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'shutting down' }));
    return;
  }

  // --- Health check ---
  if (req.method === 'GET' && req.url === '/health') {
    let queueMetrics = null;
    let queueBackendError = null;
    try {
      queueMetrics = await getQueueMetrics();
    } catch (err) {
      queueBackendError = err.message || String(err);
    }
    const healthStatus = queueBackendError ? 'degraded' : 'ok';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: healthStatus,
      timestamp: new Date().toISOString(),
      activeSpawns,
      queuedSpawns: queueMetrics ? queueMetrics.pendingCount : null,
      runningJobs: queueMetrics ? queueMetrics.runningCount : null,
      oldestQueuedAgeSec: queueMetrics ? queueMetrics.oldestQueuedAgeSec : null,
      activeProcesses: activeProcesses.size,
      maxConcurrent: MAX_CONCURRENT,
      maxQueue: MAX_QUEUE,
      queueBackend: queueStore ? 'redis' : 'memory',
      shuttingDown,
      ...(queueBackendError ? { queueBackendError } : {}),
    }));
    return;
  }

  // --- Status ---
  if (req.method === 'GET' && req.url === '/status') {
    try {
      const result = await runAo(['status'], '/app', 10000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', output: result.stdout }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'error', error: err.message }));
    }
    return;
  }

  // --- Sessions ---
  if (req.method === 'GET' && req.url === '/sessions') {
    try {
      const result = await runAo(['session', 'ls'], '/app', 10000);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions: result.stdout }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- Auth check for write operations ---
  if (AUTH_TOKEN && req.headers['x-ao-token'] !== AUTH_TOKEN) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }

  // --- Spawn agent for issue or directive ---
  if (req.method === 'POST' && req.url === '/spawn') {
    // Phase 1: request parsing and validation.
    // Only validation/input errors reach the catch here → 400.
    let spawnId, job;
    try {
      const {
        issueUrl,
        issueNumber,
        cleanupIssueNumber,
        claimPr,
        repo,
        orchestrator,
        directive,
        context,
        harness: harnessParam,
      } = await parseBody(req);

      const issue = sanitizeIssue(issueNumber || (issueUrl ? issueUrl.split('/').pop() : null));
      const cleanupIssue = sanitizeIssue(cleanupIssueNumber || issue);
      const claimedPr = sanitizeIssue(claimPr);
      // Reject explicitly-provided but malformed repo values with a 400.
      // Only fall back to the default when repo is genuinely omitted.
      if (repo != null && repo !== '' && !sanitizeRepo(repo)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid repo: must be in "owner/name" format (alphanumeric, hyphens, underscores, dots only)' }));
        return;
      }
      const safeRepo = sanitizeRepo(repo) || 'your-org/your-project';
      const hasDirective = typeof directive === 'string' && directive.trim().length > 0;
      if (!issue && !hasDirective) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'issueNumber, issueUrl, or directive required' }));
        return;
      }

      const harness = orchestrator || harnessParam;

      spawnId = claimedPr
        ? `ao-pr-${claimedPr}-${Date.now()}`
        : issue
          ? `ao-${issue}-${Date.now()}`
          : `ao-dir-${Date.now()}-${randomUUID().slice(0, 8)}`;
      job = {
        id: spawnId,
        queuedAt: new Date().toISOString(),
        repo: safeRepo,
        issueNumber: issue,
        cleanupIssueNumber: cleanupIssue,
        claimPr: claimedPr,
        directive: typeof directive === 'string' ? directive : '',
        context: typeof context === 'string' ? context : '',
        orchestrator: typeof harness === 'string' ? harness : '',
      };
    } catch (err) {
      console.error(`[ao-bridge] Spawn request parse error: ${err.message}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, status: 'failed' }));
      return;
    }

    // Phase 2: queue/infrastructure operations.
    // Redis or other backend failures reach the catch here → 503 so the
    // caller can correctly distinguish a server-side outage from a bad request
    // and trigger degraded/circuit-breaker logic.
    try {
      const enqueueResult = await queueSpawnJob(job);

      if (enqueueResult.queueFull) {
        const queueMetrics = await getQueueMetrics();
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'spawn queue full',
          active: activeSpawns,
          queued: queueMetrics.pendingCount,
          maxConcurrent: MAX_CONCURRENT,
          maxQueue: MAX_QUEUE,
        }));
        return;
      }

      if (enqueueResult.duplicate) {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: enqueueResult.id,
          status: 'queued',
          duplicate: true,
          active: activeSpawns,
          queued: (await getQueueMetrics()).pendingCount,
        }));
        return;
      }

      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: spawnId,
        status: 'queued',
        queuePosition: enqueueResult.queuePosition,
        active: activeSpawns,
        queued: (await getQueueMetrics()).pendingCount,
      }));
      void drainSpawnQueue();

    } catch (err) {
      console.error(`[ao-bridge] Spawn queue backend error: ${err.message}`);
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'queue backend unavailable', status: 'failed' }));
    }
    return;
  }

  // --- Batch spawn ---
  if (req.method === 'POST' && req.url === '/batch-spawn') {
    try {
      const { issues, repo } = await parseBody(req);
      if (!Array.isArray(issues) || issues.length === 0 || issues.length > 10) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'issues: array of 1-10 issue numbers required' }));
        return;
      }

      const safeIssues = issues.map(sanitizeIssue).filter(Boolean);
      if (safeIssues.length === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'no valid issue numbers' }));
        return;
      }

      // Reject explicitly-provided but malformed repo values with a 400.
      // Only fall back to the default when repo is genuinely omitted.
      if (repo != null && repo !== '' && !sanitizeRepo(repo)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid repo: must be in "owner/name" format (alphanumeric, hyphens, underscores, dots only)' }));
        return;
      }
      const safeRepo = sanitizeRepo(repo) || 'your-org/your-project';

      // Admission is enforced atomically inside queueSpawnJob for each item;
      // we no longer do a non-atomic pre-check here.
      const results = [];
      for (const issueNumber of safeIssues) {
        const spawnId = `ao-${issueNumber}-${Date.now()}-${randomUUID().slice(0, 6)}`;
        const job = {
          id: spawnId,
          queuedAt: new Date().toISOString(),
          repo: safeRepo,
          issueNumber,
          cleanupIssueNumber: issueNumber,
          claimPr: null,
          directive: '',
          context: '',
          orchestrator: '',
        };
        const enqueueResult = await queueSpawnJob(job);
        results.push({
          id: enqueueResult.id,
          status: enqueueResult.queueFull ? 'rejected' : 'queued',
          ...(enqueueResult.queueFull ? { reason: 'queue full' } : {}),
          queuePosition: enqueueResult.queuePosition ?? undefined,
        });
      }

      void drainSpawnQueue();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'queued', results }));
    } catch (err) {
      console.error(`[ao-bridge] Batch spawn error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, status: 'failed' }));
    }
    return;
  }

  // --- Cleanup worktrees for an issue ---
  if (req.method === 'POST' && req.url === '/cleanup') {
    try {
      const { issueNumber } = await parseBody(req);
      const issue = sanitizeIssue(issueNumber);
      if (!issue) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'valid issueNumber required' }));
        return;
      }

      await cleanupWorktreesForIssue(issue);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'cleaned', issue }));
    } catch (err) {
      console.error(`[ao-bridge] Cleanup error: ${err.message}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message, status: 'failed' }));
    }
    return;
  }

  // --- 404 ---
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

// Validate project path contracts — auto-reconcile missing dirs, never hard-fail
// on resources the process itself is responsible for creating.
validateConfiguredProjectContracts();
console.log('[ao-bridge] Project path contract validation passed.');

if (!AUTH_TOKEN) {
  console.warn('[ao-bridge] WARNING: AO_AUTH_TOKEN is not set — callbacks to yclaw will fail with 401');
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ao-bridge] HTTP server listening on :${PORT}`);
  console.log(`[ao-bridge] Max concurrent spawns: ${MAX_CONCURRENT}`);
  console.log(`[ao-bridge] Max queued spawns: ${MAX_QUEUE}`);
  // Reattach monitors for sessions that were active before this restart.
  void resumeSessionMonitors().catch((err) => {
    console.error('[ao-bridge] resumeSessionMonitors failed:', err?.message || String(err));
  });

  if (queueStore) {
    void queueStore.recoverRunningJobs()
      .then((recovered) => {
        if (recovered > 0) {
          console.log(`[ao-bridge] Recovered ${recovered} running job(s) back to pending queue`);
        }
        return drainSpawnQueue();
      })
      .catch((err) => {
        console.error(`[ao-bridge] Queue recovery failed: ${err.message}`);
      });
  }
});
// AO Bridge v9 — Redis-backed async spawn admission, bounded worker draining
