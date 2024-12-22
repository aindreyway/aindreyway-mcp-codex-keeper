# Security Guide

This guide covers security best practices and features of MCP Codex Keeper.

## Overview

MCP Codex Keeper implements multiple layers of security:

1. Input Sanitization
2. Rate Limiting
3. File System Security
4. Resource Protection
5. Access Control

## Input Sanitization

### File Names and Paths

```typescript
import { InputSanitizer } from '@mcp/codex-keeper';

// Sanitize file names to prevent path traversal and injection
const safeName = InputSanitizer.sanitizeFileName(userInput);
// Result: Only allows alphanumeric characters and safe separators

// Sanitize paths and ensure they're within allowed directory
const safePath = InputSanitizer.sanitizePath(userPath, basePath);
// Prevents: '../' traversal attacks, absolute paths outside base
```

### Content Sanitization

```typescript
// Sanitize document content
const safeContent = InputSanitizer.sanitizeContent(userContent);
// Handles: Character encoding, control characters, max length

// Sanitize URLs
const safeUrl = InputSanitizer.sanitizeUrl(userUrl);
// Validates: Protocol, domain, path components

// Sanitize search queries
const safeQuery = InputSanitizer.sanitizeSearchQuery(userQuery);
// Prevents: Regex injection, excessive patterns
```

## Rate Limiting

### Basic Rate Limiting

```typescript
const limiter = new RateLimiter({
  tokensPerInterval: 100, // Requests per interval
  interval: 60000, // 1 minute
  burstFactor: 2, // Allow bursts up to 2x normal rate
});

async function handleRequest(clientId: string) {
  if (!(await limiter.acquire(clientId))) {
    throw new RateLimitError('Rate limit exceeded', 60);
  }
  // Process request
}
```

### Advanced Configuration

```typescript
const limiter = new RateLimiter({
  tokensPerInterval: 100,
  interval: 60000,
  burstFactor: 2,
  recoveryFactor: 0.5, // Recover tokens at half rate after burst
  costCalculator: req => {
    // Calculate cost based on request complexity
    return req.complexity || 1;
  },
});
```

### Rate Limit Groups

```typescript
// Different limits for different operations
const readLimiter = new RateLimiter({
  tokensPerInterval: 1000,
  interval: 60000,
});

const writeLimiter = new RateLimiter({
  tokensPerInterval: 100,
  interval: 60000,
});

async function handleRequest(clientId: string, operation: 'read' | 'write') {
  const limiter = operation === 'read' ? readLimiter : writeLimiter;
  await limiter.acquire(clientId);
}
```

## File System Security

### Safe File Operations

```typescript
import { FileSystemSecurity } from '@mcp/codex-keeper';

// Create directory with proper permissions
await FileSystemSecurity.createSecureDirectory(dirPath, 0o755);

// Write file safely (atomic operation)
await FileSystemSecurity.writeSecureFile(filePath, content, 0o644);

// Read file with permission checks
const content = await FileSystemSecurity.readSecureFile(filePath);

// Delete file safely
await FileSystemSecurity.deleteSecureFile(filePath);
```

### Permission Management

```typescript
// Check and fix permissions recursively
await FileSystemSecurity.securePath(basePath, {
  maxDirMode: 0o755, // Directory permissions
  maxFileMode: 0o644, // File permissions
  recursive: true, // Process subdirectories
});

// Verify path is within allowed directory
await FileSystemSecurity.ensurePathWithinDirectory(targetPath, allowedDir);

// Check specific permissions
await FileSystemSecurity.checkPermissions(filePath, fs.constants.R_OK | fs.constants.W_OK);
```

### Resource Limits

```typescript
// Check resource limits before operations
await FileSystemSecurity.checkResourceLimits({
  type: 'write',
  path: filePath,
  maxSize: 50 * 1024 * 1024, // 50MB max file size
  maxFiles: 1000, // Maximum number of files
});
```

## Resource Protection

### Memory Protection

```typescript
const manager = new ResourceManager({
  memory: {
    heapUsedPercent: 80, // Trigger cleanup at 80% heap usage
    rssPercent: 70, // Trigger cleanup at 70% system memory
  },
});

// Monitor memory usage
manager.on('metrics', metrics => {
  if (metrics.memory.heapUsed > threshold) {
    // Take action to reduce memory usage
  }
});

// Automatic cleanup
manager.on('threshold', async () => {
  await manager.cleanup({ force: true });
  global.gc?.();
});
```

