import { JSDOM } from 'jsdom';
import path from 'path';
import TurndownService from 'turndown';
import { FileSystemError } from './fs.js';
import { InputSanitizer } from './input-sanitizer.js';
import { LogContext, logger } from './logger.js';

// Constants for HTML processing
const HTML_SIZE_LIMITS = {
  WARN: 500 * 1024, // 500KB
  ERROR: 2 * 1024 * 1024, // 2MB
  MAX: 5 * 1024 * 1024, // 5MB absolute max
};

const IMPORTANT_HTML_SECTIONS = [
  'main',
  'article',
  'section',
  '.content',
  '#content',
  '.documentation',
  '#documentation',
];

export enum ContentType {
  HTML = 'text/html',
  MARKDOWN = 'text/markdown',
  JSON = 'application/json',
  RAW = 'text/plain',
}

export interface FetchResult {
  content: string;
  contentType: ContentType;
  timestamp?: string;
  eTag?: string;
  lastModified?: string;
  notModified?: boolean;
  metadata?: {
    title?: string;
    description?: string;
    format?: string;
    source?: string;
    tags?: string[];
    category?: string;
  };
}

interface FetcherConfig {
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  maxSize?: number;
}

export interface McpDocMetadata {
  title: string;
  description?: string;
  category: string;
  section?: string;
  tags: string[];
  relatedDocs?: string[];
  lastChecked: string;
  lastModified?: string;
}

// Default configuration
const DEFAULT_CONFIG: FetcherConfig = {
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 10000,
  maxSize: 10 * 1024 * 1024, // 10MB
};

// Singleton instance
let instance: ContentFetcher | null = null;

export class ContentFetcher {
  private config: FetcherConfig;
  private turndown: TurndownService;
  private knownMcpDocs: Map<string, McpDocMetadata> = new Map();
  private mcpBaseUrl: string = 'https://modelcontextprotocol.io/docs';

  static getInstance(config?: FetcherConfig): ContentFetcher {
    if (!instance) {
      instance = new ContentFetcher(config || DEFAULT_CONFIG);
    }
    return instance;
  }

  constructor(config: FetcherConfig) {
    this.config = {
      maxSize: 10 * 1024 * 1024, // 10MB
      ...config,
    };
    this.turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
  }

