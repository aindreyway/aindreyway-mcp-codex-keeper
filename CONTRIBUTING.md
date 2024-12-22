# Contributing to MCP Codex Keeper

Thank you for considering contributing to MCP Codex Keeper! This guide will help you understand our development process and standards.

## 🚀 Development Setup

### Prerequisites

- Node.js ≥ 18.0.0
- npm ≥ 7.0.0
- Git

### Initial Setup

1. Clone the repository:

   ```bash
   git clone https://github.com/aindreyway/mcp-codex-keeper.git
   cd mcp-codex-keeper
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Set up development environment:

   Add to your Cline/Claude configuration (e.g., claude_desktop_config.json):

   ```json
   {
     "mcpServers": {
       "local-mcp-codex-keeper": {
         "command": "node",
         "args": ["./build/index.js"],
         "env": {
           "NODE_ENV": "development"
         }
       }
     }
   }
   ```

4. Start development:

   ```bash
   # Watch mode for development
   npm run dev
   ```

## 📁 Project Structure

```
aindreyway-mcp-codex-keeper/
├── src/                 # Source code
│   ├── types/          # TypeScript types
│   ├── utils/          # Utilities
│   ├── validators/     # Input validation
│   └── tests/          # Tests
│       ├── unit/           # Unit tests
│       ├── integration/    # Integration tests
│       ├── performance/    # Performance tests
│       └── e2e/           # End-to-end tests
├── docs/               # Documentation
└── scripts/           # Build scripts
```

## 🧪 Testing

### Test Organization

1. **Unit Tests** (`src/tests/unit/`)

   - Test individual components
   - Mock external dependencies
   - Fast execution
   - Example:
     ```typescript
     describe('CacheManager', () => {
       it('should store and retrieve values', () => {
         const cache = new CacheManager();
         cache.set('key', 'value');
         expect(cache.get('key')).toBe('value');
       });
     });
     ```

2. **Integration Tests** (`src/tests/integration/`)

   - Test component interactions
   - Minimal mocking
   - Real file system operations
   - Example:
     ```typescript
     describe('DocumentationServer', () => {
       it('should handle complete workflow', async () => {
         const server = new DocumentationServer();
         await server.addDoc({ name: 'Test' });
         const docs = await server.listDocs();
         expect(docs).toContain('Test');
       });
     });
     ```

3. **Performance Tests** (`src/tests/performance/`)

   - Load testing
   - Stress testing
   - Benchmarks
   - Example:
     ```typescript
     describe('CacheManager Performance', () => {
       it('should handle concurrent operations', async () => {
         const cache = new CacheManager();
         const start = performance.now();
         // Test code
         expect(performance.now() - start).toBeLessThan(100);
       });
     });
     ```

4. **E2E Tests** (`src/tests/e2e/`)
   - Complete workflows
   - Real external services
   - User scenarios

### Running Tests

```bash
# Run all tests
npm run test:all

# Run specific test types
npm run test:unit
npm run test:integration
npm run test:performance
npm run test:e2e

# Watch mode for development
npm run test:watch:unit
npm run test:watch:integration

# Generate coverage reports
npm run test:coverage:all
```

## 📝 Code Guidelines

### TypeScript

1. **Type Safety**

   - Use strict mode
   - Avoid `any`
   - Define interfaces
   - Document types

2. **Code Style**

   - Use ESLint
   - Follow Prettier
   - Clear naming
   - Consistent patterns

3. **Documentation**
   - JSDoc for public APIs
   - Clear comments
   - Usage examples
   - Type documentation

### Git Workflow

1. **Branch Names**

   ```
   feature/description
   fix/description
   docs/description
   test/description
   ```

2. **Commit Messages**

   ```
   type(scope): description

   [optional body]
   [optional footer]
   ```

   Types: feat, fix, docs, style, refactor, test, chore

3. **Pull Requests**
   - Clear title
   - Detailed description
   - Reference issues
   - Include tests
   - Update documentation

### System Files

1. **Git Ignored Files**

   - `.codexkeeper/` (automatically added)
   - `node_modules/`
   - `build/`
   - `coverage/`

2. **Development Files**
   - Keep test data in `test-data/`
   - Store fixtures in `src/tests/fixtures/`

## 🚀 Release Process

1. **Preparation**

   ```bash
   # Run all checks
   npm run validate

   # Build project
   npm run build
   ```

2. **Version Update**

   ```bash
   # Choose one:
   npm version patch  # Bug fixes (0.0.X)
   npm version minor  # Features (0.X.0)
   npm version major  # Breaking (X.0.0)
   ```

3. **Publication**

   ```bash
   # Test publication
   npm publish --dry-run

   # Actual publication
   npm publish --access public
   ```

4. **Verification**
   ```bash
   # Test installation
   npx @aindreyway/mcp-codex-keeper@latest
   ```

## 🤝 Getting Help

- Read [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)
- Check existing issues
- Ask in discussions
- Join our community

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.
