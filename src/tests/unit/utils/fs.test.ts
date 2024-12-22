import fs from 'fs/promises';
import path from 'path';
import { FileSystemManager } from '../../../utils/fs.js';

// Test class for accessing protected members
class TestFileSystemManager extends FileSystemManager {
  setContentFetcher(fetcher: any) {
    this.contentFetcher = fetcher;
  }

  getContentFetcher() {
    return this.contentFetcher;
  }
}

describe('FileSystemManager', () => {
  let fsManager: TestFileSystemManager;
  let testDir: string;

  beforeEach(async () => {
    // Create temp test directory
    testDir = path.join(
      process.cwd(),
      'test-data',
      'mcp-codex-keeper-test-' + Math.random().toString(36).slice(2)
    );
    await fs.mkdir(testDir, { recursive: true });
    fsManager = new TestFileSystemManager(testDir);
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('File Path Handling', () => {
    it('should handle valid file names', async () => {
      const testCases = [
        {
          name: 'Simple name',
          input: 'test document',
          content: 'test content',
        },
        {
          name: 'Special characters',
          input: 'test@#$%^&* document',
          content: 'test content',
        },
        {
          name: 'URL-like string',
          input: 'https://example.com/doc',
          content: 'test content',
        },
      ];

      for (const { input, content } of testCases) {
        // Сохраняем документ
        await fsManager.saveDocumentation(input, content);

        // Проверяем, что документ существует
        const exists = await fsManager.hasDocumentation(input);
        expect(exists).toBeTrue();
      }
    });

    it('should prevent path traversal', async () => {
      const maliciousNames = [
        '../../../etc/passwd',
        '..\\..\\Windows\\System32',
        '/etc/passwd',
        'C:\\Windows\\System32',
        '../../secret.txt',
      ];

      for (const input of maliciousNames) {
        // Сохраняем документ
        await fsManager.saveDocumentation(input, 'test content');

        // Проверяем, что документ существует
        const exists = await fsManager.hasDocumentation(input);
        expect(exists).toBeTrue();

        // Проверяем, что путь безопасный
        const files = await fs.readdir(fsManager.getCachePath());
        for (const file of files) {
          expect(file).not.toInclude('..');
          const fullPath = path.join(fsManager.getCachePath(), file);
          expect(fullPath.startsWith(fsManager.getCachePath())).toBeTrue();
        }
      }
    });

    it('should handle non-printable characters', async () => {
      const testCases = [
        'test\x00doc\x01ument\x1F',
        'file\x00name\n\t\rwith\x1Fspaces',
        '\x00\x01\x02test\x1F\x1E\x1D',
      ];

      for (const input of testCases) {
        // Сохраняем документ
        await fsManager.saveDocumentation(input, 'test content');

        // Проверяем, что документ существует
        const exists = await fsManager.hasDocumentation(input);
        expect(exists).toBeTrue();

        // Проверяем, что файл существует и содержит контент
        const files = await fs.readdir(fsManager.getCachePath());
        expect(files.length).toBeGreaterThan(0);

        // Читаем содержимое файла
        const filePath = path.join(fsManager.getCachePath(), files[0]);
        const content = await fs.readFile(filePath, 'utf-8');
        expect(content).toBe('test content');
      }
    });
  });

  describe('searchInDocumentation', () => {
    beforeEach(async () => {
      // Create test document
      const content = `
First line of the document
Second line with some test content
Third line for more context
Fourth line with test word
Fifth line at the end
      `.trim();

      await fsManager.saveDocumentation('test-doc', content);
    });

    it('should find matches with context', async () => {
      const results = await fsManager.searchInDocumentation('test-doc', 'test');
      expect(results.length).toBeGreaterThan(0);

      // Check first result
      const firstResult = results[0];
      expect(firstResult.content).toContain('test');
      expect(firstResult.context.length).toBeGreaterThan(1);
    });

    it('should return empty array for no matches', async () => {
      const results = await fsManager.searchInDocumentation('test-doc', 'nonexistent');
      expect(results).toEqual([]);
    });

    it('should handle case-insensitive search', async () => {
      const results = await fsManager.searchInDocumentation('test-doc', 'TEST');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('updateDocumentation', () => {
    it('should handle URL content with eTag and lastModified', async () => {
      // Mock ContentFetcher
      const mockContent = 'test content';
      const mockETag = '"123456"';
      const mockLastModified = 'Wed, 21 Oct 2023 07:28:00 GMT';

      fsManager.setContentFetcher({
        fetchContent: jest.fn().mockResolvedValue({
          content: mockContent,
          contentType: 'text/plain',
          timestamp: new Date().toISOString(),
          eTag: mockETag,
          lastModified: mockLastModified,
          notModified: false,
        }),
      });

      // Initial save
      await fsManager.saveDocumentation('test-doc', new URL('https://example.com/doc'));

      // Get metadata and verify resource info
      const docMetadata = await fsManager.getDocumentMetadata('test-doc');
      expect(docMetadata?.resource).toBeDefined();
      expect(docMetadata?.resource?.hash).toBeDefined();
      expect(docMetadata?.resource?.eTag).toBe(mockETag);
      expect(docMetadata?.resource?.lastModified).toBe(mockLastModified);

      // Force update
      await fsManager.saveDocumentation(
        'test-doc',
        new URL('https://example.com/doc'),
        undefined,
        false
      );

      // Verify ContentFetcher was called with correct headers
      const contentFetcher = fsManager.getContentFetcher();
      expect(contentFetcher.fetchContent).toHaveBeenCalledTimes(2);
      const secondCallHeaders = (contentFetcher.fetchContent as jest.Mock).mock.calls[1][1];
      expect(secondCallHeaders['If-None-Match']).toBe(mockETag);
      expect(secondCallHeaders['If-Modified-Since']).toBe(mockLastModified);
    });

    it('should handle non-URL content correctly', async () => {
      const mockContent = 'test content';

      // Save string content
      await fsManager.saveDocumentation('test-doc', mockContent);

      // Get metadata and verify no resource info
      const docMetadata = await fsManager.getDocumentMetadata('test-doc');
      expect(docMetadata?.resource?.eTag).toBeUndefined();
      expect(docMetadata?.resource?.lastModified).toBeUndefined();
    });
  });
});
