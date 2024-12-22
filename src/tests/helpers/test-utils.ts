import path from 'path';
import fs from 'fs/promises';
import { DocSource, ValidCategory } from '../../types/index.js';

/**
 * Creates a test directory with a unique name
 */
export const createTestDir = async (): Promise<string> => {
  const testDir = path.join(
    process.cwd(),
    'test-data',
    `test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await fs.mkdir(testDir, { recursive: true });
  return testDir;
};

/**
 * Cleans up a test directory
 */
export const cleanupTestDir = async (testDir: string): Promise<void> => {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to clean test directory: ${error}`);
  }
};

/**
 * Creates a test environment with all necessary setup
 */
export const createTestEnvironment = async () => {
  const testDir = await createTestDir();

  // Set test environment variables
  const originalEnv = process.env;
  process.env = {
    ...originalEnv,
    MCP_ENV: 'test',
    STORAGE_PATH: testDir,
    NODE_ENV: 'test',
  };

  return {
    testDir,
    cleanup: async () => {
      await cleanupTestDir(testDir);
      process.env = originalEnv;
    },
  };
};

/**
 * Creates a test document with default values
 */
export const createTestDoc = (overrides: Partial<DocSource> = {}): DocSource => ({
  name: 'Test Doc',
  url: 'https://example.com/doc',
  category: 'Base.Standards' as ValidCategory,
  description: 'Test description',
  tags: ['test'],
  ...overrides,
});

/**
 * Waits for a condition to be true
 */
export const waitFor = async (
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> => {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
};

/**
 * Creates a mock fetch response
 */
export const createMockResponse = (data: any, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => data,
  text: async () => JSON.stringify(data),
});

/**
 * Performance testing utilities
 */
export const performance = {
  /**
   * Measures execution time of an async function
   */
  async measure<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1_000_000; // Convert to milliseconds
    return { result, duration };
  },

  /**
   * Runs multiple iterations of a function and returns statistics
   */
  async benchmark(
    fn: () => Promise<void>,
    iterations = 100
  ): Promise<{ mean: number; min: number; max: number; stdDev: number }> {
    const times: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const { duration } = await performance.measure(fn);
      times.push(duration);
    }

    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = times.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / times.length;

    return {
      mean,
      min: Math.min(...times),
      max: Math.max(...times),
      stdDev: Math.sqrt(variance),
    };
  },
};

/**
 * Memory testing utilities
 */
export const memory = {
  /**
   * Gets current memory usage
   */
  getUsage(): NodeJS.MemoryUsage {
    return process.memoryUsage();
  },

  /**
   * Measures memory usage before and after a function execution
   */
  async measure<T>(fn: () => Promise<T>): Promise<{
    result: T;
    before: NodeJS.MemoryUsage;
    after: NodeJS.MemoryUsage;
    diff: NodeJS.MemoryUsage;
  }> {
    const before = memory.getUsage();
    const result = await fn();
    const after = memory.getUsage();

    const diff = {
      heapTotal: after.heapTotal - before.heapTotal,
      heapUsed: after.heapUsed - before.heapUsed,
      external: after.external - before.external,
      arrayBuffers: after.arrayBuffers - before.arrayBuffers,
      rss: after.rss - before.rss,
    };

    return { result, before, after, diff };
  },
};