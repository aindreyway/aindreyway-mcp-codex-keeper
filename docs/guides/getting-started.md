# Getting Started with MCP Codex Keeper

This guide will help you get started with MCP Codex Keeper, a high-performance documentation management system.

## Installation

```bash
# Install from npm
npm install @mcp/codex-keeper

# Or using yarn
yarn add @mcp/codex-keeper
```

## Basic Setup

1. Create a new instance of the documentation manager:

```typescript
import { FileSystemManager } from '@mcp/codex-keeper';

const manager = new FileSystemManager('./docs');
await manager.ensureDirectories();
```

2. Configure caching for better performance:

```typescript
import { CacheManager } from '@mcp/codex-keeper';

const cache = new CacheManager({
  maxSize: 100 * 1024 * 1024, // 100MB
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  cleanupInterval: 60 * 60 * 1000, // 1 hour
});
```

3. Set up resource monitoring:

```typescript
import { ResourceManager } from '@mcp/codex-keeper';

const resources = new ResourceManager({
  memory: {
    heapUsedPercent: 80,
    rssPercent: 70,
  },
});

resources.startMonitoring();
```

## Managing Documentation

### Saving Documentation

```typescript
// Save from string
await manager.saveDocumentation('guide', 'Documentation content');

// Save from URL
await manager.saveDocumentation('remote-doc', new URL('https://example.com/doc'));

// Save with version
await manager.saveDocumentation('guide', {
  content: 'Updated content',
  timestamp: '2024-01-10',
});
```

### Searching Documentation

```typescript
// Search within a document
const results = await manager.searchInDocumentation('guide', 'search term');

// Results include context
results.forEach(result => {
  console.log(`Line ${result.line}: ${result.content}`);
  console.log('Context:', result.context);
});
```

### Version Management

```typescript
// Get document metadata
const metadata = await manager.getDocumentMetadata('guide');
console.log('Available versions:', metadata.versions);

// Get specific version
const version = await manager.getDocumentVersion('guide', '1.0.0');
```

## Performance Optimization

### Using the Batch Processor

```typescript
import { BatchProcessor } from '@mcp/codex-keeper';

const processor = new BatchProcessor({
  maxBatchSize: 100,
  maxWaitTime: 100,
  parallel: true,
});

// Add operations to batch
const results = await Promise.all([
  processor.add(async () => {
    await manager.saveDocumentation('doc1', 'content1');
    return 'doc1';
  }),
  processor.add(async () => {
    await manager.saveDocumentation('doc2', 'content2');
    return 'doc2';
  }),
]);

// Flush any remaining operations
await processor.flush();
```

### Efficient Caching

```typescript
// Cache with size tracking
function getSize(data: string): number {
  return Buffer.from(data).length;
}

// Cache documentation content
const content = await manager.getDocumentVersion('guide', 'latest');
cache.set('guide:latest', content, getSize(content));

// Retrieve from cache
const cachedContent = cache.get('guide:latest');
if (cachedContent) {
  // Use cached content
} else {
  // Fetch and cache
  const content = await manager.getDocumentVersion('guide', 'latest');
  cache.set('guide:latest', content, getSize(content));
}
```

## Security Best Practices

### Input Sanitization

```typescript
import { InputSanitizer } from '@mcp/codex-keeper';

// Sanitize file names
const safeName = InputSanitizer.sanitizeFileName(userInput);

// Sanitize paths
const safePath = InputSanitizer.sanitizePath(userPath, basePath);

// Sanitize content
const safeContent = InputSanitizer.sanitizeContent(userContent);
```

### Rate Limiting

```typescript
import { RateLimiter } from '@mcp/codex-keeper';

const limiter = new RateLimiter({
  tokensPerInterval: 100,
  interval: 60000, // 1 minute
  burstFactor: 2,
});

async function handleRequest(clientId: string) {
  if (await limiter.acquire(clientId)) {
    // Process request
  } else {
    throw new Error('Rate limit exceeded');
  }
}
```

