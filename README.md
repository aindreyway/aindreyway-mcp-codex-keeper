# 📚 MCP Codex Keeper

> Your AI assistant's documentation manager

![Version](https://img.shields.io/badge/version-1.1.10-green)
![License](https://img.shields.io/badge/license-MIT-blue)

MCP Codex Keeper helps AI assistants access and manage development documentation efficiently. It automatically handles documentation storage, updates, and search, so you can focus on your work.

## ⚡️ Quick Start

```bash
# Using npx (recommended)
npx @aindreyway/mcp-codex-keeper@latest

# Or install globally
npm install -g @aindreyway/mcp-codex-keeper
```

Add to your AI assistant's configuration (e.g., claude_desktop_config.json):

```json
{
  "mcpServers": {
    "aindreyway-mcp-codex-keeper": {
      "command": "npx",
      "args": ["-y", "@aindreyway/mcp-codex-keeper@latest"]
    }
  }
}
```

That's it! Your AI assistant will now have access to:

- Development best practices
- Coding standards
- Documentation
- Security guidelines
- And more!

## 🎯 Examples

Ask your AI assistant to:

```
"Show me TypeScript best practices"
"Find SOLID principles documentation"
"What are the current security guidelines?"
"How to write good unit tests?"
```

## ✨ Features

- 📖 **Auto-managed documentation**

  - Always up-to-date
  - Locally cached for speed
  - Automatically organized

- 🔍 **Smart search**

  - Full-text search
  - Category filtering
  - Fast results

- 🛠 **Project analysis**
  - Tech stack detection
  - Documentation recommendations
  - Best practices suggestions

## 📦 Requirements

- Node.js ≥ 18.0.0
- npm ≥ 7.0.0

## 🤝 Support

- 📖 [Full Documentation](./docs)
- 🐛 [Report Issues](https://github.com/aindreyway/mcp-codex-keeper/issues)
- 💡 [Contributing](./CONTRIBUTING.md)

## 📄 License

MIT © [aindreyway](https://github.com/aindreyway)
