import { CacheManager } from '../../../utils/cache-manager.js';

describe('CacheManager', () => {
  let cache: CacheManager<string>;

  beforeEach(() => {
    cache = new CacheManager({
      maxSize: 1000,
      maxAge: 1000, // 1 second
      cleanupInterval: 100,
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      expect(cache.set('key1', 'value1', 10)).toBe(true);
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for missing keys', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should delete values', () => {
      cache.set('key1', 'value1', 10);
      cache.delete('key1');
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should clear all values', () => {
      cache.set('key1', 'value1', 10);
      cache.set('key2', 'value2', 10);
      cache.clear();
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
    });
  });

  describe('Size Management', () => {
    it('should reject entries larger than max size', () => {
      expect(cache.set('large', 'value', 2000)).toBe(false);
    });

    it('should evict entries to make room for new ones', async () => {
      // Set initial entries that fill up most of the cache
      expect(cache.set('key1', 'value1', 400)).toBe(true);
      expect(cache.set('key2', 'value2', 400)).toBe(true);

      // Add new entry that requires eviction of both previous entries
      expect(cache.set('key3', 'value3', 900)).toBe(true);

      // Wait for eviction to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify eviction - both previous entries should be removed
      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBe('value3');
    });

    it('should track current size correctly', () => {
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 200);

      const stats = cache.getStats();
      expect(stats.currentSize).toBe(300);
    });
  });

  describe('Expiration', () => {
    it('should expire entries after maxAge', async () => {
      cache.set('key1', 'value1', 10);

      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(cache.get('key1')).toBeUndefined();
    });

    it('should cleanup expired entries on access', async () => {
      // Установка записей
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 100);

      // Ждем, пока записи устареют
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Попытка доступа должна вызвать очистку
      cache.get('key1');
      cache.get('key2');

      const stats = cache.getStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.currentSize).toBe(0);
    });

    it('should cleanup expired entries manually', async () => {
      // Установка записей
      cache.set('key1', 'value1', 100);
      cache.set('key2', 'value2', 100);

      // Ждем, пока записи устареют
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Вызываем очистку вручную
      cache.cleanup();

      const stats = cache.getStats();
      expect(stats.entryCount).toBe(0);
      expect(stats.currentSize).toBe(0);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entries first', async () => {
      // Set initial entries
      expect(cache.set('key1', 'value1', 400)).toBe(true);
      expect(cache.set('key2', 'value2', 400)).toBe(true);

      // Wait a bit to ensure different access times
      await new Promise(resolve => setTimeout(resolve, 100));

      // Access key1 to make it more recently used
      expect(cache.get('key1')).toBe('value1');

      // Wait a bit more
      await new Promise(resolve => setTimeout(resolve, 100));

      // Add new entry that requires eviction
      expect(cache.set('key3', 'value3', 400)).toBe(true);

      // Verify LRU eviction
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBe('value3');
    }, 30000);
  });

  describe('Batch Operations', () => {
    it('should get multiple values', () => {
      cache.set('key1', 'value1', 10);
      cache.set('key2', 'value2', 10);
      cache.set('key3', 'value3', 10);

      const values = cache.getMany(['key1', 'key2', 'nonexistent']);
      expect(values.get('key1')).toBe('value1');
      expect(values.get('key2')).toBe('value2');
      expect(values.has('nonexistent')).toBe(false);
    });

    it('should set multiple values', () => {
      const entries = [
        { key: 'key1', value: 'value1', size: 10 },
        { key: 'key2', value: 'value2', size: 10 },
        { key: 'large', value: 'value3', size: 2000 },
      ];

      const results = cache.setMany(entries);
      expect(results.get('key1')).toBe(true);
      expect(results.get('key2')).toBe(true);
      expect(results.get('large')).toBe(false);
    });
  });

  describe('Statistics', () => {
    it('should track hit and miss rates', () => {
      cache.set('key1', 'value1', 10);

      cache.getWithStats('key1'); // hit
      cache.getWithStats('missing'); // miss
      cache.getWithStats('key1'); // hit

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(2 / 3);
      expect(stats.missRate).toBe(1 / 3);
    });

    it('should reset statistics', async () => {
      // Set up initial state
      cache.set('key1', 'value1', 10);

      // Generate some stats
      cache.get('key1'); // hit
      cache.get('missing'); // miss
      cache.get('key1'); // hit
      cache.get('key1'); // hit
      cache.get('missing2'); // miss

      // Инициализируем кэш
      cache.set('key1', 'value1', 10);

      // Инициализируем счетчики
      let hits = 0;
      let total = 0;

      // Генерируем статистику
      if (cache.getWithStats('key1')) hits++;
      total++; // hit
      if (!cache.getWithStats('missing1')) total++; // miss
      if (cache.getWithStats('key1')) hits++;
      total++; // hit
      if (cache.getWithStats('key1')) hits++;
      total++; // hit
      if (!cache.getWithStats('missing2')) total++; // miss

      // Проверяем начальную статистику
      let stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(hits / total); // 3 hits из 5 операций
      expect(stats.missRate).toBeCloseTo((total - hits) / total); // 2 misses из 5 операций

      // Сбрасываем статистику
      cache.resetStats();

      // Проверяем сброшенную статистику
      stats = cache.getStats();
      expect(stats.hitRate).toBe(0);
      expect(stats.missRate).toBe(0);
      expect(stats.entryCount).toBe(1); // key1 все еще существует
      expect(stats.currentSize).toBe(10); // размер key1

      // Новые операции должны начать новую статистику
      hits = 0;
      total = 0;
      if (cache.getWithStats('key1')) hits++;
      total++; // hit
      if (!cache.getWithStats('missing3')) total++; // miss

      // Проверяем новую статистику
      stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(hits / total); // 1 hit из 2 операций
      expect(stats.missRate).toBeCloseTo((total - hits) / total); // 1 miss из 2 операций
    }, 30000);
  });

  describe('Configuration Updates', () => {
    it('should update configuration', () => {
      cache.updateConfig({
        maxSize: 2000,
        maxAge: 2000,
      });

      // Now we should be able to store larger entries
      expect(cache.set('large', 'value', 1500)).toBe(true);
    });
  });

  describe('Key/Value Enumeration', () => {
    it('should list all keys', () => {
      cache.set('key1', 'value1', 10);
      cache.set('key2', 'value2', 10);

      const keys = cache.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys.length).toBe(2);
    });

    it('should list all non-expired values', async () => {
      cache.set('key1', 'value1', 10);
      cache.set('key2', 'value2', 10);

      await new Promise(resolve => setTimeout(resolve, 1100));

      const values = cache.values();
      expect(values.length).toBe(0);
    });
  });

  describe('Existence Checks', () => {
    it('should check if key exists', () => {
      cache.set('key1', 'value1', 10);
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('missing')).toBe(false);
    });

    it('should return false for expired entries', async () => {
      cache.set('key1', 'value1', 10);
      await new Promise(resolve => setTimeout(resolve, 1100));
      expect(cache.has('key1')).toBe(false);
    });
  });
});
