// Type definitions for Node.js process extensions
import type { EventEmitter } from 'events';
import type { ProcessEnv, Platform, ProcessVersions, MemoryUsage, CpuUsage } from 'node:process';

export interface ActiveHandle extends EventEmitter {
  constructor: { name: string };
  unref?: () => void;
  destroy?: () => void;
  removeAllListeners?: () => void;
}

export interface Process extends EventEmitter {
    _getActiveHandles(): ActiveHandle[];
    env: ProcessEnv;
    exit(code?: number): never;
    cwd(): string;
    platform: Platform;
    versions: ProcessVersions;
    pid: number;
    memoryUsage(): MemoryUsage;
    cpuUsage(previousValue?: CpuUsage): CpuUsage;
    hrtime: {
      (time?: [number, number]): [number, number];
      bigint(): bigint;
    };
    stdout: {
      write(str: string): boolean;
    };
    stderr: {
      write(str: string): boolean;
    };
  }

declare global {
  var process: Process;
}

export type { Process };
