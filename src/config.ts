import { Environment, ServerConfig } from './types/index.js';
import { getRuntimeConfig } from './runtime-modes.js';

// Get runtime configuration
const runtime = getRuntimeConfig();

/**
 * Environment configuration
 */
export const ENV: Environment = {
  nodeEnv: process.env.NODE_ENV || 'development',
  storagePath: process.env.STORAGE_PATH || runtime.storagePath,
  cacheMaxSize: 104857600, // 100MB
  cacheMaxAge: 604800000, // 7 days
  cacheCleanupInterval: 3600000, // 1 hour
  cacheKeepVersions: 3,
  fetchMaxRetries: 3,
  fetchRetryDelay: 2000,
  fetchTimeout: 15000,
  logLevel: process.env.LOG_LEVEL || 'info',
  logFormat: process.env.LOG_FORMAT || 'json',
};

/**
 * Server configuration
 */
export const SERVER_CONFIG: ServerConfig = {
  name: runtime.serverName,
  version: process.env.npm_package_version || '0.0.0',
  capabilities: {
    tools: {},
    resources: {},
  },
  env: ENV,
};

// Log runtime information
console.log('\nRuntime Information:');
console.log(`Storage Path: ${ENV.storagePath}`);
console.log(`Server Name: ${SERVER_CONFIG.name}`);
