import { createLogger } from '../logging/logger.js';
import { generateApiKey, hashApiKey } from './api-keys.js';
import { extractKeyPrefix } from './api-keys.js';
import type { OperatorStore } from './operator-store.js';
import type { Operator } from './types.js';

const logger = createLogger('operator-seed');

/**
 * Ensure a root operator exists. If ROOT_API_KEY is set, use it (must be gzop_live_* format).
 * Otherwise generate a key and print it to stdout ONLY (not to log files).
 *
 * When YCLAW_SETUP_TOKEN is set, seeding is skipped entirely — the CLI's
 * bootstrap endpoint handles root operator creation with the setup token.
 * This prevents the seed from racing with the bootstrap flow.
 *
 * Returns the root operator's operatorId (or the deterministic 'op_root' when
 * deferring to the bootstrap endpoint so route registration still proceeds).
 */
export async function seedRootOperator(operatorStore: OperatorStore): Promise<string> {
  // Defer to CLI bootstrap when setup token is configured
  if (process.env.YCLAW_SETUP_TOKEN && process.env.YCLAW_SETUP_TOKEN.trim().length >= 32) {
    const existing = await operatorStore.listOperators({ tier: 'root' });
    if (existing.length > 0) {
      logger.info('Root operator already exists', { operatorId: existing[0]!.operatorId });
      return existing[0]!.operatorId;
    }
    // Return deterministic ID matching bootstrap endpoint — routes.ts gates on
    // rootOperatorId being truthy, so returning a value ensures /v1/* routes
    // (including the bootstrap endpoint itself) are registered.
    logger.info('Seed skipped — YCLAW_SETUP_TOKEN set, deferring to bootstrap endpoint');
    return 'op_root';
  }

  const existing = await operatorStore.listOperators({ tier: 'root' });
  if (existing.length > 0) {
    logger.info('Root operator already exists', { operatorId: existing[0]!.operatorId });
    return existing[0]!.operatorId;
  }

  const operatorId = 'op_root';
  const displayName = process.env.ROOT_OPERATOR_NAME || 'Troy';
  const email = process.env.ROOT_OPERATOR_EMAIL || 'ceo@yclaw.ai';

  let apiKeyHash: string;
  let apiKeyPrefix: string;

  const envKey = process.env.ROOT_API_KEY;
  if (envKey) {
    // Validate ROOT_API_KEY has the correct prefix format
    const prefix = extractKeyPrefix(envKey);
    if (!prefix) {
      throw new Error(
        'ROOT_API_KEY must use gzop_live_* format (e.g., gzop_live_abc12345...). '
        + 'Generate one with: node -e "import(\'crypto\').then(c => console.log(\'gzop_live_\' + c.randomBytes(32).toString(\'base64url\')))"',
      );
    }
    apiKeyHash = await hashApiKey(envKey);
    apiKeyPrefix = prefix;
    logger.info('Root operator seeded with ROOT_API_KEY from environment');
  } else {
    const generated = await generateApiKey();
    apiKeyHash = generated.hash;
    apiKeyPrefix = generated.prefix;
    // Print key to stdout ONLY — NOT through the logger (which writes to log files)
    process.stdout.write('\n');
    process.stdout.write('═══════════════════════════════════════════════════════════════\n');
    process.stdout.write('  ROOT OPERATOR API KEY (save this — shown only once):\n');
    process.stdout.write(`  ${generated.key}\n`);
    process.stdout.write('═══════════════════════════════════════════════════════════════\n');
    process.stdout.write('\n');
  }

  const now = new Date();
  const rootOperator: Operator = {
    operatorId,
    displayName,
    role: 'CEO',
    email,
    apiKeyHash,
    apiKeyPrefix,
    tailscaleIPs: [],
    tier: 'root',
    roleIds: ['role_ceo'],
    departments: ['*'],
    priorityClass: 100,
    crossDeptPolicy: 'request',
    limits: {
      requestsPerMinute: 1000,
      maxConcurrentTasks: 50,
      dailyTaskQuota: 10000,
    },
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  await operatorStore.createOperator(rootOperator);
  logger.info('Root operator seeded', { operatorId, displayName });
  return operatorId;
}
