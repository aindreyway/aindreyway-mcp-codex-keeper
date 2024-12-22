import { createWriteStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { DocMetadata, DocSource, DocVersion, SearchIndex } from '../types/index.js';
import { ContentFetcher } from './content-fetcher.js';
import { InputSanitizer } from './input-sanitizer.js';
import { LogContext, logger } from './logger.js';

/**
 * Error thrown when file system operations fail
 */
export class FileSystemError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly context?: LogContext
  ) {
    super(message);
    this.name = 'FileSystemError';

    // Log error with context
    logger.error(message, {
      component: 'FileSystemManager',
      error: this,
      ...context,
    });
  }
}

/**
 * Configuration for cache management
 */
interface CacheConfig {
  maxSize: number; // Maximum cache size in bytes (default: 100MB)
  maxAge: number; // Maximum age of cache files in milliseconds (default: 7 days)
  cleanupInterval: number; // Cleanup interval in milliseconds (default: 1 hour)
  keepVersions?: number; // Number of previous versions to keep (default: 3)
}

/**
 * Manages file system operations for documentation storage
 */
export class FileSystemManager {
  private docsPath: string;
  private sourcesFile: string;
  private cacheDir: string;
  private metadataDir: string;
  private cacheConfig: CacheConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private metadata: Map<string, DocMetadata>;
  protected contentFetcher: ContentFetcher;
  private searchIndices: Map<string, SearchIndex>;
  private symlinkPath: string;

  /**
   * Creates a new FileSystemManager instance
   * @param basePath - Base path for storing documentation
   */
  constructor(
    basePath: string,
    cacheConfig: CacheConfig = {
      maxSize: 100 * 1024 * 1024, // 100MB
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      cleanupInterval: 60 * 60 * 1000, // 1 hour
    }
  ) {
    // Ensure absolute path and decode URL-encoded characters
    const workingDir = process.cwd();
    // Use platform-specific app data directory
    const dataDir =
      process.env.NODE_ENV === 'development'
        ? path.join(workingDir, '.mcp-data') // Use local directory for development
        : path.join(
            process.env.APPDATA ||
              (process.platform == 'darwin'
                ? path.join(process.env.HOME || '', 'Library/Application Support')
                : path.join(process.env.HOME || '', '.local/share')),
            'mcp-codex-keeper'
          );
    this.docsPath = dataDir;
    this.sourcesFile = InputSanitizer.sanitizePath('sources.json', this.docsPath);
    this.cacheDir = InputSanitizer.sanitizePath('cache', this.docsPath);
    this.metadataDir = InputSanitizer.sanitizePath('metadata', this.docsPath);
    this.symlinkPath = path.join(workingDir, '.codexkeeper');

    // Log paths for debugging
    logger.debug('FileSystemManager initialized', {
      component: 'FileSystemManager',
      paths: {
        basePath: this.docsPath,
        sourcesFile: this.sourcesFile,
        cacheDir: this.cacheDir,
        workingDir: process.cwd(),
        symlinkPath: this.symlinkPath,
      },
    });

    // Use provided cache configuration with defaults
    this.cacheConfig = {
      maxSize: cacheConfig.maxSize,
      maxAge: cacheConfig.maxAge,
      cleanupInterval: cacheConfig.cleanupInterval,
      keepVersions: cacheConfig.keepVersions ?? 3,
    };
    this.metadata = new Map();
    this.searchIndices = new Map();

    // Initialize content fetcher
    this.contentFetcher = new ContentFetcher({
      maxRetries: 3,
      retryDelay: 2000,
      timeout: 15000,
    });

    // Start cache cleanup timer
    this.startCleanupTimer();
  }

