import os from 'os';
import path from 'path';

/**
 * Runtime configuration
 */
export interface RuntimeConfig {
  storagePath: string;
  serverName: string;
}

/**
 * Get platform-specific data directory
 * Following XDG Base Directory Specification for Linux/macOS
 * and standard app data locations for Windows
 */
function getDataDir(): string {
  switch (process.platform) {
    case 'darwin':
      // macOS: ~/Library/Application Support
      return path.join(os.homedir(), 'Library', 'Application Support', 'mcp-codex-keeper');
    case 'win32':
      // Windows: %APPDATA%
      return path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'mcp-codex-keeper'
      );
    default:
      // Linux/Unix: $XDG_DATA_HOME or ~/.local/share
      const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
      return path.join(xdgDataHome, 'mcp-codex-keeper');
  }
}

/**
 * Get runtime configuration
 * The storage path and server name are determined by the environment:
 * - Development: Uses XDG_DATA_HOME/mcp-codex-keeper-dev
 * - Production: Uses platform-specific app data directory
 */
export function getRuntimeConfig(): RuntimeConfig {
  const isDev = process.env.NODE_ENV === 'development';
  const baseDir = getDataDir();

  return {
    serverName: 'aindreyway-mcp-codex-keeper',
    storagePath: isDev ? `${baseDir}-dev` : baseDir,
  };
}