  async fetchContent(url: string, headers: Record<string, string> = {}): Promise<FetchResult> {
    const safeUrl = InputSanitizer.sanitizeUrl(url);
    let lastError: Error | undefined;

    const logContext: LogContext = {
      component: 'ContentFetcher',
      operation: 'fetchContent',
      url: safeUrl,
      attempt: 0,
      headers: Object.keys(headers),
    };

    logger.debug('Starting content fetch', logContext);

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      logContext.attempt = attempt;
      try {
        if (safeUrl.startsWith('file://')) {
          return await this.handleFileProtocol(safeUrl);
        } else if (safeUrl.includes('gist.github.com')) {
          return await this.handleGistUrl(safeUrl, headers);
        } else if (safeUrl.includes('github.com')) {
          return await this.handleGitHubUrl(safeUrl, headers);
        } else if (safeUrl.includes('npmjs.com')) {
          return await this.handleNpmUrl(safeUrl, headers);
        }

        // Default HTTP(S) handling
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(safeUrl, {
          signal: controller.signal,
          headers: {
            ...headers,
            Accept: '*/*',
          },
        });

        // Check content length
        const contentLength = parseInt(response.headers.get('content-length') || '0');
        if (contentLength > this.config.maxSize!) {
          const error = `Content too large: ${contentLength} bytes`;
          logger.error(error, {
            ...logContext,
            contentLength,
            maxSize: this.config.maxSize,
          });
          throw new Error(error);
        }

        logger.debug('Content length check passed', {
          ...logContext,
          contentLength,
        });

        // Handle 304 Not Modified
        if (response.status === 304) {
          logger.info('Content not modified', logContext);
          return {
            content: '',
            contentType: this.detectContentType(safeUrl),
            timestamp: new Date().toISOString(),
            notModified: true,
          };
        }

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = `HTTP error! status: ${response.status}`;
          logger.error(error, {
            ...logContext,
            status: response.status,
            statusText: response.statusText,
          });
          throw new Error(error);
        }

        const content = await response.text();
        const contentType = this.detectContentType(safeUrl);

        logger.debug('Content received', {
          ...logContext,
          contentType,
          contentLength: content.length,
        });

        // Process content based on type
        let processedContent = content;
        let metadata = {};

        if (contentType === ContentType.HTML) {
          const { content: processed, metadata: meta } = await this.processHtml(content, safeUrl);
          processedContent = processed;
          metadata = meta;
        }

        return {
          content: processedContent,
          contentType,
          timestamp: new Date().toISOString(),
          eTag: response.headers.get('etag') || undefined,
          lastModified: response.headers.get('last-modified') || undefined,
          notModified: false,
          metadata,
        };
      } catch (error) {
        lastError = error as Error;
        logger.warn(`Fetch attempt ${attempt} failed`, {
          ...logContext,
          error: lastError,
        });

        if (attempt < this.config.maxRetries) {
          const delay = this.config.retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
          logger.debug(`Retrying after ${delay}ms`, logContext);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    const errorMessage = `Failed to fetch content after ${this.config.maxRetries} attempts: ${lastError?.message}`;
    logger.error(errorMessage, {
      ...logContext,
      error: lastError,
      totalAttempts: this.config.maxRetries,
    });
    throw new Error(errorMessage);
  }

  private async handleFileProtocol(url: string): Promise<FetchResult> {
    const filePath = decodeURIComponent(url.replace('file://', ''));
    const safePath = InputSanitizer.sanitizePath(filePath, process.cwd());

    const logContext: LogContext = {
      component: 'ContentFetcher',
      operation: 'handleFileProtocol',
      url,
      filePath: safePath,
    };

    logger.debug('Reading local file', logContext);

    try {
      const fs = await import('fs/promises');
      const content = await fs.readFile(safePath, 'utf-8');
      const contentType = this.detectContentType(safePath);

      logger.debug('File read successfully', {
        ...logContext,
        contentType,
        contentLength: content.length,
      });

      // Process content based on type
      let processedContent = content;
      let metadata = {
        source: 'local',
        title: path.basename(safePath),
      };

      if (contentType === ContentType.HTML) {
        const { content: processed, metadata: meta } = await this.processHtml(content, safePath);
        processedContent = processed;
        metadata = { ...metadata, ...meta };
      }

      return {
        content: processedContent,
        contentType,
        timestamp: new Date().toISOString(),
        metadata,
      };
    } catch (error) {
      const errorMessage = 'Failed to read local file';
      logger.error(errorMessage, {
        ...logContext,
        error: error as Error,
      });
      throw new FileSystemError(errorMessage, error);
    }
  }

  private async handleGistUrl(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<FetchResult> {
    const logContext: LogContext = {
      component: 'ContentFetcher',
      operation: 'handleGistUrl',
      url,
      headers: Object.keys(headers),
    };

    logger.debug('Fetching from GitHub Gist', logContext);

    // Extract gist ID from URL
    const gistId = url.split('/').pop();
    if (!gistId) {
      throw new Error('Invalid Gist URL');
    }

    // Get gist content using GitHub API
    const apiUrl = `https://api.github.com/gists/${gistId}`;
    logger.debug('Using GitHub Gist API URL', { ...logContext, apiUrl });

    const response = await fetch(apiUrl, {
      headers: {
        ...headers,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('rate limit exceeded');
    } else if (!response.ok) {
      const error = `Failed to fetch from GitHub Gist: ${response.statusText}`;
      logger.error(error, {
        ...logContext,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(error);
    }

    const gistData = await response.json();
    const files = gistData.files;
    const firstFile = Object.values(files)[0] as any;
    const content = firstFile.content;
    const filename = firstFile.filename;

    logger.debug('Gist content received', {
      ...logContext,
      filename,
      contentLength: content.length,
    });

    return {
      content,
      contentType: this.detectContentType(filename),
      timestamp: new Date().toISOString(),
      eTag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      notModified: false,
      metadata: {
        source: 'github-gist',
        title: filename,
        description: gistData.description,
      },
    };
  }

  private async handleGitHubUrl(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<FetchResult> {
    // Parse GitHub URL components
    const urlParts = url.split('/');
    const owner = urlParts[3];
    const repo = urlParts[4];
    const branch = urlParts[6] || 'main';
    const path = urlParts.slice(7).join('/');

    const logContext: LogContext = {
      component: 'ContentFetcher',
      operation: 'handleGitHubUrl',
      url,
      owner,
      repo,
      branch,
      path,
      headers: Object.keys(headers),
    };

    logger.debug('Fetching from GitHub', logContext);

    // Get file content using GitHub API
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
    logger.debug('Using GitHub API URL', { ...logContext, apiUrl });

    const response = await fetch(apiUrl, {
      headers: {
        ...headers,
        Accept: 'application/vnd.github.v3.raw+json',
      },
    });

    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      throw new Error('rate limit exceeded');
    } else if (!response.ok) {
      const error = `Failed to fetch from GitHub: ${response.statusText}`;
      logger.error(error, {
        ...logContext,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(error);
    }

    logger.debug('GitHub API response received', {
      ...logContext,
      status: response.status,
      headers: Object.keys(response.headers),
    });

    const content = await response.text();
    const contentType = this.detectContentType(path);

    logger.debug('GitHub content received', {
      ...logContext,
      contentType,
      contentLength: content.length,
    });

    // Process content based on type
    let processedContent = content;
    let metadata = {
      source: 'github',
      title: path.split('/').pop() || '',
    };

    if (contentType === ContentType.HTML) {
      const { content: processed, metadata: meta } = await this.processHtml(content, url);
      processedContent = processed;
      metadata = { ...metadata, ...meta };
    }

    return {
      content: processedContent,
      contentType,
      timestamp: new Date().toISOString(),
      eTag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined,
      notModified: false,
      metadata,
    };
  }

  private async handleNpmUrl(
    url: string,
    headers: Record<string, string> = {}
  ): Promise<FetchResult> {
    const logContext: LogContext = {
      component: 'ContentFetcher',
      operation: 'handleNpmUrl',
      url,
      headers: Object.keys(headers),
    };

    logger.debug('Processing NPM URL', logContext);

    // Extract package name and file path
    const matches = url.match(/npmjs.com\/package\/(@?[^/]+\/[^/]+)(?:\/([^?#]+))?/);
    if (!matches) {
      const error = 'Invalid NPM URL';
      logger.error(error, logContext);
      throw new Error(error);
    }

    const [, packageName, filePath = 'README.md'] = matches;
    logger.debug('Extracted package info', {
      ...logContext,
      packageName,
      filePath,
    });

    // Get package metadata from npm registry
    const registryUrl = `https://registry.npmjs.org/${packageName}`;
    logger.debug('Fetching NPM metadata', {
      ...logContext,
      registryUrl,
    });

    const response = await fetch(registryUrl);

    if (!response.ok) {
      const error = `Failed to fetch package metadata: ${response.statusText}`;
      logger.error(error, {
        ...logContext,
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(error);
    }

    const metadata = await response.json();
    const repoUrl = metadata.repository?.url;

    if (!repoUrl) {
      const error = 'Package repository not found';
      logger.error(error, {
        ...logContext,
        packageMetadata: metadata,
      });
      throw new Error(error);
    }

    logger.debug('Found repository URL', {
      ...logContext,
      repoUrl,
    });

    // Convert to GitHub URL and fetch
    const githubUrl =
      repoUrl.replace('git+', '').replace('.git', '').replace('git:', 'https:') +
      '/blob/master/' +
      filePath;

    logger.debug('Converting to GitHub URL', {
      ...logContext,
      githubUrl,
    });

    return this.handleGitHubUrl(githubUrl, headers);
  }

  private async processHtml(
    html: string,
    url: string
  ): Promise<{ content: string; metadata: any }> {
    const logContext: LogContext = {
      component: 'ContentFetcher',
      operation: 'processHtml',
      url,
      contentSize: html.length,
    };

    // Check content size
    if (html.length > HTML_SIZE_LIMITS.MAX) {
      logger.error('HTML content exceeds maximum size limit', {
        ...logContext,
        limit: HTML_SIZE_LIMITS.MAX,
      });
      throw new Error('Content too large for processing');
    }

    if (html.length > HTML_SIZE_LIMITS.ERROR) {
      logger.error('HTML content is very large', {
        ...logContext,
        limit: HTML_SIZE_LIMITS.ERROR,
      });
    } else if (html.length > HTML_SIZE_LIMITS.WARN) {
      logger.warn('HTML content is large', {
        ...logContext,
        limit: HTML_SIZE_LIMITS.WARN,
      });
    }

    logger.debug('Starting HTML processing', logContext);

    const dom = new JSDOM(html);
    const { document } = dom.window;

    // Remove unwanted elements
    const unwantedElements = ['script', 'style', 'iframe', 'nav', 'footer', 'header', 'aside'];
    let removedElements = 0;
    unwantedElements.forEach(tag => {
      const elements = document.querySelectorAll(tag);
      elements.forEach(el => el.remove());
      removedElements += elements.length;
    });

    logger.debug('Removed unwanted elements', {
      ...logContext,
      removedElements,
      elementTypes: unwantedElements,
    });

    // Try to find main content section
    let mainContent: Element | null = null;
    for (const selector of IMPORTANT_HTML_SECTIONS) {
      mainContent = document.querySelector(selector);
      if (mainContent) {
        logger.debug('Found main content section', {
          ...logContext,
          selector,
          contentLength: mainContent.innerHTML.length,
        });
        break;
      }
    }

    const content = mainContent ? mainContent.innerHTML : document.body.innerHTML;

    // Extract metadata
    const metadata = {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content'),
      format: 'html',
      originalSize: html.length,
      processedSize: content.length,
      mainContentSelector: mainContent
        ? IMPORTANT_HTML_SECTIONS.find(s => document.querySelector(s))
        : null,
      headings: Array.from(document.querySelectorAll('h1, h2, h3')).map(h => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim(),
      })),
    };

    logger.debug('Extracted metadata', {
      ...logContext,
      metadata: {
        ...metadata,
        headings: metadata.headings.length,
      },
    });

    // Convert to Markdown
    const markdown = this.turndown.turndown(content);

    logger.info('Successfully processed HTML content', {
      ...logContext,
      originalSize: html.length,
      markdownSize: markdown.length,
      compressionRatio: (((html.length - markdown.length) / html.length) * 100).toFixed(1) + '%',
    });

    return {
      content: markdown,
      metadata,
    };
  }

  /**
   * Discover and fetch all MCP documentation
   */
  async discoverMcpDocs(): Promise<Map<string, FetchResult>> {
    const results = new Map<string, FetchResult>();
    const toVisit = new Set([this.mcpBaseUrl]);
    const visited = new Set<string>();

    while (toVisit.size > 0) {
      const url = Array.from(toVisit)[0];
      toVisit.delete(url);

      if (visited.has(url)) continue;
      visited.add(url);

      try {
        const result = await this.fetchContent(url);
        results.set(url, result);

        // Extract links to other MCP docs
        const links = this.extractMcpLinks(result.content, url);
        for (const link of links) {
          if (!visited.has(link)) {
            toVisit.add(link);
          }
        }

        // Extract and store metadata
        const metadata = this.extractMcpMetadata(result.content, url);
        this.knownMcpDocs.set(url, metadata);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Failed to fetch MCP doc: ${url}`, error);
      }
    }

    return results;
  }

  /**
   * Extract links to other MCP documentation pages
   */
  private extractMcpLinks(content: string, baseUrl: string): string[] {
    const links = new Set<string>();

    // Extract markdown links
    const markdownLinks = content.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
    for (const link of markdownLinks) {
      const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match) {
        const [, , href] = match;
        const fullUrl = new URL(href, baseUrl).toString();
        if (this.isMcpDocUrl(fullUrl)) {
          links.add(fullUrl);
        }
      }
    }

    // Extract HTML links
    const dom = new JSDOM(content);
    const { document } = dom.window;
    document.querySelectorAll('a').forEach(a => {
      const href = a.getAttribute('href');
      if (href) {
        const fullUrl = new URL(href, baseUrl).toString();
        if (this.isMcpDocUrl(fullUrl)) {
          links.add(fullUrl);
        }
      }
    });

    return Array.from(links);
  }

  /**
   * Check if URL is an MCP documentation page
   */
  private isMcpDocUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.hostname === 'modelcontextprotocol.io' &&
        urlObj.pathname.startsWith('/docs/') &&
        !urlObj.pathname.includes('.')
      );
    } catch {
      return false;
    }
  }

  /**
   * Extract metadata from MCP documentation
   */
  private extractMcpMetadata(content: string, url: string): McpDocMetadata {
    const urlPath = new URL(url).pathname;
    const pathParts = urlPath.split('/').filter(Boolean);

    // Extract title and description
    const titleMatch = content.match(/<h1[^>]*>(.*?)<\/h1>/i) || content.match(/# (.*?)(\n|$)/);
    const descriptionMatch =
      content.match(/<p[^>]*>(.*?)<\/p>/i) || content.match(/\n\n([^#\n].*?)(\n\n|$)/);

    // Determine category and section
    const category = pathParts[1] || 'General'; // e.g., concepts, guides
    const section = pathParts[2] || undefined; // e.g., architecture, resources

    // Extract tags
    const tags = new Set<string>(['mcp', category.toLowerCase()]);
    if (section) {
      tags.add(section.toLowerCase());
    }

    // Common MCP-related keywords
    const keywords = ['protocol', 'api', 'implementation', 'server', 'client', 'tools'];
    for (const keyword of keywords) {
      if (content.toLowerCase().includes(keyword)) {
        tags.add(keyword);
      }
    }

    return {
      title: titleMatch?.[1]?.trim() || urlPath.split('/').pop() || 'Untitled',
      description: descriptionMatch?.[1]?.trim(),
      category: category.charAt(0).toUpperCase() + category.slice(1),
      section,
      tags: Array.from(tags),
      lastChecked: new Date().toISOString(),
    };
  }

  private detectContentType(url: string): ContentType {
    const extension = path.extname(url).slice(1).toLowerCase();
    switch (extension) {
      case 'md':
      case 'markdown':
        return ContentType.MARKDOWN;
      case 'html':
      case 'htm':
        return ContentType.HTML;
      case 'json':
        return ContentType.JSON;
      default:
        // Try to detect HTML content by URL pattern
        if (url.includes('/docs/') || url.includes('/documentation/')) {
          return ContentType.HTML;
        }
        return ContentType.RAW;
    }
  }
}

// Export a singleton instance of the fetcher
export const contentFetcher = ContentFetcher.getInstance();

// Export a convenience function for fetching content
export async function fetchContent(
  url: string,
  headers: Record<string, string> = {}
): Promise<string> {
  const result = await contentFetcher.fetchContent(url, headers);
  return result.content;
}
