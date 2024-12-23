# Aindreyway MCP Codex Keeper

![MCP Server](https://img.shields.io/badge/MCP-Server-blue)
![Version](https://img.shields.io/badge/version-1.1.10-green)
![License](https://img.shields.io/badge/license-MIT-blue)
[![smithery badge](https://smithery.ai/badge/@aindreyway/mcp-codex-keeper)](https://smithery.ai/server/@aindreyway/mcp-codex-keeper)

An intelligent MCP server that serves as a guardian of development knowledge, providing AI assistants with curated access to latest documentation and best practices.

<a href="https://glama.ai/mcp/servers/bo39uifs3k"><img width="380" height="200" src="https://glama.ai/mcp/servers/bo39uifs3k/badge" alt="mcp-codex-keeper MCP server" /></a>

## 🚀 Quick Start

### Prerequisites

1. Make sure you have Node.js installed (version 18 or higher):

   ```bash
   node --version
   ```

2. Install or update npm (comes with Node.js):

   ```bash
   npm install -g npm@latest
   ```

3. Verify npx is available:
   ```bash
   npx --version
   ```
   If not found, install it:
   ```bash
   npm install -g npx
   ```

### Installing via Smithery

To install Aindreyway Codex Keeper for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@aindreyway/mcp-codex-keeper):

```bash
npx -y @smithery/cli install @aindreyway/mcp-codex-keeper --client claude
```

### Configuration

Add this to your Cline/Sonnet configuration:

```json
"aindreyway-codex-keeper": {
  "command": "npx",
  "args": ["-y", "@aindreyway/mcp-codex-keeper@latest"],
  "disabled": false,
  "env": {
    "npm_config_cache_max": "1024000000",
    "NODE_OPTIONS": "--max-old-space-size=256"
  }
}
```

That's it! The assistant will handle everything automatically.

> **Note:** This server uses `npx` for direct npm package execution, which is optimal for Node.js/TypeScript MCP servers, providing seamless integration with the npm ecosystem and TypeScript tooling.

## 🎯 What Your Assistant Can Do

Ask your assistant to:

- "Show me the latest React documentation"
- "Find best practices for TypeScript development"
- "Update documentation for Node.js"
- "Search for information about async/await"

## 🛠 Available Tools

### list_documentation

Lists all available documentation sources with optional category filtering.

### add_documentation

Add new documentation sources to the knowledge base.

### update_documentation

Update existing documentation to get the latest content.

### search_documentation

Search through documentation with category filtering.

## 📚 Documentation Categories

- Frontend
- Backend
- Language
- MCP
- MCP-Guide
- Database
- DevOps
- Security
- Testing
- Architecture
- Mobile
- AI
- Cloud

## 🔧 Features

The server automatically:

- Manages documentation from various sources
- Keeps track of latest development best practices
- Provides intelligent search capabilities
- Updates documentation automatically
- Supports tagging and categorization
- Optimizes memory usage:
  - Uses streaming for large files
  - Automatic cache cleanup
  - Memory-efficient search
  - Size and age limits for cached files
  - Limited heap size (256MB)

## 📝 License

MIT License - feel free to use this in your projects!

## 👤 Author

**aindreyway**

- GitHub: [@aindreyway](https://github.com/aindreyway)

## 📖 Documentation

- [User Guide](README.md) - Installation and usage instructions
- [Contributing Guide](CONTRIBUTING.md) - How to contribute to the project
- [Technical Documentation](PROJECT_SUMMARY.md) - Detailed technical information

## ⭐️ Support

Give a ⭐️ if this project helped you! If you want to contribute, please check our [Contributing Guide](CONTRIBUTING.md).
