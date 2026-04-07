import WebSocket from 'ws';
import crypto from 'node:crypto';
import { EventEmitter } from 'events';
import type {
  GatewayStatus,
  ChannelStatus,
  HealthSnapshot,
} from '@/types/gateway';

// ── Types ────────────────────────────────────────────────────────

interface GatewayClientOptions {
  url: string;
  token: string;
}

interface RpcRequest {
  type: 'req';
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface RpcResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { type: string; message: string };
}

interface RpcEvent {
  type: 'event';
  event: string;
  payload: unknown;
  seq?: number;
}

type GatewayFrame = RpcResponse | RpcEvent;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Device Auth ──────────────────────────────────────────────────

interface DeviceIdentity {
  publicKeyPem: string;
  privateKeyPem: string;
  fingerprint: string;
}

function getDeviceIdentity(): DeviceIdentity | null {
  // ECS Secrets Manager JSON extraction yields literal \n in PEM strings
  const publicKeyPem = process.env.GATEWAY_DEVICE_PUBLIC_KEY?.replace(/\\n/g, '\n');
  const privateKeyPem = process.env.GATEWAY_DEVICE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const fingerprint = process.env.GATEWAY_DEVICE_FINGERPRINT;

  if (!publicKeyPem || !privateKeyPem || !fingerprint) {
    return null;
  }

  return { publicKeyPem, privateKeyPem, fingerprint };
}

function signChallenge(nonce: string, identity: DeviceIdentity) {
  const signedAt = Date.now();
  const payload = JSON.stringify({ nonce, signedAt });

  const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
  const signature = crypto.sign(null, Buffer.from(payload), privateKey).toString('base64');

  return {
    id: identity.fingerprint,
    publicKey: identity.publicKeyPem,
    signature,
    signedAt,
    nonce,
  };
}

// ── GatewayClient ────────────────────────────────────────────────

class GatewayClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly token: string;
  private readonly emitter = new EventEmitter();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly requestQueue: RpcRequest[] = [];
  private reconnectAttempts = 0;
  private readonly MAX_BACKOFF_MS = 30000;
  private _connected = false;
  private _connectionEpoch = 0;
  private _destroyed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private challengeNonce: string | null = null;

  // Resolves after first successful handshake
  readonly ready: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (err: Error) => void;
  private readySettled = false;

  // State cache
  readonly state: {
    status: GatewayStatus | null;
    channels: ChannelStatus[] | null;
    health: HealthSnapshot | null;
  } = {
    status: null,
    channels: null,
    health: null,
  };

  constructor(opts: GatewayClientOptions) {
    this.url = opts.url;
    this.token = opts.token;

    this.ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    // Wire state cache updates
    this.on('status', (payload) => {
      this.state.status = payload as GatewayStatus;
    });
    this.on('channels.status', (payload) => {
      const data = payload as { channels?: ChannelStatus[] };
      this.state.channels = data.channels ?? null;
    });
    this.on('health', (payload) => {
      this.state.health = payload as HealthSnapshot;
    });

    this.connect();
  }

  get connected(): boolean {
    return this._connected;
  }

  get connectionEpoch(): number {
    return this._connectionEpoch;
  }

  // ── Event delegation ─────────────────────────────────────────

  on(event: string, handler: (payload: unknown) => void): void {
    this.emitter.on(event, handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.emitter.off(event, handler);
  }

  private emit(event: string, payload: unknown): void {
    this.emitter.emit(event, payload);
  }

  // ── Connection ───────────────────────────────────────────────

  private connect(): void {
    if (this._destroyed) return;
    if (!this.token) {
      console.error('[gateway-ws] No OPENCLAW_GATEWAY_TOKEN configured');
      if (!this.readySettled) {
        this.readySettled = true;
        this.rejectReady(new Error('No gateway token'));
      }
      return;
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('[gateway-ws] WebSocket constructor failed:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      console.log('[gateway-ws] Connected to', this.url);
      // Wait for connect.challenge event from gateway
    });

    this.ws.on('message', (data: WebSocket.Data, isBinary: boolean) => {
      try {
        // Normalize data to string — handles Buffer, ArrayBuffer, Buffer[], and string
        let payload: string;
        if (typeof data === 'string') {
          payload = data;
        } else if (Buffer.isBuffer(data)) {
          payload = data.toString('utf-8');
        } else if (data instanceof ArrayBuffer) {
          payload = Buffer.from(data).toString('utf-8');
        } else if (Array.isArray(data)) {
          payload = Buffer.concat(data).toString('utf-8');
        } else {
          payload = Buffer.from(data as Uint8Array).toString('utf-8');
        }

        const frame = JSON.parse(payload) as GatewayFrame;
        this.handleFrame(frame);
      } catch (err) {
        const preview = typeof data === 'string'
          ? data.slice(0, 200)
          : Buffer.isBuffer(data)
            ? data.toString('utf-8', 0, 200)
            : Object.prototype.toString.call(data);
        console.error('[gateway-ws] Failed to parse frame:', {
          error: err instanceof Error ? err.message : err,
          dataType: typeof data,
          constructor: data?.constructor?.name,
          isBinary,
          preview,
        });
      }
    });

    this.ws.on('close', (code: number) => {
      console.log('[gateway-ws] Disconnected, code:', code);
      this._connected = false;
      this.emit('disconnected', { code });
      this.rejectPendingRequests('Connection closed');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error('[gateway-ws] Error:', err.message);
    });
  }

  private handleFrame(frame: GatewayFrame): void {
    if (frame.type === 'event') {
      const evt = frame as RpcEvent;

      // Handle connect challenge
      if (evt.event === 'connect.challenge') {
        const challenge = evt.payload as { nonce: string; ts: number };
        this.challengeNonce = challenge.nonce;
        this.sendConnectRequest();
        return;
      }

      // Emit to listeners
      this.emit(evt.event, evt.payload);
      return;
    }

    if (frame.type === 'res') {
      const res = frame as RpcResponse;

      // Handle hello-ok (connect response)
      const payload = res.payload as Record<string, unknown> | undefined;
      if (res.ok && payload?.type === 'hello-ok') {
        this._connected = true;
        this._connectionEpoch++;
        this.reconnectAttempts = 0;
        console.log(
          '[gateway-ws] Handshake complete, protocol:',
          payload.protocol,
        );

        if (!this.readySettled) {
          this.readySettled = true;
          this.resolveReady();
        }

        this.flushPendingQueue();
        this.emit('reconnected', { epoch: this._connectionEpoch });
        return;
      }

      // Log rejected connect attempts
      if (!res.ok && !this.pendingRequests.has(res.id)) {
        console.error('[gateway-ws] Connect rejected:', res.error?.message);
      }

      // Handle RPC responses
      const pending = this.pendingRequests.get(res.id);
      if (pending) {
        this.pendingRequests.delete(res.id);
        clearTimeout(pending.timer);

        if (res.ok) {
          pending.resolve(res.payload);
        } else {
          pending.reject(
            new Error(res.error?.message ?? 'RPC error'),
          );
        }
      }
    }
  }

  private sendConnectRequest(): void {
    const id = crypto.randomUUID();
    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'cli',
        version: '1.0.0',
        platform: 'linux',
        mode: 'cli',
      },
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      caps: [],
      commands: [],
      permissions: {},
      auth: { token: this.token },
    };

    // Ed25519 device auth — signs the challenge nonce
    // Skip device auth when dangerouslyDisableDeviceAuth is enabled on the gateway
    // to avoid "device identity mismatch" for unpaired devices.
    // Re-enable once device is properly paired via gateway approval flow.
    if (!process.env.GATEWAY_SKIP_DEVICE_AUTH) {
      const identity = getDeviceIdentity();
      if (identity && this.challengeNonce) {
        params.device = signChallenge(this.challengeNonce, identity);
      }
    }

    const connectFrame: RpcRequest = { type: 'req', id, method: 'connect', params };
    this.ws?.send(JSON.stringify(connectFrame));
  }

  // ── Request/Response ─────────────────────────────────────────

  private static readonly WRITE_METHODS = new Set([
    'sessions.patch', 'cron.add', 'cron.edit', 'cron.run', 'cron.enable',
    'skills.toggle', 'config.set', 'config.apply', 'update.run',
    'chat.send', 'chat.abort', 'exec.approval.resolve',
    'connection.start',
    'connection.wire',
  ]);

  async invoke<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const id = crypto.randomUUID();
    const resolvedParams = { ...(params ?? {}) };

    // Auto-inject idempotencyKey for write methods per protocol spec
    if (GatewayClient.WRITE_METHODS.has(method) && !resolvedParams.idempotencyKey) {
      resolvedParams.idempotencyKey = crypto.randomUUID();
    }

    const frame: RpcRequest = {
      type: 'req',
      id,
      method,
      params: resolvedParams,
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Gateway RPC timeout: ${method}`));
      }, 10000);

      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      if (this._connected && this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(frame));
      } else {
        this.requestQueue.push(frame);
      }
    });
  }

  // ── Queue management ─────────────────────────────────────────

  private flushPendingQueue(): void {
    while (this.requestQueue.length > 0) {
      const frame = this.requestQueue.shift()!;
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(frame));
      }
    }
  }

  private rejectPendingRequests(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }

  // ── Reconnection ─────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this._destroyed) return;
    this.reconnectAttempts++;
    const base = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.MAX_BACKOFF_MS,
    );
    const jitter = Math.random() * 1000;
    const delay = base + jitter;
    console.log(
      `[gateway-ws] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  // ── Lifecycle ────────────────────────────────────────────────

  destroy(): void {
    this._destroyed = true;
    this._connected = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.rejectPendingRequests('Client destroyed');
    this.ws?.close();
    this.emitter.removeAllListeners();
  }
}

// ── Singleton ────────────────────────────────────────────────────

const globalForGateway = globalThis as unknown as {
  gatewayClient: GatewayClient | undefined;
};

export function getGateway(): GatewayClient {
  if (!globalForGateway.gatewayClient) {
    globalForGateway.gatewayClient = new GatewayClient({
      url: process.env.GATEWAY_WS_URL || '',
      token: process.env.OPENCLAW_GATEWAY_TOKEN || '',
    });
  }
  return globalForGateway.gatewayClient;
}
