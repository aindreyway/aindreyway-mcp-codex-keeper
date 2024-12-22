export interface DocSource {
  name: string;
  url: string;
  description: string;
  category: string;
  tags?: string[];
  version?: string;
  lastUpdated?: string;
  path?: string;
  alternativeUrl?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    currentPage: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

export interface SearchArgs extends PaginationParams {
  query: string;
  category?: string;
  tag?: string;
}

export interface ListDocsArgs extends PaginationParams {
  category?: string;
  tag?: string;
}

export interface UpdateArgs {
  name: string;
  force?: boolean;
}

export interface Environment {
  nodeEnv: string;
  storagePath: string;
  cacheMaxSize: number;
  cacheMaxAge: number;
  cacheCleanupInterval: number;
  cacheKeepVersions: number;
  fetchMaxRetries: number;
  fetchRetryDelay: number;
  fetchTimeout: number;
  logLevel: string;
  logFormat: string;
}

export interface ServerConfig {
  name: string;
  version: string;
  capabilities: {
    tools: Record<string, unknown>;
    resources: Record<string, unknown>;
  };
  env: Environment;
}

export interface DocMetadata {
  name: string;
  title: string;
  description?: string;
  category: string;
  tags?: string[];
  version: string;
  content: string;
  lastUpdated: string;
  lastChecked?: string;
  versions: DocVersion[];
  lastSuccessfulUpdate?: string;
  lastAttemptedUpdate?: string;
  updateError?: string;
  resource?: {
    hash?: string;
    eTag?: string;
    lastModified?: string;
  };
  searchIndex?: {
    terms: Record<string, { positions: number[]; lines: number[] }>;
    lastUpdated: string;
  };
  parent?: string;
}

export interface DocVersion {
  version: string;
  content: string;
  lastUpdated: string;
  timestamp?: string;
}

export interface ResourceMetadata {
  name: string;
  versions: DocVersion[];
}

export interface SearchIndex {
  terms: Record<string, { positions: number[]; lines: number[] }>;
  lastUpdated: string;
}

export interface DocProvider {
  id: string;
  type: string;
  canHandle(source: DocSource): boolean;
  fetchContent(source: DocSource): Promise<string>;
}

export interface TechStack {
  id: string;
  name: string;
  description: string;
  category: string;
  status: 'active' | 'deprecated';
  requiredDocs: Array<{
    url: string;
    providerId: string;
  }>;
  optionalDocs?: Array<{
    url: string;
    providerId: string;
  }>;
}

export type ValidCategory = (typeof VALID_CATEGORIES)[number];

export const VALID_CATEGORIES = [
  'Base.Standards',
  'Base.Testing',
  'Base.Tools',
  'Project.MCP',
  'Project.Stack',
] as const;

type TagsType = {
  'Base.Standards': readonly string[];
  'Base.Testing': readonly string[];
  'Base.Tools': readonly string[];
  'Project.MCP': readonly string[];
  'Project.Stack': readonly string[];
};

export const VALID_TAGS: TagsType = {
  'Base.Standards': [
    'best-practices',
    'principles',
    'patterns',
    'conventions',
    'clean-code',
    'code-quality',
    'design-patterns',
    'architecture',
    'oop',
    'solid',
    'security',
    'web',
    'owasp',
    'git',
    'commits',
    'versioning',
    'releases',
  ],
  'Base.Testing': [
    'testing',
    'test-pyramid',
    'unit-tests',
    'integration-tests',
    'e2e-tests',
    'tdd',
    'best-practices',
  ],
  'Base.Tools': ['git', 'version-control', 'workflow', 'collaboration', 'ci-cd', 'deployment'],
  'Project.MCP': ['mcp', 'sdk', 'api', 'server', 'client', 'protocol', 'development'],
  'Project.Stack': ['javascript', 'typescript', 'node', 'jest', 'react', 'express'],
} as const;

export type ValidTag = (typeof VALID_TAGS)[ValidCategory][number];

export interface ProjectDependency {
  name: string;
  version: string;
  type: 'production' | 'development';
}

export interface SourceFile {
  path: string;
  language: string;
  imports: string[];
}

export interface ProjectAnalysisSection {
  section: 'overview' | 'dependencies' | 'sourceFiles';
  page?: number;
  pageSize?: number;
}

export interface ProjectAnalysisOverview {
  mainTechnologies: string[];
  patterns: string[];
  frameworks: string[];
  totalDependencies: number;
  totalSourceFiles: number;
}

export interface ProjectAnalysisDependencies extends PaginatedResponse<ProjectDependency> {}
export interface ProjectAnalysisSourceFiles extends PaginatedResponse<SourceFile> {}

export interface ProjectAnalysis {
  overview: ProjectAnalysisOverview;
  dependencies?: ProjectAnalysisDependencies;
  sourceFiles?: ProjectAnalysisSourceFiles;
}

export interface AnalyzeProjectArgs extends PaginationParams {
  projectPath: string;
  force?: boolean;
  sections?: ProjectAnalysisSection[];
}

export interface StackDocumentation {
  core: DocSource[];
  patterns: DocSource[];
  frameworks: DocSource[];
  testing: DocSource[];
  security: DocSource[];
}
