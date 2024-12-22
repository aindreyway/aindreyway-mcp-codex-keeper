import { logger } from './logger.js';
import { EventEmitter } from 'events';
import os from 'os';

/**
 * Resource usage metrics
 */
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

/**
 * Resource thresholds configuration
 */
interface ResourceThresholds {
  memory: {
    heapUsedPercent: number; // Percentage of max heap size
    rssPercent: number; // Percentage of system memory
  };
  fileDescriptors: {
    percentUsed: number; // Percentage of max file descriptors
  };
  connections: {
    maxActive: number; // Maximum active connections
    maxIdle: number; // Maximum idle connections
  };
}

/**
 * Resource cleanup options
 */
interface CleanupOptions {
  force?: boolean; // Force cleanup even if thresholds not reached
  timeout?: number; // Timeout for cleanup operations
}

/**
 * Resource manager for monitoring and controlling system resources
 */
export class ResourceManager extends EventEmitter {
  private metrics: ResourceMetrics;
  private thresholds: ResourceThresholds;
  private monitoringInterval?: NodeJS.Timeout;
  private fileHandles: Set<number> = new Set();
  private connections: Map<string, { active: boolean; lastUsed: number }> = new Map();
  private cleanupInProgress = false;

  constructor(thresholds: Partial<ResourceThresholds> = {}) {
    super();
    this.thresholds = {
      memory: {
        heapUsedPercent: 80, // 80% of max heap
        rssPercent: 70, // 70% of system memory
        ...thresholds.memory,
      },
      fileDescriptors: {
        percentUsed: 80, // 80% of max file descriptors
        ...thresholds.fileDescriptors,
      },
      connections: {
        maxActive: 100,
        maxIdle: 20,
        ...thresholds.connections,
      },
    };

    this.metrics = this.getCurrentMetrics();
  }

  /**
   * Start resource monitoring
   * @param interval Monitoring interval in milliseconds
   */
  startMonitoring(interval = 5000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(() => {
      this.updateMetrics();
      this.checkThresholds();
    }, interval);

    logger.info('Resource monitoring started', {
      component: 'ResourceManager',
      interval,
    });
  }

  /**
   * Stop resource monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }
  }

  /**
   * Get current resource metrics
   */
  private getCurrentMetrics(): ResourceMetrics {
    const memory = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memory: {
        heapUsed: memory.heapUsed,
        heapTotal: memory.heapTotal,
        external: memory.external,
        rss: memory.rss,
      },
      cpu: {
        usage: (cpuUsage.user + cpuUsage.system) / 1000000, // Convert to ms
        loadAvg: os.loadavg(),
      },
      fileDescriptors: {
        allocated: this.fileHandles.size,
        limit: Number.MAX_SAFE_INTEGER, // Will be updated in updateMetrics
      },
      connections: {
        active: Array.from(this.connections.values()).filter(c => c.active).length,
        idle: Array.from(this.connections.values()).filter(c => !c.active).length,
      },
    };
  }

  /**
   * Update resource metrics
   */
  private updateMetrics(): void {
    this.metrics = this.getCurrentMetrics();
    this.emit('metrics', this.metrics);

    logger.debug('Resource metrics updated', {
      component: 'ResourceManager',
      metrics: this.metrics,
    });
  }

  /**
   * Check resource thresholds and trigger cleanup if needed
   */
  private async checkThresholds(): Promise<void> {
    try {
      const memoryPercent = (this.metrics.memory.heapUsed / this.metrics.memory.heapTotal) * 100;
      const rssPercent = (this.metrics.memory.rss / os.totalmem()) * 100;
      const fdPercent =
        (this.metrics.fileDescriptors.allocated / this.metrics.fileDescriptors.limit) * 100;

      if (
        memoryPercent > this.thresholds.memory.heapUsedPercent ||
        rssPercent > this.thresholds.memory.rssPercent ||
        fdPercent > this.thresholds.fileDescriptors.percentUsed ||
        this.metrics.connections.active > this.thresholds.connections.maxActive ||
        this.metrics.connections.idle > this.thresholds.connections.maxIdle
      ) {
        await this.cleanup({ force: true });
      }
    } catch (error) {
      logger.error('Failed to check thresholds', {
        component: 'ResourceManager',
        error: error instanceof Error ? error : new Error(String(error)),
      });
      // Не прерываем мониторинг при ошибке проверки порогов
    }
  }

  /**
   * Register file handle
   * @param fd File descriptor
   */
  registerFileHandle(fd: number): void {
    this.fileHandles.add(fd);
    logger.debug('File handle registered', {
      component: 'ResourceManager',
      fd,
      totalHandles: this.fileHandles.size,
    });
  }

  /**
   * Unregister file handle
   * @param fd File descriptor
   */
  unregisterFileHandle(fd: number): void {
    this.fileHandles.delete(fd);
    logger.debug('File handle unregistered', {
      component: 'ResourceManager',
      fd,
      totalHandles: this.fileHandles.size,
    });
  }

  /**
   * Register connection
   * @param id Connection identifier
   * @param active Whether connection is active
   */
  registerConnection(id: string, active = true): void {
    this.connections.set(id, { active, lastUsed: Date.now() });
    logger.debug('Connection registered', {
      component: 'ResourceManager',
      id,
      active,
      totalConnections: this.connections.size,
    });
  }

  /**
   * Update connection status
   * @param id Connection identifier
   * @param active Whether connection is active
   */
  updateConnection(id: string, active: boolean): void {
    const connection = this.connections.get(id);
    if (connection) {
      connection.active = active;
      connection.lastUsed = Date.now();
    }
  }

  /**
   * Unregister connection
   * @param id Connection identifier
   */
  unregisterConnection(id: string): void {
    this.connections.delete(id);
    logger.debug('Connection unregistered', {
      component: 'ResourceManager',
      id,
      totalConnections: this.connections.size,
    });
  }

  /**
   * Clean up resources
   * @param options Cleanup options
   */
  async cleanup(options: CleanupOptions = {}): Promise<void> {
    if (this.cleanupInProgress && !options.force) {
      return;
    }

    this.cleanupInProgress = true;
    const startTime = Date.now();

    try {
      // Clean up idle connections
      const now = Date.now();
      const idleTimeout = 5 * 60 * 1000; // 5 minutes

      for (const [id, connection] of this.connections.entries()) {
        if (!connection.active && now - connection.lastUsed > idleTimeout) {
          this.unregisterConnection(id);
        }
      }

      // Trigger garbage collection if available
      if (global.gc) {
        global.gc();
      }

      logger.info('Resource cleanup completed', {
        component: 'ResourceManager',
        duration: Date.now() - startTime,
        freedConnections: this.metrics.connections.idle - this.getCurrentMetrics().connections.idle,
      });
    } catch (error) {
      logger.error('Resource cleanup failed', {
        component: 'ResourceManager',
        error: error instanceof Error ? error : new Error(String(error)),
      });
    } finally {
      this.cleanupInProgress = false;
    }
  }

  /**
   * Get current resource metrics
   */
  getMetrics(): ResourceMetrics {
    return this.getCurrentMetrics();
  }

  /**
   * Update resource thresholds
   * @param thresholds New thresholds
   */
  updateThresholds(thresholds: Partial<ResourceThresholds>): void {
    this.thresholds = {
      ...this.thresholds,
      ...thresholds,
    };
  }

  /**
   * Clean up resources and stop monitoring
   */
  async destroy(): Promise<void> {
    this.stopMonitoring();
    await this.cleanup({ force: true });
    this.removeAllListeners();
  }
}
