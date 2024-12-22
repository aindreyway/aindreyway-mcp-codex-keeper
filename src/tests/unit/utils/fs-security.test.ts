import { FileSystemSecurity, SecurityError } from '../../../utils/fs-security.js';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

describe('FileSystemSecurity', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-security-test-'));
  });

  afterEach(async () => {
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('ensurePathWithinDirectory', () => {
    it('should allow paths within directory', async () => {
      const targetPath = path.join(testDir, 'test.txt');
      await expect(
        FileSystemSecurity.ensurePathWithinDirectory(targetPath, testDir)
      ).resolves.not.toThrow();
    });

    it('should reject paths outside directory', async () => {
      const targetPath = path.join(testDir, '..', 'test.txt');
      await expect(
        FileSystemSecurity.ensurePathWithinDirectory(targetPath, testDir)
      ).rejects.toThrow(SecurityError);
    });

    it('should handle symlink attacks', async () => {
      const outsideFile = path.join(os.tmpdir(), 'outside.txt');
      const symlinkPath = path.join(testDir, 'symlink.txt');

      await fs.writeFile(outsideFile, 'test');
      await fs.symlink(outsideFile, symlinkPath);

      await expect(
        FileSystemSecurity.ensurePathWithinDirectory(symlinkPath, testDir)
      ).resolves.not.toThrow();

      // Clean up
      await fs.unlink(outsideFile);
    });
  });

  describe('checkPermissions', () => {
    it('should allow access with correct permissions', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'test', { mode: 0o644 });

      await expect(
        FileSystemSecurity.checkPermissions(filePath, fs.constants.R_OK)
      ).resolves.not.toThrow();
    });

    it('should reject access with insufficient permissions', async () => {
      const filePath = path.join(testDir, 'test.txt');
      await fs.writeFile(filePath, 'test', { mode: 0o000 });

      await expect(
        FileSystemSecurity.checkPermissions(filePath, fs.constants.R_OK)
      ).rejects.toThrow(SecurityError);

      // Reset permissions for cleanup
      await fs.chmod(filePath, 0o644);
    });
  });

  describe('createSecureDirectory', () => {
    it('should create directory with correct permissions', async () => {
      const dirPath = path.join(testDir, 'secure-dir');
      await FileSystemSecurity.createSecureDirectory(dirPath);

      const stats = await fs.stat(dirPath);
      expect(stats.mode & 0o777).toBe(0o755);
    });

    it('should fix incorrect permissions', async () => {
      const dirPath = path.join(testDir, 'insecure-dir');
      await fs.mkdir(dirPath, { mode: 0o777 });

      await FileSystemSecurity.createSecureDirectory(dirPath, 0o755);
      const stats = await fs.stat(dirPath);
      expect(stats.mode & 0o777).toBe(0o755);
    });
  });

  describe('writeSecureFile', () => {
    it('should write file with correct permissions', async () => {
      const filePath = path.join(testDir, 'secure.txt');
      await FileSystemSecurity.writeSecureFile(filePath, 'test content');

      const stats = await fs.stat(filePath);
      expect(stats.mode & 0o777).toBe(0o644);

      const content = await fs.readFile(filePath, 'utf-8');
      expect(content).toBe('test content');
    });

    it('should handle write failures gracefully', async () => {
      const filePath = path.join(testDir, 'nonexistent', 'secure.txt');
      await expect(FileSystemSecurity.writeSecureFile(filePath, 'test')).rejects.toThrow(
        SecurityError
      );
    });

    it('should clean up temporary files on failure', async () => {
      const filePath = path.join(testDir, 'nonexistent', 'secure.txt');
      const tempPath = `${filePath}.tmp`;

      try {
        await FileSystemSecurity.writeSecureFile(filePath, 'test');
      } catch (error) {
        // Expected error
      }

      await expect(fs.access(tempPath)).rejects.toThrow();
    });
  });

  describe('readSecureFile', () => {
    it('should read file with correct permissions', async () => {
      const filePath = path.join(testDir, 'readable.txt');
      await fs.writeFile(filePath, 'test content', { mode: 0o644 });

      const content = await FileSystemSecurity.readSecureFile(filePath);
      expect(content.toString()).toBe('test content');
    });

    it('should reject reading files without permission', async () => {
      const filePath = path.join(testDir, 'unreadable.txt');
      await fs.writeFile(filePath, 'test content', { mode: 0o000 });

      await expect(FileSystemSecurity.readSecureFile(filePath)).rejects.toThrow(SecurityError);

      // Reset permissions for cleanup
      await fs.chmod(filePath, 0o644);
    });
  });

  describe('deleteSecureFile', () => {
    it('should delete file with correct permissions', async () => {
      const filePath = path.join(testDir, 'deletable.txt');
      await fs.writeFile(filePath, 'test content', { mode: 0o644 });

      await FileSystemSecurity.deleteSecureFile(filePath);
      await expect(fs.access(filePath)).rejects.toThrow();
    });

    it('should reject deleting files without permission', async () => {
      const filePath = path.join(testDir, 'undeletable.txt');
      await fs.writeFile(filePath, 'test content', { mode: 0o444 });

      await expect(FileSystemSecurity.deleteSecureFile(filePath)).rejects.toThrow(SecurityError);

      // Reset permissions for cleanup
      await fs.chmod(filePath, 0o644);
    });
  });

  describe('ensureSafePermissions', () => {
    it('should fix unsafe directory permissions', async () => {
      const dirPath = path.join(testDir, 'unsafe-dir');
      await fs.mkdir(dirPath, { mode: 0o777 });

      await FileSystemSecurity.ensureSafePermissions(dirPath);
      const stats = await fs.stat(dirPath);
      expect(stats.mode & 0o777).toBe(0o755);
    });

    it('should fix unsafe file permissions', async () => {
      const filePath = path.join(testDir, 'unsafe.txt');
      await fs.writeFile(filePath, 'test', { mode: 0o777 });

      await FileSystemSecurity.ensureSafePermissions(filePath);
      const stats = await fs.stat(filePath);
      expect(stats.mode & 0o777).toBe(0o644);
    });
  });

  describe('securePath', () => {
    it('should recursively secure directory tree', async () => {
      // Create test directory structure
      const subDir = path.join(testDir, 'subdir');
      const subFile = path.join(subDir, 'test.txt');
      await fs.mkdir(subDir, { mode: 0o777 });
      await fs.writeFile(subFile, 'test', { mode: 0o777 });

      await FileSystemSecurity.securePath(testDir);

      // Check permissions
      const dirStats = await fs.stat(subDir);
      const fileStats = await fs.stat(subFile);
      expect(dirStats.mode & 0o777).toBe(0o755);
      expect(fileStats.mode & 0o777).toBe(0o644);
    });

    it('should handle custom permissions', async () => {
      const dirPath = path.join(testDir, 'custom-dir');
      const filePath = path.join(dirPath, 'test.txt');
      await fs.mkdir(dirPath, { mode: 0o777 });
      await fs.writeFile(filePath, 'test', { mode: 0o777 });

      await FileSystemSecurity.securePath(testDir, {
        maxDirMode: 0o750,
        maxFileMode: 0o640,
      });

      const dirStats = await fs.stat(dirPath);
      const fileStats = await fs.stat(filePath);
      expect(dirStats.mode & 0o777).toBe(0o750);
      expect(fileStats.mode & 0o777).toBe(0o640);
    });
  });

  describe('checkResourceLimits', () => {
    it('should enforce file count limits', async () => {
      await expect(
        FileSystemSecurity.checkResourceLimits({
          type: 'write',
          path: path.join(testDir, 'test.txt'),
          maxFiles: 5,
          currentFiles: 6,
        })
      ).rejects.toThrow(SecurityError);
    });

    it('should enforce directory size limits', async () => {
      const filePath = path.join(testDir, 'large.txt');
      await fs.writeFile(filePath, Buffer.alloc(1024 * 1024)); // 1MB file

      await expect(
        FileSystemSecurity.checkResourceLimits({
          type: 'write',
          path: path.join(testDir, 'test.txt'),
          maxSize: 512 * 1024, // 512KB limit
        })
      ).rejects.toThrow(SecurityError);
    });

    it('should enforce file size limits for reads', async () => {
      const filePath = path.join(testDir, 'large.txt');
      await fs.writeFile(filePath, Buffer.alloc(1024 * 1024)); // 1MB file

      await expect(
        FileSystemSecurity.checkResourceLimits({
          type: 'read',
          path: filePath,
          maxSize: 512 * 1024, // 512KB limit
        })
      ).rejects.toThrow(SecurityError);
    });
  });
});
