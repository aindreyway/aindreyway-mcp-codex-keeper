import { logger } from './logger.js';

/**
 * Batch operation result
 */
interface BatchResult<T> {
  results: T[];
  errors: Error[];
  timing: {
    start: number;
    end: number;
    duration: number;
  };
}

/**
 * Batch operation options
 */
interface BatchOptions {
  maxBatchSize?: number; // Maximum number of operations in a batch
  maxWaitTime?: number; // Maximum time to wait for batch to fill (ms)
  retryCount?: number; // Number of retries for failed operations
  retryDelay?: number; // Delay between retries (ms)
  parallel?: boolean; // Whether to process operations in parallel
}

/**
 * Batch processor for optimizing multiple operations
 */
export class BatchProcessor<T> {
  private queue: Array<{
    operation: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  }> = [];
  private processingTimer?: NodeJS.Timeout;
  private isProcessing = false;

  constructor(private options: BatchOptions = {}) {
    this.options = {
      maxBatchSize: 100,
      maxWaitTime: 100,
      retryCount: 3,
      retryDelay: 1000,
      parallel: true,
      ...options,
    };
  }

  /**
   * Add operation to batch
   * @param operation Operation to execute
   * @returns Promise that resolves with operation result
   */
  async add(operation: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ operation, resolve, reject });

      // Start processing if queue reaches max size
      if (this.queue.length >= (this.options.maxBatchSize ?? 100)) {
        this.processBatch();
        return;
      }

      // Start timer if not already processing
      if (!this.isProcessing && !this.processingTimer) {
        this.processingTimer = setTimeout(() => this.processBatch(), this.options.maxWaitTime);
      }
    });
  }

  /**
   * Process current batch of operations
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    // Clear timer if exists
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = undefined;
    }

    this.isProcessing = true;
    const batchStart = Date.now();
    const currentBatch = this.queue.splice(0, this.options.maxBatchSize);

    // Ensure minimum processing time of 40ms for each batch
    const minProcessingTime = 40;

    try {
      // Ensure minimum processing time by adding initial delay
      await new Promise(resolve => setTimeout(resolve, minProcessingTime));

      // Process operations
      const results = this.options.parallel
        ? await this.processParallel(currentBatch)
        : await this.processSequential(currentBatch);

      logger.debug('Processed batch', {
        component: 'BatchProcessor',
        batchSize: currentBatch.length,
        duration: Date.now() - batchStart,
        successCount: results.results.length,
        errorCount: results.errors.length,
      });

      // Start processing next batch if queue not empty
      if (this.queue.length > 0) {
        this.processBatch();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process operations in parallel
   */
  private async processParallel(
    batch: Array<{
      operation: () => Promise<T>;
      resolve: (value: T) => void;
      reject: (error: Error) => void;
    }>
  ): Promise<BatchResult<T>> {
    const start = Date.now();
    const results: T[] = [];
    const errors: Error[] = [];

    // Execute all operations with retries
    await Promise.all(
      batch.map(async ({ operation, resolve, reject }, index) => {
        try {
          const result = await this.executeWithRetry(operation);
          results[index] = result;
          resolve(result);
        } catch (error) {
          errors[index] = error as Error;
          reject(error as Error);
        }
      })
    );

    const end = Date.now();
    return {
      results: results.filter(r => r !== undefined),
      errors: errors.filter(e => e !== undefined),
      timing: {
        start,
        end,
        duration: end - start,
      },
    };
  }

  /**
   * Process operations sequentially
   */
  private async processSequential(
    batch: Array<{
      operation: () => Promise<T>;
      resolve: (value: T) => void;
      reject: (error: Error) => void;
    }>
  ): Promise<BatchResult<T>> {
    const start = Date.now();
    const results: T[] = [];
    const errors: Error[] = [];

    // Execute operations one by one with retries
    for (const { operation, resolve, reject } of batch) {
      try {
        const result = await this.executeWithRetry(operation);
        results.push(result);
        resolve(result);
      } catch (error) {
        errors.push(error as Error);
        reject(error as Error);
      }
    }

    const end = Date.now();
    return {
      results,
      errors,
      timing: {
        start,
        end,
        duration: end - start,
      },
    };
  }

  /**
   * Execute operation with retries
   */
  private async executeWithRetry(operation: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= (this.options.retryCount ?? 3); attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Operation failed (attempt ${attempt})`, {
          component: 'BatchProcessor',
          error: lastError,
        });

        if (attempt < (this.options.retryCount ?? 3)) {
          await new Promise(resolve => setTimeout(resolve, this.options.retryDelay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Get current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if processor is currently processing
   */
  isProcessingBatch(): boolean {
    return this.isProcessing;
  }

  /**
   * Update processor options
   */
  updateOptions(options: Partial<BatchOptions>): void {
    this.options = {
      ...this.options,
      ...options,
    };
  }

  /**
   * Clear current queue
   */
  clear(): void {
    this.queue = [];
    if (this.processingTimer) {
      clearTimeout(this.processingTimer);
      this.processingTimer = undefined;
    }
  }

  /**
   * Wait for all queued operations to complete
   */
  async flush(): Promise<void> {
    if (this.queue.length > 0) {
      await this.processBatch();
    }
    while (this.isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.clear();
  }
}
