export * from './base-provider.js';
export * from './website-provider.js';
export * from './github-provider.js';
export * from './local-provider.js';

import { WebsiteProvider } from './website-provider.js';
import { GithubProvider } from './github-provider.js';
import { LocalProvider } from './local-provider.js';

// Create and export provider instances
export const providers = {
  website: new WebsiteProvider(),
  github: new GithubProvider(),
  local: new LocalProvider(),
};
