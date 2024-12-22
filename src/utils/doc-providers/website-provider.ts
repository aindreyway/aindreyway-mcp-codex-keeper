import { DocSource } from '../../types/index.js';
import { BaseProvider } from './base-provider.js';
import { fetchContent } from '../content-fetcher.js';

export class WebsiteProvider extends BaseProvider {
  name = 'website';

  async fetchDocumentation(source: DocSource): Promise<string> {
    try {
      if (!source.url) {
        throw new Error('URL is required for website documentation source');
      }
      return await fetchContent(source.url);
    } catch (error) {
      return this.handleError(error as Error, source);
    }
  }

  validateSource(source: DocSource): boolean {
    return !!source.url && source.url.startsWith('http');
  }
}
