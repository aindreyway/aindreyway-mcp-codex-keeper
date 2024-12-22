import 'jest-extended';
import { mockDeep, mockReset } from 'jest-mock-extended';
import { logger } from '../../utils/logger.js';
import { Worker, MessagePort, WorkerOptions } from 'worker_threads';

// Define types for handles and workers
interface WorkerHandle {
  constructor: { name: string };
  terminate?: () => Promise<void>;
  destroy?: () => void;
  unref?: () => void;
  removeAllListeners?: () => void;
  startTime: number;  // Changed from optional to required
  threadId?: number;
  getState?: () => string;
  isRunning?: boolean;
  exitCode?: number | null;  // Added null as possible value
  _state?: string;
}

// Define types for process._getActiveHandles
declare global {
  namespace NodeJS {
    interface Process {
      _getActiveHandles(): Array<{
        constructor: { name: string };
        unref?: () => void;
        destroy?: () => void;
        removeAllListeners?: () => void;
      }>;
    }
  }
}
import fs from 'fs/promises';
import path from 'path';

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
jest.setTimeout(30000);

// Console methods are configured in main setup.ts

// Define types for tracking
type TrackedWorker = Worker & {
  terminate(): void;
  postMessage(value: any, transferList?: ReadonlyArray<MessagePort | ArrayBuffer>): void;
  ref(): void;
  unref(): void;
};

// Track active handles and resources
const activeHandles = new Set();
const activeWorkers = new Set<TrackedWorker>();
// Initialize worker tracking
beforeAll(async () => {
  try {
    const { Worker: OriginalWorker } = await import('worker_threads');
    
    // Create a simple tracked worker factory function
    const createTrackedWorker = (filename: string | URL, options?: WorkerOptions): TrackedWorker => {
      const worker = new OriginalWorker(filename, options) as TrackedWorker;
      activeWorkers.add(worker);
      worker.on('exit', () => {
        activeWorkers.delete(worker);
      });
      return worker;
    };

    // Replace the Worker constructor directly
    (global as any).Worker = function Worker(filename: string | URL, options?: WorkerOptions) {
      return createTrackedWorker(filename, options);
    };
    
    // Copy only necessary properties
    (global as any).Worker.prototype = OriginalWorker.prototype;
  } catch (error) {
    console.warn('Failed to patch worker_threads:', error instanceof Error ? error.message : String(error));
  }
});

