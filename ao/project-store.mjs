/**
 * project-store.mjs — Runtime Project Store for AO
 *
 * Persists dynamically registered projects to an EBS-backed JSON file so they
 * survive container restarts. Bootstrap repos from YCLAW_REPOS are merged with
 * the persisted store at startup — they are NOT written to the store, since
 * they are already captured by the env var.
 *
 * Store format (projects.json):
 * {
 *   "version": 1,
 *   "projects": {
 *     "owner__repo": {
 *       "repo": "owner/repo",
 *       "name": "optional-key-override",
 *       "branch": "main",
 *       "registeredAt": "2026-01-01T00:00:00.000Z"
 *     }
 *   }
 * }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STORE_DIR = process.env.AO_STATE_DIR || '/data/ao-state';
const STORE_PATH = join(STORE_DIR, 'projects.json');
const STORE_VERSION = 1;

let _store = null; // in-memory cache; null = not yet loaded

function repoSlug(repo) {
  return repo.replace(/\//g, '__');
}

function loadStore() {
  if (_store !== null) {
    return _store;
  }

  try {
    if (existsSync(STORE_PATH)) {
      const raw = readFileSync(STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed?.version === STORE_VERSION && parsed?.projects && typeof parsed.projects === 'object') {
        _store = parsed;
        console.log(`[project-store] Loaded ${Object.keys(_store.projects).length} project(s) from ${STORE_PATH}`);
        return _store;
      }
      console.warn(`[project-store] Store at ${STORE_PATH} has unexpected format — starting fresh`);
    }
  } catch (err) {
    console.warn(`[project-store] Could not read ${STORE_PATH}: ${err.message} — starting fresh`);
  }

  _store = { version: STORE_VERSION, projects: {} };
  return _store;
}

function saveStore() {
  try {
    mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify(_store, null, 2) + '\n', 'utf-8');
  } catch (err) {
    console.error(`[project-store] WARN: could not persist project store to ${STORE_PATH}: ${err.message}`);
    // Graceful degradation: the project is still registered in memory for this
    // container's lifetime even if persistence fails (e.g. EBS not mounted).
  }
}

/**
 * Register a project in the runtime store.
 *
 * @param {object} opts
 * @param {string} opts.repo      - "owner/repo" slug
 * @param {string} [opts.name]    - optional AO project key override (defaults to repo slug)
 * @param {string} [opts.branch]  - default branch (defaults to "main")
 * @returns {{ slug: string, isNew: boolean }}
 */
export function registerProject({ repo, name, branch = 'main' }) {
  const store = loadStore();
  const slug = repoSlug(repo);
  const isNew = !store.projects[slug];

  store.projects[slug] = {
    repo,
    name: name || slug,
    branch,
    registeredAt: store.projects[slug]?.registeredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  saveStore();

  if (isNew) {
    console.log(`[project-store] Registered new project: ${repo} (key: ${name || slug})`);
  } else {
    console.log(`[project-store] Updated existing project: ${repo}`);
  }

  return { slug, isNew };
}

/**
 * List all registered projects from the store.
 *
 * @returns {Array<{ slug: string, repo: string, name: string, branch: string, registeredAt: string }>}
 */
export function listProjects() {
  const store = loadStore();
  return Object.entries(store.projects).map(([slug, entry]) => ({ slug, ...entry }));
}

/**
 * Check whether a given repo is already registered in the store.
 *
 * @param {string} repo - "owner/repo"
 * @returns {boolean}
 */
export function isRegistered(repo) {
  const store = loadStore();
  return Boolean(store.projects[repoSlug(repo)]);
}

/**
 * Retrieve a single project entry by repo slug.
 *
 * @param {string} repo - "owner/repo"
 * @returns {object|null}
 */
export function getProject(repo) {
  const store = loadStore();
  return store.projects[repoSlug(repo)] || null;
}

/**
 * Reload the in-memory cache from disk.  Useful after external writes.
 */
export function reloadStore() {
  _store = null;
  return loadStore();
}
