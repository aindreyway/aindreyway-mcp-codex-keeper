import { jest } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { EventEmitter } from 'events';
import { DocumentationServer } from '../../server.js';
import { DocSource, ValidCategory } from '../../types/index.js';
import path from 'path';
import fs from 'fs/promises';
import { logger } from '../../utils/logger.js';
// Define comprehensive worker handle type
interface WorkerHandle {
  constructor: { name: string };
  terminate?: () => Promise<void>;
  destroy?: () => void;
  unref?: () => void;
  removeAllListeners?: () => void;
  threadId?: number;
  getState?: () => string;
  isRunning?: boolean;
  exitCode?: number | null;
  stderr?: { 
    _writableState?: { 
      finished?: boolean 
    } 
  };
  stdout?: { 
    _writableState?: { 
      finished?: boolean 
    } 
  };
  process?: { 
    killed?: boolean;
    kill?: (signal: string) => void;
  };
}

// Remove unused import


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

export interface ServerResponse {
  content?: Array<{ type: string; text: string }>;
  headers?: Record<string, string>;
}

export interface ServerRequest {
  params: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

export interface ServerHandler {
  (request: ServerRequest): Promise<ServerResponse>;
}

export interface ServerSchema {
  shape?: {
    method?: {
      value?: string;
    };
  };
}

type MockHandler = (schema: ServerSchema, handler: ServerHandler) => Promise<void>;
type MockConnect = () => Promise<void>;
type MockClose = () => Promise<void>;

export interface MockServer {
  setRequestHandler: jest.MockedFunction<MockHandler>;
  connect: jest.MockedFunction<MockConnect>;
  close: jest.MockedFunction<MockClose>;
}

export class TestServer {
  private mockHandlers: Map<string, ServerHandler>;
  private mockServer!: MockServer;
  private server: DocumentationServer & EventEmitter;
  private resources: Map<string, { content: string; lastUpdated: string }>;
  private static originalMaxListeners: number = 0;
  private static originalListeners: Map<string | symbol, Function[]> = new Map();
  public registerServerCleanup: () => void = () => {
    throw new Error('registerServerCleanup not initialized');
  };

