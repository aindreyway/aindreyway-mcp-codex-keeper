import { readFile } from 'fs/promises';
import { DocSource } from '../../types/index.js';
import { BaseProvider } from './base-provider.js';
import { InputSanitizer } from '../input-sanitizer.js';

export class LocalProvider extends BaseProvider {
  name = 'local';

  async fetchDocumentation(source: DocSource): Promise<string> {
    try {
      if (!source.path) {
        throw new Error('Local path is required for local documentation source');
      }

      const safePath = InputSanitizer.sanitizePath(source.path, process.cwd());
      return await readFile(safePath, 'utf-8');
    } catch (error) {
      return this.handleError(error as Error, source);
    }
  }

  validateSource(source: DocSource): boolean {
    return !!source.path;
  }
}
