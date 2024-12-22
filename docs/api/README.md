# MCP Codex Keeper API Documentation

## Overview

MCP Codex Keeper is a documentation management system that provides robust caching, security, and performance optimizations. This document describes the core components and their APIs.

## Core Components

### FileSystemManager

Manages file system operations with security and performance optimizations.

```typescript
class FileSystemManager {
  constructor(basePath: string);

  // Documentation Management
  async saveDocumentation(
    name: string,
    content: string | URL | { content: string; timestamp?: string }
  ): Promise<void>;
  async getDocumentationPath(name: string): string;
  async hasDocumentation(name: string): Promise<boolean>;
  async listDocumentationFiles(): Promise<string[]>;

  // Version Control
  async getDocumentMetadata(name: string): Promise<DocMetadata | undefined>;
  async getDocumentVersion(name: string, version: string): Promise<string | undefined>;

  // Source Management
  async saveSources(docs: DocSource[]): Promise<void>;
  async loadSources(): Promise<DocSource[]>;

  // Search Functionality
  async searchInDocumentation(name: string, searchQuery: string): Promise<SearchResult[]>;
}
```

### CacheManager

In-memory caching system with LRU eviction and size/age limits.

```typescript
class CacheManager<T> {
  constructor(config: CacheConfig);

  // Cache Operations
  set(key: string, value: T, size: number): boolean;
  get(key: string): T | undefined;
  delete(key: string): void;
  clear(): void;

  // Batch Operations
  getMany(keys: string[]): Map<string, T>;
  setMany(entries: Array<{ key: string; value: T; size: number }>): Map<string, boolean>;

  // Cache Management
  getStats(): CacheStats;
  updateConfig(config: Partial<CacheConfig>): void;
  destroy(): void;
}
```

### BatchProcessor

Optimizes multiple operations through batching and parallel processing.

```typescript
class BatchProcessor<T> {
  constructor(options?: BatchOptions);

  // Operation Management
  async add(operation: () => Promise<T>): Promise<T>;
  async flush(): Promise<void>;
  clear(): void;

  // Configuration
  updateOptions(options: Partial<BatchOptions>): void;
  getQueueLength(): number;
  isProcessingBatch(): boolean;
  destroy(): void;
}
```

### ResourceManager

Monitors and manages system resources to prevent resource exhaustion.

```typescript
class ResourceManager extends EventEmitter {
  constructor(thresholds?: Partial<ResourceThresholds>);

  // Resource Monitoring
  startMonitoring(interval?: number): void;
  stopMonitoring(): void;
  getMetrics(): ResourceMetrics;

  // Resource Management
  registerFileHandle(fd: number): void;
  unregisterFileHandle(fd: number): void;
  registerConnection(id: string, active?: boolean): void;
  updateConnection(id: string, active: boolean): void;
  unregisterConnection(id: string): void;

  // Cleanup
  async cleanup(options?: CleanupOptions): Promise<void>;
  updateThresholds(thresholds: Partial<ResourceThresholds>): void;
  async destroy(): Promise<void>;
}
```

### InputSanitizer

Provides input validation and sanitization for security.

```typescript
class InputSanitizer {
  static sanitizeFileName(name: string): string;
  static sanitizePath(filePath: string, basePath: string): string;
  static sanitizeContent(content: string): string;
  static sanitizeUrl(url: string): string;
  static sanitizeSearchQuery(query: string): string;
}
```

### RateLimiter

Implements rate limiting with burst handling and recovery.

```typescript
class RateLimiter {
  constructor(options: RateLimitOptions);

  // Rate Limiting
  async acquire(key: string, cost?: number): Promise<boolean>;
  async release(key: string, cost?: number): Promise<void>;
  getRemainingTokens(key: string): number;

  // Configuration
  updateOptions(options: Partial<RateLimitOptions>): void;
  reset(key?: string): void;
}
```

## Common Types

### Configuration Types

```typescript
interface CacheConfig {
  maxSize: number; // Maximum cache size in bytes
  maxAge: number; // Maximum age of cache entries in milliseconds
  cleanupInterval: number; // Cleanup interval in milliseconds
}

interface BatchOptions {
  maxBatchSize?: number; // Maximum number of operations in a batch
  maxWaitTime?: number; // Maximum time to wait for batch to fill
  retryCount?: number; // Number of retries for failed operations
  retryDelay?: number; // Delay between retries
  parallel?: boolean; // Whether to process operations in parallel
}

interface ResourceThresholds {
  memory: {
    heapUsedPercent: number;
    rssPercent: number;
  };
  fileDescriptors: {
    percentUsed: number;
  };
  connections: {
    maxActive: number;
    maxIdle: number;
  };
}

interface RateLimitOptions {
  tokensPerInterval: number;
  interval: number;
  burstFactor?: number;
  recoveryFactor?: number;
}
```