  private constructor(server: DocumentationServer) {
    this.server = server;
    this.mockHandlers = new Map();
    this.resources = new Map();
    
    // Enhanced server cleanup and event handling
    if (server instanceof DocumentationServer) {
      // Set max listeners with safety margin
      const MAX_LISTENERS = 50;
      server.setMaxListeners(MAX_LISTENERS);
      
      // Store original state
      const originalMaxListeners = server.getMaxListeners();
      
      // Create a Map to store original listeners since events can be symbols
      const originalListeners = new Map<string | symbol, Function[]>();
      server.eventNames().forEach(event => {
        originalListeners.set(event, server.listeners(event));
      });
      
      // Initialize static fields
      if (!TestServer.originalListeners) {
        TestServer.originalListeners = new Map();
      }
      TestServer.originalMaxListeners = server.getMaxListeners();

      // Create cleanup registration function
      this.registerServerCleanup = () => {
        beforeAll(() => {
          // Store original state
          server.eventNames().forEach((event: string | symbol) => {
            TestServer.originalListeners.set(event, server.listeners(event));
          });
        });

        afterEach(async () => {
          try {
            // First remove all test-specific listeners
            server.eventNames().forEach((event: string | symbol) => {
              const originalEventListeners = TestServer.originalListeners.get(event) || [];
              const currentListeners = server.listeners(event);
              
              // Remove only the listeners that were added during the test
              currentListeners.forEach(listener => {
                if (!originalEventListeners.includes(listener)) {
                  server.removeListener(event, listener as (...args: any[]) => void);
                }
              });
            });
            
            // Then perform server cleanup
            if (typeof server.cleanup === 'function') {
              await server.cleanup();
            }
            
            // Reset to original state
            server.setMaxListeners(TestServer.originalMaxListeners);
            
            // Enhanced cleanup with active handle management and staged timeouts
            const cleanupPromises = [];
            
            // Stage 1: Remove all listeners and cleanup server
            cleanupPromises.push(
              new Promise<void>(resolve => {
                const cleanup = async () => {
                  try {
                    // Remove all listeners for each event
                    server.eventNames().forEach(event => {
                      server.removeAllListeners(event);
                    });
                    
                    // Cleanup server resources
                    if (typeof server.cleanup === 'function') {
                      await server.cleanup();
                    }
                    
                    resolve();
                  } catch (error) {
                    logger.error('Error during listener cleanup:', {
                      component: 'TestServer',
                      operation: 'cleanup',
                      error: error instanceof Error ? error : new Error(String(error))
                    });
                    resolve();
                  }
                };
                cleanup().catch(error => {
                  logger.error('Error in cleanup IIFE:', {
                    component: 'TestServer',
                    operation: 'cleanup',
                    error: error instanceof Error ? error : new Error(String(error))
                  });
                  resolve();
                });
              })
            );
            
            // Stage 2: Handle active timers and resources
            cleanupPromises.push(
              new Promise<void>(resolve => {
                try {
                  // Get and unref all active handles
                  const activeHandles = process._getActiveHandles();
                  activeHandles.forEach(handle => {
                    if (handle && typeof handle.unref === 'function') {
                      handle.unref();
                    }
                  });
                  
                  // Force cleanup of remaining handles
                  if (typeof global.gc === 'function') {
                    global.gc();
                  }
                  
                  resolve();
                } catch (error) {
                  logger.error('Error during handle cleanup:', {
                    component: 'TestServer',
                    operation: 'cleanup',
                    error: error instanceof Error ? error : new Error(String(error))
                  });
                  resolve();
                }
              })
            );
            
            // Stage 3: Final cleanup with extended timeout
            cleanupPromises.push(
              new Promise(resolve => setTimeout(resolve, 2000))
            );
            
            await Promise.all(cleanupPromises);
            
            // Final verification of cleanup with detailed logging
            const remainingEvents = server.eventNames();
            if (remainingEvents.length > 0) {
              const remainingListenerCounts = remainingEvents.map(event => ({
                event: event.toString(),
                count: server.listeners(event).length
              }));
              
              logger.warn('Some listeners remained after cleanup', {
                component: 'TestServer',
                operation: 'cleanup',
                remainingListenerCounts,
                totalEvents: remainingEvents.length
              });
            }
          } catch (error) {
            logger.error('Failed to cleanup test server', {
              component: 'TestServer',
              operation: 'cleanup',
              error: error instanceof Error ? error : new Error(String(error))
            });
            throw error;
          }
        });
      };

      // No return needed in constructor
    }

    // Define types for server resources
    interface CleanableResource {
      cleanup?: () => Promise<void>;
      [key: string]: any; // Allow other properties
    }

    // Track server-specific resources with proper typing
    const serverResources = new Set<CleanableResource>();

    // Access protected methods using type assertion with proper typing
    type AddDocumentationFn = (...args: any[]) => Promise<CleanableResource | undefined>;
    const serverInstance = server as unknown as {
      addDocumentation: AddDocumentationFn;
    };

    // Store original method
    const originalAddDoc = serverInstance.addDocumentation.bind(server);

    // Override with tracking
    serverInstance.addDocumentation = async (...args: Parameters<AddDocumentationFn>) => {
      const result = await originalAddDoc(...args);
      if (result) serverResources.add(result);
      return result;
    };

    // Enhanced cleanup for server resources
    afterEach(async () => {
      try {
        // Stage 1: Stop all server operations and remove listeners with concurrent operation awareness
        await new Promise<void>((resolve) => {
          const cleanup = () => {
            // Only remove test-specific listeners, preserve core operation listeners
            const eventNames = (server as EventEmitter).eventNames();
            const coreEvents = ['worker', 'message', 'error', 'exit'];
            
            eventNames.forEach((event: string | symbol) => {
              if (!coreEvents.includes(event.toString())) {
                server.removeAllListeners(event);
              }
            });
            resolve();
          };
          
          // Set a timeout for cleanup with extended duration for concurrent operations
          const timeoutId = setTimeout(() => {
            logger.warn('Server cleanup timeout reached');
            cleanup();
          }, 15000); // Further increased timeout to allow for concurrent operations

          // Attempt cleanup
          try {
            // Remove all event listeners
            (server as EventEmitter).eventNames().forEach((event: string | symbol) => {
              (server as EventEmitter).removeAllListeners(event);
            });

            // Call cleanup method if available
            if (typeof server.cleanup === 'function') {
              Promise.resolve(server.cleanup())
                .then(() => {
                  clearTimeout(timeoutId);
                  cleanup();
                })
                .catch(error => {
                  logger.warn('Error during server cleanup', {
                    error: error instanceof Error ? error : new Error(String(error))
                  });
                  clearTimeout(timeoutId);
                  cleanup();
                });
            } else {
              clearTimeout(timeoutId);
              cleanup();
            }
          } catch (error) {
            logger.warn('Error during server cleanup', {
              error: error instanceof Error ? error : new Error(String(error))
            });
            clearTimeout(timeoutId);
            cleanup();
          }
        });

        // Stage 2: Clean up tracked resources with timeout
        const resourceCleanupPromises = Array.from(serverResources).map(resource => {
          return new Promise<void>((resolve) => {
            const timeoutId = setTimeout(() => {
              logger.warn('Resource cleanup timeout reached');
              resolve();
            }, 1000);

            if (typeof resource.cleanup === 'function') {
              Promise.resolve(resource.cleanup())
                .then(() => {
                  clearTimeout(timeoutId);
                  resolve();
                })
                .catch(error => {
                  const logError = error instanceof Error ? error : new Error(String(error));
                  logger.warn('Failed to cleanup resource:', {
                    resourceType: typeof resource,
                    error: logError
                  });
                  clearTimeout(timeoutId);
                  resolve();
                });
            } else {
              clearTimeout(timeoutId);
              resolve();
            }
          });
        });

        await Promise.all(resourceCleanupPromises);
        serverResources.clear();

        // Stage 3: Progressive cleanup of remaining handles
        const finalCleanup = async () => {
          // First unref all handles
          const handles = process._getActiveHandles?.() || [];
          for (const handle of handles) {
            if (handle?.unref) handle.unref();
          }
          
          // Wait for any immediate operations
          await new Promise<void>(resolve => setImmediate(resolve));
          
          // Then destroy handles
          for (const handle of handles) {
            if (handle?.destroy) {
              try {
                handle.destroy();
              } catch (error) {
                logger.warn('Failed to destroy handle', {
                  error: error instanceof Error ? error : new Error(String(error))
                });
              }
            }
          }
          
          // Force garbage collection
          if (typeof global.gc === 'function') {
            global.gc();
          }
          
          // Final wait for any cleanup operations with worker check
          await new Promise<void>(resolve => {
            const finalCheck = async () => {
              // Wait for immediate operations
              await new Promise<void>(r => setTimeout(r, 1000));
              
              // Enhanced worker thread detection and cleanup
              const remainingWorkers = (process._getActiveHandles?.()
                ?.filter(handle => {
                  if (handle?.constructor?.name === 'Worker') {
                    const worker = handle as WorkerHandle & {
                      threadId?: number;
                      getState?: () => string;
                      isRunning?: boolean;
                      exitCode?: number | null;
                      stderr?: { _writableState?: { finished?: boolean } };
                      stdout?: { _writableState?: { finished?: boolean } };
                      process?: { killed?: boolean };
                    };

                    // Comprehensive worker state check
                    const workerState = worker.getState?.();
                    const isExited = worker.exitCode !== undefined && worker.exitCode !== null;
                    const isStopped = workerState === 'stopped' || workerState === 'errored';
                    const isNotRunning = worker.isRunning === false;
                    const isKilled = worker.process?.killed === true;
                    const streamsFinished = 
                      worker.stderr?._writableState?.finished === true && 
                      worker.stdout?._writableState?.finished === true;

                    // Return true for any worker that shows signs of completion or needs cleanup
                    return isExited || isStopped || isNotRunning || isKilled || streamsFinished;
                  }
                  return false;
                }) || []) as WorkerHandle[];
                
              for (const worker of remainingWorkers) {
                try {
                  // Enhanced worker cleanup with staged termination
                  try {
                    // Stage 1: Give workers a chance to cleanup gracefully
                    await Promise.race([
                      new Promise<void>(resolve => setTimeout(resolve, 2000)),
                      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('Cleanup timeout')), 5000))
                    ]);

                    // Stage 2: Attempt graceful termination
                    if (worker.terminate) {
                      await Promise.race([
                        worker.terminate(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Terminate timeout')), 3000))
                      ]);
                    } else if (worker.destroy) {
                      worker.destroy();
                    }

                    // Stage 3: Force cleanup if still running
                    const workerRef = worker as any;
                    if (workerRef.process && !workerRef.process.killed) {
                      workerRef.process.kill('SIGKILL');
                    }
                  } catch (terminateError) {
                    // Log termination error but continue cleanup
                    const workerRef = worker as WorkerHandle;
                    logger.warn('Worker termination error', {
                      error: terminateError instanceof Error ? terminateError : new Error(String(terminateError)),
                      workerId: workerRef.threadId,
                      stage: 'force_cleanup'
                    });
                    
                    // Ensure cleanup even if termination failed
                    try {
                      if (workerRef.process?.kill) {
                        workerRef.process.kill('SIGKILL');
                      }
                    } catch (killError) {
                      logger.error('Failed to force kill worker', {
                        error: killError instanceof Error ? killError : new Error(String(killError)),
                        workerId: workerRef.threadId
                      });
                    }
                  }
                } catch (error) {
                  logger.warn('Failed to terminate worker in final check', {
                    error: error instanceof Error ? error : new Error(String(error)),
                    workerId: (worker as any).threadId
                  });
                }
              }
              
              // Extended final wait with verification
              await new Promise<void>(r => setTimeout(r, 5000));
              
              // Verify all workers are cleaned up
              const finalWorkerCheck = process._getActiveHandles?.()?.filter(h => h?.constructor?.name === 'Worker') || [];
              if (finalWorkerCheck.length > 0) {
                logger.warn('Some workers still remain after cleanup', {
                  remainingCount: finalWorkerCheck.length,
                  workerIds: finalWorkerCheck.map((w: any) => w.threadId).filter(Boolean)
                });
              }
              resolve();
            };
            finalCheck().catch(error => {
              logger.error('Error in final cleanup check', {
                error: error instanceof Error ? error : new Error(String(error))
              });
              resolve();
            });
          });
        };
        
        await finalCleanup();
      } catch (error) {
        const logError = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to cleanup server resources:', {
          error: logError
        });
        throw error;
      }
    });

    // Set up MCP protocol handlers with proper schema
    const listToolsHandler: ServerHandler = async () => ({
      content: [{ 
        type: 'text', 
        text: JSON.stringify([]) // Empty array as we don't have tools in test environment
      }],
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const listResourcesHandler: ServerHandler = async () => ({
      content: [{ 
        type: 'text', 
        text: JSON.stringify(await this.listResources())
      }],
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const mockServer: MockServer = {
      setRequestHandler: jest.fn(async (schema: ServerSchema, handler: ServerHandler) => {
        const methodName = schema?.shape?.method?.value;
        if (methodName) {
          this.mockHandlers.set(methodName, handler);
        }
      }),
      connect: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
    };

    // Register handlers with proper MCP protocol schema
    mockServer.setRequestHandler({
      shape: {
        method: {
          value: 'list_tools'
        }
      }
    }, listToolsHandler);

    mockServer.setRequestHandler({
      shape: {
        method: {
          value: 'list_resources'
        }
      }
    }, listResourcesHandler);

    this.mockServer = mockServer;
    this.setMockServer(mockServer as unknown as Server);

    // Register MCP protocol handlers
    mockServer.setRequestHandler({ shape: { method: { value: 'list_tools' } } }, listToolsHandler);
    mockServer.setRequestHandler({ shape: { method: { value: 'list_resources' } } }, listResourcesHandler);
  }

  private setMockServer(mockServer: Server): void {
    // @ts-expect-error: Доступ к protected полю для тестирования
    this.server.server = mockServer;
  }

  static async createTestInstance(): Promise<TestServer> {
    // Create a unique test directory with timestamp and random id
    const testDir = path.join(
      process.cwd(),
      'test-data',
      `test-server-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testDir, { recursive: true });

    // Set environment variables
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      STORAGE_PATH: testDir,
      MCP_ENV: 'local',
      NODE_ENV: 'test', // Ensure test environment for logger
    };

    // Register cleanup for this test directory
    afterEach(async () => {
      try {
        // Ensure all pending operations are complete
        await new Promise(resolve => setImmediate(resolve));
        
        // Clean up server resources first
        if (server instanceof DocumentationServer) {
          await server.cleanup();
        }

        // Clean up test directory with retries
        let retries = 3;
        while (retries > 0) {
          try {
            await fs.rm(testDir, { recursive: true, force: true });
            break;
          } catch (error) {
            if (retries === 1) throw error;
            retries--;
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        // Log cleanup
        logger.debug('Test resources cleaned up', {
          component: 'TestServer',
          operation: 'cleanup',
          testDir
        });
      } catch (error) {
        logger.error('Failed to cleanup test resources', {
          component: 'TestServer',
          operation: 'cleanup',
          error: error instanceof Error ? error : new Error(String(error)),
          testDir
        });
        throw error;
      } finally {
        // Always restore environment and cleanup event emitters
        process.env = originalEnv;
        if (server instanceof EventEmitter) {
          server.removeAllListeners();
        }
      }
    });

    const server = await DocumentationServer.start();
    return new TestServer(server);
  }

  async addTestDoc(doc: Partial<DocSource>): Promise<ServerResponse> {
    const fullDoc: DocSource = {
      name: doc.name || 'Test Doc',
      url: doc.url || 'https://example.com/doc',
      category: (doc.category as ValidCategory) || 'Base.Standards',
      description: doc.description || 'Test description',
      tags: doc.tags || ['test'],
      ...doc,
    };
    await (this.server as any).addDocumentation(fullDoc);
    return {
      content: [{ type: 'text', text: `Added documentation: ${fullDoc.name}` }],
    };
  }

  getStoragePath(): string {
    // @ts-expect-error: Доступ к protected полю для тестирования
    return this.server.fsManager.docsPath;
  }

  getMockHandler(name: string): ServerHandler {
    const handler = this.mockHandlers.get(name);
    if (!handler) {
      throw new Error(`Mock handler not found for: ${name}`);
    }
    return handler;
  }

  getMockServer(): MockServer {
    return this.mockServer;
  }

  getMockCalls(name: string): Array<Parameters<MockHandler>> {
    return this.mockServer.setRequestHandler.mock.calls.filter(
      (call): call is Parameters<MockHandler> =>
        call.length === 2 && call[0]?.shape?.method?.value === name
    );
  }

  getServer(): DocumentationServer {
    return this.server;
  }

  async listDocumentation(options: Record<string, unknown> = {}): Promise<ServerResponse> {
    const docs = await (this.server as any).listDocumentation(options);
    return {
      content: [{ type: 'text', text: JSON.stringify(docs) }],
    };
  }

  async searchDocumentation(options: {
    query: string;
    category?: ValidCategory;
    tag?: string;
  }): Promise<ServerResponse> {
    const docs = await (this.server as any).searchDocumentation(options);
    return {
      content: [{ type: 'text', text: JSON.stringify(docs) }],
    };
  }

  async updateDocumentation(options: { name: string; force?: boolean }): Promise<ServerResponse> {
    await (this.server as any).updateDocumentation(options);
    return {
      content: [{ type: 'text', text: `Updated documentation: ${options.name}` }],
    };
  }

  async removeDocumentation(name: string): Promise<ServerResponse> {
    await (this.server as any).removeDocumentation(name);
    return {
      content: [{ type: 'text', text: `Removed documentation: ${name}` }],
    };
  }

  async listResources(): Promise<Array<{ name: string; content: string }>> {
    return Array.from(this.resources.entries()).map(([name, { content }]) => ({
      name,
      content,
    }));
  }

  async getResource(name: string): Promise<{ content: string; lastUpdated: string }> {
    const resource = this.resources.get(name);
    if (!resource) {
      throw new Error(`Resource not found: ${name}`);
    }
    return resource;
  }
}
