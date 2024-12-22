import { logger } from './logger.js';

/**
 * Cache entry with metadata
 */
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
  size: number;
}

/**
 * Cache configuration
 */
interface CacheConfig {
  maxSize: number; // Maximum cache size in bytes
  maxAge: number; // Maximum age of cache entries in milliseconds
  cleanupInterval: number; // Cleanup interval in milliseconds
}

/**
 * Memory cache manager with LRU eviction and size/age limits
 */
export class CacheManager<T> {
  private cache: Map<string, CacheEntry<T>>;
  private currentSize: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(private config: CacheConfig) {
    this.cache = new Map();
    this.currentSize = 0;
    this.startCleanupTimer();
  }

  /**
   * Set cache entry
   * @param key Cache key
   * @param value Value to cache
   * @param size Size of value in bytes
   * @returns true if value was cached, false if skipped due to size
   */
  set(key: string, value: T, size: number): boolean {
    // Skip if single entry exceeds max size
    if (size > this.config.maxSize) {
      logger.warn('Cache entry exceeds maximum size', {
        component: 'CacheManager',
        key,
        size,
        maxSize: this.config.maxSize,
      });
      return false;
    }

    // Make room if needed
    while (this.currentSize + size > this.config.maxSize) {
      if (!this.evictLRU()) {
        // Nothing left to evict
        return false;
      }
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt: Date.now() + this.config.maxAge,
      lastAccessed: Date.now(),
      size,
    };

    this.cache.set(key, entry);
    this.currentSize += size;

    logger.debug('Added cache entry', {
      component: 'CacheManager',
      key,
      size,
      currentSize: this.currentSize,
    });

    return true;
  }

  /**
   * Get cache entry
   * @param key Cache key
   * @returns Cached value or undefined if not found
   */
  get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }

    // Update last accessed time
    entry.lastAccessed = Date.now();
    return entry.value;
  }

  /**
   * Delete cache entry
   * @param key Cache key
   */
  delete(key: string): void {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      this.cache.delete(key);

      logger.debug('Deleted cache entry', {
        component: 'CacheManager',
        key,
        size: entry.size,
        currentSize: this.currentSize,
      });
    }
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.currentSize = 0;

    logger.debug('Cleared cache', {
      component: 'CacheManager',
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    entryCount: number;
    currentSize: number;
    maxSize: number;
    hitRate: number;
    missRate: number;
  } {
    const total = this.hitCount + this.missCount;
    return {
      entryCount: this.cache.size,
      currentSize: this.currentSize,
      maxSize: this.config.maxSize,
      hitRate: total > 0 ? this.hitCount / total : 0,
      missRate: total > 0 ? this.missCount / total : 0,
    };
  }

  /**
   * Start cleanup timer
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
      this.cleanup();
    }, this.config.cleanupInterval);

    // Предотвращаем блокировку процесса Node.js
    timer.unref();

    this.cleanupTimer = timer;
  }

  /**
   * Clean up expired entries
   */
  /**
   * Clean up expired entries
   * @internal Публичный для тестирования
   */
  public cleanup(): void {
    const now = Date.now();
    let freedSize = 0;
    let freedCount = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.currentSize -= entry.size;
        this.cache.delete(key);
        freedSize += entry.size;
        freedCount++;
      }
    }

    if (freedCount > 0) {
      logger.debug('Cleaned up expired cache entries', {
        component: 'CacheManager',
        freedCount,
        freedSize,
        currentSize: this.currentSize,
      });
    }
  }

  /**
   * Evict least recently used entry
   * @returns true if an entry was evicted, false if cache is empty
   */
  private evictLRU(): boolean {
    let lruKey: string | undefined;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruKey = key;
        lruTime = entry.lastAccessed;
      }
    }

    if (lruKey) {
      this.delete(lruKey);
      return true;
    }

    return false;
  }

  /**
   * Stop cleanup timer
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
  }

  // Cache statistics
  private hitCount = 0;
  private missCount = 0;

  /**
   * Get value with statistics tracking
   * @param key Cache key
   * @returns Cached value or undefined
   */
  getWithStats(key: string): T | undefined {
    const value = this.get(key);
    if (value === undefined) {
      this.missCount++;
    } else {
      this.hitCount++;
    }
    return value;
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.hitCount = 0;
    this.missCount = 0;
    // Пересчитываем текущий размер кэша
    this.currentSize = Array.from(this.cache.values()).reduce(
      (total, entry) => total + entry.size,
      0
    );
  }

  /**
   * Get multiple values
   * @param keys Cache keys
   * @returns Map of found values
   */
  getMany(keys: string[]): Map<string, T> {
    const result = new Map<string, T>();
    for (const key of keys) {
      const value = this.getWithStats(key);
      if (value !== undefined) {
        result.set(key, value);
      }
    }
    return result;
  }

  /**
   * Set multiple values
   * @param entries Entries to cache
   * @returns Map of successfully cached keys
   */
  setMany(entries: Array<{ key: string; value: T; size: number }>): Map<string, boolean> {
    const results = new Map<string, boolean>();
    for (const entry of entries) {
      results.set(entry.key, this.set(entry.key, entry.value, entry.size));
    }
    return results;
  }

  /**
   * Check if key exists in cache
   * @param key Cache key
   * @returns Whether key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get all cache keys
   * @returns Array of cache keys
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get all cache values
   * @returns Array of non-expired values
   */
  values(): T[] {
    const result: T[] = [];
    const now = Date.now();
    for (const entry of this.cache.values()) {
      if (now <= entry.expiresAt) {
        result.push(entry.value);
      }
    }
    return result;
  }

  /**
   * Update cache configuration
   * @param config New configuration
   */
  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };
    this.startCleanupTimer();
  }
}
