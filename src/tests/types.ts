import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { DocSource } from '../types/index.js';

export interface MockServer extends Partial<Server> {
  mockHandlers?: Map<string, Function>;
}

export interface TestDocumentationServer {
  server: MockServer;
  isLocal: boolean;
  fsManager: {
    storagePath: string;
  };
  addDocumentation(doc: Partial<DocSource>): Promise<any>;
  listDocumentation(options: any): Promise<any>;
  searchDocumentation(options: any): Promise<any>;
  updateDocumentation(options: any): Promise<any>;
  removeDocumentation(name: string): Promise<any>;
}