## Resource Management

### Monitoring Resources

```typescript
const manager = new ResourceManager();

// Monitor resource usage
manager.on('metrics', metrics => {
  console.log('Memory usage:', {
    heapUsed: metrics.memory.heapUsed,
    heapTotal: metrics.memory.heapTotal,
    rss: metrics.memory.rss,
  });
});

// Handle threshold events
manager.on('threshold', async () => {
  await manager.cleanup({ force: true });
});
```

### Connection Management

```typescript
// Track active connections
manager.registerConnection('client1', true);

// Update connection status
manager.updateConnection('client1', false);

// Cleanup idle connections
await manager.cleanup();
```

## Error Handling

```typescript
try {
  await manager.saveDocumentation('guide', content);
} catch (error) {
  if (error instanceof FileSystemError) {
    // Handle file system errors
    console.error('File system error:', error.message);
    console.error('Context:', error.context);
  } else if (error instanceof SecurityError) {
    // Handle security violations
    console.error('Security error:', error.message);
  } else if (error instanceof RateLimitError) {
    // Handle rate limiting
    console.error('Rate limit exceeded. Retry after:', error.retryAfter);
  } else {
    // Handle other errors
    console.error('Unknown error:', error);
  }
}
```

## Logging and Debugging

```typescript
import { logger } from '@mcp/codex-keeper';

// Configure logging
logger.setLevel('debug');

// Add context to logs
logger.debug('Operation details', {
  component: 'FileSystemManager',
  operation: 'saveDocumentation',
  name: 'guide',
  size: content.length,
});

// Log errors with context
logger.error('Operation failed', {
  component: 'CacheManager',
  error,
  key,
  attempted: true,
});
```

## Configuration

Create a configuration file `codex-keeper.config.json`:

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

Load configuration:

```typescript
import { loadConfig } from '@mcp/codex-keeper';

const config = await loadConfig('./codex-keeper.config.json');

const manager = new FileSystemManager(config.basePath);
const cache = new CacheManager(config.cache);
const resources = new ResourceManager(config.resources);
const limiter = new RateLimiter(config.rateLimiting);
```

## Best Practices

1. **Resource Cleanup**

   ```typescript
   // Always cleanup resources when done
   try {
     // Use resources
   } finally {
     await cache.destroy();
     await processor.destroy();
     await resources.destroy();
   }
   ```

2. **Batch Operations**

   ```typescript
   // Use batch processor for multiple operations
   const processor = new BatchProcessor();
   const operations = docs.map(doc =>
     processor.add(() => manager.saveDocumentation(doc.name, doc.content))
   );
   await Promise.all(operations);
   ```

3. **Error Recovery**

   ```typescript
   // Implement retry logic for transient failures
   async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
     for (let attempt = 1; attempt <= 3; attempt++) {
       try {
         return await operation();
       } catch (error) {
         if (attempt === 3) throw error;
         await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
       }
     }
     throw new Error('Unreachable');
   }
   ```

4. **Resource Monitoring**
   ```typescript
   // Monitor resource usage and implement cleanup
   resources.on('threshold', async () => {
     logger.warn('Resource threshold exceeded');
     await cache.cleanup();
     await manager.cleanup();
     global.gc?.();
   });
   ```

## Common Issues

1. **Memory Leaks**

   - Use ResourceManager to monitor memory usage
   - Implement proper cleanup in finally blocks
   - Use WeakMap/WeakSet for caching references

2. **Performance Issues**

   - Use BatchProcessor for bulk operations
   - Configure appropriate cache sizes
   - Monitor and tune resource thresholds

3. **Security Concerns**
   - Always sanitize user inputs
   - Implement rate limiting
   - Use proper file permissions

## Next Steps

- Read the [API Documentation](../api/README.md)
- Check out the [Examples](../examples/)
- Review the [Security Guide](./security.md)
- Learn about [Advanced Features](./advanced.md)