### Connection Protection

```typescript
// Track and limit connections
manager.registerConnection(clientId, true);

// Set maximum connections
manager.updateThresholds({
  connections: {
    maxActive: 100,
    maxIdle: 20,
  },
});

// Cleanup idle connections
await manager.cleanup({
  force: false,
  timeout: 5000,
});
```

### File Handle Protection

```typescript
// Track file handles
manager.registerFileHandle(fd);

// Set file descriptor limits
manager.updateThresholds({
  fileDescriptors: {
    percentUsed: 80, // Cleanup at 80% of max FDs
  },
});

// Cleanup handles
try {
  const fd = await fs.open(filePath, 'r');
  manager.registerFileHandle(fd);
  // Use file
} finally {
  manager.unregisterFileHandle(fd);
  await fs.close(fd);
}
```

## Error Handling

### Security Errors

```typescript
try {
  await operation();
} catch (error) {
  if (error instanceof SecurityError) {
    // Log security violation
    logger.error('Security violation', {
      component: 'Security',
      error,
      context: error.context,
    });
    // Return appropriate error response
    throw new Error('Operation not permitted');
  }
}
```

### Rate Limit Errors

```typescript
try {
  await limiter.acquire(clientId);
} catch (error) {
  if (error instanceof RateLimitError) {
    // Add retry-after header
    response.setHeader('Retry-After', error.retryAfter);
    response.status(429).send('Too Many Requests');
    return;
  }
}
```

## Logging Security Events

```typescript
// Configure secure logging
logger.setSecurityOptions({
  maskSensitiveData: true, // Mask passwords, tokens
  maxFieldLength: 1000, // Prevent log injection
  sanitizeMessages: true, // Clean log messages
});

// Log security events
logger.security('Authentication attempt', {
  component: 'Security',
  clientId: maskPII(clientId),
  success: false,
  reason: 'Invalid credentials',
});

// Log file access
logger.security('File access', {
  component: 'FileSystem',
  path: sanitizePath(filePath),
  operation: 'read',
  allowed: false,
});
```

## Security Checklist

### Initial Setup

- [ ] Configure input sanitization
- [ ] Set up rate limiting
- [ ] Configure resource monitoring
- [ ] Set appropriate file permissions
- [ ] Enable security logging

### Regular Maintenance

- [ ] Review security logs
- [ ] Update rate limit configurations
- [ ] Check resource usage patterns
- [ ] Verify file permissions
- [ ] Test security measures

### Incident Response

- [ ] Monitor security events
- [ ] Configure alerts
- [ ] Document response procedures
- [ ] Test recovery processes
- [ ] Maintain audit logs

## Best Practices

1. **Input Validation**

   - Always sanitize user inputs
   - Validate file paths
   - Check content size and format
   - Sanitize search queries

2. **Resource Management**

   - Monitor memory usage
   - Limit file handles
   - Control active connections
   - Implement timeouts

3. **Error Handling**

   - Catch security errors
   - Log security events
   - Return appropriate errors
   - Maintain audit trail

4. **File System**
   - Use secure operations
   - Check permissions
   - Limit access scope
   - Cleanup resources

## Security Configuration

Example security configuration file (`security.config.json`):

```json
{
  "security": {
    "inputSanitization": {
      "maxFileNameLength": 255,
      "maxPathLength": 4096,
      "maxContentSize": 10485760,
      "allowedFileTypes": [".txt", ".md", ".json"]
    },
    "rateLimiting": {
      "read": {
        "tokensPerInterval": 1000,
        "interval": 60000
      },
      "write": {
        "tokensPerInterval": 100,
        "interval": 60000
      }
    },
    "fileSystem": {
      "dirMode": 493,
      "fileMode": 420,
      "maxFileSize": 52428800,
      "maxFiles": 10000
    },
    "resources": {
      "memory": {
        "heapUsedPercent": 80,
        "rssPercent": 70
      },
      "connections": {
        "maxActive": 100,
        "maxIdle": 20,
        "idleTimeout": 300000
      }
    },
    "logging": {
      "securityEvents": true,
      "maskSensitiveData": true,
      "maxFieldLength": 1000,
      "retentionDays": 90
    }
  }
}
```
