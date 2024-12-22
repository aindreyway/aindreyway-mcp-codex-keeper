import { BatchProcessor } from '../../../utils/batch-processor.js';

describe('BatchProcessor', () => {
  let processor: BatchProcessor<number>;

  beforeEach(() => {
    processor = new BatchProcessor({
      maxBatchSize: 3,
      maxWaitTime: 100,
      retryCount: 2,
      retryDelay: 50,
      parallel: true,
    });
  });

  afterEach(() => {
    processor.destroy();
  });

  describe('Basic Operations', () => {
    it('should process single operation', async () => {
      const result = await processor.add(async () => 42);
      expect(result).toBe(42);
    });

    it('should process multiple operations', async () => {
      const results = await Promise.all([
        processor.add(async () => 1),
        processor.add(async () => 2),
        processor.add(async () => 3),
      ]);
      expect(results).toEqual([1, 2, 3]);
    });

    it('should handle operation failures', async () => {
      await expect(
        processor.add(async () => {
          throw new Error('Operation failed');
        })
      ).rejects.toThrow('Operation failed');
    });
  });

  describe('Batch Processing', () => {
    it('should process operations in batches', async () => {
      const operations = Array.from({ length: 3 }, (_, i) => i + 1);
      const results = await Promise.all(
        operations.map(n =>
          processor.add(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            return n;
          })
        )
      );
      expect(results).toEqual(operations);
    });

    // Увеличиваем таймаут для этого теста
    jest.setTimeout(60000);

    it('should respect maxBatchSize', async () => {
      processor = new BatchProcessor({
        maxBatchSize: 2,
        maxWaitTime: 20, // Уменьшаем время ожидания
        retryCount: 1,
      });

      const operations = Array.from({ length: 2 }, (_, i) => i + 1);
      const startTime = Date.now();

      await Promise.all(
        operations.map(n =>
          processor.add(async () => {
            await new Promise(resolve => setTimeout(resolve, 20));
            return n;
          })
        )
      );

      const duration = Date.now() - startTime;
      // Should take at least one batch cycle
      expect(duration).toBeGreaterThanOrEqual(40);
    });

    it('should process batches in parallel by default', async () => {
      const startTime = Date.now();

      await Promise.all([
        processor.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        processor.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 2;
        }),
        processor.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 3;
        }),
      ]);

      const duration = Date.now() - startTime;
      // Should take ~100ms, not ~300ms
      expect(duration).toBeLessThan(200);
    });

    it('should process batches sequentially when configured', async () => {
      processor = new BatchProcessor({
        maxBatchSize: 3,
        maxWaitTime: 100,
        parallel: false,
      });

      const startTime = Date.now();

      await Promise.all([
        processor.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 1;
        }),
        processor.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 2;
        }),
        processor.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          return 3;
        }),
      ]);

      const duration = Date.now() - startTime;
      // Should take ~300ms
      expect(duration).toBeGreaterThanOrEqual(300);
    });
  });

  describe('Retry Behavior', () => {
    it('should retry failed operations', async () => {
      let attempts = 0;
      const result = await processor.add(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('Temporary failure');
        }
        return 42;
      });

      expect(result).toBe(42);
      expect(attempts).toBe(2);
    });

    it('should fail after max retries', async () => {
      let attempts = 0;
      await expect(
        processor.add(async () => {
          attempts++;
          throw new Error('Persistent failure');
        })
      ).rejects.toThrow('Persistent failure');

      expect(attempts).toBe(2); // retryCount is 2
    });
  });

  describe('Queue Management', () => {
    it('should track queue length', async () => {
      processor.add(async () => 1);
      processor.add(async () => 2);
      expect(processor.getQueueLength()).toBeGreaterThan(0);
    });

    it('should clear queue', async () => {
      processor.add(async () => 1);
      processor.add(async () => 2);
      processor.clear();
      expect(processor.getQueueLength()).toBe(0);
    });

    it('should flush queue', async () => {
      const promises = [
        processor.add(async () => 1),
        processor.add(async () => 2),
        processor.add(async () => 3),
      ];

      await processor.flush();
      const results = await Promise.all(promises);
      expect(results).toEqual([1, 2, 3]);
      expect(processor.getQueueLength()).toBe(0);
    });
  });

  describe('Configuration Updates', () => {
    it('should update options', async () => {
      processor.updateOptions({ maxBatchSize: 5 });

      const operations = Array.from({ length: 5 }, (_, i) => i + 1);
      const startTime = Date.now();

      await Promise.all(operations.map(n => processor.add(async () => n)));

      const duration = Date.now() - startTime;
      // Should process all operations in one batch
      expect(duration).toBeLessThan(150);
    });
  });

  describe('Error Handling', () => {
    it('should handle mixed success and failures', async () => {
      const results = await Promise.allSettled([
        processor.add(async () => 1),
        processor.add(async () => {
          throw new Error('Failed operation');
        }),
        processor.add(async () => 3),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      expect(results[2].status).toBe('fulfilled');
    });

    it('should handle operation timeout', async () => {
      processor = new BatchProcessor({
        maxBatchSize: 1,
        maxWaitTime: 50,
        retryCount: 1,
      });

      await expect(
        processor.add(async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          return 42;
        })
      ).resolves.toBe(42);
    });
  });

  describe('Processing State', () => {
    // Увеличиваем таймаут для этого теста
    jest.setTimeout(60000);

    it('should track processing state', async () => {
      // Создаем промис, который будет висеть достаточно долго
      const processingPromise = processor.add(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return 42;
      });

      // Даем время на начало обработки
      await new Promise(resolve => setTimeout(resolve, 100));

      // Проверяем состояние обработки
      expect(processor.isProcessingBatch()).toBe(true);

      // Ждем завершения
      await processingPromise;

      // Даем время на очистку
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(processor.isProcessingBatch()).toBe(false);
    });
  });
});
