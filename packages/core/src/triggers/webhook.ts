import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import { createHmac } from 'node:crypto';
import { createLogger } from '../logging/logger.js';
import type { Server } from 'node:http';

const API_KEY = process.env.YCLAW_API_KEY || '';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * Check whether a request IP is internal-only:
 *   - IPv4 loopback (127.0.0.1)
 *   - IPv6 loopback (::1)
 *   - RFC1918 private ranges (10/8, 172.16/12, 192.168/16)
 *   - IPv4 link-local (169.254/16)
 *   - IPv6 unique local addresses (fc00::/7)
 *
 * Used to gate internal-only endpoints like /api/migrate, which must be
 * reachable from the sibling compose container (Docker bridge: 172.16/12)
 * but never from the public internet.
 */
function isInternalIp(ip: string): boolean {
  // Strip IPv6-mapped IPv4 prefix (::ffff:10.0.0.1 → 10.0.0.1)
  const addr = ip.replace(/^::ffff:/, '');
  if (addr === '127.0.0.1' || addr === '::1' || addr === 'localhost') return true;
  if (addr.startsWith('10.')) return true;
  if (addr.startsWith('192.168.')) return true;
  if (addr.startsWith('169.254.')) return true;
  // 172.16.0.0/12 (Docker default bridge range)
  const m = /^172\.(\d+)\./.exec(addr);
  if (m?.[1]) {
    const second = parseInt(m[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 unique local addresses fc00::/7
  if (addr.startsWith('fc') || addr.startsWith('fd')) return true;
  return false;
}

/** Middleware that requires a valid API key in the x-api-key header. */
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) {
    if (IS_PRODUCTION) {
      // Fail-closed: in production, reject all requests when API key is not configured
      res.status(503).json({ success: false, error: 'Server misconfigured — API key not set' });
      return;
    }
    // In development, log warning and allow
    next();
    return;
  }
  const provided = req.headers['x-api-key'];
  if (provided !== API_KEY) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  next();
}

/** Verify GitHub webhook signature using HMAC-SHA256. */
function verifyGitHubSignature(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    if (IS_PRODUCTION) {
      res.status(503).json({ success: false, error: 'GitHub webhook secret not configured' });
      return;
    }
    next();
    return;
  }

  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) {
    res.status(401).json({ success: false, error: 'Missing X-Hub-Signature-256 header' });
    return;
  }

  const hmac = createHmac('sha256', secret);
  const digest = 'sha256=' + hmac.update(JSON.stringify(req.body)).digest('hex');

  if (signature !== digest) {
    res.status(401).json({ success: false, error: 'Invalid webhook signature' });
    return;
  }
  next();
}

// ─── WebhookServer ──────────────────────────────────────────────────────────

/**
 * Lightweight Express-based webhook server for agents. External services
 * (GitHub, Stripe, custom tooling) can POST to registered routes to trigger
 * agent tasks. Includes a built-in health check endpoint.
 */
export class WebhookServer {
  private readonly log = createLogger('webhook-server');
  private readonly app: Express;
  private readonly port: number;
  private server: Server | null = null;

  constructor(port?: number) {
    this.port = port || Number(process.env.YCLAW_WEBHOOK_PORT) || 3100;
    this.app = express();

    // ─── Middleware ──────────────────────────────────────────────────────
    this.app.use(express.json({
      limit: '50kb',
      verify: (req: any, _res: any, buf: Buffer) => {
        // Capture raw body for Slack signature verification (HMAC over raw string)
        if (req.url?.startsWith('/slack/')) {
          req.rawBody = buf.toString('utf-8');
        }
      },
    }));
    this.app.use(express.urlencoded({ extended: true, limit: '50kb' }));

    // ─── Health Check (unauthenticated) ─────────────────────────────────
    this.app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Trust the first proxy hop so req.ip reflects the real client address
    // when the API sits behind a reverse proxy (compose sidecar, ALB, etc).
    this.app.set('trust proxy', 'loopback, linklocal, uniquelocal');

    // ─── Internal-only gate for /api/migrate ────────────────────────────
    // Schema migration is idempotent and triggered by the `migrate` sidecar
    // in docker-compose. It must NOT require the operator API key (patient
    // zero doesn't have one yet), but also must NOT be reachable from the
    // public internet. Gate it to loopback / RFC1918 ranges only.
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path !== '/api/migrate') return next();
      const ip = req.ip || (req as unknown as { connection?: { remoteAddress?: string } }).connection?.remoteAddress || '';
      if (!isInternalIp(ip)) {
        this.log.warn('Rejected /api/migrate from non-internal IP', { ip });
        res.status(403).json({ success: false, error: 'Forbidden: /api/migrate is internal-only' });
        return;
      }
      next();
    });

    // ─── API Key Authentication for all routes except /health ──────────
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/health' || req.path === '/health/infra') return next();
      if (req.path === '/telegram/webhook') return next(); // Telegram has its own secret verification
      if (req.path.startsWith('/github/')) return next(); // GitHub uses HMAC signature verification
      if (req.path.startsWith('/slack/')) return next(); // Slack uses HMAC signature verification
      if (req.path.startsWith('/v1/')) return next(); // /v1/* uses operator Bearer auth, not legacy x-api-key
      if (req.path === '/api/ao/callback') return next(); // AO callback uses X-AO-TOKEN auth in its own middleware
      if (req.path === '/api/migrate') return next(); // Gated by isInternalIp above — no API key required
      requireApiKey(req, res, next);
    });

    // ─── GitHub Webhook Signature Verification ──────────────────────────
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/github')) {
        verifyGitHubSignature(req, res, next);
        return;
      }
      next();
    });

    this.log.info('WebhookServer initialized', { port: this.port });
  }

  // ─── Register Route ─────────────────────────────────────────────────

  registerRoute(
    path: string,
    method: string,
    handler: (body: unknown, headers: Record<string, string>) => Promise<unknown>,
  ): void {
    const httpMethod = method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';

    this.app[httpMethod](path, async (req: Request, res: Response) => {
      this.log.info('Webhook received', { method: httpMethod.toUpperCase(), path });

      try {
        const headers = Object.fromEntries(
          Object.entries(req.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );

        // For GET requests, pass query params as body (GET bodies are unreliable)
        const payload = httpMethod === 'get' ? req.query : req.body;
        const result = await handler(payload, headers);
        res.json({ success: true, data: result ?? null });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log.error('Webhook handler failed', { path, error: message });
        res.status(500).json({ success: false, error: 'Internal server error' });
      }
    });

    this.log.info('Route registered', { method: httpMethod.toUpperCase(), path });
  }

  // ─── Express App Access ───────────────────────────────────────────────

  /** Expose the Express app for mounting raw middleware (e.g. Telegraf webhook). */
  getExpressApp(): Express {
    return this.app;
  }

  // ─── Start ────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.port, () => {
          this.log.info('WebhookServer listening', { port: this.port });
          resolve();
        });

        this.server!.on('error', (err) => {
          this.log.error('Server error', { error: err.message });
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  // ─── Stop ─────────────────────────────────────────────────────────────

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          this.log.error('Error stopping server', { error: err.message });
          reject(err);
          return;
        }

        this.server = null;
        this.log.info('WebhookServer stopped');
        resolve();
      });
    });
  }
}