### Result Types

```typescript
interface SearchResult {
  line: number;
  content: string;
  context: string[];
}

interface CacheStats {
  entryCount: number;
  currentSize: number;
  maxSize: number;
  hitRate: number;
  missRate: number;
}

interface ResourceMetrics {
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    usage: number;
    loadAvg: number[];
  };
  fileDescriptors: {
    allocated: number;
    limit: number;
  };
  connections: {
    active: number;
    idle: number;
  };
}
```

## Error Handling

All components use typed error classes for better error handling:

```typescript
class FileSystemError extends Error {
  constructor(message: string, cause?: unknown, context?: LogContext);
}

class SecurityError extends Error {
  constructor(message: string, cause?: unknown);
}

class RateLimitError extends Error {
  constructor(message: string, retryAfter: number);
}
```

## Events

Components that extend EventEmitter emit the following events:

### ResourceManager Events

- `metrics`: Emitted when resource metrics are updated
- `cleanup`: Emitted when resource cleanup starts/completes
- `threshold`: Emitted when resource thresholds are exceeded

### CacheManager Events

- `evict`: Emitted when entries are evicted
- `expire`: Emitted when entries expire
- `error`: Emitted on cache operation errors

### BatchProcessor Events

- `batch`: Emitted when a batch starts/completes processing
- `error`: Emitted on batch processing errors

## Usage Examples

### Basic Documentation Management

```typescript
const manager = new FileSystemManager('./docs');

// Save documentation
await manager.saveDocumentation('guide', 'Documentation content');

// Search documentation
const results = await manager.searchInDocumentation('guide', 'search term');

// Get specific version
const version = await manager.getDocumentVersion('guide', '1.0.0');
```

### Caching with Size Limits

```typescript
const cache = new CacheManager({
  maxSize: 100 * 1024 * 1024, // 100MB
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  cleanupInterval: 60 * 60 * 1000, // 1 hour
});

// Cache large object
const success = cache.set('key', data, getSize(data));

// Get cached data
const data = cache.get('key');

// Batch operations
const results = cache.getMany(['key1', 'key2', 'key3']);
```

### Batch Processing

```typescript
const processor = new BatchProcessor({
  maxBatchSize: 100,
  maxWaitTime: 100,
  parallel: true,
});

// Add operations to batch
const results = await Promise.all([
  processor.add(() => operation1()),
  processor.add(() => operation2()),
  processor.add(() => operation3()),
]);

// Flush pending operations
await processor.flush();
```

### Resource Management

```typescript
const manager = new ResourceManager({
  memory: {
    heapUsedPercent: 80,
    rssPercent: 70,
  },
});

// Start monitoring
manager.startMonitoring(5000);

// Track resources
manager.registerFileHandle(fd);
manager.registerConnection('conn1', true);

// Handle cleanup
manager.on('threshold', async () => {
  await manager.cleanup({ force: true });
});
```

## Best Practices

1. **Error Handling**

   - Always catch and handle specific error types
   - Use error contexts for better debugging
   - Implement proper cleanup in catch blocks

2. **Resource Management**

   - Monitor resource usage with ResourceManager
   - Implement proper cleanup with try/finally
   - Use automatic cleanup with destroy() methods

3. **Performance Optimization**

   - Use BatchProcessor for multiple operations
   - Configure CacheManager based on memory constraints
   - Implement proper connection pooling

4. **Security**
   - Always sanitize inputs with InputSanitizer
   - Implement rate limiting for public endpoints
   - Use proper file system permissions

## Debugging

The system uses structured logging with different log levels:

```typescript
logger.debug('Detailed information', { component: 'CacheManager', key, size });
logger.info('Operation completed', { component: 'BatchProcessor', batchSize });
logger.warn('Resource threshold reached', { component: 'ResourceManager', metrics });
logger.error('Operation failed', { component: 'FileSystemManager', error });
```

Log messages include:

- Component name
- Operation context
- Relevant metrics
- Error details when applicable

## Configuration

Example configuration file:

```json
{
  "cache": {
    "maxSize": 104857600,
    "maxAge": 86400000,
    "cleanupInterval": 3600000
  },
  "batch": {
    "maxBatchSize": 100,
    "maxWaitTime": 100,
    "retryCount": 3,
    "retryDelay": 1000,
    "parallel": true
  },
  "resources": {
    "memory": {
      "heapUsedPercent": 80,
      "rssPercent": 70
    },
    "fileDescriptors": {
      "percentUsed": 80
    },
    "connections": {
      "maxActive": 100,
      "maxIdle": 20
    }
  },
  "rateLimiting": {
    "tokensPerInterval": 100,
    "interval": 60000,
    "burstFactor": 2,
    "recoveryFactor": 0.5
  }
}
```
