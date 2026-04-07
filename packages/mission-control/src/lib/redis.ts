import { Redis } from 'ioredis';

export type RedisConnectionState = 'connected' | 'reconnecting' | 'disconnected';

let redis: Redis | null = null;
let connectionState: RedisConnectionState = 'disconnected';

export function getRedisConnectionState(): RedisConnectionState {
  return connectionState;
}

export function getRedis(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (!redis) {
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy(times: number) {
        const delay = Math.min(times * 500, 30000);
        console.warn(`[redis] Reconnecting in ${delay}ms (attempt ${times})`);
        return delay;
      },
    });

    redis.on('ready', () => {
      const wasReconnecting = connectionState === 'reconnecting';
      connectionState = 'connected';
      console.warn(
        wasReconnecting
          ? '[redis] Reconnected to Redis'
          : '[redis] Connected to Redis',
      );
    });

    redis.on('close', () => {
      if (connectionState === 'connected') {
        console.warn('[redis] Connection lost, attempting reconnect...');
      }
      connectionState = 'reconnecting';
    });

    redis.on('end', () => {
      console.warn('[redis] Connection ended');
      connectionState = 'disconnected';
    });

    redis.on('error', (err: Error) => {
      console.warn('[redis] Error:', err.message);
    });
  }

  return redis;
}

export async function redisGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (!r) return null;
  try {
    return await r.get(key);
  } catch {
    return null;
  }
}

export async function redisScan(pattern: string): Promise<string[]> {
  const r = getRedis();
  if (!r) return [];
  const keys: string[] = [];
  try {
    let cursor = '0';
    do {
      const [nextCursor, batch] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
  } catch {
    // return partial results
  }
  return keys;
}

export async function redisHgetall(key: string): Promise<Record<string, string>> {
  const r = getRedis();
  if (!r) return {};
  try {
    return await r.hgetall(key);
  } catch {
    return {};
  }
}

export async function redisZrange(key: string, start: number, stop: number): Promise<string[]> {
  const r = getRedis();
  if (!r) return [];
  try {
    return await r.zrange(key, start, stop);
  } catch {
    return [];
  }
}

export async function redisSet(key: string, value: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    await r.set(key, value);
    return true;
  } catch {
    return false;
  }
}

export async function redisZcard(key: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  try {
    return await r.zcard(key);
  } catch {
    return 0;
  }
}

export async function redisPublish(channel: string, message: string): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    await r.publish(channel, message);
    return true;
  } catch {
    return false;
  }
}

export async function redisPing(): Promise<boolean> {
  const r = getRedis();
  if (!r) return false;
  try {
    const result = await r.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
