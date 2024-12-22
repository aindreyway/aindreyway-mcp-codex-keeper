import path from 'path';

/**
 * Input sanitization utility to prevent security vulnerabilities
 */
export class InputSanitizer {
  /**
   * Sanitize file path to prevent path traversal attacks
   * @param filePath Path to sanitize
   * @param basePath Base directory that should contain the file
   * @returns Sanitized absolute path
   * @throws {Error} If path tries to escape base directory
   */
  static sanitizePath(filePath: string, basePath: string): string {
    // Normalize paths to handle different path separators
    const normalizedBase = path.resolve(basePath);

    // Handle empty or invalid paths
    if (!filePath) {
      return normalizedBase;
    }

    // Convert to absolute path and normalize
    const normalizedPath = path.normalize(
      path.isAbsolute(filePath) ? filePath : path.join(normalizedBase, filePath)
    );

    // In production mode, allow paths in home directory
    const isProduction = process.env.MCP_ENV !== 'local';
    const homeDir = process.env.HOME || process.env.USERPROFILE;

    if (isProduction && homeDir && normalizedPath.startsWith(path.resolve(homeDir))) {
      // Allow paths in home directory for production mode
      return normalizedPath;
    } else if (!normalizedPath.startsWith(normalizedBase)) {
      throw new Error('Path traversal attack detected');
    }

    return normalizedPath;
  }

  /**
   * Sanitize file name to prevent malicious file names
   * @param fileName File name to sanitize
   * @returns Sanitized file name
   */
  /**
   * Sanitize file name to prevent malicious file names
   * @param fileName File name to sanitize
   * @returns Sanitized file name
   */
  static sanitizeFileName(fileName: string): string {
    // Normalize string for consistent processing
    let sanitized = fileName.normalize('NFC');

    // Remove non-printable characters
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');

    // Handle path traversal attempts
    sanitized = sanitized.replace(/^\.+[/\\]/, '');

    // Handle URL-like names first
    if (sanitized.includes('://')) {
      sanitized = sanitized.replace(/^https?:\/\//, 'https_').replace(/[/\\?=&]/g, '_');
    }

    // Check for path traversal attempts
    const hasTraversal = /^\.\./.test(sanitized);

    if (hasTraversal) {
      // For path traversal attempts, replace all dots with underscores
      return sanitized
        .replace(/[/\\]/g, '_') // Replace path separators
        .replace(/\s+/g, '_') // Replace spaces
        .replace(/\./g, '_') // Replace all dots with underscores
        .replace(/[^a-zA-Z0-9_-]/g, '_') // Keep only alphanumeric, underscore, and hyphen
        .replace(/_{2,}/g, '_') // Replace multiple underscores
        .replace(/^[_-]+|[_-]+$/g, '') // Remove leading/trailing underscores and hyphens
        .toLowerCase();
    }

    // For normal files, preserve the extension
    const parts = sanitized.split('.');
    const extension = parts.length > 1 ? parts.pop() : '';
    let name = parts.join('_');

    // Process the name part
    name = name
      .replace(/[/\\]/g, '_') // Replace path separators
      .replace(/\s+/g, '_') // Replace spaces
      .replace(/[^a-zA-Z0-9_-]/g, '_') // Keep only alphanumeric, underscore, and hyphen
      .replace(/_{2,}/g, '_') // Replace multiple underscores
      .replace(/^[_-]+|[_-]+$/g, '') // Remove leading/trailing underscores and hyphens
      .toLowerCase();

    // Ensure we have a valid filename
    if (!name && !extension) {
      return 'unnamed_file';
    }

    // Handle special cases for extension
    if (extension === '..') {
      return `${name || 'unnamed'}_txt`;
    }

    return extension ? `${name}.${extension}` : name;
  }

  /**
   * Validate and sanitize URL
   * @param url URL to validate
   * @returns Sanitized URL
   * @throws {Error} If URL is invalid or uses disallowed protocol
   */
  static sanitizeUrl(url: string): string {
    try {
      const parsed = new URL(url);

      // Only allow specific protocols
      const allowedProtocols = ['http:', 'https:', 'file:'];
      if (!allowedProtocols.includes(parsed.protocol)) {
        throw new Error(`Protocol ${parsed.protocol} is not allowed`);
      }

      // Remove any fragments
      parsed.hash = '';

      // Ensure path is properly encoded without double-encoding
      const decodedPath = decodeURIComponent(parsed.pathname);
      parsed.pathname = encodeURIComponent(decodedPath).replace(/%2F/g, '/');

      return parsed.toString();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Invalid URL: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Validate and sanitize content
   * @param content Content to validate
   * @param options Validation options
   * @returns Sanitized content
   */
  static sanitizeContent(
    content: string,
    options: {
      maxLength?: number;
      allowHtml?: boolean;
      allowedTags?: string[];
    } = {}
  ): string {
    const {
      maxLength = 1000000, // 1MB default max length
      allowHtml = false,
      allowedTags = ['p', 'br', 'b', 'i', 'code', 'pre'],
    } = options;

    // Check content length
    if (content.length > maxLength) {
      throw new Error(`Content exceeds maximum length of ${maxLength} characters`);
    }

    if (!allowHtml) {
      // Remove all HTML tags if HTML is not allowed
      return content.replace(/<[^>]*>/g, '');
    }

    // If HTML is allowed, only keep allowed tags
    const tagPattern = new RegExp(`<(?!\\/?(?:${allowedTags.join('|')})\\b)[^>]+>`, 'gi');
    return content.replace(tagPattern, '');
  }

  /**
   * Validate and normalize character encoding
   * @param text Text to validate
   * @returns Normalized text
   */
  static normalizeEncoding(text: string): string {
    // Normalize to NFC form (Canonical Decomposition, followed by Canonical Composition)
    const normalized = text.normalize('NFC');

    // Remove any invalid UTF-8 sequences
    return normalized.replace(/[\uFFFD\uFFFE\uFFFF]/g, '');
  }

  /**
   * Validate and sanitize search query
   * @param query Search query to sanitize
   * @returns Sanitized query
   */
  static sanitizeSearchQuery(query: string): string {
    // Remove any special characters that could be used for regex attacks
    return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Validate and sanitize JSON input
   * @param input JSON string to validate
   * @returns Parsed and sanitized object
   * @throws {Error} If JSON is invalid or contains disallowed values
   */
  static sanitizeJson(input: string): unknown {
    try {
      const parsed = JSON.parse(input);

      // Recursively sanitize object
      const sanitizeValue = (value: unknown): unknown => {
        if (typeof value === 'string') {
          // Sanitize strings
          return this.normalizeEncoding(value);
        } else if (Array.isArray(value)) {
          // Recursively sanitize arrays
          return value.map(sanitizeValue);
        } else if (value && typeof value === 'object') {
          // Recursively sanitize objects
          const result: Record<string, unknown> = {};
          for (const [key, val] of Object.entries(value)) {
            result[this.normalizeEncoding(key)] = sanitizeValue(val);
          }
          return result;
        }
        // Return primitives as-is
        return value;
      };

      return sanitizeValue(parsed);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Invalid JSON: ${error.message}`);
      }
      throw error;
    }
  }
}
