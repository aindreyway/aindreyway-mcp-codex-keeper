import {
  DocSource,
  ProjectAnalysis,
  StackDocumentation,
  ProjectDependency,
  SourceFile,
  ProjectAnalysisOverview,
  PaginatedResponse,
  AnalyzeProjectArgs,
} from '../types/index.js';
import { logger } from './logger.js';
import fs from 'fs/promises';
import path from 'path';

export class ProjectAnalyzer {
  private static instance: ProjectAnalyzer;
  private DEFAULT_PAGE_SIZE = 20;

  private constructor() {}

  static getInstance(): ProjectAnalyzer {
    if (!ProjectAnalyzer.instance) {
      ProjectAnalyzer.instance = new ProjectAnalyzer();
    }
    return ProjectAnalyzer.instance;
  }

  async analyzeProject(args: AnalyzeProjectArgs): Promise<ProjectAnalysis> {
    const { projectPath, sections = [{ section: 'overview' }] } = args;
    const analysis: ProjectAnalysis = {
      overview: {
        mainTechnologies: [],
        patterns: [],
        frameworks: [],
        totalDependencies: 0,
        totalSourceFiles: 0,
      },
    };

    try {
      // Анализ package.json
      const packageJson = await this.readPackageJson(projectPath);
      const allDependencies: ProjectDependency[] = [];
      const allSourceFiles: SourceFile[] = [];

      if (packageJson) {
        this.analyzeDependencies(packageJson, allDependencies, analysis.overview);
        analysis.overview.totalDependencies = allDependencies.length;
      }

      // Анализ исходных файлов
      await this.analyzeSourceFiles(projectPath, allSourceFiles, analysis.overview);
      analysis.overview.totalSourceFiles = allSourceFiles.length;

      // Анализ паттернов
      await this.analyzePatterns(allSourceFiles, analysis.overview);

      // Добавляем запрошенные секции с пагинацией
      for (const section of sections) {
        const { page = 1, pageSize = this.DEFAULT_PAGE_SIZE } = section;

        switch (section.section) {
          case 'dependencies':
            analysis.dependencies = this.paginateResults(allDependencies, page, pageSize);
            break;
          case 'sourceFiles':
            analysis.sourceFiles = this.paginateResults(allSourceFiles, page, pageSize);
            break;
        }
      }

      return analysis;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to analyze project', {
        component: 'ProjectAnalyzer',
        error: { message: errorMessage },
        projectPath,
      });
      throw error;
    }
  }

  async getRecommendedDocumentation(analysis: ProjectAnalysis): Promise<StackDocumentation> {
    const docs: StackDocumentation = {
      core: [],
      patterns: [],
      frameworks: [],
      testing: [],
      security: [],
    };

    // Базовая документация для всех проектов
    docs.core.push(
      this.createDocSource({
        name: 'Clean Code Principles',
        url: 'https://github.com/ryanmcdermott/clean-code-javascript',
        description: 'Clean Code concepts adapted for JavaScript',
        category: 'Base.Standards',
        tags: ['javascript', 'typescript', 'best-practices'],
      })
    );

    // TypeScript/JavaScript специфичная документация
    if (analysis.overview.mainTechnologies.includes('typescript')) {
      docs.core.push(
        this.createDocSource({
          name: 'TypeScript Best Practices',
          url: 'https://google.github.io/styleguide/tsguide.html',
          description: 'Google TypeScript Style Guide',
          category: 'Project.Stack',
          tags: ['typescript', 'javascript'],
        })
      );
    }

    // Тестирование
    if (analysis.overview.patterns.includes('unit-testing')) {
      docs.testing.push(
        this.createDocSource({
          name: 'Jest Best Practices',
          url: 'https://jestjs.io/docs/setup-teardown',
          description: 'Jest testing framework best practices',
          category: 'Base.Testing',
          tags: ['testing', 'unit-tests'],
        })
      );
    }

    // MCP специфичная документация
    if (analysis.overview.frameworks.includes('mcp')) {
      docs.frameworks.push(
        this.createDocSource({
          name: 'MCP Server Development',
          url: 'https://modelcontextprotocol.io/docs/server/development',
          description: 'MCP server development guide',
          category: 'Project.MCP',
          tags: ['mcp', 'server', 'development'],
        })
      );
    }

    // Паттерны
    if (analysis.overview.patterns.includes('singleton')) {
      docs.patterns.push(
        this.createDocSource({
          name: 'Singleton Pattern',
          url: 'https://refactoring.guru/design-patterns/singleton',
          description: 'Singleton pattern implementation and best practices',
          category: 'Base.Standards',
          tags: ['patterns', 'design-patterns'],
        })
      );
    }

    // Безопасность
    docs.security.push(
      this.createDocSource({
        name: 'Node.js Security Best Practices',
        url: 'https://nodejs.org/en/docs/guides/security',
        description: 'Security best practices for Node.js applications',
        category: 'Base.Standards',
        tags: ['security', 'node'],
      })
    );

    return docs;
  }

  private async readPackageJson(projectPath: string): Promise<any> {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      return JSON.parse(content);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn('Failed to read package.json', {
        component: 'ProjectAnalyzer',
        error: { message: errorMessage },
        projectPath,
      });
      return null;
    }
  }

  private analyzeDependencies(
    packageJson: any,
    dependencies: ProjectDependency[],
    overview: ProjectAnalysisOverview
  ): void {
    const allDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    for (const [name, version] of Object.entries(allDependencies)) {
      const type = packageJson.dependencies?.[name] ? 'production' : 'development';
      dependencies.push({
        name,
        version: version as string,
        type,
      });

      // Определение основных технологий
      if (name === 'typescript') {
        overview.mainTechnologies.push('typescript');
      }
      if (name === 'jest') {
        overview.frameworks.push('jest');
      }
      if (name.includes('modelcontextprotocol')) {
        overview.frameworks.push('mcp');
      }
    }
  }

  private async analyzeSourceFiles(
    projectPath: string,
    sourceFiles: SourceFile[],
    overview: ProjectAnalysisOverview
  ): Promise<void> {
    const files = await this.findSourceFiles(projectPath);

    for (const filePath of files) {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        const imports = this.extractImports(content);
        const language = path.extname(filePath).slice(1);

        sourceFiles.push({
          path: filePath,
          language,
          imports,
        });

        // Анализ паттернов в файле
        if (content.includes('private static instance')) {
          if (!overview.patterns.includes('singleton')) {
            overview.patterns.push('singleton');
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.warn(`Failed to analyze file: ${filePath}`, {
          component: 'ProjectAnalyzer',
          error: { message: errorMessage },
        });
      }
    }
  }

  private async findSourceFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        files.push(...(await this.findSourceFiles(fullPath)));
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
        files.push(fullPath);
      }
    }

    return files;
  }

  private extractImports(content: string): string[] {
    const imports: string[] = [];
    const importRegex = /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(content)) !== null) {
      imports.push(match[1]);
    }

    return imports;
  }

  private async analyzePatterns(
    sourceFiles: SourceFile[],
    overview: ProjectAnalysisOverview
  ): Promise<void> {
    // Проверка наличия тестов
    const hasTests = sourceFiles.some(file => file.path.includes('.test.'));
    if (hasTests && !overview.patterns.includes('unit-testing')) {
      overview.patterns.push('unit-testing');
    }

    // Проверка использования TypeScript
    const hasTypeScript = sourceFiles.some(file => file.path.endsWith('.ts'));
    if (hasTypeScript && !overview.patterns.includes('static-typing')) {
      overview.patterns.push('static-typing');
    }
  }

  private paginateResults<T>(items: T[], page: number, pageSize: number): PaginatedResponse<T> {
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / pageSize);

    return {
      data: items.slice(startIndex, endIndex),
      pagination: {
        currentPage: page,
        pageSize,
        totalItems,
        totalPages,
        hasNextPage: endIndex < totalItems,
        hasPreviousPage: page > 1,
      },
    };
  }

  private createDocSource(doc: Partial<DocSource>): DocSource {
    return {
      name: doc.name!,
      url: doc.url!,
      description: doc.description!,
      category: doc.category!,
      tags: doc.tags || [],
      version: doc.version || '1.0.0',
      lastUpdated: new Date().toISOString(),
    };
  }
}

export const projectAnalyzer = ProjectAnalyzer.getInstance();
