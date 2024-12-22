import { DocSource } from '../../types/index.js';
import { BaseProvider } from './base-provider.js';
import { fetchContent } from '../content-fetcher.js';

export class GithubProvider extends BaseProvider {
  name = 'github';

  async fetchDocumentation(source: DocSource): Promise<string> {
    try {
      if (!source.url || !source.url.includes('github.com')) {
        throw new Error('Valid GitHub URL is required');
      }

      // Convert github.com URL to raw.githubusercontent.com
      const rawUrl = source.url
        .replace('github.com', 'raw.githubusercontent.com')
        .replace('/blob/', '/');

      return await fetchContent(rawUrl);
    } catch (error) {
      return this.handleError(error as Error, source);
    }
  }

  validateSource(source: DocSource): boolean {
    return !!source.url && source.url.includes('github.com');
  }
}
