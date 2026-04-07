/**
 * Contract tests for IStateStore — any adapter must pass these.
 *
 * Uses NullStateStore to validate the contract is correctly defined.
 * A real MongoStateStore test would require a running MongoDB instance.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NullStateStore } from '../src/adapters/state/MongoStateStore.js';
import type { IStateStore, ICollection } from '../src/interfaces/IStateStore.js';

interface TestDoc {
  id: string;
  name: string;
  value: number;
  status: string;
}

describe('IStateStore contract (NullStateStore)', () => {
  let store: IStateStore;

  beforeEach(() => {
    store = new NullStateStore();
  });

  it('connects and disconnects without error', async () => {
    await store.connect();
    await store.disconnect();
  });

  it('reports unhealthy', async () => {
    expect(await store.healthy()).toBe(false);
  });

  it('returns null for getRawDb()', () => {
    expect(store.getRawDb()).toBeNull();
  });

  describe('ICollection contract (NullCollection)', () => {
    let collection: ICollection<TestDoc>;

    beforeEach(() => {
      collection = store.collection<TestDoc>('test');
    });

    it('insertOne is a no-op', async () => {
      await expect(collection.insertOne({
        id: '1', name: 'test', value: 42, status: 'active',
      })).resolves.toBeUndefined();
    });

    it('findOne returns null', async () => {
      expect(await collection.findOne({ id: '1' })).toBeNull();
    });

    it('find returns empty array', async () => {
      expect(await collection.find({ status: 'active' })).toEqual([]);
    });

    it('find with options returns empty array', async () => {
      expect(await collection.find(
        { status: 'active' },
        { sort: { value: -1 }, limit: 10, skip: 0 },
      )).toEqual([]);
    });

    it('updateOne returns zero counts', async () => {
      const result = await collection.updateOne(
        { id: '1' },
        { $set: { name: 'updated' } },
      );
      expect(result.matchedCount).toBe(0);
      expect(result.modifiedCount).toBe(0);
    });

    it('updateMany returns zero counts', async () => {
      const result = await collection.updateMany(
        { status: 'pending' },
        { $set: { status: 'rejected' } },
      );
      expect(result.matchedCount).toBe(0);
      expect(result.modifiedCount).toBe(0);
    });

    it('deleteOne returns zero count', async () => {
      const result = await collection.deleteOne({ id: '1' });
      expect(result.deletedCount).toBe(0);
    });

    it('deleteMany returns zero count', async () => {
      const result = await collection.deleteMany({ status: 'old' });
      expect(result.deletedCount).toBe(0);
    });

    it('countDocuments returns zero', async () => {
      expect(await collection.countDocuments()).toBe(0);
      expect(await collection.countDocuments({ status: 'active' })).toBe(0);
    });

    it('createIndex is a no-op', async () => {
      await expect(collection.createIndex({
        fields: { name: 1, value: -1 },
        unique: true,
      })).resolves.toBeUndefined();
    });
  });
});
