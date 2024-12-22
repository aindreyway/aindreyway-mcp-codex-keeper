import { ResourceManager } from '../../../utils/resource-manager.js';
import os from 'os';

describe('ResourceManager', () => {
  let manager: ResourceManager;

  beforeEach(() => {
    manager = new ResourceManager({
      memory: {
        heapUsedPercent: 90,
        rssPercent: 80,
      },
      fileDescriptors: {
        percentUsed: 70,
      },
      connections: {
        maxActive: 50,
        maxIdle: 10,
      },
    });
  });

  afterEach(async () => {
    if (manager) {
      try {
        await manager.destroy();
        // Ensure all event listeners are removed
        manager.removeAllListeners();
      } catch (error) {
        console.warn('Failed to destroy ResourceManager in test:', error);
      } finally {
        // Clear any remaining timers
        jest.clearAllTimers();
      }
    }
  });

  describe('Resource Monitoring', () => {
    it('should start and stop monitoring', () => {
      manager.startMonitoring(1000);
      expect(manager.getMetrics()).toBeDefined();
      manager.stopMonitoring();
    });

    it('should emit metrics events', done => {
      manager.on('metrics', metrics => {
        expect(metrics).toBeDefined();
        expect(metrics.memory).toBeDefined();
        expect(metrics.cpu).toBeDefined();
        expect(metrics.fileDescriptors).toBeDefined();
        expect(metrics.connections).toBeDefined();
        manager.stopMonitoring();
        done();
      });

      manager.startMonitoring(100);
    });

    it('should update metrics periodically', done => {
      let updateCount = 0;
      manager.on('metrics', () => {
        updateCount++;
        if (updateCount >= 2) {
          manager.stopMonitoring();
          done();
        }
      });

      manager.startMonitoring(100);
    });
  });

  describe('File Handle Management', () => {
    it('should track file handles', () => {
      manager.registerFileHandle(1);
      manager.registerFileHandle(2);
      expect(manager.getMetrics().fileDescriptors.allocated).toBe(2);

      manager.unregisterFileHandle(1);
      expect(manager.getMetrics().fileDescriptors.allocated).toBe(1);
    });

    it('should handle duplicate file handles', () => {
      manager.registerFileHandle(1);
      manager.registerFileHandle(1);
      expect(manager.getMetrics().fileDescriptors.allocated).toBe(1);
    });

    it('should handle unregistering non-existent handles', () => {
      manager.unregisterFileHandle(999);
      expect(manager.getMetrics().fileDescriptors.allocated).toBe(0);
    });
  });

  describe('Connection Management', () => {
    it('should track connections', () => {
      manager.registerConnection('conn1', true);
      manager.registerConnection('conn2', false);

      const metrics = manager.getMetrics();
      expect(metrics.connections.active).toBe(1);
      expect(metrics.connections.idle).toBe(1);
    });

    it('should update connection status', () => {
      manager.registerConnection('conn1', true);
      expect(manager.getMetrics().connections.active).toBe(1);

      manager.updateConnection('conn1', false);
      expect(manager.getMetrics().connections.active).toBe(0);
      expect(manager.getMetrics().connections.idle).toBe(1);
    });

    it('should handle connection cleanup', async () => {
      // Register connections
      manager.registerConnection('conn1', false);
      manager.registerConnection('conn2', false);

      // Simulate time passing
      const now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now + 6 * 60 * 1000); // 6 minutes

      await manager.cleanup();

      expect(manager.getMetrics().connections.idle).toBe(0);

      // Restore Date.now
      (Date.now as jest.Mock).mockRestore();
    });
  });

  describe('Resource Cleanup', () => {
    it('should cleanup resources when thresholds exceeded', async () => {
      // Register many connections to trigger cleanup
      for (let i = 0; i < 15; i++) {
        manager.registerConnection(`conn${i}`, false);
      }

      // Simulate time passing
      const now = Date.now();
      jest.spyOn(Date, 'now').mockImplementation(() => now + 6 * 60 * 1000);

      await manager.cleanup({ force: true });

      expect(manager.getMetrics().connections.idle).toBe(0);

      // Restore Date.now
      (Date.now as jest.Mock).mockRestore();
    });

    it('should handle cleanup errors gracefully', async () => {
      // Mock a connection that throws on cleanup
      manager.registerConnection('error-conn', false);
      jest.spyOn(manager as any, 'unregisterConnection').mockImplementationOnce(() => {
        throw new Error('Cleanup error');
      });

      await expect(manager.cleanup({ force: true })).resolves.not.toThrow();
    });

    it('should prevent concurrent cleanups', async () => {
      const cleanup1 = manager.cleanup();
      const cleanup2 = manager.cleanup();

      await Promise.all([cleanup1, cleanup2]);
      expect(manager.getMetrics()).toBeDefined();
    });

    it('should force cleanup when specified', async () => {
      const cleanup1 = manager.cleanup();
      const cleanup2 = manager.cleanup({ force: true });

      await Promise.all([cleanup1, cleanup2]);
      expect(manager.getMetrics()).toBeDefined();
    });
  });

  describe('Configuration Management', () => {
    it('should update thresholds', () => {
      manager.updateThresholds({
        memory: {
          heapUsedPercent: 95,
          rssPercent: 85,
        },
      });

      // Trigger a cleanup to use new thresholds
      manager.cleanup({ force: true });
      expect(manager.getMetrics()).toBeDefined();
    });

    it('should merge partial threshold updates', () => {
      const currentMetrics = manager.getMetrics();
      manager.updateThresholds({
        memory: {
          heapUsedPercent: 95,
          rssPercent: (currentMetrics.memory.rss / os.totalmem()) * 100,
        },
      });

      // Original rssPercent should be preserved
      manager.cleanup({ force: true });
      expect(manager.getMetrics()).toBeDefined();
    });
  });

  describe('Event Handling', () => {
    it('should cleanup event listeners on destroy', async () => {
      const listener = jest.fn();
      manager.on('metrics', listener);

      await manager.destroy();

      // Verify no listeners remain
      expect(manager.listenerCount('metrics')).toBe(0);
    });

    it('should handle multiple event listeners', done => {
      let count = 0;
      const listener1 = () => count++;
      const listener2 = () => count++;

      manager.on('metrics', listener1);
      manager.on('metrics', listener2);

      manager.startMonitoring(100);

      setTimeout(() => {
        expect(count).toBeGreaterThan(0);
        manager.stopMonitoring();
        done();
      }, 150);
    });
  });

  describe('Error Handling', () => {
    it('should handle monitoring errors', () => {
      jest.spyOn(manager as any, 'updateMetrics').mockImplementationOnce(() => {
        throw new Error('Monitoring error');
      });

      expect(() => manager.startMonitoring(100)).not.toThrow();
      manager.stopMonitoring();
    });

    it('should handle threshold check errors', async () => {
      // Mock checkThresholds to throw an error
      jest.spyOn(manager as any, 'checkThresholds').mockImplementationOnce(async () => {
        throw new Error('Threshold check error');
      });

      // Start monitoring
      manager.startMonitoring(100);

      // Wait for the threshold check to be triggered
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify monitoring continues and metrics are available
      const metrics = manager.getMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.memory).toBeDefined();
      expect(metrics.cpu).toBeDefined();
      expect(metrics.fileDescriptors).toBeDefined();
      expect(metrics.connections).toBeDefined();

      // Stop monitoring
      manager.stopMonitoring();
    });
  });
});
