import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { EventEmitter } from 'events';
import type { ActiveHandle } from './types/process.js';

// Import Process type explicitly
import type { Process } from './types/process.js';

// Import SDK types and values
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// Type-only imports
import type { RequestIdSchema } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import path from 'path';
import { DocSource, StackDocumentation } from './types/index.js';
import { ContentFetcher } from './utils/content-fetcher.js';
import { ensureGitIgnore } from './utils/fs-setup.js';
import { FileSystemError, FileSystemManager } from './utils/fs.js';
import { projectAnalyzer } from './utils/project-analyzer.js';
import { DEFAULT_RATE_LIMIT_CONFIG, RateLimiter } from './utils/rate-limiter.js';
import {
  isValidCategory,
  validateAddDoc,
  validateSearch,
  validateUpdateDoc,
} from './validators/index.js';

interface MpcResponse {
  headers?: Record<string, string>;
  [key: string]: any;
}

import { ENV } from './config.js';
import { getRuntimeConfig } from './runtime-modes.js';
import { logger } from './utils/logger.js';

// Default documentation will be loaded from sources.json

/**
 * Main server class for the documentation keeper
 */
export class DocumentationServer extends EventEmitter {
  private server!: Server;
  private fsManager!: FileSystemManager;
  private docs: DocSource[] = [];
  private contentFetcher: ContentFetcher;
  private rateLimiter: RateLimiter;
  private _cleanupInterval?: NodeJS.Timeout;

