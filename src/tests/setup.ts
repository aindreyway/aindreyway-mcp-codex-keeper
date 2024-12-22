import 'jest-extended/all';
import { mockDeep, mockReset } from 'jest-mock-extended';

// Extend Jest matchers
expect.extend({
  toMatchFilePath(received: string, expected: string) {
    const normalizedReceived = received.replace(/[\\/]+/g, '/');
    const normalizedExpected = expected.replace(/[\\/]+/g, '/');

    return {
      message: () => `expected ${normalizedReceived} to match path ${normalizedExpected}`,
      pass: normalizedReceived === normalizedExpected,
    };
  },
});

// Mock global.gc for tests
(global as any).gc = jest.fn();

// Increase timeout for all tests
jest.setTimeout(10000);

// Сохраняем оригинальный console.error для отладки
const originalError = console.error;

// Configure console methods for test output
const mockLog = jest.fn((...args: any[]) => {
  if (process.env.CI) {
    process.stdout.write(args.map(String).join(' ') + '\n');
  }
});

const mockDebug = jest.fn((...args: any[]) => {
  if (process.env.CI) {
    process.stdout.write('[DEBUG] ' + args.map(String).join(' ') + '\n');
  }
});

const mockInfo = jest.fn((...args: any[]) => {
  if (process.env.CI) {
    process.stdout.write('[INFO] ' + args.map(String).join(' ') + '\n');
  }
});

const mockWarn = jest.fn((...args: any[]) => {
  if (process.env.CI) {
    process.stderr.write('[WARN] ' + args.map(String).join(' ') + '\n');
  }
});

const mockError = jest.fn((...args: any[]) => {
  // Always output errors to stderr
  process.stderr.write('[ERROR] ' + args.map(String).join(' ') + '\n');
});

// Replace console methods with mocks
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: mockLog,
  debug: mockDebug,
  info: mockInfo,
  warn: mockWarn,
  error: mockError
};

// Create test directory helper
export const createTestDir = async (fs: any, path: string) => {
  await fs.mkdir(path, { recursive: true });
  return path;
};

// Clean test directory helper
export const cleanTestDir = async (fs: any, path: string) => {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to clean test directory: ${error}`);
  }
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  // Не используем mockReset, так как он вызывает проблемы
  jest.resetAllMocks();
});

// Clean up after each test
afterEach(async () => {
  // Restore all mocks
  jest.restoreAllMocks();

  // Clear all timers
  jest.clearAllTimers();

  // Clear all intervals and timeouts
  const globalObj = typeof window !== 'undefined' ? window : global;
  
  // Handle intervals
  const intervals = (globalObj as any)[Symbol.for('jest-native-timers')] || new Set();
  intervals.forEach((interval: any) => {
    if (interval && typeof interval.unref === 'function') {
      interval.unref();
    }
    clearInterval(interval);
  });

  // Handle timeouts
  const timeouts = (globalObj as any)[Symbol.for('jest-native-timeouts')] || new Set();
  timeouts.forEach((timeout: any) => {
    if (timeout && typeof timeout.unref === 'function') {
      timeout.unref();
    }
    clearTimeout(timeout);
  });

  // Clean test directories
  const testDataPath = process.env.TEST_DATA_DIR || './test-data';
  try {
    const { rm } = await import('fs/promises');
    await rm(testDataPath, { recursive: true, force: true });
  } catch (error) {
    console.error(`Failed to clean test directory: ${error}`);
  }

  // Wait for any pending promises and I/O operations
  await Promise.all([
    new Promise(resolve => setImmediate(resolve)),
    new Promise(resolve => setTimeout(resolve, 100))
  ]);
});

// Clean up after all tests
afterAll(async () => {
  // Final cleanup of any remaining timers or handles
  jest.clearAllTimers();

  // Wait for any remaining operations
  await new Promise(resolve => setTimeout(resolve, 100));
});

// Add custom type for toMatchFilePath matcher
declare global {
  namespace jest {
    interface Matchers<R> {
      toMatchFilePath(expected: string): R;
      toBeTrue(): R;
      toBeFalse(): R;
      toInclude(value: string): R;
      toEndWith(value: string): R;
    }
  }
}
