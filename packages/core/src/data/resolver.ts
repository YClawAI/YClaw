import https from 'node:https';
import { createHash } from 'node:crypto';
import type { DataSource } from '../config/schema.js';
import { createLogger } from '../logging/logger.js';

const logger = createLogger('data-resolver');

/** Default timeout for all outbound fetch calls (ms) */
const FETCH_TIMEOUT_MS = 10_000;

/** Max concurrent fetches to avoid overwhelming rate limits */
const MAX_CONCURRENCY = 5;

/**
 * Allowlisted localhost URLs that are legitimate internal sidecar services.
 * These bypass SSRF protection because they are co-located containers, not external targets.
 */
const LOCALHOST_ALLOWLIST = [
  'http://localhost:4000', // LiteLLM proxy sidecar
];

/**
 * Block requests to internal/metadata endpoints to prevent SSRF.
 * Blocks: RFC1918, link-local, localhost, cloud metadata endpoints.
 * Exception: URLs matching LOCALHOST_ALLOWLIST are permitted (sidecar services).
 */
function validateOutboundUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const hostname = parsed.hostname;

  // Block cloud metadata endpoints
  if (hostname === '169.254.169.254' || hostname === '169.254.170.2') {
    throw new Error(`SSRF blocked: cloud metadata endpoint ${hostname}`);
  }

  // Block link-local range (169.254.x.x)
  if (hostname.startsWith('169.254.')) {
    throw new Error(`SSRF blocked: link-local address ${hostname}`);
  }

  // Block localhost (unless allowlisted sidecar)
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) {
    const isAllowlisted = LOCALHOST_ALLOWLIST.some(allowed => url.startsWith(allowed));
    if (!isAllowlisted) {
      throw new Error(`SSRF blocked: localhost ${hostname}`);
    }
  }

  // Block RFC1918 private ranges
  const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipMatch) {
    const [, a, b] = ipMatch.map(Number);
    if (a === 10) throw new Error(`SSRF blocked: private IP ${hostname}`);
    if (a === 172 && b >= 16 && b <= 31) {
      throw new Error(`SSRF blocked: private IP ${hostname}`);
    }
    if (a === 192 && b === 168) {
      throw new Error(`SSRF blocked: private IP ${hostname}`);
    }
  }
}

/**
 * Interpolate ${ENV_VAR} references in a string.
 * Returns the interpolated string and a list of missing env vars.
 */
function interpolateEnvVars(
  input: string,
): { result: string; missing: string[] } {
  const missing: string[] = [];
  const result = input.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    const val = process.env[key];
    if (val === undefined || val === '') {
      missing.push(key);
      return '';
    }
    return val;
  });
  return { result, missing };
}

/**
 * Make an mTLS-authenticated request to the Teller API.
 * Uses client certificate + private key for mTLS, access token for Basic Auth.
 */
function tellerRequest(
  baseUrl: string,
  path: string,
  accessToken: string,
  cert: string,
  key: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'GET',
      cert,
      key,
      headers: {
        'Authorization': `Basic ${Buffer.from(`${accessToken}:`).toString('base64')}`,
        'Accept': 'application/json',
      },
      timeout: FETCH_TIMEOUT_MS,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error(`Teller response not JSON: ${data.slice(0, 200)}`));
          }
        } else {
          reject(new Error(`Teller HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        }
      });
    });

    req.on('error', (err) => reject(new Error(`Teller request failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Teller request timed out')); });
    req.end();
  });
}

export interface DataResult {
  source: string;
  data: unknown;
  fetchedAt: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error message if fetch failed */
  error?: string;
}

type DataFetcher = (config: Record<string, unknown>) => Promise<unknown>;

/**
 * Run promises with bounded concurrency.
 * Executes at most `limit` promises at a time.
 */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const idx = nextIndex++;
      results[idx] = await tasks[idx]();
    }
  }

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

export class DataResolver {
  private fetchers = new Map<string, DataFetcher>();

  constructor() {
    this.registerDefaults();
  }

  registerFetcher(type: string, fetcher: DataFetcher): void {
    this.fetchers.set(type, fetcher);
    logger.debug(`Registered data fetcher: ${type}`);
  }

