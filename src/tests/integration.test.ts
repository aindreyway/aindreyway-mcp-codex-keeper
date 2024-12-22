import { TestServer } from './test-server.js';
import path from 'path';
import fs from 'fs/promises';

describe('MCP Integration Tests', () => {
  let testDir: string;
  let server: TestServer;

  beforeEach(async () => {
    // Создаем тестовую директорию в безопасном месте
    testDir = path.join(
      process.cwd(),
      'test-data',
      `mcp-codex-keeper-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.mkdir(testDir, { recursive: true });

    // Настраиваем окружение для тестов
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      MCP_ENV: 'test',
      STORAGE_PATH: testDir,
      NODE_ENV: 'test',
    };

    // Создаем тестовый сервер
    server = await TestServer.createTestInstance();
  });

  afterEach(async () => {
    // Очищаем тестовую директорию
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to cleanup test directory:', error);
    }

    // Восстанавливаем моки
    jest.restoreAllMocks();
  });

  describe('Tool Execution Flow', () => {
    it('should handle complete documentation workflow', async () => {
      // 1. Add documentation
      const addResult = await server.addTestDoc({
        name: 'Test Doc',
        url: 'https://example.com/doc',
        category: 'Base.Standards',
        description: 'Test description',
        tags: ['test', 'integration'],
      });
      expect(addResult.content?.[0].text).toBe('Added documentation: Test Doc');

      // 2. List documentation
      const listResult = await server.listDocumentation({});
      const docs = JSON.parse(listResult.content?.[0].text || '[]');
      expect(docs).toContainEqual(
        expect.objectContaining({
          name: 'Test Doc',
          category: 'Base.Standards',
        })
      );

      // 3. Search documentation
      const searchResult = await server.searchDocumentation({
        query: 'test',
        category: 'Base.Standards',
      });
      const searchDocs = JSON.parse(searchResult.content?.[0].text || '[]');
      expect(searchDocs).toContainEqual(
        expect.objectContaining({
          name: 'Test Doc',
        })
      );

      // 4. Update documentation
      const updateResult = await server.updateDocumentation({
        name: 'Test Doc',
        force: true,
      });
      expect(updateResult.content?.[0].text).toBe('Updated documentation: Test Doc');

      // 5. Remove documentation
      const removeResult = await server.removeDocumentation('Test Doc');
      expect(removeResult.content?.[0].text).toBe('Removed documentation: Test Doc');

      // 6. Verify removal
      const finalListResult = await server.listDocumentation({});
      const finalDocs = JSON.parse(finalListResult.content?.[0].text || '[]');
      expect(finalDocs).not.toContainEqual(
        expect.objectContaining({
          name: 'Test Doc',
        })
      );
    });
  });

  describe('MCP Protocol Compliance', () => {
    it('should handle tool requests according to MCP protocol', async () => {
      // Проверяем обработчик list_tools
      const listToolsHandler = server.getMockHandler('list_tools');
      const toolList = await listToolsHandler({ params: {} });
      expect(toolList).toEqual({
        tools: expect.arrayContaining([
          expect.objectContaining({
            name: expect.any(String),
            description: expect.any(String),
            inputSchema: expect.any(Object),
          }),
        ]),
      });

      // Проверяем обработчик call_tool
      const callToolHandler = server.getMockHandler('call_tool');
      const toolCall = await callToolHandler({
        params: {
          name: 'list_documentation',
          arguments: {},
        },
      });

      expect(toolCall).toEqual({
        content: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.any(String),
          }),
        ]),
      });
    });

    it('should handle resource requests according to MCP protocol', async () => {
      // Проверяем обработчик list_resources
      const listResourcesHandler = server.getMockHandler('list_resources');
      const resourceList = await listResourcesHandler({ params: {} });
      expect(resourceList).toEqual({
        resources: expect.arrayContaining([
          expect.objectContaining({
            uri: expect.any(String),
            name: expect.any(String),
            description: expect.any(String),
            mimeType: expect.any(String),
          }),
        ]),
      });

      // Проверяем обработчик read_resource
      const readResourceHandler = server.getMockHandler('read_resource');
      const resourceRead = await readResourceHandler({
        params: {
          name: 'read_resource',
          arguments: {
            uri: 'docs://sources',
          },
        },
      });

      expect(resourceRead).toEqual({
        contents: expect.arrayContaining([
          expect.objectContaining({
            uri: 'docs://sources',
            mimeType: 'application/json',
            text: expect.any(String),
          }),
        ]),
      });
    });
  });

  describe('Error Handling Scenarios', () => {
    it('should handle invalid tool requests', async () => {
      const callToolHandler = server.getMockHandler('call_tool');
      await expect(
        callToolHandler({
          params: {
            name: 'nonexistent_tool',
            arguments: {},
          },
        })
      ).rejects.toThrow();
    });

    it('should handle invalid resource requests', async () => {
      const readResourceHandler = server.getMockHandler('read_resource');
      await expect(
        readResourceHandler({
          params: {
            name: 'read_resource',
            arguments: {
              uri: 'invalid://resource',
            },
          },
        })
      ).rejects.toThrow();
    });

    it('should handle network errors during documentation update', async () => {
      // Add test doc
      await server.addTestDoc({
        name: 'Test Doc',
        url: 'https://example.com/doc',
        category: 'Base.Standards',
        description: 'Test description',
      });

      // Mock network error
      jest.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      // Attempt update
      await expect(
        server.updateDocumentation({
          name: 'Test Doc',
          force: true,
        })
      ).rejects.toThrow();
    });
  });

  describe('Mode Switching Tests', () => {
    it('should handle mode-specific behavior', async () => {
      // Test local mode
      process.env.MCP_ENV = 'local';
      const localServer = await TestServer.createTestInstance();
      const localDocServer = localServer.getServer();
      expect((localDocServer as any).isLocal).toBe(true);

      // Test production mode
      process.env.MCP_ENV = 'production';
      const prodServer = await TestServer.createTestInstance();
      const prodDocServer = prodServer.getServer();
      expect((prodDocServer as any).isLocal).toBe(false);

      // Verify different storage paths
      expect(localServer.getStoragePath()).not.toBe(prodServer.getStoragePath());
    });

    it('should use appropriate logging format per mode', async () => {
      const consoleError = jest.spyOn(console, 'error');

      // Test local mode logging
      process.env.MCP_ENV = 'local';
      await TestServer.createTestInstance();
      expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[LOCAL VERSION]'));

      // Test production mode logging
      process.env.MCP_ENV = 'production';
      await TestServer.createTestInstance();
      expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('[LOCAL VERSION]'));
    });
  });
});