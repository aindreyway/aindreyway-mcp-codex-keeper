import { DocumentationServer } from '../../../server.js';
import { FileSystemManager } from '../../../utils/fs.js';
import { ContentFetcher } from '../../../utils/content-fetcher.js';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Mock MCP SDK
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    setRequestHandler: jest.fn(),
    close: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}));

describe('DocumentationServer', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create temp test directory with unique instance ID
    const testInstanceId = Math.random().toString(36).slice(2);
    testDir = path.join(
      os.tmpdir(),
      `mcp-codex-keeper-test-${Date.now()}-${testInstanceId}`
    );
    await fs.mkdir(testDir, { recursive: true });

    // Set environment variables for testing with unique instance
    process.env.MCP_ENV = 'local';
    process.env.STORAGE_PATH = testDir;
    process.env.TEST_INSTANCE_ID = testInstanceId;
    process.env.TEST_INSTANCE_ID = Math.random().toString(36).slice(2);
  });

  afterEach(async () => {
    // Cleanup and restore environment
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup test directory:', error);
    }
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('Server Initialization', () => {
    it('should initialize server with default documentation when no existing docs', async () => {
      const server = await DocumentationServer.start();
      expect(server).toBeDefined();

      // Check if default docs were loaded
      const docs = await fs.readFile(path.join(testDir, 'sources.json'), 'utf-8');
      const parsedDocs = JSON.parse(docs);
      expect(parsedDocs).toHaveLength(8); // Default docs count
      expect(parsedDocs[0].name).toBe('SOLID Principles Guide');
    });

    it('should use existing documentation if available', async () => {
      // Create existing docs
      const existingDocs = [
        {
          name: 'Test Doc',
          url: 'https://example.com/test',
          category: 'Standards',
          description: 'Test documentation',
        },
      ];

      await fs.mkdir(path.join(testDir, 'metadata'), { recursive: true });
      await fs.writeFile(path.join(testDir, 'sources.json'), JSON.stringify(existingDocs));

      const server = await DocumentationServer.start();
      expect(server).toBeDefined();

      // Check if existing docs were loaded
      const docs = await fs.readFile(path.join(testDir, 'sources.json'), 'utf-8');
      const parsedDocs = JSON.parse(docs);
      expect(parsedDocs).toHaveLength(1);
      expect(parsedDocs[0].name).toBe('Test Doc');
    });
  });

  describe('Documentation Management', () => {
    let server: DocumentationServer;

    beforeEach(async () => {
      server = await DocumentationServer.start();
    });

    it('should add new documentation', async () => {
      // Helper function to add or update doc with retry logic
      const addOrUpdateDoc = async () => {
        try {
          return await server['addDocumentation']({
            name: 'Test Doc',
            url: 'https://example.com/test',
            category: 'Standards',
            description: 'Test documentation',
          });
        } catch (error: any) {
          if (error.message?.includes('already exists')) {
            return await server['updateDocumentation']({ name: 'Test Doc', force: true });
          }
          throw error;
        }
      };

      const result = await addOrUpdateDoc();
      expect(result.content[0].text).toMatch(/Added|Updated documentation: Test Doc/);

      // Verify doc was saved
      const docs = await fs.readFile(path.join(testDir, 'sources.json'), 'utf-8');
      const parsedDocs = JSON.parse(docs);
      const addedDoc = parsedDocs.find((doc: any) => doc.name === 'Test Doc');
      expect(addedDoc).toBeDefined();
      expect(addedDoc.url).toBe('https://example.com/test');
    });

    it('should update existing documentation', async () => {
      // Helper function to add or update doc with retry logic
      const addOrUpdateDoc = async (url: string, description: string) => {
        try {
          return await server['addDocumentation']({
            name: 'Test Doc',
            url,
            category: 'Standards',
            description,
          });
        } catch (error: any) {
          if (error.message?.includes('already exists')) {
            return await server['updateDocumentation']({ name: 'Test Doc', force: true });
          }
          throw error;
        }
      };

      // First add doc
      await addOrUpdateDoc('https://example.com/test', 'Test documentation');

      // Then update it with new content
      const result = await addOrUpdateDoc('https://example.com/test2', 'Updated documentation');

      expect(result.content[0].text).toBe('Updated documentation: Test Doc');

      // Verify doc was updated
      const docs = await fs.readFile(path.join(testDir, 'sources.json'), 'utf-8');
      const parsedDocs = JSON.parse(docs);
      const updatedDoc = parsedDocs.find((doc: any) => doc.name === 'Test Doc');
      expect(updatedDoc.url).toBe('https://example.com/test2');
      expect(updatedDoc.description).toBe('Updated documentation');
    });

    it('should remove documentation', async () => {
      // First add doc
      await server['addDocumentation']({
        name: 'Test Doc',
        url: 'https://example.com/test',
        category: 'Standards',
        description: 'Test documentation',
      });

      // Then remove it
      const result = await server['removeDocumentation']('Test Doc');
      expect(result.content[0].text).toBe('Removed documentation: Test Doc');

      // Verify doc was removed
      const docs = await fs.readFile(path.join(testDir, 'sources.json'), 'utf-8');
      const parsedDocs = JSON.parse(docs);
      const removedDoc = parsedDocs.find((doc: any) => doc.name === 'Test Doc');
      expect(removedDoc).toBeUndefined();
    });
  });

  describe('Search and Filtering', () => {
    let server: DocumentationServer;

    beforeEach(async () => {
      server = await DocumentationServer.start();

      // Helper function to add or update doc with retry logic
      const addOrUpdateDoc = async (name: string, category: string, tags: string[], description: string) => {
        try {
          return await server['addDocumentation']({
            name,
            url: `https://example.com/${name.toLowerCase().replace(' ', '')}`,
            category,
            tags,
            description,
          });
        } catch (error: any) {
          if (error.message?.includes('already exists')) {
            return await server['updateDocumentation']({ name, force: true });
          }
          throw error;
        }
      };

      // Add test docs with retry logic
      await Promise.all([
        addOrUpdateDoc('Test Doc 1', 'Standards', ['test', 'documentation'], 'Test documentation one'),
        addOrUpdateDoc('Test Doc 2', 'Tools', ['test', 'tools'], 'Test documentation two'),
      ]);
    });

    it('should list documentation with category filter', async () => {
      const result = await server['listDocumentation']({ category: 'Standards' });
      const docs = JSON.parse(result.content[0].text);
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe('Test Doc 1');
    });

    it('should list documentation with tag filter', async () => {
      const result = await server['listDocumentation']({ tag: 'tools' });
      const docs = JSON.parse(result.content[0].text);
      expect(docs).toHaveLength(1);
      expect(docs[0].name).toBe('Test Doc 2');
    });

    it('should search documentation content', async () => {
      // Mock FileSystemManager's searchInDocumentation
      const mockSearch = jest
        .spyOn(FileSystemManager.prototype, 'searchInDocumentation')
        .mockResolvedValue([{ line: 1, content: 'test match', context: ['test line'] }]);

      const result = await server['searchDocumentation']({
        query: 'test',
        category: 'Standards',
      });

      const searchResults = JSON.parse(result.content[0].text);
      expect(searchResults).toHaveLength(1);
      expect(searchResults[0].name).toBe('Test Doc 1');

      mockSearch.mockRestore();
    });
  });

  describe('Error Handling', () => {
    let server: DocumentationServer;

    beforeEach(async () => {
      server = await DocumentationServer.start();
    });

    it('should handle invalid documentation name on remove', async () => {
      await expect(server['removeDocumentation']('NonExistent')).rejects.toThrow(
        'Documentation "NonExistent" not found'
      );
    });

    it('should handle invalid documentation name on update', async () => {
      await expect(server['updateDocumentation']({ name: 'NonExistent' })).rejects.toThrow(
        'Documentation "NonExistent" not found'
      );
    });

    it('should handle fetch errors during update', async () => {
      // Add test doc first
      await server['addDocumentation']({
        name: 'Test Doc',
        url: 'https://example.com/test',
        category: 'Standards',
        description: 'Test documentation',
      });

      // Mock ContentFetcher to throw error
      jest
        .spyOn(ContentFetcher.prototype, 'fetchContent')
        .mockRejectedValue(new Error('Fetch failed'));

      await expect(server['updateDocumentation']({ name: 'Test Doc' })).rejects.toThrow(
        'Failed to update documentation: Fetch failed'
      );
    });
  });
});
