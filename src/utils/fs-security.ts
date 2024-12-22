import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

/**
 * Error thrown when file system security checks fail
 */
export class SecurityError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * File system security utility to ensure safe file operations
 */
export class FileSystemSecurity {
  /**
   * Check if a path is within allowed directory
   * @param targetPath Path to check
   * @param allowedDir Allowed directory
   * @throws {SecurityError} If path is outside allowed directory
   */
  static async ensurePathWithinDirectory(targetPath: string, allowedDir: string): Promise<void> {
    const normalizedTarget = path.normalize(targetPath);
    const normalizedAllowed = path.normalize(allowedDir);

    if (!normalizedTarget.startsWith(normalizedAllowed)) {
      throw new SecurityError(`Path ${targetPath} is outside allowed directory ${allowedDir}`);
    }
  }

  /**
   * Check if current process has required permissions for a path
   * @param targetPath Path to check
   * @param requiredPermissions Required permissions (e.g., fs.constants.R_OK | fs.constants.W_OK)
   * @throws {SecurityError} If permissions are insufficient
   */
  static async checkPermissions(targetPath: string, requiredPermissions: number): Promise<void> {
    try {
      await fs.access(targetPath, requiredPermissions);
    } catch (error) {
      throw new SecurityError(`Insufficient permissions for ${targetPath}`, error);
    }
  }

  /**
   * Safely create directory with proper permissions
   * @param dirPath Directory path
   * @param mode Directory permissions (default: 0o755)
   * @throws {SecurityError} If directory creation fails
   */
  static async createSecureDirectory(dirPath: string, mode = 0o755): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true, mode });

      // Verify permissions after creation
      const stats = await fs.stat(dirPath);
      if ((stats.mode & 0o777) !== mode) {
        await fs.chmod(dirPath, mode);
      }
    } catch (error) {
      throw new SecurityError(`Failed to create secure directory ${dirPath}`, error);
    }
  }

  /**
   * Safely write file with proper permissions
   * @param filePath File path
   * @param content File content
   * @param mode File permissions (default: 0o644)
   * @throws {SecurityError} If file write fails
   */
  static async writeSecureFile(
    filePath: string,
    content: string | Buffer,
    mode = 0o644
  ): Promise<void> {
    const tempPath = `${filePath}.tmp`;
    try {
      // Write to temporary file first
      await fs.writeFile(tempPath, content, { mode });

      // Verify permissions
      const stats = await fs.stat(tempPath);
      if ((stats.mode & 0o777) !== mode) {
        await fs.chmod(tempPath, mode);
      }

      // Atomically rename to target file
      await fs.rename(tempPath, filePath);
    } catch (error) {
      // Clean up temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw new SecurityError(`Failed to write secure file ${filePath}`, error);
    }
  }

  /**
   * Safely read file with permission check
   * @param filePath File path
   * @throws {SecurityError} If file read fails
   */
  static async readSecureFile(filePath: string): Promise<Buffer> {
    try {
      // Check read permissions
      await this.checkPermissions(filePath, fs.constants.R_OK);

      // Read file
      return await fs.readFile(filePath);
    } catch (error) {
      throw new SecurityError(`Failed to read secure file ${filePath}`, error);
    }
  }

  /**
   * Safely delete file with permission check
   * @param filePath File path
   * @throws {SecurityError} If file deletion fails
   */
  static async deleteSecureFile(filePath: string): Promise<void> {
    try {
      // Check write permissions on parent directory and file
      const parentDir = path.dirname(filePath);
      await this.checkPermissions(parentDir, fs.constants.W_OK);
      await this.checkPermissions(filePath, fs.constants.W_OK);

      // Delete file
      await fs.unlink(filePath);
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new SecurityError(`Failed to delete secure file ${filePath}`, error);
    }
  }

  /**
   * Check if path has safe permissions
   * @param targetPath Path to check
   * @param maxMode Maximum allowed permissions (default: 0o755 for dirs, 0o644 for files)
   * @throws {SecurityError} If permissions are too permissive
   */
  static async ensureSafePermissions(targetPath: string, maxMode?: number): Promise<void> {
    try {
      const stats = await fs.stat(targetPath);
      const isDirectory = stats.isDirectory();
      const defaultMaxMode = isDirectory ? 0o755 : 0o644;
      const effectiveMaxMode = maxMode ?? defaultMaxMode;

      if ((stats.mode & 0o777) > effectiveMaxMode) {
        await fs.chmod(targetPath, effectiveMaxMode);
        logger.warn(`Fixed unsafe permissions on ${targetPath}`, {
          component: 'FileSystemSecurity',
          oldMode: stats.mode & 0o777,
          newMode: effectiveMaxMode,
        });
      }
    } catch (error) {
      throw new SecurityError(`Failed to check/fix permissions for ${targetPath}`, error);
    }
  }

  /**
   * Recursively check and fix permissions in a directory
   * @param dirPath Directory path
   * @param options Permission options
   */
  static async securePath(
    dirPath: string,
    options: {
      maxDirMode?: number;
      maxFileMode?: number;
      recursive?: boolean;
    } = {}
  ): Promise<void> {
    const { maxDirMode = 0o755, maxFileMode = 0o644, recursive = true } = options;

    try {
      const stats = await fs.stat(dirPath);

      if (stats.isDirectory()) {
        // Fix directory permissions
        await this.ensureSafePermissions(dirPath, maxDirMode);

        if (recursive) {
          // Process directory contents
          const entries = await fs.readdir(dirPath);
          await Promise.all(
            entries.map(entry => this.securePath(path.join(dirPath, entry), options))
          );
        }
      } else {
        // Fix file permissions
        await this.ensureSafePermissions(dirPath, maxFileMode);
      }
    } catch (error) {
      throw new SecurityError(`Failed to secure path ${dirPath}`, error);
    }
  }

  /**
   * Check if a file operation would cause resource exhaustion
   * @param operation Operation details
   * @throws {SecurityError} If operation would exhaust resources
   */
  static async checkResourceLimits(operation: {
    type: 'read' | 'write';
    path: string;
    maxSize?: number;
    maxFiles?: number;
    currentFiles?: number;
  }): Promise<void> {
    try {
      const {
        type,
        path: targetPath,
        maxSize = 100 * 1024 * 1024, // 100MB default
        maxFiles = 1000, // 1000 files default
        currentFiles = 0,
      } = operation;

      // Check file count limit
      if (type === 'write' && currentFiles >= maxFiles) {
        throw new SecurityError(`File count limit (${maxFiles}) exceeded`);
      }

      // Check size limit for writes
      if (type === 'write' && operation.maxSize) {
        const dirPath = path.dirname(targetPath);
        let dirSize = 0;

        // Recursively calculate directory size
        const calculateDirSize = async (dir: string): Promise<number> => {
          let size = 0;
          const entries = await fs.readdir(dir, { withFileTypes: true });

          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              size += await calculateDirSize(fullPath);
            } else {
              const stats = await fs.stat(fullPath);
              size += stats.size;
            }
          }

          return size;
        };

        dirSize = await calculateDirSize(dirPath);

        if (dirSize > maxSize) {
          throw new SecurityError(`Directory size limit (${maxSize} bytes) exceeded`);
        }
      }

      // Check size limit for reads
      if (type === 'read' && operation.maxSize) {
        const stats = await fs.stat(targetPath);
        if (stats.size > maxSize) {
          throw new SecurityError(`File size limit (${maxSize} bytes) exceeded`);
        }
      }
    } catch (error) {
      if (error instanceof SecurityError) {
        throw error;
      }
      throw new SecurityError(`Failed to check resource limits`, error);
    }
  }
}