  async resolve(
    sources: DataSource[],
  ): Promise<Map<string, DataResult>> {
    const results = new Map<string, DataResult>();

    if (sources.length === 0) return results;

    logger.info(
      `Resolving ${sources.length} data sources (concurrency: ${MAX_CONCURRENCY})`,
    );

    const tasks = sources.map((source) => async () => {
      const start = Date.now();
      const fetcher = this.fetchers.get(source.type);

      if (!fetcher) {
        logger.warn(
          `No fetcher registered for data source type: ${source.type}`,
        );
        results.set(source.name, {
          source: source.name,
          data: null,
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - start,
          error: `No fetcher for type: ${source.type}`,
        });
        return;
      }

      try {
        const data = await fetcher(source.config || {});
        results.set(source.name, {
          source: source.name,
          data,
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - start,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`Failed to fetch data source: ${source.name}`, {
          error: msg,
          type: source.type,
        });
        results.set(source.name, {
          source: source.name,
          data: null,
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - start,
          error: `Fetch failed: ${msg}`,
        });
      }
    });

    await runWithConcurrency(tasks, MAX_CONCURRENCY);

    // Log summary
    const succeeded = [...results.values()].filter(r => !r.error).length;
    const failed = results.size - succeeded;
    const totalMs = [...results.values()].reduce(
      (sum, r) => sum + (r.durationMs ?? 0),
      0,
    );
    logger.info(
      `Data resolution complete: ${succeeded} ok, ${failed} failed, ${totalMs}ms total`,
    );

    return results;
  }

  private registerDefaults(): void {
    // ── MCP data source ──────────────────────────────────────────────
    this.fetchers.set('mcp', async (config) => {
      const rawEndpoint =
        (config.endpoint as string) || process.env.YCLAW_MCP_ENDPOINT;
      if (!rawEndpoint) {
        throw new Error('MCP endpoint not configured');
      }

      const { result: endpoint, missing } = interpolateEnvVars(rawEndpoint);
      if (missing.length > 0) {
        throw new Error(
          `Missing env vars for MCP endpoint: ${missing.join(', ')}`,
        );
      }
      validateOutboundUrl(endpoint);

      const method = (config.method as string) || 'query';
      const params =
        (config.params as Record<string, unknown>) || {};

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `MCP HTTP ${response.status}: ${response.statusText}`,
        );
      }
      return response.json();
    });

    // ── REST API data source ─────────────────────────────────────────
    this.fetchers.set('api', async (config) => {
      const url = config.url as string;
      if (!url) throw new Error('API URL not configured');

      const { result: interpolatedUrl, missing: urlMissing } =
        interpolateEnvVars(url);
      if (urlMissing.length > 0) {
        throw new Error(
          `Missing env vars for API URL: ${urlMissing.join(', ')}`,
        );
      }
      validateOutboundUrl(interpolatedUrl);

      const method = (
        (config.method as string) || 'GET'
      ).toUpperCase();

      // Interpolate env vars in each header value so callers can write
      // e.g. Authorization: Bearer ${LITELLM_API_KEY}
      const rawHeaders = (config.headers as Record<string, string>) || {};
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawHeaders)) {
        const { result: interpolatedValue, missing: headerMissing } =
          interpolateEnvVars(value);
        if (headerMissing.length > 0) {
          throw new Error(
            `Missing env vars for API header '${key}': ${headerMissing.join(', ')}`,
          );
        }
        headers[key] = interpolatedValue;
      }

      let body = config.body as string | undefined;

      if (body) {
        const { result: interpolatedBody, missing: bodyMissing } =
          interpolateEnvVars(body);
        if (bodyMissing.length > 0) {
          throw new Error(
            `Missing env vars for API body: ${bodyMissing.join(', ')}`,
          );
        }
        body = interpolatedBody;
      }

      const fetchOpts: RequestInit = {
        method,
        headers,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      };
      if (body && method === 'POST') fetchOpts.body = body;

