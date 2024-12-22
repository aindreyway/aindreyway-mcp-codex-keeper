import {
  isValidCategory,
  validateAddDoc,
  validateSearch,
  validateUpdateDoc,
} from '../../../validators/index.js';

describe('Validators', () => {
  describe('isValidCategory', () => {
    it('returns true for valid categories', async () => {
      expect(await isValidCategory('Base.Standards')).toBe(true);
      expect(await isValidCategory('Base.Testing')).toBe(true);
      expect(await isValidCategory('Project.MCP')).toBe(true);
    });

    it('returns false for invalid categories', async () => {
      expect(await isValidCategory('Invalid')).toBe(false);
      expect(await isValidCategory('')).toBe(false);
      expect(await isValidCategory(123)).toBe(false);
      expect(await isValidCategory(null)).toBe(false);
      expect(await isValidCategory(undefined)).toBe(false);
    });
  });

  describe('validateAddDoc', () => {
    it('validates correct arguments', async () => {
      const args = {
        name: 'Test Doc',
        url: 'https://example.com',
        description: 'Test description',
        category: 'Base.Standards',
        tags: ['best-practices', 'principles'],
        version: '1.0.0',
      };

      const result = await validateAddDoc(args);
      expect(result).toEqual({
        ...args,
        lastUpdated: expect.any(String),
      });
    });

    it('validates arguments with minimum required fields', async () => {
      const args = {
        name: 'Test Doc',
        url: 'https://example.com',
        category: 'Base.Standards',
      };

      const result = await validateAddDoc(args);
      expect(result).toEqual({
        ...args,
        description: '',
        tags: undefined,
        version: undefined,
        lastUpdated: expect.any(String),
      });
    });

    it('throws error for invalid URL', async () => {
      const args = {
        name: 'Test Doc',
        url: 'not-a-url',
        category: 'Base.Standards',
      };

      await expect(validateAddDoc(args)).rejects.toThrow('Invalid URL format');
    });

    it('throws error for invalid category', async () => {
      const args = {
        name: 'Test Doc',
        url: 'https://example.com',
        category: 'Invalid',
      };

      await expect(validateAddDoc(args)).rejects.toThrow('Invalid category');
    });

    it('throws error for invalid tags', async () => {
      const args = {
        name: 'Test Doc',
        url: 'https://example.com',
        category: 'Base.Standards',
        tags: ['invalid-tag'],
      };

      await expect(validateAddDoc(args)).rejects.toThrow('Invalid tags for category');
    });
  });

  describe('validateUpdateDoc', () => {
    it('validates correct arguments', () => {
      const args = {
        name: 'Test Doc',
        force: true,
      };

      const result = validateUpdateDoc(args);
      expect(result).toEqual(args);
    });

    it('validates arguments without force flag', () => {
      const args = {
        name: 'Test Doc',
      };

      const result = validateUpdateDoc(args);
      expect(result).toEqual({ name: 'Test Doc', force: undefined });
    });

    it('throws error for missing name', () => {
      const args = {
        force: true,
      };

      expect(() => validateUpdateDoc(args)).toThrow('Name is required');
    });

    it('throws error for invalid force flag', () => {
      const args = {
        name: 'Test Doc',
        force: 'true',
      };

      expect(() => validateUpdateDoc(args)).toThrow('Force must be a boolean');
    });
  });

  describe('validateSearch', () => {
    it('validates correct arguments', async () => {
      const args = {
        query: 'test',
        category: 'Base.Standards',
        tag: 'best-practices',
      };

      const result = await validateSearch(args);
      expect(result).toEqual(args);
    });

    it('validates arguments with only required query', async () => {
      const args = {
        query: 'test',
      };

      const result = await validateSearch(args);
      expect(result).toEqual({
        query: 'test',
        category: undefined,
        tag: undefined,
      });
    });

    it('throws error for missing query', async () => {
      const args = {
        category: 'Base.Standards',
        tag: 'best-practices',
      };

      await expect(validateSearch(args)).rejects.toThrow('Query is required');
    });

    it('throws error for invalid category', async () => {
      const args = {
        query: 'test',
        category: 'Invalid',
      };

      await expect(validateSearch(args)).rejects.toThrow('Invalid category');
    });

    it('throws error for invalid tag', async () => {
      const args = {
        query: 'test',
        category: 'Base.Standards',
        tag: 'invalid-tag',
      };

      await expect(validateSearch(args)).rejects.toThrow('Invalid tag for category');
    });
  });
});