  /**
   * Cleanup resources and listeners
   */
  public async cleanup(): Promise<void> {
    try {
      // Stage 1: Stop accepting new operations
      this.removeAllListeners();
      
      // Stage 2: Clear intervals and timeouts
      if (this._cleanupInterval) {
        if (typeof this._cleanupInterval.unref === 'function') {
          this._cleanupInterval.unref();
        }
        clearInterval(this._cleanupInterval);
        this._cleanupInterval = undefined;
      }

      // Stage 3: Handle active timers and resources
      const activeHandles = process._getActiveHandles();
      activeHandles
        .filter(handle => handle.constructor.name === 'Timeout')
        .forEach(timer => {
          if (typeof timer.unref === 'function') {
            timer.unref();
          }
        });

      // Stage 4: Close server and cleanup resources
      const cleanupPromises = [];

      // Close server if it exists
      if (this.server) {
        cleanupPromises.push(
          (async () => {
            try {
              await this.server.close();
            } catch (error) {
              logger.warn('Error closing server during cleanup', {
                component: 'DocumentationServer',
                operation: 'cleanup',
                error: error instanceof Error ? error : new Error(String(error))
              });
            }
          })()
        );
      }

      // Clean up all documentation with retries
      const docNames = [...this.docs.map(doc => doc.name)];
      for (const name of docNames) {
        cleanupPromises.push(
          (async () => {
            let retries = 3;
            while (retries > 0) {
              try {
                await this.removeDocumentation(name);
                break;
              } catch (error) {
                retries--;
                if (retries === 0) {
                  logger.error(`Failed to remove documentation ${name} after retries`, {
                    component: 'DocumentationServer',
                    operation: 'cleanup',
                    error: error instanceof Error ? error : new Error(String(error))
                  });
                } else {
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              }
            }
          })()
        );
      }

      // Clean up file system manager with retries
      if (this.fsManager) {
        cleanupPromises.push(
          (async () => {
            let retries = 3;
            while (retries > 0) {
              try {
                await this.fsManager.destroy();
                break;
              } catch (error) {
                retries--;
                if (retries === 0) {
                  logger.error('Failed to destroy file system manager after retries', {
                    component: 'DocumentationServer',
                    operation: 'cleanup',
                    error: error instanceof Error ? error : new Error(String(error))
                  });
                } else {
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
              }
            }
          })()
        );
      }

      // Wait for all cleanup operations to complete
      await Promise.all(cleanupPromises);

      // Stage 5: Reset instances
      this.contentFetcher = new ContentFetcher({
        maxRetries: 3,
        retryDelay: 2000,
        timeout: 15000,
      });
      this.rateLimiter = new RateLimiter(DEFAULT_RATE_LIMIT_CONFIG);
      this.docs = [];

      // Stage 6: Force cleanup of any remaining resources
      if (typeof global.gc === 'function') {
        global.gc();
      }

      logger.debug('DocumentationServer cleanup completed', {
        component: 'DocumentationServer',
        operation: 'cleanup'
      });
    } catch (error) {
      logger.error('Error during DocumentationServer cleanup', {
        component: 'DocumentationServer',
        operation: 'cleanup',
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }

  constructor() {
    super();
    this.rateLimiter = new RateLimiter(DEFAULT_RATE_LIMIT_CONFIG);
    this.contentFetcher = new ContentFetcher({
      maxRetries: 3,
      retryDelay: 2000,
      timeout: 15000,
    });
  }

  /**
   * Initialize and run the server
   */
  static async start(): Promise<DocumentationServer> {
    const server = new DocumentationServer();
    try {
      await server.init();
      await server.run();
      return server;
    } catch (error) {
      console.error('Failed to start server:', error);
      throw error;
    }
  }

  private async init(): Promise<void> {
    try {
      // Get runtime configuration
      const runtime = getRuntimeConfig();
      const storagePath = runtime.storagePath;

      logger.info('Initializing storage', {
        component: 'DocumentationServer',
        operation: 'init',
        storagePath
      });

      // Try to create storage directories, but don't fail if they exist
      try {
        await fs.mkdir(storagePath, { recursive: true });
        await fs.mkdir(path.join(storagePath, 'cache'), { recursive: true });
        await fs.mkdir(path.join(storagePath, 'metadata'), { recursive: true });
        
        // Ensure .codexkeeper is in .gitignore of the project
        await ensureGitIgnore(process.cwd());
        
        logger.debug('Storage directories created', {
          component: 'DocumentationServer',
          operation: 'init'
        });
      } catch (error) {
        // Log error but continue - directories might exist
        logger.warn('Could not create some directories', {
          component: 'DocumentationServer',
          operation: 'init',
          error: error instanceof Error ? error : new Error(String(error))
        });
      }

      // Initialize file system manager with proper error handling
      this.fsManager = new FileSystemManager(storagePath, {
        maxSize: ENV.cacheMaxSize,
        maxAge: ENV.cacheMaxAge,
        cleanupInterval: ENV.cacheCleanupInterval,
      });

      await this.fsManager.ensureDirectories();
      
      logger.debug('File system manager initialized', {
        component: 'DocumentationServer',
        operation: 'init'
      });

      // Initialize server with proper cleanup handling
      this.server = new Server(
        {
          name: runtime.serverName,
          version: '1.1.10',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
          },
        }
      );

      // Initialize with empty array, will be populated in run()
      this.docs = [];

      // Set up handlers with proper error boundaries
      this.setupToolHandlers();
      this.setupResourceHandlers();
      this.setupErrorHandlers();

      // Start rate limiter cleanup with proper handle management
      if (this._cleanupInterval) {
        clearInterval(this._cleanupInterval);
      }
      
      this._cleanupInterval = setInterval(() => {
        try {
          this.rateLimiter.cleanup(ENV.cacheMaxAge);
        } catch (error) {
          logger.error('Rate limiter cleanup failed', {
            component: 'DocumentationServer',
            operation: 'cleanup',
            error: error instanceof Error ? error : new Error(String(error))
          });
        }
      }, ENV.cacheCleanupInterval);

      // Ensure the interval doesn't keep the process alive
      if (this._cleanupInterval && typeof this._cleanupInterval.unref === 'function') {
        this._cleanupInterval.unref();
      }

      // Log initial documentation state
      const categories = [...new Set(this.docs.map(doc => doc.category))];
      categories.forEach(category => {
        const docsInCategory = this.docs.filter(doc => doc.category === category);
        logger.info(`Documentation category: ${category}`, {
          component: 'DocumentationServer',
          operation: 'init',
          docsCount: docsInCategory.length,
          docs: docsInCategory.map(doc => ({
            name: doc.name,
            description: doc.description,
            tags: doc.tags
          }))
        });
      });
    } catch (error) {
      logger.error('Server initialization failed', {
        component: 'DocumentationServer',
        operation: 'init',
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }

  /**
   * Get initial documentation state
   * This information will be available in the environment details
   * when the server starts
   */
  private getInitialState(): string {
    const categories = [...new Set(this.docs.map(doc => doc.category))];
    let state = 'Documentation Overview:\n\n';

    categories.forEach(category => {
      const docsInCategory = this.docs.filter(doc => doc.category === category);
      state += `${category}:\n`;
      docsInCategory.forEach(doc => {
        state += `- ${doc.name}\n`;
        state += `  ${doc.description}\n`;
        if (doc.tags?.length) {
          state += `  Tags: ${doc.tags.join(', ')}\n`;
        }
        state += '\n';
      });
    });

    return state;
  }

  /**
   * Sets up error handlers for the server
   */
  private setupErrorHandlers(): void {
    // Set up server error handler with proper logging
    this.server.onerror = (error: unknown) => {
      if (error instanceof FileSystemError) {
        logger.error('Storage error occurred', {
          component: 'DocumentationServer',
          operation: 'errorHandler',
          errorType: 'FileSystemError',
          error: error instanceof Error ? error : new Error(String(error))
        });
      } else if (error instanceof McpError) {
        const mcpError = error as McpError;
        logger.error('MCP protocol error', {
          component: 'DocumentationServer',
          operation: 'errorHandler',
          errorType: 'McpError',
          error: {
            message: mcpError.message,
            code: mcpError.code
          }
        });
      } else {
        logger.error('Unexpected error', {
          component: 'DocumentationServer',
          operation: 'errorHandler',
          error: error instanceof Error ? error : new Error(String(error))
        });
      }
    };

    // Handle process termination signals
    const cleanup = async (signal: string) => {
      try {
        logger.info(`Received ${signal}, cleaning up...`, {
          component: 'DocumentationServer',
          operation: 'shutdown'
        });
        
        // Remove all listeners to prevent new operations
        this.removeAllListeners();
        
        // Perform cleanup
        await this.cleanup();
        
        // Close server after cleanup
        await this.server.close();
        
        logger.info('Cleanup completed, exiting...', {
          component: 'DocumentationServer',
          operation: 'shutdown'
        });
        
        // Exit after cleanup
        process.exit(0);
      } catch (error) {
        logger.error(`Error during ${signal} cleanup`, {
          component: 'DocumentationServer',
          operation: 'shutdown',
          error: error instanceof Error ? error : new Error(String(error))
        });
        process.exit(1);
      }
    };

    // Register signal handlers
    process.once('SIGINT', () => cleanup('SIGINT'));
    process.once('SIGTERM', () => cleanup('SIGTERM'));
    
    // Handle uncaught errors
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', {
        component: 'DocumentationServer',
        operation: 'uncaughtException',
        error
      });
    });

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('Unhandled rejection', {
        component: 'DocumentationServer',
        operation: 'unhandledRejection',
        error: reason instanceof Error ? reason : new Error(String(reason))
      });
    });
  }

  /**
   * Check rate limit for a request
   * @param clientId Client identifier
   * @throws {McpError} If rate limit exceeded
   * @returns Rate limit result
   */
  private checkRateLimit = (
    clientId: string
  ): { allowed: boolean; retryAfter?: number; remaining: number } => {
    const result = this.rateLimiter.checkLimit(clientId);
    if (!result.allowed) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Rate limit exceeded. Try again in ${result.retryAfter}ms`
      );
    }
    return result;
  };

  /**
   * Add rate limit headers to response
   * @param response MCP response
   * @param rateLimitResult Rate limit check result
   */
  private addRateLimitHeaders = (
    response: MpcResponse,
    rateLimitResult: { remaining: number }
  ): MpcResponse => {
    if (!response.headers) {
      response.headers = {};
    }
    response.headers['X-RateLimit-Remaining'] = rateLimitResult.remaining.toString();
    response.headers['X-RateLimit-Limit'] = DEFAULT_RATE_LIMIT_CONFIG.maxTokens.toString();
    return response;
  };

  /**
   * Sets up resource handlers for the server
   */
  private setupResourceHandlers = (): void => {
    this.server.setRequestHandler(ListResourcesRequestSchema, async request => {
      const rateLimitResult = this.checkRateLimit(
        request.params?._meta?.progressToken?.toString() || 'anonymous'
      );
      const resourcesList = {
        resources: [
          {
            uri: 'docs://sources',
            name: 'Documentation Sources',
            description: 'List of all available documentation sources',
            mimeType: 'application/json',
          },
        ],
      };
      return this.addRateLimitHeaders(resourcesList, rateLimitResult);
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async request => {
      const rateLimitResult = this.checkRateLimit(
        request.params?._meta?.progressToken?.toString() || 'anonymous'
      );
      if (request.params.uri === 'docs://sources') {
        const response = {
          contents: [
            {
              uri: request.params.uri,
              mimeType: 'application/json',
              text: JSON.stringify(this.docs, null, 2),
            },
          ],
        };
        this.addRateLimitHeaders(response, rateLimitResult);
        return response;
      }
      throw new McpError(ErrorCode.InvalidRequest, `Unknown resource: ${request.params.uri}`);
    });
  };

  /**
   * Sets up tool handlers for the server
   */
  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async request => {
      const rateLimitResult = this.checkRateLimit(
        request.params?._meta?.progressToken?.toString() || 'anonymous'
      );
      const toolsList = {
        tools: [
          {
            name: 'analyze_project',
            description:
              'Analyze project structure and automatically add relevant documentation based on the tech stack and patterns used.',
            inputSchema: {
              type: 'object',
              properties: {
                projectPath: {
                  type: 'string',
                  description: 'Path to the project root directory',
                },
                force: {
                  type: 'boolean',
                  description: 'Force update existing documentation',
                },
                sections: {
                  type: 'array',
                  description: 'Sections to analyze with pagination settings',
                  items: {
                    type: 'object',
                    properties: {
                      section: {
                        type: 'string',
                        enum: ['overview', 'dependencies', 'sourceFiles'],
                        description: 'Section to analyze',
                      },
                      page: {
                        type: 'number',
                        description: 'Page number (default: 1)',
                        minimum: 1,
                      },
                      pageSize: {
                        type: 'number',
                        description: 'Items per page (default: 20)',
                        minimum: 1,
                        maximum: 100,
                      },
                    },
                    required: ['section'],
                  },
                },
              },
              required: ['projectPath'],
            },
          },
          {
            name: 'list_documentation',
            description:
              'List all available documentation sources. Use this tool to discover relevant documentation before starting tasks to ensure best practices and standards compliance.',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  description: 'Filter documentation by category',
                },
                tag: {
                  type: 'string',
                  description: 'Filter documentation by tag',
                },
                page: {
                  type: 'number',
                  description: 'Page number (default: 1)',
                  minimum: 1,
                },
                pageSize: {
                  type: 'number',
                  description: 'Items per page (default: 20)',
                  minimum: 1,
                  maximum: 100,
                },
              },
            },
          },
          {
            name: 'add_documentation',
            description:
              'Add a new documentation source. When working on tasks, add any useful documentation you discover to help maintain a comprehensive knowledge base.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the documentation',
                },
                url: {
                  type: 'string',
                  description: 'URL of the documentation',
                },
                description: {
                  type: 'string',
                  description: 'Description of the documentation',
                },
                category: {
                  type: 'string',
                  description: 'Category of the documentation',
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Tags for additional categorization',
                },
                version: {
                  type: 'string',
                  description: 'Version information',
                },
              },
              required: ['name', 'url', 'category'],
            },
          },
          {
            name: 'update_documentation',
            description:
              'Update documentation content from source. Always update relevant documentation before starting a task to ensure you have the latest information and best practices.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the documentation to update',
                },
                force: {
                  type: 'boolean',
                  description: 'Force update even if recently updated',
                },
              },
              required: ['name'],
            },
          },
          {
            name: 'search_documentation',
            description:
              'Search through documentation content. Use this to find specific information, best practices, or guidelines relevant to your current task. Remember to check documentation before making important decisions.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query',
                },
                category: {
                  type: 'string',
                  description: 'Filter by category',
                },
                tag: {
                  type: 'string',
                  description: 'Filter by tag',
                },
                page: {
                  type: 'number',
                  description: 'Page number (default: 1)',
                  minimum: 1,
                },
                pageSize: {
                  type: 'number',
                  description: 'Items per page (default: 20)',
                  minimum: 1,
                  maximum: 100,
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'remove_documentation',
            description:
              'Remove a documentation source. Use this when you no longer need specific documentation.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Name of the documentation to remove',
                },
              },
              required: ['name'],
            },
          },
        ],
      };
      return this.addRateLimitHeaders(toolsList, rateLimitResult);
    });

    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      const rateLimitResult = this.checkRateLimit(
        request.params?._meta?.progressToken?.toString() || 'anonymous'
      );
      const args = request.params.arguments || {};

      switch (request.params.name) {
        case 'analyze_project': {
          const { projectPath, force, sections } = request.params.arguments as {
            projectPath: string;
            force?: boolean;
            sections?: Array<{
              section: 'overview' | 'dependencies' | 'sourceFiles';
              page?: number;
              pageSize?: number;
            }>;
          };

          try {
            const analysis = await projectAnalyzer.analyzeProject({
              projectPath,
              force,
              sections: sections || [
                { section: 'overview' },
                { section: 'dependencies', page: 1, pageSize: 20 },
                { section: 'sourceFiles', page: 1, pageSize: 20 },
              ],
            });
            const recommendations = await projectAnalyzer.getRecommendedDocumentation(analysis);

            // Добавляем рекомендованную документацию
            for (const category of Object.keys(recommendations) as Array<
              keyof StackDocumentation
            >) {
              for (const doc of recommendations[category]) {
                try {
                  const existingDoc = this.docs.find(d => d.name === doc.name);
                  if (!existingDoc || force) {
                    await this.addDocumentation(doc);
                    logger.info(`Added documentation: ${doc.name}`, {
                      component: 'DocumentationServer',
                      operation: 'analyze_project',
                      category,
                    });
                  }
                } catch (error) {
                  logger.warn(`Failed to add documentation: ${doc.name}`, {
                    component: 'DocumentationServer',
                    operation: 'analyze_project',
                    error:
                      error instanceof Error
                        ? { message: error.message }
                        : { message: String(error) },
                  });
                }
              }
            }

            const response = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      analysis,
                      addedDocs: Object.entries(recommendations).map(([category, docs]) => ({
                        category,
                        count: docs.length,
                        docs: docs.map((d: DocSource) => d.name),
                      })),
                    },
                    null,
                    2
                  ),
                },
              ],
            };
            return this.addRateLimitHeaders(response, rateLimitResult);
          } catch (error) {
            throw new McpError(
              ErrorCode.InternalError,
              `Failed to analyze project: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
        case 'list_documentation': {
          const isValidCat = await isValidCategory(args.category);
          const { page, pageSize } = args;
          const response = await this.listDocumentation({
            category: isValidCat ? (args.category as string) : undefined,
            tag: typeof args.tag === 'string' ? args.tag : undefined,
            page: typeof page === 'number' ? page : undefined,
            pageSize: typeof pageSize === 'number' ? pageSize : undefined,
          });
          return this.addRateLimitHeaders(response, rateLimitResult);
        }
        case 'add_documentation': {
          const validatedArgs = await validateAddDoc(args);
          const response = await this.addDocumentation(validatedArgs);
          return this.addRateLimitHeaders(response, rateLimitResult);
        }
        case 'update_documentation': {
          const validatedArgs = validateUpdateDoc(args);
          const response = await this.updateDocumentation(validatedArgs);
          return this.addRateLimitHeaders(response, rateLimitResult);
        }
        case 'search_documentation': {
          const validatedArgs = await validateSearch(args);
          const { page, pageSize } = args;
          const response = await this.searchDocumentation({
            ...validatedArgs,
            page: typeof page === 'number' ? page : undefined,
            pageSize: typeof pageSize === 'number' ? pageSize : undefined,
          });
          return this.addRateLimitHeaders(response, rateLimitResult);
        }
        case 'remove_documentation': {
          const response = await this.removeDocumentation(args.name as string);
          return this.addRateLimitHeaders(response, rateLimitResult);
        }
        default:
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
      }
    });
  }

  /**
   * Lists documentation sources with optional filtering
   */
  private async listDocumentation(args: {
    category?: string;
    tag?: string;
    page?: number;
    pageSize?: number;
  }): Promise<MpcResponse> {
    const { category, tag, page = 1, pageSize = 20 } = args;
    let filteredDocs = this.docs;

    if (category) {
      filteredDocs = filteredDocs.filter(doc => doc.category === category);
    }

    if (tag) {
      filteredDocs = filteredDocs.filter(doc => doc.tags?.includes(tag));
    }

    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const totalItems = filteredDocs.length;
    const totalPages = Math.ceil(totalItems / pageSize);

    const paginatedDocs = {
      data: filteredDocs.slice(startIndex, endIndex),
      pagination: {
        currentPage: page,
        pageSize,
        totalItems,
        totalPages,
        hasNextPage: endIndex < totalItems,
        hasPreviousPage: page > 1,
      },
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(paginatedDocs, null, 2),
        },
      ],
    };
  }

  /**
   * Adds new documentation source
   */
  private async addDocumentation(args: DocSource): Promise<MpcResponse> {
    const { name, url, description, category, tags, version } = args;

    // Check if document already exists
    const existingDoc = this.docs.find(doc => doc.name === name);
    if (existingDoc) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Documentation "${name}" already exists. Use update_documentation to modify existing documents.`
      );
    }

    // Create new document
    const newDoc: DocSource = {
      name,
      url,
      description,
      category,
      tags,
      version,
      lastUpdated: new Date().toISOString(),
    };

    // Add new doc
    this.docs.push(newDoc);

    try {
      // First save sources
      await this.fsManager.saveSources(this.docs);
      console.error(`Saved sources for ${name}`);

      // Then save documentation
      let docContent: string;
      if (newDoc.path) {
        docContent = await fs.readFile(newDoc.path, 'utf-8');
      } else if (newDoc.url) {
        const result = await this.contentFetcher.fetchContent(newDoc.url);
        docContent = result.content;
      } else {
        throw new Error('Either url or path must be provided');
      }
      await this.fsManager.saveDocumentation(name, docContent);
      console.error(`Saved documentation for ${name}`);
    } catch (error) {
      // Remove doc from memory if save fails
      const index = this.docs.findIndex(doc => doc.name === name);
      if (index !== -1) {
        this.docs.splice(index, 1);
      }
      console.error('Failed to save documentation:', error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to save documentation: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    return {
      content: [
        {
          type: 'text',
          text: `Added documentation: ${name}`,
        },
      ],
    };
  }

  /**
   * Updates documentation content from source
   */
  private async updateDocumentation(args: { name: string; force?: boolean }): Promise<MpcResponse> {
    const { name, force } = args;

    // Try exact match first
    let doc = this.docs.find(d => d.name === name);

    // If no exact match, try fuzzy search
    if (!doc) {
      const closestName = await this.fsManager.findClosestDocName(name);
      if (closestName) {
        doc = this.docs.find(d => d.name === closestName);
        logger.info(`Using closest match "${closestName}" for "${name}"`);
      }
    }

    if (!doc) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Documentation "${name}" not found. Please check the name and try again.`
      );
    }

    // Skip update if recently updated and not forced
    if (!force && doc.lastUpdated) {
      const lastUpdate = new Date(doc.lastUpdated);
      const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);
      if (hoursSinceUpdate < 24) {
        return {
          content: [
            {
              type: 'text',
              text: `Documentation "${name}" was recently updated. Use force=true to update anyway.`,
            },
          ],
        };
      }
    }

    try {
      let result;
      try {
        if (!doc.url) {
          throw new McpError(ErrorCode.InvalidRequest, `Documentation "${name}" has no URL`);
        }
        result = await this.contentFetcher.fetchContent(doc.url);
      } catch (error: unknown) {
        // If rate limit exceeded and alternative URL exists, try that
        if (
          error instanceof Error &&
          error.message.includes('rate limit exceeded') &&
          doc.alternativeUrl
        ) {
          logger.info(`Rate limit exceeded, trying alternative URL for ${name}`, {
            component: 'DocumentationServer',
            operation: 'updateDocumentation',
            name,
            alternativeUrl: doc.alternativeUrl,
          });
          result = await this.contentFetcher.fetchContent(doc.alternativeUrl);
        } else {
          throw error;
        }
      }
      await this.fsManager.saveDocumentation(name, result.content);

      doc.lastUpdated = new Date().toISOString();
      await this.fsManager.saveSources(this.docs);

      return {
        content: [
          {
            type: 'text',
            text: `Updated documentation: ${name}`,
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to update documentation: ${errorMessage}`
      );
    }
  }

  /**
   * Searches through documentation content
   */
  private async searchDocumentation(args: {
    query: string;
    category?: string;
    tag?: string;
    page?: number;
    pageSize?: number;
  }): Promise<MpcResponse> {
    const { query, category, tag, page = 1, pageSize = 20 } = args;
    let results = [];

    try {
      const files = await this.fsManager.listDocumentationFiles();

      for (const file of files) {
        const doc = this.docs.find(
          d => file === `${d.name.toLowerCase().replace(/\s+/g, '_')}.txt`
        );

        if (doc) {
          // Apply filters
          if (category && doc.category !== category) continue;
          if (tag && !doc.tags?.includes(tag)) continue;

          // Search content
          const matches = await this.fsManager.searchInDocumentation(doc.name, query);
          if (matches) {
            results.push({
              name: doc.name,
              url: doc.url,
              category: doc.category,
              tags: doc.tags,
              lastUpdated: doc.lastUpdated,
            });
          }
        }
      }

      const startIndex = (page - 1) * pageSize;
      const endIndex = startIndex + pageSize;
      const totalItems = results.length;
      const totalPages = Math.ceil(totalItems / pageSize);

      const paginatedResults = {
        data: results.slice(startIndex, endIndex),
        pagination: {
          currentPage: page,
          pageSize,
          totalItems,
          totalPages,
          hasNextPage: endIndex < totalItems,
          hasPreviousPage: page > 1,
        },
      };

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(paginatedResults, null, 2),
          },
        ],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new McpError(ErrorCode.InternalError, `Search failed: ${errorMessage}`);
    }
  }

  /**
   * Starts the server
   */
  private async run(): Promise<void> {
    try {
      logger.info('Starting server...', {
        component: 'DocumentationServer',
        operation: 'run'
      });
      // Initialize if not already initialized
      if (!this.fsManager) {
        await this.init();
      }

      // Load documentation sources with retries
      let retries = 3;
      while (retries > 0) {
        try {
          logger.info('Loading documentation sources...', {
            component: 'DocumentationServer',
            operation: 'run'
          });
          
          const savedDocs = await this.fsManager.loadSources();
          logger.info(`Loaded ${savedDocs.length} docs`, {
            component: 'DocumentationServer',
            operation: 'run'
          });

          if (savedDocs.length > 0) {
            logger.info('Using existing docs', {
              component: 'DocumentationServer',
              operation: 'run',
              categories: [...new Set(savedDocs.map(d => d.category))]
            });
            this.docs = savedDocs;
            break;
          } else {
            // Load default documentation if no existing docs
            logger.info('No existing docs found, loading default documentation...', {
              component: 'DocumentationServer',
              operation: 'run'
            });
            
            const defaultDocsPath = path.join(process.cwd(), 'build', 'config', 'default-docs.json');
            const defaultDocsContent = await fs.readFile(defaultDocsPath, 'utf-8');
            const defaultDocs = JSON.parse(defaultDocsContent).docs;

            // Add default docs one by one to ensure content is fetched and cached
            let successCount = 0;
            const totalDocs = defaultDocs.length;

            for (const doc of defaultDocs) {
              try {
                await this.addDocumentation(doc);
                logger.info(`Added default documentation: ${doc.name}`, {
                  component: 'DocumentationServer',
                  operation: 'run'
                });
                successCount++;
              } catch (error) {
                logger.warn(`Failed to add default documentation ${doc.name}`, {
                  component: 'DocumentationServer',
                  operation: 'run',
                  error: error instanceof Error ? error : new Error(String(error))
                });
                
                // Try alternative URL if available
                if (doc.alternativeUrl) {
                  try {
                    const altDoc = { ...doc, url: doc.alternativeUrl };
                    await this.addDocumentation(altDoc);
                    logger.info(`Added default documentation from alternative URL: ${doc.name}`, {
                      component: 'DocumentationServer',
                      operation: 'run'
                    });
                    successCount++;
                  } catch (altError) {
                    logger.error(`Failed to add documentation from alternative URL ${doc.name}`, {
                      component: 'DocumentationServer',
                      operation: 'run',
                      error: altError instanceof Error ? altError : new Error(String(altError))
                    });
                  }
                }
              }
            }

            if (successCount === 0) {
              throw new Error('Failed to load any default documentation');
            }

            logger.info(`Successfully loaded ${successCount}/${totalDocs} default documentation sources`, {
              component: 'DocumentationServer',
              operation: 'run'
            });
            break;
          }
        } catch (error) {
          retries--;
          if (retries === 0) {
            logger.error('Failed to load documentation sources after retries', {
              component: 'DocumentationServer',
              operation: 'run',
              error: error instanceof Error ? error : new Error(String(error))
            });
            this.docs = [];
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Log initial state before starting server
      logger.info('Initial Documentation State:', {
        component: 'DocumentationServer',
        operation: 'run',
        state: this.getInitialState()
      });

      // Start server with retry logic
      const transport = new StdioServerTransport();
      
      // Connect with retries
      retries = 3;
      while (retries > 0) {
        try {
          await this.server.connect(transport);
          logger.info('Documentation MCP server running on stdio', {
            component: 'DocumentationServer',
            operation: 'run'
          });
          break;
        } catch (error) {
          retries--;
          if (retries === 0) {
            logger.error('Failed to connect server after retries', {
              component: 'DocumentationServer',
              operation: 'run',
              error: error instanceof Error ? error : new Error(String(error))
            });
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Set up cleanup handler
      process.once('beforeExit', async () => {
        try {
          await this.cleanup();
        } catch (error) {
          logger.error('Error during cleanup', {
            component: 'DocumentationServer',
            operation: 'beforeExit',
            error: error instanceof Error ? error : new Error(String(error))
          });
        }
      });
    } catch (error) {
      logger.error('Fatal error during server startup', {
        component: 'DocumentationServer',
        operation: 'run',
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }

  /**
   * Removes documentation source
   */
  private async removeDocumentation(name: string): Promise<MpcResponse> {
    const doc = this.docs.find(d => d.name === name);
    if (!doc) {
      throw new McpError(ErrorCode.InvalidRequest, `Documentation "${name}" not found`);
    }

    let retries = 3;
    let lastError: Error | null = null;

    while (retries > 0) {
      try {
        // Store index before removal
        const index = this.docs.findIndex(d => d.name === name);
        const docCopy = { ...this.docs[index] };

        // Remove documentation files first
        await this.fsManager.removeDocumentation(name);
        
        // Then remove from memory
        this.docs.splice(index, 1);
        
        // Update sources file
        try {
          await this.fsManager.saveSources(this.docs);
        } catch (saveError) {
          // If saving sources fails, rollback memory state
          this.docs.splice(index, 0, docCopy);
          throw saveError;
        }

        logger.info(`Successfully removed documentation: ${name}`, {
          component: 'DocumentationServer',
          operation: 'removeDocumentation'
        });

        return {
          content: [
            {
              type: 'text',
              text: `Removed documentation: ${name}`,
            },
          ],
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        retries--;

        if (retries > 0) {
          logger.warn(`Retrying documentation removal: ${name} (${retries} attempts left)`, {
            component: 'DocumentationServer',
            operation: 'removeDocumentation',
            error: lastError
          });
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        logger.error(`Failed to remove documentation after retries: ${name}`, {
          component: 'DocumentationServer',
          operation: 'removeDocumentation',
          error: lastError
        });

        if (error instanceof McpError) {
          throw error;
        }
        
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to remove documentation: ${lastError.message}`
        );
      }
    }

    // This should never be reached
    throw new McpError(
      ErrorCode.InternalError,
      lastError ? lastError.message : `Unexpected error removing documentation: ${name}`
    );
  }
}
