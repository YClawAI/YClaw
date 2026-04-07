import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock MongoDB and other dependencies
const mockCollection = {
  createIndex: vi.fn().mockResolvedValue(undefined),
  findOne: vi.fn().mockResolvedValue(null),
  insertOne: vi.fn().mockResolvedValue(undefined),
  updateOne: vi.fn().mockResolvedValue(undefined),
  find: vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
      }),
      toArray: vi.fn().mockResolvedValue([]),
    }),
  }),
  countDocuments: vi.fn().mockResolvedValue(0),
  updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
};

class MockMongoClient {
  connect = vi.fn().mockResolvedValue(undefined);
  db = vi.fn().mockReturnValue({
    collection: vi.fn().mockReturnValue(mockCollection),
  });
}

vi.mock('mongodb', () => ({
  MongoClient: MockMongoClient,
}));

vi.mock('../src/operators/api-keys.js', () => ({
  extractKeyPrefix: vi.fn(),
  verifyApiKey: vi.fn(),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn(),
}));

const { extractKeyPrefix, verifyApiKey } = await import('../src/operators/api-keys.js');

describe('Auth Facade types', () => {
  it('exports all required types', async () => {
    const mod = await import('../src/auth/types.js');
    // Type-only check — these are interfaces so we just verify the module loads
    expect(mod).toBeDefined();
  });

  it('exports getAuthFacade from server module', async () => {
    const mod = await import('../src/auth/server.js');
    expect(typeof mod.getAuthFacade).toBe('function');
  });
});

describe('Auth Facade initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton between tests
    vi.resetModules();
  });

  it('throws when MONGODB_URI is not set', async () => {
    const savedUri = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;

    const { getAuthFacade } = await import('../src/auth/server.js');
    await expect(getAuthFacade()).rejects.toThrow('MONGODB_URI');

    process.env.MONGODB_URI = savedUri;
  });

  it('initializes successfully with MONGODB_URI', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';

    const { getAuthFacade } = await import('../src/auth/server.js');
    const facade = await getAuthFacade();

    expect(facade).toBeDefined();
    expect(typeof facade.validateOperatorKey).toBe('function');
    expect(typeof facade.checkPermission).toBe('function');
    expect(typeof facade.getOperatorState).toBe('function');
    expect(typeof facade.recordAudit).toBe('function');
    expect(typeof facade.createOperatorContext).toBe('function');
  });
});

describe('Auth Facade validateOperatorKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('returns null for invalid key format', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    vi.mocked(extractKeyPrefix).mockReturnValue(null);

    const { getAuthFacade } = await import('../src/auth/server.js');
    const facade = await getAuthFacade();

    const result = await facade.validateOperatorKey('invalid-key');
    expect(result).toBeNull();
  });

  it('returns null when operator not found by prefix', async () => {
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    vi.mocked(extractKeyPrefix).mockReturnValue('abc12345');
    // Mock operator store returns null (configured via MongoDB mock)

    const { getAuthFacade } = await import('../src/auth/server.js');
    const facade = await getAuthFacade();

    const result = await facade.validateOperatorKey('gzop_live_abc12345test');
    expect(result).toBeNull();
  });
});
