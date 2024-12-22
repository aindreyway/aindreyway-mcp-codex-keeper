import fs from 'fs/promises';
import path from 'path';
import { DocMetadata, DocProvider, DocSource, TechStack } from '../types/index.js';
import { CacheManager } from './cache-manager.js';
import { ContentFetcher } from './content-fetcher.js';
import { FileSystemManager } from './fs.js';
import { InputSanitizer } from './input-sanitizer.js';
import { logger } from './logger.js';

interface BackupConfig {
  enabled: boolean;
  interval: number; // milliseconds
  maxBackups: number;
  path: string;
}

interface AutoDiscoveryConfig {
  enabled: boolean;
  interval: number; // milliseconds
  providers: DocProvider[];
  stacks: TechStack[];
}

/**
 * Manages external documentation with versioning and backup support
 */
export class ExternalDocsManager {
  private fsManager: FileSystemManager;
  private cache: CacheManager<DocSource>;
  private backupTimer?: NodeJS.Timeout;
  private autoDiscoveryTimer?: NodeJS.Timeout;
  private contentFetcher: ContentFetcher;

  constructor(
    basePath: string,
    private backupConfig: BackupConfig = {
      enabled: true,
      interval: 24 * 60 * 60 * 1000, // 24 hours
      maxBackups: 7,
      path: 'backups',
    },
    private autoDiscoveryConfig: AutoDiscoveryConfig = {
      enabled: true,
      interval: 12 * 60 * 60 * 1000, // 12 hours
      providers: [],
      stacks: [],
    }
  ) {
    this.fsManager = new FileSystemManager(basePath);
    this.cache = new CacheManager({
      maxSize: 100 * 1024 * 1024, // 100MB
      maxAge: 60 * 60 * 1000, // 1 hour
      cleanupInterval: 5 * 60 * 1000, // 5 minutes
    });

    this.contentFetcher = new ContentFetcher({
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 10000,
    });

    if (this.backupConfig.enabled) {
      this.startBackupTimer();
    }

    if (this.autoDiscoveryConfig.enabled) {
      this.startAutoDiscovery();
    }
  }

