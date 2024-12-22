import { jest } from '@jest/globals';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { DocumentationServer } from '../server.js';
import { DocSource, ValidCategory } from '../types/index.js';
import path from 'path';
import fs from 'fs/promises';

interface ServerResponse {
  content?: Array<{ type: string; text: string }>;
  headers?: Record<string, string>;
}

interface ServerRequest {
  params: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
}

interface ServerHandler {
  (request: ServerRequest): Promise<ServerResponse>;
}

interface ServerSchema {
  shape?: {
    method?: {
      value?: string;
    };
  };
}

type MockHandler = (schema: ServerSchema, handler: ServerHandler) => Promise<void>;
type MockConnect = () => Promise<void>;
type MockClose = () => Promise<void>;

interface MockServer {
  setRequestHandler: jest.MockedFunction<MockHandler>;
  connect: jest.MockedFunction<MockConnect>;
  close: jest.MockedFunction<MockClose>;
}

export class TestServer {
  private mockHandlers: Map<string, ServerHandler>;
  private mockServer: MockServer;
  private server: DocumentationServer;

  private constructor(server: DocumentationServer) {
    this.server = server;
    this.mockHandlers = new Map();

    const mockServer: MockServer = {
      setRequestHandler: jest.fn(async (schema: ServerSchema, handler: ServerHandler) => {
        const methodName = schema?.shape?.method?.value;
        if (methodName) {
          this.mockHandlers.set(methodName, handler);
        }
      }),
      connect: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
    };

    this.mockServer = mockServer;

    // Используем protected метод для установки мока
    this.setMockServer(mockServer as unknown as Server);
  }

  private setMockServer(mockServer: Server): void {
    // @ts-expect-error: Доступ к protected полю для тестирования
    this.server.server = mockServer;
  }

  static async createTestInstance(): Promise<TestServer> {
    // Создаем временную директорию для тестов
    const testDir = path.join(process.cwd(), 'test-data', `test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Установим переменные окружения
    process.env.STORAGE_PATH = testDir;
    process.env.MCP_ENV = 'local';

    const server = await DocumentationServer.start();
    return new TestServer(server);
  }

  async addTestDoc(doc: Partial<DocSource>): Promise<ServerResponse> {
    const fullDoc: DocSource = {
      name: doc.name || 'Test Doc',
      url: doc.url || 'https://example.com/doc',
      category: (doc.category as ValidCategory) || 'Base.Standards',
      description: doc.description || 'Test description',
      tags: doc.tags || ['test'],
      ...doc,
    };
    await (this.server as any).addDocumentation(fullDoc);
    return {
      content: [{ type: 'text', text: `Added documentation: ${fullDoc.name}` }],
    };
  }

  getStoragePath(): string {
    // @ts-expect-error: Доступ к protected полю для тестирования
    return this.server.fsManager.docsPath;
  }

  getMockHandler(name: string): ServerHandler {
    const handler = this.mockHandlers.get(name);
    if (!handler) {
      throw new Error(`Mock handler not found for: ${name}`);
    }
    return handler;
  }

  getMockServer(): MockServer {
    return this.mockServer;
  }

  getMockCalls(name: string): Array<Parameters<MockHandler>> {
    return this.mockServer.setRequestHandler.mock.calls.filter(
      (call): call is Parameters<MockHandler> =>
        call.length === 2 && call[0]?.shape?.method?.value === name
    );
  }

  getServer(): DocumentationServer {
    return this.server;
  }

  async listDocumentation(options: Record<string, unknown> = {}): Promise<ServerResponse> {
    const docs = await (this.server as any).listDocumentation(options);
    return {
      content: [{ type: 'text', text: JSON.stringify(docs) }],
    };
  }

  async searchDocumentation(options: {
    query: string;
    category?: ValidCategory;
    tag?: string;
  }): Promise<ServerResponse> {
    const docs = await (this.server as any).searchDocumentation(options);
    return {
      content: [{ type: 'text', text: JSON.stringify(docs) }],
    };
  }

  async updateDocumentation(options: { name: string; force?: boolean }): Promise<ServerResponse> {
    await (this.server as any).updateDocumentation(options);
    return {
      content: [{ type: 'text', text: `Updated documentation: ${options.name}` }],
    };
  }

  async removeDocumentation(name: string): Promise<ServerResponse> {
    await (this.server as any).removeDocumentation(name);
    return {
      content: [{ type: 'text', text: `Removed documentation: ${name}` }],
    };
  }
}