      const response = await fetch(interpolatedUrl, fetchOpts);
      if (!response.ok) {
        throw new Error(
          `API HTTP ${response.status}: ${response.statusText}`,
        );
      }
      return response.json();
    });

    // ── Solana RPC data source ───────────────────────────────────────
    this.fetchers.set('solana_rpc', async (config) => {
      const rawRpcUrl =
        (config.rpcUrl as string) || process.env.SOLANA_RPC_URL;
      if (!rawRpcUrl) {
        throw new Error('Solana RPC URL not configured');
      }

      const { result: rpcUrl, missing } = interpolateEnvVars(rawRpcUrl);
      if (missing.length > 0) {
        throw new Error(
          `Missing env vars for Solana RPC: ${missing.join(', ')}`,
        );
      }
      validateOutboundUrl(rpcUrl);

      const method = config.method as string;
      if (!method) {
        throw new Error('Solana RPC method not specified');
      }

      const params = (config.params as unknown[]) || [];

      // Validate that params are non-empty for methods that require them
      const methodsRequiringAddress = [
        'getBalance',
        'getTokenAccountsByOwner',
        'getAccountInfo',
        'getTokenAccountBalance',
        'getSignaturesForAddress',
      ];
      if (
        methodsRequiringAddress.includes(method) &&
        (params.length === 0 || !params[0])
      ) {
        throw new Error(
          `Solana RPC method '${method}' requires an address parameter`,
        );
      }

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method,
          params,
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(
          `Solana RPC HTTP ${response.status}: ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        result?: unknown;
        error?: { message?: string; code?: number };
      };

      if (data.error) {
        throw new Error(
          `Solana RPC error: ${data.error.message || JSON.stringify(data.error)}`,
        );
      }

      return data.result ?? data;
    });

    // ── OpenRouter usage/credits data source ───────────────────────────
    this.fetchers.set('openrouter_usage', async () => {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('OPENROUTER_API_KEY not configured');
      }

      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json() as { data?: Record<string, unknown> };
      return result.data ?? result;
    });

    // ── Teller.io banking data source (mTLS + Basic Auth) ──────────────
    this.fetchers.set('teller', async (config) => {
      const cert = process.env.TELLER_CERTIFICATE;
      const key = process.env.TELLER_PRIVATE_KEY;
      const accessTokensRaw = process.env.TELLER_ACCESS_TOKENS;

      if (!cert || !key) {
        throw new Error('Teller mTLS credentials not configured (TELLER_CERTIFICATE, TELLER_PRIVATE_KEY)');
      }
      if (!accessTokensRaw) {
        throw new Error('TELLER_ACCESS_TOKENS not configured');
      }

      // Access tokens can be comma-separated for multiple enrollments
      const accessTokens = accessTokensRaw.split(',').map(t => t.trim()).filter(Boolean);
      if (accessTokens.length === 0) {
        throw new Error('No valid Teller access tokens found');
      }

      const endpoint = (config.endpoint as string) || '/accounts';
      const baseUrl = 'https://api.teller.io';
      
      // SECURITY: Only allow paths, not full URLs, to prevent SSRF with mTLS creds
      if (endpoint.includes('://')) {
        throw new Error('Teller endpoint must be a path, not a full URL (SSRF protection)');
      }

      // For /accounts/balances, we need to first list accounts then fetch each balance
      if (endpoint === '/accounts/balances') {
        // First get all accounts across all tokens
        const allBalances: Array<{ account_id: string; account_name: string; institution: string; balances: unknown }> = [];

        for (const token of accessTokens) {
          // List accounts for this token
          const accounts = await tellerRequest(baseUrl, '/accounts', token, cert, key) as Array<{
            id: string;
            name: string;
            institution: { name: string };
          }>;

          if (!Array.isArray(accounts)) continue;

          // Fetch balances for each account
          for (const acct of accounts) {
            try {
              const balances = await tellerRequest(baseUrl, `/accounts/${acct.id}/balances`, token, cert, key);
              allBalances.push({
                account_id: acct.id,
                account_name: acct.name,
                institution: acct.institution?.name || 'unknown',
                balances,
              });
            } catch (err) {
              logger.warn(`Failed to fetch Teller balances for ${acct.name}: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        }
        return allBalances;
      }

      // For simple endpoints (/accounts, etc.), fetch across all tokens and merge
      const allResults: unknown[] = [];
      for (const token of accessTokens) {
        const result = await tellerRequest(baseUrl, endpoint, token, cert, key);
        if (Array.isArray(result)) {
          allResults.push(...result);
        } else {
          allResults.push(result);
        }
      }
      return allResults;
    });

    // ── AWS Cost Explorer (infra spend by service) ──────────────────────
    this.fetchers.set('aws_cost', async () => {
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
      if (!accessKeyId || !secretAccessKey) {
        throw new Error('AWS credentials not configured (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)');
      }

      const { CostExplorerClient, GetCostAndUsageCommand } = await import('@aws-sdk/client-cost-explorer');
      const client = new CostExplorerClient({
        region: 'us-east-1', // Cost Explorer is global but endpoint is us-east-1
        credentials: { accessKeyId, secretAccessKey },
      });

      const now = new Date();
      const periodEnd = now.toISOString().split('T')[0]!;
      const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]!;

      const result = await client.send(new GetCostAndUsageCommand({
        TimePeriod: { Start: periodStart, End: periodEnd },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }));

      const costByService: Array<{ service: string; amount: number }> = [];
      let totalCost = 0;
      for (const period of result.ResultsByTime ?? []) {
        for (const group of period.Groups ?? []) {
          const service = group.Keys?.[0] ?? 'Unknown';
          const amount = parseFloat(group.Metrics?.['UnblendedCost']?.Amount ?? '0');
          costByService.push({ service, amount });
          totalCost += amount;
        }
      }

      return { totalCost, costByService, periodStart, periodEnd };
    });

    // ── MongoDB Atlas billing (cluster cost) ────────────────────────────
    this.fetchers.set('mongodb_atlas', async (config) => {
      const publicKey = process.env.MONGODB_ATLAS_PUBLIC_KEY;
      const privateKey = process.env.MONGODB_ATLAS_PRIVATE_KEY;
      const orgId = (config.orgId as string) || process.env.MONGODB_ATLAS_ORG_ID;

      if (!publicKey || !privateKey) {
        throw new Error('MongoDB Atlas API keys not configured (MONGODB_ATLAS_PUBLIC_KEY, MONGODB_ATLAS_PRIVATE_KEY)');
      }
      if (!orgId) {
        throw new Error('MongoDB Atlas org ID not configured (MONGODB_ATLAS_ORG_ID)');
      }

      const path = `/api/atlas/v2/orgs/${orgId}/invoices`;
      const url = `https://cloud.mongodb.com${path}`;
      const accept = 'application/vnd.atlas.2023-01-01+json';

      // Step 1: Unauthenticated request to obtain Digest Auth challenge (nonce, realm, qop)
      const challengeResponse = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': accept },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (challengeResponse.status !== 401) {
        throw new Error(`Expected 401 Digest Auth challenge, got ${challengeResponse.status}`);
      }

      const wwwAuth = challengeResponse.headers.get('WWW-Authenticate') ?? '';
      const parseParam = (name: string): string => {
        const match = new RegExp(`${name}="([^"]*)"`, 'i').exec(wwwAuth);
        return match?.[1] ?? '';
      };
      const realm = parseParam('realm');
      const nonce = parseParam('nonce');
      const qop = parseParam('qop'); // typically "auth"

      // Step 2: Compute MD5 Digest response and retry
      const nc = '00000001';
      const cnonce = createHash('md5').update(String(Date.now())).digest('hex').substring(0, 8);
      const ha1 = createHash('md5').update(`${publicKey}:${realm}:${privateKey}`).digest('hex');
      const ha2 = createHash('md5').update(`GET:${path}`).digest('hex');
      const responseHash = qop === 'auth'
        ? createHash('md5').update(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`).digest('hex')
        : createHash('md5').update(`${ha1}:${nonce}:${ha2}`).digest('hex');

      const authParts = [
        `Digest username="${publicKey}"`,
        `realm="${realm}"`,
        `nonce="${nonce}"`,
        `uri="${path}"`,
        `response="${responseHash}"`,
        ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`] : []),
      ];

      const authResponse = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': accept, 'Authorization': authParts.join(', ') },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!authResponse.ok) {
        throw new Error(`Atlas API HTTP ${authResponse.status}: ${authResponse.statusText}`);
      }

      type AtlasInvoice = { amountCents: number; statusName: string; created: string };
      const data = await authResponse.json() as { results?: AtlasInvoice[] };
      const invoices = data.results ?? [];

      const now = new Date();
      const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthPrefix = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;

      const findInvoice = (prefix: string) => invoices.find(inv => inv.created?.startsWith(prefix));
      const currentInv = findInvoice(currentMonthPrefix);
      const lastInv = findInvoice(lastMonthPrefix);

      return {
        currentMonth: { amountCents: currentInv?.amountCents ?? 0, status: currentInv?.statusName ?? 'unknown' },
        lastMonth: { amountCents: lastInv?.amountCents ?? 0, status: lastInv?.statusName ?? 'unknown' },
      };
    });

    // ── Redis Cloud billing (subscription cost) ─────────────────────────
    this.fetchers.set('redis_cloud', async (config) => {
      const apiKey = process.env.REDIS_CLOUD_API_KEY;
      const secretKey = (config.secretKey as string) || process.env.REDIS_CLOUD_SECRET_KEY;

      if (!apiKey || !secretKey) {
        throw new Error('Redis Cloud API keys not configured (REDIS_CLOUD_API_KEY, REDIS_CLOUD_SECRET_KEY)');
      }

      const headers = {
        'accept': 'application/json',
        'x-api-key': apiKey,
        'x-api-secret-key': secretKey,
      };

      const [flexResponse, fixedResponse] = await Promise.all([
        fetch('https://api.redislabs.com/v1/subscriptions', {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
        fetch('https://api.redislabs.com/v1/fixed/subscriptions', {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        }),
      ]);

      if (!flexResponse.ok) {
        throw new Error(`Redis Cloud (flexible) API HTTP ${flexResponse.status}: ${flexResponse.statusText}`);
      }
      if (!fixedResponse.ok) {
        throw new Error(`Redis Cloud (fixed) API HTTP ${fixedResponse.status}: ${fixedResponse.statusText}`);
      }

      type RawSub = { id?: number; name?: string; plan?: string | { name?: string }; price?: number; pricePeriod?: string; status?: string };
      const flexData = await flexResponse.json() as { subscriptions?: RawSub[] };
      const fixedData = await fixedResponse.json() as { subscriptions?: RawSub[] };

      const normalize = (sub: RawSub, defaultPlan: string) => ({
        id: sub.id ?? 0,
        name: sub.name ?? '',
        plan: typeof sub.plan === 'string' ? sub.plan : (sub.plan?.name ?? defaultPlan),
        price: sub.price ?? 0,
        pricePeriod: sub.pricePeriod ?? 'monthly',
        status: sub.status ?? 'unknown',
      });

      const subscriptions = [
        ...(flexData.subscriptions ?? []).map(s => normalize(s, 'flexible')),
        ...(fixedData.subscriptions ?? []).map(s => normalize(s, 'fixed')),
      ];

      const totalMonthly = subscriptions
        .filter(s => s.status === 'active')
        .reduce((sum, s) => sum + (s.pricePeriod === 'monthly' ? s.price : s.price / 12), 0);

      return { subscriptions, totalMonthly };
    });

    // ── LiteLLM spend (unified AI cost tracking via sidecar proxy) ────
    this.fetchers.set('litellm_spend', async () => {
      const dbUrl = process.env.LITELLM_DATABASE_URL;

      if (!dbUrl) {
        throw new Error('LiteLLM database not configured (LITELLM_DATABASE_URL)');
      }

      // Dynamic import pg to avoid requiring it when not needed
      const { default: pg } = await import('pg');
      const client = new pg.Client({
        connectionString: dbUrl,
        connectionTimeoutMillis: 5000,
        ssl: { rejectUnauthorized: false }, // RDS requires SSL
      });

      try {
        await client.connect();

        // Last 30 days spend, grouped by model
        const spendByModel = await client.query(`
          SELECT
            model,
            COALESCE(SUM(spend), 0) as total_spend,
            COUNT(*) as request_count,
            COALESCE(SUM(total_tokens), 0) as total_tokens
          FROM "LiteLLM_SpendLogs"
          WHERE "startTime" >= NOW() - INTERVAL '30 days'
          GROUP BY model
          ORDER BY total_spend DESC
        `);

        // Total spend last 30 days
        const totalSpend = await client.query(`
          SELECT
            COALESCE(SUM(spend), 0) as total_spend,
            COUNT(*) as total_requests,
            COALESCE(SUM(total_tokens), 0) as total_tokens
          FROM "LiteLLM_SpendLogs"
          WHERE "startTime" >= NOW() - INTERVAL '30 days'
        `);

        // Daily spend for trend
        const dailySpend = await client.query(`
          SELECT
            DATE("startTime") as date,
            COALESCE(SUM(spend), 0) as spend,
            COUNT(*) as requests
          FROM "LiteLLM_SpendLogs"
          WHERE "startTime" >= NOW() - INTERVAL '30 days'
          GROUP BY DATE("startTime")
          ORDER BY date DESC
          LIMIT 7
        `);

        const total = totalSpend.rows[0] || { total_spend: 0, total_requests: 0, total_tokens: 0 };

        return {
          periodDays: 30,
          totalSpend: parseFloat(total.total_spend) || 0,
          totalRequests: parseInt(total.total_requests) || 0,
          totalTokens: parseInt(total.total_tokens) || 0,
          byModel: spendByModel.rows.map(r => ({
            model: r.model,
            spend: parseFloat(r.total_spend) || 0,
            requests: parseInt(r.request_count) || 0,
            tokens: parseInt(r.total_tokens) || 0,
          })),
          dailyTrend: dailySpend.rows.map(r => ({
            date: r.date,
            spend: parseFloat(r.spend) || 0,
            requests: parseInt(r.requests) || 0,
          })),
        };
      } finally {
        await client.end().catch(() => {});
      }
    });

  }
}