// Clean up after each test
afterEach(async () => {
  // Restore all mocks
  jest.restoreAllMocks();
  jest.clearAllMocks();
  jest.resetAllMocks();

  // Clear all timers
  jest.clearAllTimers();

  // Terminate any active workers
  for (const worker of activeWorkers) {
    try {
      worker.terminate();
    } catch (error) {
      console.warn('Failed to terminate worker:', error);
    }
  }
  activeWorkers.clear();

  // Clear all intervals and timeouts with enhanced error handling
  const globalObj = typeof window !== 'undefined' ? window : global;
  const intervals = (globalObj as any)[Symbol.for('jest-native-timers')] || new Set();
  const timeouts = (globalObj as any)[Symbol.for('jest-native-timeouts')] || new Set();
  let activeHandles: Array<{ constructor: { name: string }; unref?: () => void; destroy?: () => void }> = [];
  
  try {
    // Get all active handles and timers
    activeHandles = process._getActiveHandles?.() || [];
    const timers = activeHandles.filter(handle => 
      handle.constructor.name === 'Timeout' || 
      handle.constructor.name === 'Interval'
    );
    
    // First unref all timers with error handling
    for (const timer of timers) {
      try {
        if (timer.unref) timer.unref();
        if (timer.destroy) timer.destroy();
      } catch (error) {
        logger.warn('Failed to cleanup timer', {
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    }
  } catch (error) {
    logger.warn('Failed to get active handles', {
      error: error instanceof Error ? error : new Error(String(error))
    });
  }
  
  // Create a set of all handles to clean up with error handling
  const allHandles = new Set<any>();
  try {
    const handles = [
      ...(Array.from(intervals) || []),
      ...(Array.from(timeouts) || []),
      ...activeHandles
    ];
    handles.forEach(handle => {
      if (handle) allHandles.add(handle);
    });
  } catch (error) {
    logger.warn('Failed to gather handles', {
      error: error instanceof Error ? error : new Error(String(error))
    });
  }
  
  // First unref all handles to prevent blocking
  allHandles.forEach((handle: any) => {
    try {
      if (handle && typeof handle.unref === 'function') {
        handle.unref();
      }
      
      // Special handling for EventEmitter instances
      if (handle && typeof handle.removeAllListeners === 'function') {
        handle.removeAllListeners();
      }
    } catch (error) {
      console.warn('Failed to unref handle:', error);
    }
  });

  // Then clear all timers
  intervals.forEach((interval: any) => {
    try {
      if (interval) {
        clearInterval(interval);
      }
    } catch (error) {
      console.warn('Failed to clear interval:', error);
    }
  });

  timeouts.forEach((timeout: any) => {
    try {
      if (timeout) {
        clearTimeout(timeout);
      }
    } catch (error) {
      console.warn('Failed to clear timeout:', error);
    }
  });
  
  // Force cleanup of any remaining handles
  allHandles.forEach((handle: any) => {
    try {
      if (handle && typeof handle.destroy === 'function') {
        handle.destroy();
      }
    } catch (error) {
      console.warn('Failed to destroy handle:', error);
    }
  });

  // Enhanced cleanup strategy with active handle tracking
  const cleanupPromises = [];
  
  // Stage 1: Handle active timers and resources with concurrent operation awareness
  cleanupPromises.push(
    new Promise<void>(resolve => {
      try {
        const activeHandles = process._getActiveHandles();
        const concurrentOperationTimeout = 5000; // Allow more time for concurrent operations
        
        // First identify any active worker threads
        const activeWorkers = activeHandles.filter(handle => 
          handle.constructor.name === 'Worker'
        );
        
        // Give workers time to complete their operations
        if (activeWorkers.length > 0) {
          setTimeout(() => {
            // Now safely unref timers and handles
            activeHandles
              .filter(handle => handle.constructor.name === 'Timeout')
              .forEach(timer => {
                if (typeof timer.unref === 'function') {
                  timer.unref();
                }
              });
            
            // Unref remaining handles except active workers
            activeHandles
              .filter(handle => handle.constructor.name !== 'Worker')
              .forEach(handle => {
                if (handle && typeof handle.unref === 'function') {
                  handle.unref();
                }
              });
            
            resolve();
          }, concurrentOperationTimeout);
        } else {
          // No workers, proceed with normal cleanup
          activeHandles
            .filter(handle => handle.constructor.name === 'Timeout')
            .forEach(timer => {
              if (typeof timer.unref === 'function') {
                timer.unref();
              }
            });
          
          activeHandles.forEach(handle => {
            if (handle && typeof handle.unref === 'function') {
              handle.unref();
            }
          });
          
          resolve();
        }
      } catch (error) {
        logger.error('Error during handle cleanup:', {
          component: 'JestSetup',
          operation: 'cleanup',
          error: error instanceof Error ? error : new Error(String(error))
        });
        resolve();
      }
    })
  );
  
  // Stage 2: Force cleanup and garbage collection
  cleanupPromises.push(
    new Promise<void>(resolve => {
      if (typeof global.gc === 'function') {
        global.gc();
      }
      resolve();
    })
  );
  
  // Stage 3: Final cleanup with reasonable timeouts
  cleanupPromises.push(
    new Promise<void>(resolve => {
      const cleanup = async () => {
        // First wait for immediate operations
        await new Promise<void>(r => setImmediate(r));
        
        // Then force garbage collection
        if (typeof global.gc === 'function') {
          global.gc();
        }
        
        // Brief wait for any remaining async operations
        await new Promise<void>(r => setTimeout(r, 1000));
        
        // Check for any remaining worker threads
        const remainingWorkers = (process._getActiveHandles?.()
          ?.filter(handle => {
            // Only cleanup workers that are marked as completed or errored
            if (handle?.constructor?.name === 'Worker') {
              // Initialize worker with required properties
              const worker = {
                ...handle,
                startTime: (handle as any).startTime || Date.now()
              } as WorkerHandle;
              
              // Enhanced state checking with multiple indicators and forced cleanup
              const workerState = worker.getState?.() || worker._state;
              const isExited = worker.exitCode !== undefined && worker.exitCode !== null;
              const isStopped = workerState === 'stopped' || workerState === 'errored' || workerState === 'terminated';
              const isNotRunning = worker.isRunning === false;
              const hasBeenRunningTooLong = Date.now() - worker.startTime > 30000; // 30 seconds max
              
              if (hasBeenRunningTooLong) {
                console.warn(`Force cleaning up long-running worker ${worker.threadId}`);
                try {
                  worker.terminate?.();
                } catch (error) {
                  console.warn(`Failed to terminate worker ${worker.threadId}:`, error);
                }
              }
              
              return isExited || isStopped || isNotRunning || hasBeenRunningTooLong;
            }
            return false;
          }) || []).map(handle => ({
            ...handle,
            startTime: (handle as any).startTime || Date.now()
          })) as WorkerHandle[];
          
        for (const worker of remainingWorkers) {
          try {
            // Extended grace period for worker cleanup
            await new Promise<void>(resolve => setTimeout(resolve, 2000));
            
            if (worker.terminate) {
              await worker.terminate();
            } else if (worker.destroy) {
              worker.destroy();
            }
          } catch (error) {
            logger.warn('Failed to terminate worker in final cleanup', {
              error: error instanceof Error ? error : new Error(String(error)),
              workerId: (worker as any).threadId
            });
          }
        }
        
        resolve();
      };
      cleanup();
    })
  );
  
  // Stage 4: ResourceManager cleanup
  cleanupPromises.push(
    new Promise<void>(resolve => {
      const cleanup = async () => {
        // Get all active handles that might be ResourceManager instances
        const activeHandles = process._getActiveHandles?.() || [];
        const resourceManagers = activeHandles.filter(handle => 
          handle?.constructor?.name === 'ResourceManager' ||
          (handle as any)?._events?.metrics !== undefined // ResourceManager extends EventEmitter and has 'metrics' event
        );

        // Clean up ResourceManager instances
        for (const manager of resourceManagers) {
          try {
            if (typeof (manager as any).destroy === 'function') {
              await (manager as any).destroy();
            }
          } catch (error) {
            logger.warn('Failed to destroy ResourceManager', {
              error: error instanceof Error ? error : new Error(String(error))
            });
          }
        }
        resolve();
      };
      cleanup();
    })
  );

  // Execute cleanup stages sequentially
  for (const promise of cleanupPromises) {
    await promise;
  }
  
  // Additional cleanup for any stray test directories
  try {
    const testDataDir = path.join(process.cwd(), 'test-data');
    const contents = await fs.readdir(testDataDir);
    await Promise.all(
      contents.map(async (item) => {
        const fullPath = path.join(testDataDir, item);
        try {
          await fs.rm(fullPath, { recursive: true, force: true });
        } catch (error) {
          console.error(`Failed to cleanup ${fullPath}:`, error);
        }
      })
    );
  } catch (error) {
    // Ignore if test-data doesn't exist
    if ((error as any)?.code !== 'ENOENT') {
      console.error('Failed to cleanup test directories:', error);
    }
  }
});

// Clean up after all tests
afterAll(async () => {
  // Final cleanup of any remaining timers or handles
  jest.clearAllTimers();

  // Final cleanup and wait for any remaining operations
  if (typeof global.gc === 'function') {
    global.gc();
  }
  
  // Extended wait to ensure all cleanup completes
  await Promise.all([
    new Promise(resolve => setImmediate(resolve)),
    new Promise(resolve => setTimeout(resolve, 2000))
  ]);
});

// Add custom types for matchers
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