  /**
   * Starts the cache cleanup timer
   */
  private startCleanupTimer(): void {
    // В тестовом окружении не запускаем таймер
    if (process.env.NODE_ENV === 'test') {
      return;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    const timer = setInterval(() => {
      this.cleanupCache().catch(console.error);
    }, this.cacheConfig.cleanupInterval);

    // Важно: предотвращаем блокировку процесса Node.js
    timer.unref();

    this.cleanupTimer = timer;
  }

  /**
   * Cleans up old cache files
   */
  private async cleanupCache(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      const now = Date.now();
      let totalSize = 0;

      // Get file stats and sort by access time
      const fileStats = await Promise.all(
        files.map(async file => {
          const filePath = InputSanitizer.sanitizePath(file, this.cacheDir);
          const stats = await fs.stat(filePath);
          return { file, path: filePath, stats };
        })
      );

      fileStats.sort((a, b) => a.stats.atime.getTime() - b.stats.atime.getTime());

      // Remove old files and check total size
      for (const { file, path: filePath, stats } of fileStats) {
        if (stats.mtimeMs < now - this.cacheConfig.maxAge) {
          await fs.unlink(filePath);
          continue;
        }

        totalSize += stats.size;
        if (totalSize > this.cacheConfig.maxSize) {
          await fs.unlink(filePath);
        }
      }
    } catch (error) {
      logger.error('Cache cleanup failed', {
        component: 'FileSystemManager',
        operation: 'cleanupCache',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Ensures required directories exist
   * @throws {FileSystemError} If directory creation fails
   */
  /**
   * Creates or verifies symlink to documentation directory
   */
  private async ensureSymlink(): Promise<void> {
    try {
      // Check if symlink exists
      try {
        const stats = await fs.lstat(this.symlinkPath);
        if (stats.isSymbolicLink()) {
          const target = await fs.readlink(this.symlinkPath);
          if (target === this.docsPath) {
            logger.debug('Symlink already exists and points to correct location', {
              component: 'FileSystemManager',
              operation: 'ensureSymlink',
              symlinkPath: this.symlinkPath,
              target: this.docsPath,
            });
            return;
          }
          // Remove existing symlink if it points to wrong location
          await fs.unlink(this.symlinkPath);
        } else if (stats.isDirectory()) {
          // Remove existing directory
          await fs.rm(this.symlinkPath, { recursive: true, force: true });
        }
      } catch (error) {
        // Symlink doesn't exist, continue to creation
      }

      // Create symlink
      await fs.symlink(this.docsPath, this.symlinkPath, 'dir');
      logger.info('Created symlink to documentation directory', {
        component: 'FileSystemManager',
        operation: 'ensureSymlink',
        symlinkPath: this.symlinkPath,
        target: this.docsPath,
      });
    } catch (error) {
      logger.error('Failed to create symlink', {
        component: 'FileSystemManager',
        operation: 'ensureSymlink',
        error: error instanceof Error ? error : new Error(String(error)),
        symlinkPath: this.symlinkPath,
        target: this.docsPath,
      });
    }
  }

  async ensureDirectories(): Promise<void> {
    try {
      logger.debug('Ensuring directories', {
        component: 'FileSystemManager',
        operation: 'ensureDirectories',
        paths: {
          base: this.docsPath,
          cache: this.cacheDir,
          metadata: this.metadataDir,
        },
      });

      // Try to create directories with standard permissions
      try {
        await fs.mkdir(this.docsPath, { recursive: true });
        await fs.mkdir(this.cacheDir, { recursive: true });
        await fs.mkdir(this.metadataDir, { recursive: true });

        logger.info('Created required directories', {
          component: 'FileSystemManager',
          operation: 'ensureDirectories',
        });
      } catch (error) {
        // Log error but continue - directories might already exist
        logger.warn('Could not create some directories', {
          component: 'FileSystemManager',
          operation: 'ensureDirectories',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }

      // Ensure symlink exists
      await this.ensureSymlink();

      // Try to load metadata
      try {
        await this.loadMetadata();
        logger.debug('Loaded metadata', {
          component: 'FileSystemManager',
          operation: 'ensureDirectories',
        });
      } catch (error) {
        // Log error but continue - metadata will be created as needed
        logger.warn('Could not load metadata', {
          component: 'FileSystemManager',
          operation: 'ensureDirectories',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    } catch (error) {
      throw new FileSystemError('Failed to create required directories', error, {
        component: 'FileSystemManager',
        operation: 'ensureDirectories',
      });
    }
  }

  /**
   * Saves documentation content to cache using streams
   * @param name - Documentation name
   * @param content - Content to save
   * @throws {FileSystemError} If save operation fails
   */
  /**
   * Calculates SHA-256 hash of content
   */
  private async calculateHash(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Saves documentation content to cache using streams
   */
  async saveDocumentation(
    name: string,
    content: string | URL | { content: string; timestamp?: string; metadata?: DocMetadata },
    version?: string,
    force: boolean = false
  ): Promise<void> {
    try {
      await this.ensureDirectories();

      // Get or create metadata for this doc
      let docMetadata =
        this.metadata.get(name) ||
        ({
          name,
          title: name,
          version: '1.0.0',
          content: '',
          lastUpdated: new Date().toISOString(),
          versions: [],
          lastSuccessfulUpdate: new Date().toISOString(),
          lastAttemptedUpdate: new Date().toISOString(),
          category: 'Other',
          tags: [],
          lastChecked: new Date().toISOString(),
          resource: {},
          searchIndex: {
            terms: {},
            lastUpdated: new Date().toISOString(),
          },
        } as DocMetadata);

      // Handle different input types
      let processedContent: string;
      let timestamp: string | undefined;

      if (content instanceof URL) {
        // Sanitize URL
        const sanitizedUrl = InputSanitizer.sanitizeUrl(content.toString());
        content = new URL(sanitizedUrl);

        // Prepare headers for conditional request
        const headers: Record<string, string> = {};
        if (!force && docMetadata.resource) {
          if (docMetadata.resource.eTag) {
            headers['If-None-Match'] = docMetadata.resource.eTag;
          }
          if (docMetadata.resource.lastModified) {
            headers['If-Modified-Since'] = docMetadata.resource.lastModified;
          }
        }

        // Fetch content with conditional headers
        const result = await this.contentFetcher.fetchContent(content.toString(), headers);

        if (result.notModified) {
          logger.debug(`Content not modified for ${name}, using cached version`, {
            component: 'FileSystemManager',
            operation: 'saveDocumentation',
            name,
          });
          return;
        }

        processedContent = InputSanitizer.sanitizeContent(result.content);
        timestamp = result.timestamp;

        // Update resource metadata
        docMetadata.resource = {
          eTag: result.eTag,
          lastModified: result.lastModified,
          hash: await this.calculateHash(result.content),
        };
      } else if (typeof content === 'object') {
        processedContent = InputSanitizer.sanitizeContent(content.content);
        timestamp = content.timestamp;
      } else {
        processedContent = InputSanitizer.sanitizeContent(content);
        timestamp = new Date().toISOString();
      }

      version = version || timestamp;

      // Create new version entry
      const newVersion: DocVersion = {
        version: version || new Date().toISOString(),
        content: processedContent,
        lastUpdated: new Date().toISOString(),
        timestamp: new Date().toISOString(),
      };

      // Add new version and maintain version limit
      docMetadata.versions.unshift(newVersion);
      const keepVersions = this.cacheConfig.keepVersions ?? 3;
      if (docMetadata.versions.length > keepVersions) {
        docMetadata.versions = docMetadata.versions.slice(0, this.cacheConfig.keepVersions);
      }

      // Update metadata
      docMetadata.lastSuccessfulUpdate = new Date().toISOString();
      docMetadata.lastAttemptedUpdate = new Date().toISOString();
      docMetadata.updateError = undefined;

      // Get metadata from content if available
      if (typeof content === 'object' && 'metadata' in content) {
        docMetadata = {
          ...docMetadata,
          ...content.metadata,
        };
      }

      // Save content and metadata
      const filename = this.getDocumentationFileName(name);
      const metadataPath = InputSanitizer.sanitizePath(`${filename}.json`, this.metadataDir);
      const cachePath = InputSanitizer.sanitizePath(filename, this.cacheDir);

      logger.debug('Saving documentation files', {
        component: 'FileSystemManager',
        operation: 'saveDocumentation',
        paths: {
          metadata: metadataPath,
          cache: cachePath,
        },
      });

      try {
        await pipeline(Readable.from(processedContent), createWriteStream(cachePath));
        logger.debug('Saved content to cache', {
          component: 'FileSystemManager',
          operation: 'saveDocumentation',
          path: cachePath,
        });
      } catch (error) {
        logger.error('Failed to save content to cache', {
          component: 'FileSystemManager',
          operation: 'saveDocumentation',
          path: cachePath,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }

      try {
        await fs.writeFile(metadataPath, JSON.stringify(docMetadata, null, 2));
        logger.debug('Saved metadata', {
          component: 'FileSystemManager',
          operation: 'saveDocumentation',
          path: metadataPath,
        });
      } catch (error) {
        logger.error('Failed to save metadata', {
          component: 'FileSystemManager',
          operation: 'saveDocumentation',
          path: metadataPath,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }

      try {
        await this.updateSearchIndex(name, processedContent);
        logger.debug('Updated search index', {
          component: 'FileSystemManager',
          operation: 'saveDocumentation',
          name,
        });
      } catch (error) {
        logger.error('Failed to update search index', {
          component: 'FileSystemManager',
          operation: 'saveDocumentation',
          name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }

      logger.info(`Saved documentation "${name}" with version ${version}`, {
        component: 'FileSystemManager',
        operation: 'saveDocumentation',
        name,
        version,
      });

      this.metadata.set(name, docMetadata);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const docMetadata = this.metadata.get(name);
      if (docMetadata) {
        docMetadata.updateError = errorMessage;
        docMetadata.lastAttemptedUpdate = new Date().toISOString();
      }
      throw new FileSystemError(`Failed to save documentation: ${name}`, error);
    }
  }

  /**
   * Load metadata and search indices for all documents
   */
  private async loadMetadata(): Promise<void> {
    try {
      const files = await fs.readdir(this.metadataDir);

      for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.index.json')) {
          // Load metadata
          const content = await fs.readFile(
            InputSanitizer.sanitizePath(file, this.metadataDir),
            'utf-8'
          );
          const name = file.replace('.json', '').replace(/_/g, ' ');
          const metadata = JSON.parse(content);
          this.metadata.set(name, metadata);

          // Load search index if exists
          const indexFile = file.replace('.json', '.index.json');
          try {
            const indexContent = await fs.readFile(
              InputSanitizer.sanitizePath(indexFile, this.metadataDir),
              'utf-8'
            );
            const index = JSON.parse(indexContent);
            this.searchIndices.set(name, index);
          } catch (indexError) {
            logger.debug(`No index found for ${name}, will be created on next update`, {
              component: 'FileSystemManager',
              operation: 'loadMetadata',
              name,
            });
          }
        }
      }
    } catch (error) {
      logger.error('Failed to load metadata', {
        component: 'FileSystemManager',
        operation: 'loadMetadata',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  /**
   * Get document metadata
   */
  async getDocumentMetadata(name: string): Promise<DocMetadata | undefined> {
    return this.metadata.get(name);
  }

  /**
   * Get specific version of a document
   */
  async getDocumentVersion(name: string, version: string): Promise<string | undefined> {
    const metadata = this.metadata.get(name);
    return metadata?.versions.find(v => v.version === version)?.content;
  }

  /**
   * Saves documentation sources metadata
   * @param docs - Array of documentation sources
   * @throws {FileSystemError} If save operation fails
   */
  async saveSources(docs: DocSource[]): Promise<void> {
    try {
      logger.debug('Saving documentation sources', {
        component: 'FileSystemManager',
        operation: 'saveSources',
        path: this.sourcesFile,
        docsCount: docs.length,
      });

      await this.ensureDirectories();

      // Write directly using fs.writeFile
      await fs.writeFile(this.sourcesFile, JSON.stringify(docs, null, 2), { mode: 0o666 });

      // Verify file was created
      const exists = await fs
        .access(this.sourcesFile)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        throw new Error('File was not created');
      }

      logger.info('Documentation sources saved successfully', {
        component: 'FileSystemManager',
        operation: 'saveSources',
        path: this.sourcesFile,
      });
    } catch (error) {
      throw new FileSystemError('Failed to save documentation sources', error, {
        component: 'FileSystemManager',
        operation: 'saveSources',
        path: this.sourcesFile,
      });
    }
  }

  /**
   * Loads documentation sources metadata
   * @returns Array of documentation sources
   * @throws {FileSystemError} If load operation fails
   */
  async loadSources(): Promise<DocSource[]> {
    try {
      logger.debug('Loading documentation sources', {
        component: 'FileSystemManager',
        operation: 'loadSources',
        path: this.sourcesFile,
      });

      await this.ensureDirectories();

      const exists = await fs
        .access(this.sourcesFile)
        .then(() => true)
        .catch(() => false);

      if (!exists) {
        logger.info('No sources file found, returning empty array', {
          component: 'FileSystemManager',
          operation: 'loadSources',
        });
        return [];
      }

      const content = await fs.readFile(this.sourcesFile, 'utf-8');
      const docs = JSON.parse(content);

      logger.debug('Documentation sources loaded', {
        component: 'FileSystemManager',
        operation: 'loadSources',
        docsCount: docs.length,
      });

      return docs;
    } catch (error) {
      logger.error('Failed to load documentation sources', {
        component: 'FileSystemManager',
        operation: 'loadSources',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return [];
    }
  }

  /**
   * Searches for text in cached documentation using search index
   * @param name - Documentation name
   * @param searchQuery - Text to search for
   * @returns Array of search results with context
   */
  async searchInDocumentation(
    name: string,
    searchQuery: string
  ): Promise<Array<{ line: number; content: string; context: string[] }>> {
    try {
      // Sanitize search query
      const sanitizedQuery = InputSanitizer.sanitizeSearchQuery(searchQuery);

      // Get search index
      const index = this.searchIndices.get(name);
      if (!index) {
        logger.debug(`No search index found for ${name}, falling back to full text search`, {
          component: 'FileSystemManager',
          operation: 'searchInDocumentation',
          name,
        });
        return this.fallbackSearch(name, sanitizedQuery);
      }

      // Get document content for context
      const filename = this.getDocumentationFileName(name);
      const filePath = InputSanitizer.sanitizePath(filename, this.cacheDir);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      // Process search terms
      const searchTerms = sanitizedQuery
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(term => term.length > 0);

      const results = new Map<number, { line: number; content: string; context: string[] }>();
      const contextLines = 2;

      // Search for each term in the index
      for (const term of searchTerms) {
        const termData = index.terms[term];
        if (termData) {
          // Add results for each line where the term appears
          for (const lineNum of termData.lines) {
            if (!results.has(lineNum)) {
              const contextStart = Math.max(0, lineNum - contextLines);
              const contextEnd = Math.min(lines.length - 1, lineNum + contextLines);
              const context = lines.slice(contextStart, contextEnd + 1);

              results.set(lineNum, {
                line: lineNum + 1,
                content: lines[lineNum],
                context,
              });
            }
          }
        }
      }

      return Array.from(results.values()).sort((a, b) => a.line - b.line);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw new FileSystemError(`Failed to search documentation: ${name}`, error);
    }
  }

  /**
   * Fallback search method when index is not available
   */
  private async fallbackSearch(
    name: string,
    searchQuery: string
  ): Promise<Array<{ line: number; content: string; context: string[] }>> {
    const filename = this.getDocumentationFileName(name);
    const filePath = InputSanitizer.sanitizePath(filename, this.cacheDir);

    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');
    const results: Array<{ line: number; content: string; context: string[] }> = [];

    const searchRegex = new RegExp(searchQuery, 'gi');
    const contextLines = 2;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (searchRegex.test(line)) {
        const contextStart = Math.max(0, i - contextLines);
        const contextEnd = Math.min(lines.length - 1, i + contextLines);
        const context = lines.slice(contextStart, contextEnd + 1);

        results.push({
          line: i + 1,
          content: line,
          context,
        });
      }
    }

    return results;
  }

  /**
   * Lists all cached documentation files
   * @returns Array of filenames
   * @throws {FileSystemError} If directory reading fails
   */
  async listDocumentationFiles(): Promise<string[]> {
    try {
      await this.ensureDirectories();
      return fs.readdir(this.cacheDir);
    } catch (error) {
      throw new FileSystemError('Failed to list documentation files', error);
    }
  }

  /**
   * Gets documentation file path
   * @param name - Documentation name
   * @returns Path to documentation file
   */
  getDocumentationPath(name: string): string {
    const fileName = this.getDocumentationFileName(name);
    return InputSanitizer.sanitizePath(fileName, this.cacheDir);
  }

  /**
   * Checks if documentation exists in cache
   * @param name - Documentation name
   * @returns Whether documentation exists
   */
  async hasDocumentation(name: string): Promise<boolean> {
    try {
      await fs.access(this.getDocumentationPath(name));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  /**
   * Find closest matching document by name
   * @param name - Document name to search for
   * @returns Best matching document name or undefined if no close matches
   */
  findClosestDocName(name: string): string | undefined {
    const normalizedSearch = name.toLowerCase().trim();
    let bestMatch: string | undefined;
    let bestDistance = Infinity;

    for (const docName of this.metadata.keys()) {
      const normalizedDoc = docName.toLowerCase().trim();
      const distance = this.levenshteinDistance(normalizedSearch, normalizedDoc);

      // Calculate threshold based on string length
      const threshold = Math.max(normalizedSearch.length, normalizedDoc.length) * 0.3;

      if (distance < bestDistance && distance <= threshold) {
        bestDistance = distance;
        bestMatch = docName;
      }
    }

    return bestMatch;
  }

  /**
   * Gets documentation file name
   * @param name - Documentation name
   * @returns Sanitized file name
   */
  private getDocumentationFileName(name: string): string {
    // Удаляем непечатаемые символы
    name = name.replace(/[\x00-\x1F\x7F]/g, '');

    // Обработка URL-подобных имен
    if (name.includes('://')) {
      return (
        'https_' +
        name
          .replace(/^https?:\/\//, '')
          .replace(/[/\\?=&.]/g, '_')
          .replace(/_{2,}/g, '_')
          .replace(/^_+|_+$/g, '')
      );
    }

    // Преобразуем в нижний регистр
    name = name.toLowerCase();

    // Удаляем пути Windows и Unix
    name = name
      .replace(/^[a-z]:[\\\/]/, '') // Windows
      .replace(/^[/\\]+/, ''); // Unix

    // Заменяем слеши на подчеркивания
    name = name.replace(/[/\\]/g, '_');

    // Разделяем слова в CamelCase
    name = name.replace(/([a-z])([A-Z])/g, '$1_$2');

    // Заменяем пробелы и спецсимволы на подчеркивания
    name = name.replace(/[^a-z0-9-]/g, '_');

    // Убираем множественные подчеркивания
    name = name.replace(/_{2,}/g, '_');

    // Всегда добавляем расширение .txt
    return `${name}.txt`;
  }

  /**
   * Gets base documentation path
   * @returns Base path for documentation storage
   */
  getDocsPath(): string {
    return this.docsPath;
  }

  /**
   * Gets cache directory path
   * @returns Path to cache directory
   */
  getCachePath(): string {
    return this.cacheDir;
  }

  /**
   * Updates cache configuration
   * @param config - New cache configuration
   */
  updateCacheConfig(config: Partial<CacheConfig>): void {
    this.cacheConfig = { ...this.cacheConfig, ...config };
    this.startCleanupTimer(); // Restart timer with new interval
  }

  /**
   * Updates search index for a document
   * @param name - Documentation name
   * @param content - Document content
   */
  private async updateSearchIndex(name: string, content: string): Promise<void> {
    const lines = content.split('\n');
    const index: SearchIndex = {
      terms: {},
      lastUpdated: new Date().toISOString(),
    };

    // Process each line
    lines.forEach((line, lineNumber) => {
      // Split line into words and remove punctuation
      const words = line
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 0);

      // Index each word
      words.forEach((word, position) => {
        if (!index.terms[word]) {
          index.terms[word] = {
            positions: [position],
            lines: [lineNumber],
          };
        } else {
          index.terms[word].positions.push(position);
          index.terms[word].lines.push(lineNumber);
        }
      });
    });

    // Save index
    const indexPath = InputSanitizer.sanitizePath(
      `${this.getDocumentationFileName(name)}.index.json`,
      this.metadataDir
    );
    await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
    this.searchIndices.set(name, index);

    // Update metadata
    const docMetadata = this.metadata.get(name);
    if (docMetadata) {
      docMetadata.searchIndex = index;
      this.metadata.set(name, docMetadata);
    }
  }

  /**
   * Cleanup resources
   */
  async destroy(): Promise<void> {
    try {
      // Clear timer
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
      }

      // Clean up cache directory
      try {
        const cacheFiles = await fs.readdir(this.cacheDir);
        await Promise.all(
          cacheFiles.map(file => 
            fs.unlink(path.join(this.cacheDir, file))
              .catch(error => {
                logger.warn(`Failed to remove cache file: ${file}`, {
                  component: 'FileSystemManager',
                  operation: 'destroy',
                  error: error instanceof Error ? error : new Error(String(error))
                });
              })
          )
        );
      } catch (error) {
        logger.warn('Failed to clean cache directory', {
          component: 'FileSystemManager',
          operation: 'destroy',
          error: error instanceof Error ? error : new Error(String(error))
        });
      }

      // Reset content fetcher
      this.contentFetcher = new ContentFetcher({
        maxRetries: 3,
        retryDelay: 2000,
        timeout: 15000,
      });

      // Clear maps
      this.metadata.clear();
      this.searchIndices.clear();

      // Log cleanup
      logger.debug('FileSystemManager resources cleaned up', {
        component: 'FileSystemManager',
        operation: 'destroy'
      });
    } catch (error) {
      logger.error('Error during FileSystemManager cleanup', {
        component: 'FileSystemManager',
        operation: 'destroy',
        error: error instanceof Error ? error : new Error(String(error))
      });
      throw error;
    }
  }

  /**
   * Remove documentation and associated files
   * @param name Documentation name
   */
  async removeDocumentation(name: string): Promise<void> {
    try {
      const fileName = this.getDocumentationFileName(name);
      const filePath = path.join(this.metadataDir, fileName);
      const indexPath = path.join(this.metadataDir, `${fileName}.index.json`);

      // Remove documentation file
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Remove index file
      try {
        await fs.unlink(indexPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }

      // Remove from maps
      this.metadata.delete(name);
      this.searchIndices.delete(name);

      logger.debug(`Documentation files removed: ${name}`, {
        component: 'FileSystemManager',
        operation: 'removeDocumentation'
      });
    } catch (error) {
      throw new FileSystemError(`Failed to remove documentation: ${name}`, error);
    }
  }
}
