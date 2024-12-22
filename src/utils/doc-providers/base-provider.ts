import { DocSource } from '../../types/index.js';

export abstract class BaseProvider {
  abstract name: string;

  abstract fetchDocumentation(source: DocSource): Promise<string>;

  abstract validateSource(source: DocSource): boolean;

  protected handleError(error: Error, source: DocSource): never {
    console.error(`Error in ${this.name} provider for ${source.name}:`, error);
    throw error;
  }
}
