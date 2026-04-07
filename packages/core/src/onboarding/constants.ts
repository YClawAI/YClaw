/**
 * Onboarding constants — limits, MIME types, timeouts.
 */

/** Maximum file size for a single uploaded file (10 MB). */
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

/** Maximum total ingestion quota per org (100 MB). */
export const MAX_TOTAL_INGESTION_BYTES = 100 * 1024 * 1024;

/** Maximum GitHub repo archive size (500 MB). */
export const MAX_GITHUB_REPO_BYTES = 500 * 1024 * 1024;

/** URL fetch timeout in milliseconds. */
export const URL_FETCH_TIMEOUT_MS = 10_000;

/** Maximum redirect hops for URL ingestion. */
export const MAX_URL_REDIRECTS = 3;

/** Session abandonment threshold in days. */
export const SESSION_ABANDON_DAYS = 7;

/** Object store key prefix for onboarding assets. */
export const ASSET_KEY_PREFIX = 'onboarding/assets/';

/** Supported MIME types for file uploads. */
export const SUPPORTED_MIME_TYPES = new Set([
  // Text
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  // Documents
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  // Data
  'application/json',
  'application/x-yaml',
  'text/yaml',
  // Images (stored as-is, no OCR)
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

/** File extension → MIME type fallback map. */
export const EXTENSION_MIME_MAP: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.json': 'application/json',
  '.yaml': 'application/x-yaml',
  '.yml': 'application/x-yaml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/**
 * GitHub files to index when importing a repo.
 * Only these paths are read — not the full repo.
 */
export const GITHUB_INDEX_PATHS = [
  'README.md',
  'README',
  'readme.md',
  'docs/',
  'doc/',
  'package.json',
  'Cargo.toml',
  'go.mod',
  'pyproject.toml',
  'requirements.txt',
];

/** Departments available as presets. */
export const DEPARTMENT_NAMES = [
  'development',
  'marketing',
  'operations',
  'support',
  'executive',
  'finance',
] as const;

export type DepartmentName = (typeof DEPARTMENT_NAMES)[number];