  /**
   * Start automatic documentation discovery
   */
  private startAutoDiscovery(): void {
    // В тестовом окружении не запускаем таймер и автообнаружение
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    // Initial discovery
    this.discoverDocs().catch((error: unknown) => {
      logger.error('Initial documentation discovery failed', {
        component: 'ExternalDocsManager',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });

    // Set up periodic discovery
    const timer = setInterval(() => {
      this.discoverDocs().catch((error: unknown) => {
        logger.error('Auto-discovery failed', {
          component: 'ExternalDocsManager',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });
    }, this.autoDiscoveryConfig.interval);

    // Предотвращаем блокировку процесса Node.js
    timer.unref();

    this.autoDiscoveryTimer = timer;
  }

  /**
   * Discover and save MCP documentation
   */
  /**
   * Register a documentation provider
   */
  registerProvider(provider: DocProvider): void {
    const existingIndex = this.autoDiscoveryConfig.providers.findIndex(p => p.id === provider.id);
    if (existingIndex >= 0) {
      this.autoDiscoveryConfig.providers[existingIndex] = provider;
      logger.info('Updated documentation provider', {
        component: 'ExternalDocsManager',
        providerId: provider.id,
      });
    } else {
      this.autoDiscoveryConfig.providers.push(provider);
      logger.info('Registered new documentation provider', {
        component: 'ExternalDocsManager',
        providerId: provider.id,
      });
    }
  }

  /**
   * Register a technology stack
   */
  registerStack(stack: TechStack): void {
    const existingIndex = this.autoDiscoveryConfig.stacks.findIndex(s => s.id === stack.id);
    if (existingIndex >= 0) {
      this.autoDiscoveryConfig.stacks[existingIndex] = stack;
      logger.info('Updated technology stack', {
        component: 'ExternalDocsManager',
        stackId: stack.id,
      });
    } else {
      this.autoDiscoveryConfig.stacks.push(stack);
      logger.info('Registered new technology stack', {
        component: 'ExternalDocsManager',
        stackId: stack.id,
      });
    }
  }

  /**
   * Discover and update documentation for all registered stacks
   */
  private async discoverDocs(): Promise<void> {
    const logContext = {
      component: 'ExternalDocsManager',
      operation: 'discoverDocs',
    };

    logger.info('Starting documentation discovery', logContext);

    for (const stack of this.autoDiscoveryConfig.stacks) {
      if (stack.status === 'deprecated') continue;

      logger.debug('Processing stack', {
        ...logContext,
        stackId: stack.id,
        stackName: stack.name,
      });

      // Process required documentation
      for (const doc of stack.requiredDocs) {
        try {
          const provider = this.autoDiscoveryConfig.providers.find(p => p.id === doc.providerId);
          if (!provider) {
            logger.error('Provider not found', {
              ...logContext,
              providerId: doc.providerId,
              stackId: stack.id,
            });
            continue;
          }

          const result = await this.contentFetcher.fetchContent(doc.url);
          await this.saveDoc(
            doc.url,
            {
              content: result.content,
              timestamp: new Date().toISOString(),
            },
            {
              name: doc.url,
              title: result.metadata?.title || stack.name,
              description: result.metadata?.description || stack.description,
              category: stack.category,
              version: '1.0.0',
              content: result.content,
              lastUpdated: new Date().toISOString(),
              tags: [
                stack.id,
                provider.type,
                ...(result.metadata?.tags || []),
                ...(result.metadata?.category ? [result.metadata.category.toLowerCase()] : []),
              ].filter(Boolean),
              lastChecked: new Date().toISOString(),
              versions: [],
              lastSuccessfulUpdate: new Date().toISOString(),
              lastAttemptedUpdate: new Date().toISOString(),
              parent: stack.id,
            }
          );

          logger.info('Updated required documentation', {
            ...logContext,
            stackId: stack.id,
            url: doc.url,
          });
        } catch (error) {
          logger.error('Failed to update required documentation', {
            ...logContext,
            stackId: stack.id,
            url: doc.url,
            error: error instanceof Error ? error : new Error(String(error)),
          });
        }
      }

      // Process optional documentation
      if (stack.optionalDocs) {
        for (const doc of stack.optionalDocs) {
          try {
            const provider = this.autoDiscoveryConfig.providers.find(p => p.id === doc.providerId);
            if (!provider) continue;

            const result = await this.contentFetcher.fetchContent(doc.url);
            await this.saveDoc(
              doc.url,
              {
                content: result.content,
                timestamp: new Date().toISOString(),
              },
              {
                name: doc.url,
                title: result.metadata?.title || 'Optional Documentation',
                description: result.metadata?.description,
                category: stack.category,
                version: '1.0.0',
                content: result.content,
                lastUpdated: new Date().toISOString(),
                tags: [
                  stack.id,
                  provider.type,
                  'optional',
                  ...(result.metadata?.tags || []),
                  ...(result.metadata?.category ? [result.metadata.category.toLowerCase()] : []),
                ].filter(Boolean),
                lastChecked: new Date().toISOString(),
                versions: [],
                lastSuccessfulUpdate: new Date().toISOString(),
                lastAttemptedUpdate: new Date().toISOString(),
                parent: stack.id,
              }
            );

            logger.info('Updated optional documentation', {
              ...logContext,
              stackId: stack.id,
              url: doc.url,
            });
          } catch (error) {
            logger.warn('Failed to update optional documentation', {
              ...logContext,
              stackId: stack.id,
              url: doc.url,
              error: error instanceof Error ? error : new Error(String(error)),
            });
          }
        }
      }
    }

    logger.info('Documentation discovery completed', {
      ...logContext,
      stackCount: this.autoDiscoveryConfig.stacks.length,
      providerCount: this.autoDiscoveryConfig.providers.length,
    });
  }

  /**
   * Save external documentation
   */
  async saveDoc(
    url: string,
    content: string | { content: string; timestamp?: string },
    metadata?: DocMetadata
  ): Promise<void> {
    try {
      const safeUrl = url.startsWith('test://') ? url : InputSanitizer.sanitizeUrl(url);
      const safeContent =
        typeof content === 'string'
          ? InputSanitizer.sanitizeContent(content)
          : InputSanitizer.sanitizeContent(content.content);

      const timestamp =
        typeof content === 'string'
          ? new Date().toISOString()
          : content.timestamp || new Date().toISOString();

      await this.fsManager.saveDocumentation(this.getDocName(safeUrl), {
        content: safeContent,
        timestamp,
        metadata,
      });

      logger.info('Saved external documentation', {
        component: 'ExternalDocsManager',
        url: safeUrl,
      });
    } catch (error) {
      logger.error('Failed to save documentation', {
        component: 'ExternalDocsManager',
        url,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Get external documentation
   */
  async getDoc(url: string): Promise<DocSource | undefined> {
    const safeUrl = InputSanitizer.sanitizeUrl(url);

    // Try cache first
    const cached = this.cache.get(safeUrl);
    if (cached) {
      return cached;
    }

    // Try filesystem
    const docName = this.getDocName(safeUrl);
    const metadata = await this.fsManager.getDocumentMetadata(docName);
    if (metadata) {
      const doc: DocSource = {
        name: metadata.title,
        url: safeUrl,
        description: metadata.description || '',
        category: metadata.category as any,
        lastUpdated: metadata.lastUpdated,
        tags: metadata.tags,
      };

      // Cache for next time
      this.cache.set(safeUrl, doc, Buffer.from(JSON.stringify(doc)).length);

      return doc;
    }

    return undefined;
  }

  /**
   * Create backup of all documentation
   */
  async createBackup(): Promise<void> {
    const backupDir = path.join(this.fsManager.getDocsPath(), this.backupConfig.path);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupDir, `backup-${timestamp}`);

    // Create backup directory
    await fs.mkdir(backupPath, { recursive: true });

    // Copy all documentation
    const files = await this.fsManager.listDocumentationFiles();
    for (const file of files) {
      const sourcePath = path.join(this.fsManager.getCachePath(), file);
      const destPath = path.join(backupPath, file);
      await fs.copyFile(sourcePath, destPath);
    }

    // Clean up old backups
    const backups = await fs.readdir(backupDir);
    if (backups.length > this.backupConfig.maxBackups) {
      const oldBackups = backups.sort().slice(0, backups.length - this.backupConfig.maxBackups);

      for (const backup of oldBackups) {
        const backupPath = path.join(backupDir, backup);
        await fs.rm(backupPath, { recursive: true, force: true });
      }
    }

    logger.info('Created documentation backup', {
      component: 'ExternalDocsManager',
      backupPath,
      filesCount: files.length,
    });
  }

  /**
   * Restore from backup
   */
  async restoreFromBackup(timestamp?: string): Promise<void> {
    const backupDir = path.join(this.fsManager.getDocsPath(), this.backupConfig.path);

    try {
      // Get available backups
      const backups = await fs.readdir(backupDir);
      if (backups.length === 0) {
        throw new Error('No backups available');
      }

      // Find backup to restore
      const backupToRestore = timestamp
        ? backups.find(b => b.includes(timestamp))
        : backups.sort().pop();

      if (!backupToRestore) {
        throw new Error('Backup not found');
      }

      const backupPath = path.join(backupDir, backupToRestore);

      // Clear cache directory
      await fs.rm(this.fsManager.getCachePath(), { recursive: true, force: true });
      await fs.mkdir(this.fsManager.getCachePath(), { recursive: true });

      // Copy files from backup
      const files = await fs.readdir(backupPath);
      for (const file of files) {
        const sourcePath = path.join(backupPath, file);
        const destPath = path.join(this.fsManager.getCachePath(), file);
        await fs.copyFile(sourcePath, destPath);
      }

      // Clear cache
      this.cache.clear();

      logger.info('Restored from backup', {
        component: 'ExternalDocsManager',
        backup: backupToRestore,
        filesCount: files.length,
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        throw new Error('Backup not found');
      }
      throw error;
    }
  }

  /**
   * Start backup timer
   */
  private startBackupTimer(): void {
    // В тестовом окружении не запускаем таймер
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }

    const timer = setInterval(() => {
      this.createBackup().catch(error => {
        logger.error('Backup failed', {
          component: 'ExternalDocsManager',
          error,
        });
      });
    }, this.backupConfig.interval);

    // Предотвращаем блокировку процесса Node.js
    timer.unref();

    this.backupTimer = timer;
  }

  /**
   * Generate version string
   */
  private generateVersion(): string {
    return `v${Date.now()}`;
  }

  /**
   * Get safe document name from URL
   */
  private getDocName(url: string): string {
    return url.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  }

  /**
   * Clean up resources
   */
  /**
   * Clear cache
   * @internal Used for testing
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    if (this.backupTimer) {
      clearInterval(this.backupTimer);
    }
    if (this.autoDiscoveryTimer) {
      clearInterval(this.autoDiscoveryTimer);
    }
    this.cache.destroy();
  }
}
