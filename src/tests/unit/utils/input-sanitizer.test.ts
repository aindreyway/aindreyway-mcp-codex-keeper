import { InputSanitizer } from '../../../utils/input-sanitizer.js';
import path from 'path';

describe('InputSanitizer', () => {
  describe('sanitizePath', () => {
    const basePath = '/test/base/path';

    it('should handle normal paths', () => {
      const result = InputSanitizer.sanitizePath('file.txt', basePath);
      expect(result).toBe(path.join(basePath, 'file.txt'));
    });

    it('should detect path traversal attempts', () => {
      expect(() => {
        InputSanitizer.sanitizePath('../../../etc/passwd', basePath);
      }).toThrow('Path traversal attack detected');
    });

    it('should normalize paths', () => {
      const result = InputSanitizer.sanitizePath('subdir//file.txt', basePath);
      expect(result).toBe(path.join(basePath, 'subdir', 'file.txt'));
    });
  });

  describe('sanitizeFileName', () => {
    it('should remove directory traversal characters', () => {
      const result = InputSanitizer.sanitizeFileName('../../malicious.txt');
      expect(result).toBe('malicious_txt');
    });

    it('should remove non-printable characters', () => {
      const result = InputSanitizer.sanitizeFileName('file\x00name.txt');
      expect(result).toBe('filename.txt');
    });

    it('should preserve valid characters', () => {
      const result = InputSanitizer.sanitizeFileName('valid-file_name.txt');
      expect(result).toBe('valid-file_name.txt');
    });
  });

  describe('sanitizeUrl', () => {
    it('should allow valid http URLs', () => {
      const url = 'https://example.com/path?query=1';
      const result = InputSanitizer.sanitizeUrl(url);
      expect(result).toBe(url);
    });

    it('should allow file URLs', () => {
      const url = 'file:///path/to/file.txt';
      const result = InputSanitizer.sanitizeUrl(url);
      expect(result).toBe(url);
    });

    it('should reject invalid protocols', () => {
      expect(() => {
        InputSanitizer.sanitizeUrl('ftp://example.com');
      }).toThrow('Protocol ftp: is not allowed');
    });

    it('should encode special characters in path', () => {
      const result = InputSanitizer.sanitizeUrl('https://example.com/path with spaces');
      expect(result).toBe(encodeURI('https://example.com/path with spaces'));
    });

    it('should remove fragments', () => {
      const result = InputSanitizer.sanitizeUrl('https://example.com/path#fragment');
      expect(result).toBe('https://example.com/path');
    });
  });

  describe('sanitizeContent', () => {
    it('should enforce maximum length', () => {
      expect(() => {
        InputSanitizer.sanitizeContent('a'.repeat(2000000));
      }).toThrow('Content exceeds maximum length');
    });

    it('should remove all HTML when not allowed', () => {
      const content = '<p>Text with <script>alert("xss")</script> and <b>bold</b></p>';
      const result = InputSanitizer.sanitizeContent(content, { allowHtml: false });
      expect(result).toBe('Text with alert("xss") and bold');
    });

    it('should only allow specified HTML tags', () => {
      const content = '<p>Text with <script>alert("xss")</script> and <b>bold</b></p>';
      const result = InputSanitizer.sanitizeContent(content, {
        allowHtml: true,
        allowedTags: ['p', 'b'],
      });
      expect(result).toBe('<p>Text with alert("xss") and <b>bold</b></p>');
    });
  });

  describe('normalizeEncoding', () => {
    it('should normalize Unicode characters', () => {
      // é can be represented as é (U+00E9) or e + ́ (U+0065 U+0301)
      const result = InputSanitizer.normalizeEncoding('e\u0301'); // e + combining acute accent
      expect(result).toBe('\u00E9'); // single é character
    });

    it('should remove invalid UTF-8 sequences', () => {
      const result = InputSanitizer.normalizeEncoding('text\uFFFD\uFFFEwith\uFFFFbad chars');
      expect(result).toBe('textwithbad chars');
    });
  });

  describe('sanitizeSearchQuery', () => {
    it('should escape regex special characters', () => {
      const result = InputSanitizer.sanitizeSearchQuery('search.*+?^${}()|[]\\');
      expect(result).toBe('search\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });

    it('should preserve normal characters', () => {
      const result = InputSanitizer.sanitizeSearchQuery('normal search query');
      expect(result).toBe('normal search query');
    });
  });

  describe('sanitizeJson', () => {
    it('should parse and sanitize valid JSON', () => {
      const input = '{"key": "value with \uFFFD", "array": ["item1", "item2"]}';
      const result = InputSanitizer.sanitizeJson(input) as Record<string, unknown>;
      expect(result.key).toBe('value with ');
      expect(Array.isArray(result.array)).toBe(true);
    });

    it('should handle nested objects', () => {
      const input = '{"outer": {"inner": "value\uFFFE"}}';
      const result = InputSanitizer.sanitizeJson(input) as Record<string, unknown>;
      expect((result.outer as Record<string, string>).inner).toBe('value');
    });

    it('should throw on invalid JSON', () => {
      expect(() => {
        InputSanitizer.sanitizeJson('{"invalid": json}');
      }).toThrow('Invalid JSON');
    });

    it('should preserve primitive values', () => {
      const input = '{"number": 42, "boolean": true, "null": null}';
      const result = InputSanitizer.sanitizeJson(input) as Record<string, unknown>;
      expect(result.number).toBe(42);
      expect(result.boolean).toBe(true);
      expect(result.null).toBeNull();
    });
  });
});
