#!/usr/bin/env node

/**
 * Aindreyway MCP Codex Keeper
 * An intelligent MCP server for managing development documentation and best practices
 *
 * @author aindreyway
 * @license MIT
 */

import { DocumentationServer } from './server.js';
import { execSync } from 'child_process';
import { ContentFetcher } from './utils/content-fetcher.js';

export { ContentFetcher };

/**
 * Check if required dependencies are installed
 */
function checkDependencies() {
  try {
    // Check Node.js version
    const nodeVersion = process.versions.node;
    const [major] = nodeVersion.split('.').map(Number);
    if (major < 18) {
      throw new Error(`Node.js version 18 or higher is required. Current version: ${nodeVersion}`);
    }

    // Check npm
    try {
      execSync('npm --version', { stdio: 'ignore' });
    } catch {
      throw new Error(
        'npm is not installed. Please install npm: https://docs.npmjs.com/downloading-and-installing-node-js-and-npm'
      );
    }

    // Check npx
    try {
      execSync('npx --version', { stdio: 'ignore' });
    } catch {
      throw new Error('npx is not installed. Please install npx: npm install -g npx');
    }
  } catch (error: unknown) {
    console.error('\n[Dependency Check Failed]');
    console.error(error instanceof Error ? error.message : String(error));
    console.error('\nPlease check the installation requirements in README.md\n');
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', error => {
  console.error('[Fatal Error] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Fatal Error] Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Check dependencies before starting
checkDependencies();

// Start server
DocumentationServer.start().catch(error => {
  console.error('[Fatal Error] Failed to start server:', error);
  process.exit(1);
});
