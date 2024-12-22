import {
  DocSource,
  SearchArgs,
  UpdateArgs,
  VALID_CATEGORIES,
  VALID_TAGS,
  ValidCategory,
  ValidTag,
} from '../types/index.js';

/**
 * Checks if a value is a valid category
 */
export function isValidCategory(category: unknown): category is ValidCategory {
  if (typeof category !== 'string') {
    return false;
  }

  return VALID_CATEGORIES.includes(category as ValidCategory);
}

/**
 * Checks if tags are valid for a category
 */
export function isValidTags(category: ValidCategory, tags: string[]): tags is ValidTag[] {
  const allowedTags = VALID_TAGS[category];
  return tags.every(tag => allowedTags.includes(tag as ValidTag));
}

/**
 * Validates arguments for adding documentation
 */
export function validateAddDoc(args: unknown): DocSource {
  if (!args || typeof args !== 'object') {
    throw new Error('Invalid arguments');
  }

  const { name, url, description, category, tags, version } = args as Record<string, unknown>;

  if (!name || typeof name !== 'string') {
    throw new Error('Name is required and must be a string');
  }

  if (!url || typeof url !== 'string') {
    throw new Error('URL is required and must be a string');
  }

  try {
    new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (!category || typeof category !== 'string' || !isValidCategory(category)) {
    throw new Error('Invalid category');
  }

  if (description && typeof description !== 'string') {
    throw new Error('Description must be a string');
  }

  const validatedTags = Array.isArray(tags)
    ? tags.filter(tag => typeof tag === 'string')
    : undefined;
  if (tags && !validatedTags) {
    throw new Error('Tags must be an array of strings');
  }

  if (validatedTags && !isValidTags(category, validatedTags)) {
    throw new Error('Invalid tags for category');
  }

  return {
    name,
    url,
    description: (description as string) || '',
    category,
    tags: validatedTags,
    version: typeof version === 'string' ? version : undefined,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Validates arguments for updating documentation
 */
export function validateUpdateDoc(args: unknown): UpdateArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('Invalid arguments');
  }

  const { name, force } = args as Record<string, unknown>;

  if (!name || typeof name !== 'string') {
    throw new Error('Name is required and must be a string');
  }

  if (force !== undefined && typeof force !== 'boolean') {
    throw new Error('Force must be a boolean');
  }

  return { name, force };
}

/**
 * Validates arguments for searching documentation
 */
export function validateSearch(args: unknown): SearchArgs {
  if (!args || typeof args !== 'object') {
    throw new Error('Invalid arguments');
  }

  const { query, category, tag, page, pageSize } = args as Record<string, unknown>;

  if (!query || typeof query !== 'string') {
    throw new Error('Query is required and must be a string');
  }

  let validCategory: ValidCategory | undefined;
  if (category) {
    if (typeof category !== 'string' || !isValidCategory(category)) {
      throw new Error('Invalid category');
    }
    validCategory = category;
  }

  let validTag: string | undefined;
  if (tag) {
    if (typeof tag !== 'string') {
      throw new Error('Tag must be a string');
    }
    validTag = tag;

    if (validCategory && !isValidTags(validCategory, [validTag])) {
      throw new Error('Invalid tag for category');
    }
  }

  if (page !== undefined && (typeof page !== 'number' || page < 1)) {
    throw new Error('Page must be a positive number');
  }

  if (pageSize !== undefined && (typeof pageSize !== 'number' || pageSize < 1 || pageSize > 100)) {
    throw new Error('Page size must be between 1 and 100');
  }

  return {
    query: query as string,
    category: validCategory,
    tag: validTag,
    page: typeof page === 'number' ? page : undefined,
    pageSize: typeof pageSize === 'number' ? pageSize : undefined,
  };
}
