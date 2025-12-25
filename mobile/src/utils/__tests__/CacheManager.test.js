/**
 * CacheManager Unit Tests
 *
 * Tests for offline caching and queue functionality
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import CacheManager from '../CacheManager';

// Mock AsyncStorage and NetInfo (already mocked in jest.setup.js)

describe('CacheManager', () => {
  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();
    AsyncStorage.clear();
  });

  describe('cacheData', () => {
    it('should cache data with expiration', async () => {
      const key = 'test/endpoint';
      const data = { success: true, data: { id: 1, name: 'Test' } };

      await CacheManager.cacheData(key, data);

      // Verify AsyncStorage.setItem was called
      expect(AsyncStorage.setItem).toHaveBeenCalled();

      // Get the cached data
      const cachedData = await CacheManager.getCachedData(key);

      // Verify the data was cached correctly
      expect(cachedData).toEqual(data);
    });

    it('should use custom cache duration', async () => {
      const key = 'test/endpoint';
      const data = { success: true, data: { id: 1 } };
      const customDuration = 10 * 60 * 1000; // 10 minutes

      await CacheManager.cacheData(key, data, customDuration);

      // Verify the data was cached
      const cachedData = await CacheManager.getCachedData(key);
      expect(cachedData).toEqual(data);
    });
  });

  describe('getCachedData', () => {
    it('should return null if no cached data exists', async () => {
      const result = await CacheManager.getCachedData('nonexistent/key');
      expect(result).toBeNull();
    });

    it('should return cached data if not expired', async () => {
      const key = 'test/endpoint';
      const data = { success: true, data: { id: 1 } };

      // Cache the data
      await CacheManager.cacheData(key, data);

      // Retrieve the data
      const cachedData = await CacheManager.getCachedData(key);

      expect(cachedData).toEqual(data);
    });

    it('should return null and delete data if expired', async () => {
      const key = 'test/endpoint';
      const data = { success: true, data: { id: 1 } };

      // Cache with very short duration
      await CacheManager.cacheData(key, data, 1); // 1ms

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Try to retrieve expired data
      const cachedData = await CacheManager.getCachedData(key);

      expect(cachedData).toBeNull();
    });
  });

  describe('deleteCachedData', () => {
    it('should delete a specific cache entry', async () => {
      const key = 'test/endpoint';
      const data = { success: true, data: { id: 1 } };

      // Cache the data
      await CacheManager.cacheData(key, data);

      // Delete the data
      await CacheManager.deleteCachedData(key);

      // Verify it's gone
      const cachedData = await CacheManager.getCachedData(key);
      expect(cachedData).toBeNull();
    });
  });

  describe('deleteCachedDataByPattern', () => {
    it('should delete all cache entries matching a pattern', async () => {
      // Cache multiple entries
      await CacheManager.cacheData('v1/participants/1', { id: 1 });
      await CacheManager.cacheData('v1/participants/2', { id: 2 });
      await CacheManager.cacheData('v1/activities/1', { id: 1 });

      // Mock getAllKeys to return our cached keys
      AsyncStorage.getAllKeys.mockResolvedValue([
        'cache:v1/participants/1',
        'cache:v1/participants/2',
        'cache:v1/activities/1',
      ]);

      // Delete participant caches
      await CacheManager.deleteCachedDataByPattern('v1/participants');

      // Verify multiRemove was called with participant keys only
      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
        'cache:v1/participants/1',
        'cache:v1/participants/2',
      ]);
    });
  });

  describe('clearAllCache', () => {
    it('should clear all cached data', async () => {
      // Cache multiple entries
      await CacheManager.cacheData('key1', { id: 1 });
      await CacheManager.cacheData('key2', { id: 2 });

      // Mock getAllKeys
      AsyncStorage.getAllKeys.mockResolvedValue([
        'cache:key1',
        'cache:key2',
        'other:key',
      ]);

      // Clear all cache
      await CacheManager.clearAllCache();

      // Verify only cache keys were removed
      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith([
        'cache:key1',
        'cache:key2',
      ]);
    });
  });

  describe('queueMutation', () => {
    it('should queue a mutation', async () => {
      const mutation = {
        method: 'POST',
        url: 'https://api.example.com/v1/participants',
        data: { firstName: 'John', lastName: 'Doe' },
        headers: { 'Content-Type': 'application/json' },
      };

      await CacheManager.queueMutation(mutation);

      // Verify the mutation was queued
      const queue = await CacheManager.getMutationQueue();

      expect(queue).toHaveLength(1);
      expect(queue[0]).toMatchObject({
        method: mutation.method,
        url: mutation.url,
        data: mutation.data,
      });
      expect(queue[0]).toHaveProperty('id');
      expect(queue[0]).toHaveProperty('timestamp');
    });

    it('should queue multiple mutations', async () => {
      const mutation1 = {
        method: 'POST',
        url: 'https://api.example.com/v1/participants',
        data: { firstName: 'John' },
      };

      const mutation2 = {
        method: 'PUT',
        url: 'https://api.example.com/v1/participants/1',
        data: { firstName: 'Jane' },
      };

      await CacheManager.queueMutation(mutation1);
      await CacheManager.queueMutation(mutation2);

      const queue = await CacheManager.getMutationQueue();

      expect(queue).toHaveLength(2);
    });
  });

  describe('getMutationQueue', () => {
    it('should return empty array if no queue exists', async () => {
      const queue = await CacheManager.getMutationQueue();
      expect(queue).toEqual([]);
    });

    it('should return the mutation queue', async () => {
      const mutation = {
        method: 'POST',
        url: 'https://api.example.com/v1/participants',
        data: { firstName: 'John' },
      };

      await CacheManager.queueMutation(mutation);

      const queue = await CacheManager.getMutationQueue();

      expect(Array.isArray(queue)).toBe(true);
      expect(queue.length).toBeGreaterThan(0);
    });
  });

  describe('syncQueuedMutations', () => {
    it('should skip sync if offline', async () => {
      // Mock offline state
      NetInfo.fetch.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
      });

      await CacheManager.getNetworkState(); // Update internal state

      const mockApiClient = jest.fn();
      const result = await CacheManager.syncQueuedMutations(mockApiClient);

      expect(result).toEqual({ success: 0, failed: 0 });
      expect(mockApiClient).not.toHaveBeenCalled();
    });

    it('should skip sync if queue is empty', async () => {
      // Mock online state
      NetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
      });

      await CacheManager.getNetworkState(); // Update internal state

      const mockApiClient = jest.fn();
      const result = await CacheManager.syncQueuedMutations(mockApiClient);

      expect(result).toEqual({ success: 0, failed: 0 });
      expect(mockApiClient).not.toHaveBeenCalled();
    });

    it('should sync queued mutations successfully', async () => {
      // Queue a mutation
      const mutation = {
        method: 'POST',
        url: 'https://api.example.com/v1/participants',
        data: { firstName: 'John' },
      };

      await CacheManager.queueMutation(mutation);

      // Mock online state
      NetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
      });

      await CacheManager.getNetworkState(); // Update internal state

      // Mock successful API call
      const mockApiClient = jest.fn().mockResolvedValue({ success: true });

      const result = await CacheManager.syncQueuedMutations(mockApiClient);

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      expect(mockApiClient).toHaveBeenCalledTimes(1);

      // Queue should be empty after successful sync
      const queue = await CacheManager.getMutationQueue();
      expect(queue).toHaveLength(0);
    });

    it('should re-queue mutations that fail with server errors', async () => {
      // Queue a mutation
      const mutation = {
        method: 'POST',
        url: 'https://api.example.com/v1/participants',
        data: { firstName: 'John' },
      };

      await CacheManager.queueMutation(mutation);

      // Mock online state
      NetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
      });

      await CacheManager.getNetworkState();

      // Mock API failure (500 error)
      const mockApiClient = jest.fn().mockRejectedValue({
        response: { status: 500 },
      });

      const result = await CacheManager.syncQueuedMutations(mockApiClient);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);

      // Mutation should still be in queue
      const queue = await CacheManager.getMutationQueue();
      expect(queue).toHaveLength(1);
    });

    it('should not re-queue mutations that fail with client errors', async () => {
      // Queue a mutation
      const mutation = {
        method: 'POST',
        url: 'https://api.example.com/v1/participants',
        data: { firstName: 'John' },
      };

      await CacheManager.queueMutation(mutation);

      // Mock online state
      NetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
      });

      await CacheManager.getNetworkState();

      // Mock API failure (400 error - client error)
      const mockApiClient = jest.fn().mockRejectedValue({
        response: { status: 400 },
      });

      const result = await CacheManager.syncQueuedMutations(mockApiClient);

      expect(result.success).toBe(0);
      expect(result.failed).toBe(1);

      // Mutation should NOT be in queue (400 errors are not re-queued)
      const queue = await CacheManager.getMutationQueue();
      expect(queue).toHaveLength(0);
    });
  });

  describe('clearMutationQueue', () => {
    it('should clear the mutation queue', async () => {
      // Queue some mutations
      await CacheManager.queueMutation({
        method: 'POST',
        url: 'https://api.example.com/v1/participants',
        data: {},
      });

      // Clear the queue
      await CacheManager.clearMutationQueue();

      // Verify queue is empty
      const queue = await CacheManager.getMutationQueue();
      expect(queue).toEqual([]);
    });
  });

  describe('Cache Invalidation Functions', () => {
    beforeEach(() => {
      // Mock getAllKeys to return various cache keys
      AsyncStorage.getAllKeys.mockResolvedValue([
        'cache:v1/participants',
        'cache:v1/participants/1',
        'cache:v1/activities',
        'cache:v1/activities/1',
        'cache:v1/carpools/activity/1',
        'cache:v1/groups',
        'cache:badge-dashboard',
        'cache:v1/finance',
        'cache:fundraisers',
      ]);
    });

    it('should clear participant-related caches', async () => {
      await CacheManager.clearParticipantRelatedCaches();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(
        expect.arrayContaining([
          'cache:v1/participants',
          'cache:v1/participants/1',
        ])
      );
    });

    it('should clear activity-related caches', async () => {
      await CacheManager.clearActivityRelatedCaches();

      expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    });

    it('should clear carpool-related caches for specific activity', async () => {
      await CacheManager.clearCarpoolRelatedCaches(1);

      expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
        'cache:v1/carpools/activity/1'
      );
    });

    it('should clear all carpool caches if no activity ID provided', async () => {
      await CacheManager.clearCarpoolRelatedCaches();

      expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    });

    it('should clear group-related caches', async () => {
      await CacheManager.clearGroupRelatedCaches();

      expect(AsyncStorage.multiRemove).toHaveBeenCalled();
    });

    it('should clear badge-related caches', async () => {
      await CacheManager.clearBadgeRelatedCaches();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(
        expect.arrayContaining(['cache:badge-dashboard'])
      );
    });

    it('should clear finance-related caches', async () => {
      await CacheManager.clearFinanceRelatedCaches();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(
        expect.arrayContaining(['cache:v1/finance'])
      );
    });

    it('should clear fundraiser-related caches', async () => {
      await CacheManager.clearFundraiserRelatedCaches();

      expect(AsyncStorage.multiRemove).toHaveBeenCalledWith(
        expect.arrayContaining(['cache:fundraisers'])
      );
    });
  });

  describe('Network State', () => {
    it('should detect online state', async () => {
      NetInfo.fetch.mockResolvedValue({
        isConnected: true,
        isInternetReachable: true,
      });

      const isOnline = await CacheManager.getNetworkState();

      expect(isOnline).toBe(true);
    });

    it('should detect offline state', async () => {
      NetInfo.fetch.mockResolvedValue({
        isConnected: false,
        isInternetReachable: false,
      });

      const isOnline = await CacheManager.getNetworkState();

      expect(isOnline).toBe(false);
    });

    it('should add and remove network listeners', () => {
      const listener = jest.fn();

      CacheManager.addNetworkListener(listener);
      CacheManager.removeNetworkListener(listener);

      // No way to easily test this without triggering network events
      // But we can verify the functions don't throw
      expect(true).toBe(true);
    });
  });
});
