import { CacheManager } from '../../../utils/cache-manager.js';
import { performance, memory } from '../../helpers/test-utils.js';

describe('CacheManager Performance', () => {
  let cache: CacheManager<string>;

  beforeEach(() => {
    cache = new CacheManager({
      maxSize: 10000,
      maxAge: 1000,
      cleanupInterval: 100,
    });
  });

  afterEach(() => {
    cache.destroy();
  });

  describe('Write Performance', () => {
    it('should handle rapid sequential writes', async () => {
      const iterations = 10000;
      const { duration } = await performance.measure(async () => {
        for (let i = 0; i < iterations; i++) {
          cache.set(`key${i}`, `value${i}`, 10);
        }
      });

      // Ожидаем не более 100мс на 1000 операций
      const expectedMaxDuration = (iterations / 1000) * 100;
      expect(duration).toBeLessThan(expectedMaxDuration);
    });

    it('should handle concurrent writes efficiently', async () => {
      const concurrency = 10;
      const operationsPerThread = 1000;

      const { duration } = await performance.measure(async () => {
        await Promise.all(
          Array.from({ length: concurrency }).map(async (_, thread) => {
            for (let i = 0; i < operationsPerThread; i++) {
              await cache.set(`key-${thread}-${i}`, `value-${i}`, 10);
            }
          })
        );
      });

      // Ожидаем не более 500мс на 1000 параллельных операций
      const totalOperations = concurrency * operationsPerThread;
      const expectedMaxDuration = (totalOperations / 1000) * 500;
      expect(duration).toBeLessThan(expectedMaxDuration);
    });
  });

  describe('Read Performance', () => {
    beforeEach(async () => {
      // Заполняем кэш тестовыми данными
      for (let i = 0; i < 10000; i++) {
        cache.set(`key${i}`, `value${i}`, 10);
      }
    });

    it('should handle rapid sequential reads', async () => {
      const iterations = 10000;
      const { duration } = await performance.measure(async () => {
        for (let i = 0; i < iterations; i++) {
          cache.get(`key${i}`);
        }
      });

      // Ожидаем не более 50мс на 1000 операций чтения
      const expectedMaxDuration = (iterations / 1000) * 50;
      expect(duration).toBeLessThan(expectedMaxDuration);
    });

    it('should handle concurrent reads efficiently', async () => {
      const concurrency = 10;
      const operationsPerThread = 1000;

      const { duration } = await performance.measure(async () => {
        await Promise.all(
          Array.from({ length: concurrency }).map(async (_, thread) => {
            for (let i = 0; i < operationsPerThread; i++) {
              cache.get(`key${i}`);
            }
          })
        );
      });

      // Ожидаем не более 250мс на 1000 параллельных операций чтения
      const totalOperations = concurrency * operationsPerThread;
      const expectedMaxDuration = (totalOperations / 1000) * 250;
      expect(duration).toBeLessThan(expectedMaxDuration);
    });
  });

  describe('Memory Usage', () => {
    it('should maintain stable memory usage under load', async () => {
      const iterations = 1000;
      const { before, after, diff } = await memory.measure(async () => {
        for (let i = 0; i < iterations; i++) {
          cache.set(`key${i}`, `value${i}`, 10);
          if (i % 2 === 0) {
            cache.get(`key${i - 1}`);
          }
          if (i % 3 === 0) {
            cache.delete(`key${i - 2}`);
          }
        }
      });

      // Проверяем, что прирост памяти не превышает ожидаемый
      const maxExpectedHeapGrowth = 5 * 1024 * 1024; // 5MB
      expect(diff.heapUsed).toBeLessThan(maxExpectedHeapGrowth);
    });

    it('should cleanup memory after clear', async () => {
      // Заполняем кэш
      for (let i = 0; i < 1000; i++) {
        cache.set(`key${i}`, `value${i}`, 10);
      }

      const { before, after, diff } = await memory.measure(async () => {
        cache.clear();
        // Принудительный GC если доступен
        if (global.gc) {
          global.gc();
        }
      });

      // После очистки и GC ожидаем уменьшение использования памяти
      expect(diff.heapUsed).toBeLessThan(0);
    });
  });

  describe('Stress Testing', () => {
    it('should handle mixed operations under load', async () => {
      const duration = 5000; // 5 seconds
      const startTime = Date.now();
      let operations = 0;

      const { result } = await performance.measure(async () => {
        while (Date.now() - startTime < duration) {
          const op = Math.random();
          const key = `key${Math.floor(Math.random() * 1000)}`;

          if (op < 0.4) {
            // 40% reads
            cache.get(key);
          } else if (op < 0.8) {
            // 40% writes
            cache.set(key, `value${operations}`, 10);
          } else {
            // 20% deletes
            cache.delete(key);
          }

          operations++;
        }
        return operations;
      });

      // Ожидаем минимум 10000 операций в секунду
      const opsPerSecond = (operations / duration) * 1000;
      expect(opsPerSecond).toBeGreaterThan(10000);
    });
  });
});
