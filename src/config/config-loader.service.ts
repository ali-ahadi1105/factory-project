import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import {
  FactoryConfigSchema,
  FactoryConfig,
} from './schema';
import {
  ActorType,
  AdapterType,
  ActorAvailability,
  AutonomyLevel,
} from '../core';

export interface ConfigValidationResult {
  valid: boolean;
  config?: FactoryConfig;
  errors?: string[];
  path?: string;
}

@Injectable()
export class ConfigLoaderService {
  private readonly logger = new Logger(ConfigLoaderService.name);
  private currentConfig: FactoryConfig | null = null;
  private loadedPath: string | null = null;

  constructor(private readonly basePath: string = process.cwd()) {}

  /**
   * Find factory.yaml or factory.yml in basePath or given directory,
   * searching upwards in parent directories by default.
   */
  findConfigFile(searchDir?: string, upward: boolean = true): string | null {
    const rawTarget = searchDir || this.basePath;
    const resolvedTarget = path.isAbsolute(rawTarget)
      ? rawTarget
      : path.resolve(this.basePath, rawTarget);

    // If target is directly an existing file, return it
    if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isFile()) {
      return resolvedTarget;
    }

    let dir = resolvedTarget;
    while (true) {
      const candidates = [
        path.join(dir, 'factory.yaml'),
        path.join(dir, 'factory.yml'),
      ];

      for (const candidate of candidates) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return candidate;
        }
      }

      if (!upward) {
        break;
      }

      const parentDir = path.dirname(dir);
      if (parentDir === dir) {
        break; // Reached filesystem root
      }
      dir = parentDir;
    }

    return null;
  }

  /**
   * Check whether a factory.yaml or factory.yml exists.
   */
  hasConfigFile(searchDir?: string, upward: boolean = true): boolean {
    return this.findConfigFile(searchDir, upward) !== null;
  }

  /**
   * Return the path of the currently loaded config file, or null if using fallback defaults.
   */
  getLoadedPath(): string | null {
    return this.loadedPath;
  }

  /**
   * Get the active Factory configuration (loads if not already loaded).
   */
  getConfig(): FactoryConfig {
    if (!this.currentConfig) {
      this.currentConfig = this.loadConfig();
    }
    return this.currentConfig;
  }

  /**
   * Load configuration from explicit path or auto-located factory.yaml.
   * If explicitPath points to a directory, searches for factory.yaml within it (and upwards).
   * If no file exists, returns fallback default configuration.
   */
  loadConfig(explicitPath?: string): FactoryConfig {
    let filePath: string | null = null;

    if (explicitPath) {
      const resolved = path.isAbsolute(explicitPath)
        ? explicitPath
        : path.resolve(this.basePath, explicitPath);

      if (fs.existsSync(resolved)) {
        if (fs.statSync(resolved).isDirectory()) {
          filePath = this.findConfigFile(resolved, true);
          if (!filePath) {
            throw new Error(`Configuration file not found in directory: ${resolved}`);
          }
        } else {
          filePath = resolved;
        }
      } else {
        throw new Error(`Configuration file not found at: ${resolved}`);
      }
    } else {
      filePath = this.findConfigFile(this.basePath, true);
    }

    if (!filePath) {
      this.logger.debug('No factory.yaml found. Using fallback default configuration.');
      this.loadedPath = null;
      this.currentConfig = this.getDefaultConfig();
      return this.currentConfig;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = yaml.parse(content);
      const validated = FactoryConfigSchema.parse(parsed || {});

      this.loadedPath = filePath;
      this.currentConfig = validated;
      this.logger.log(`Loaded Factory configuration from: ${filePath}`);
      return this.currentConfig;
    } catch (err: any) {
      this.logger.error(`Failed to parse configuration file ${filePath}: ${err.message}`);
      throw err;
    }
  }

  /**
   * Validate configuration without throwing exceptions.
   */
  validateConfigFile(explicitPath?: string): ConfigValidationResult {
    let filePath: string | null = null;

    if (explicitPath) {
      const resolved = path.isAbsolute(explicitPath)
        ? explicitPath
        : path.resolve(this.basePath, explicitPath);

      if (fs.existsSync(resolved)) {
        if (fs.statSync(resolved).isDirectory()) {
          filePath = this.findConfigFile(resolved, true);
          if (!filePath) {
            return {
              valid: false,
              errors: [`Configuration file not found in directory: ${resolved}`],
              path: resolved,
            };
          }
        } else {
          filePath = resolved;
        }
      } else {
        return {
          valid: false,
          errors: [`Configuration file not found: ${resolved}`],
          path: resolved,
        };
      }
    } else {
      filePath = this.findConfigFile(this.basePath, true);
    }

    if (!filePath) {
      const defaultConfig = this.getDefaultConfig();
      return {
        valid: true,
        config: defaultConfig,
        errors: [],
        path: undefined,
      };
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      let parsed: any;
      try {
        parsed = yaml.parse(content);
      } catch (parseErr: any) {
        return {
          valid: false,
          errors: [`YAML Syntax Error: ${parseErr.message}`],
          path: filePath,
        };
      }

      const result = FactoryConfigSchema.safeParse(parsed || {});
      if (!result.success) {
        const errorMessages = result.error.errors.map(
          (e) => `${e.path.join('.') || 'root'}: ${e.message}`,
        );
        return {
          valid: false,
          errors: errorMessages,
          path: filePath,
        };
      }

      return {
        valid: true,
        config: result.data,
        errors: [],
        path: filePath,
      };
    } catch (err: any) {
      return {
        valid: false,
        errors: [`Unexpected error validating config: ${err.message}`],
        path: filePath,
      };
    }
  }

  /**
   * Returns fallback configuration when factory.yaml is absent.
   */
  getDefaultConfig(): FactoryConfig {
    return {
      name: 'software-factory',
      version: '1.0.0',
      description: 'Software Factory - System of Coordination for Humans and Agents',
      defaultBranch: 'main',
      actors: [
        {
          id: 'opencode',
          name: 'OpenCode CLI Agent',
          type: ActorType.INTERNAL_AGENT,
          adapter: AdapterType.CLI,
          capabilities: ['code_generation', 'implementation', 'refactoring', 'tests', 'debugging'],
          model: 'opencode/deepseek-v4.1-flash-free',
          availability: ActorAvailability.AVAILABLE,
          autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
          config: {},
        },
        {
          id: 'agy',
          name: 'Google Antigravity Agent',
          type: ActorType.INTERNAL_AGENT,
          adapter: AdapterType.CLI,
          capabilities: ['code_generation', 'implementation', 'refactoring'],
          model: 'gemini-3.8-flash',
          availability: ActorAvailability.AVAILABLE,
          autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
          config: {},
        },
        {
          id: 'claude',
          name: 'Claude Code Agent',
          type: ActorType.INTERNAL_AGENT,
          adapter: AdapterType.CLI,
          capabilities: ['architecture', 'code_review', 'security_audit', 'planning'],
          model: 'claude-3-7-sonnet',
          availability: ActorAvailability.AVAILABLE,
          autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
          config: {},
        },
        {
          id: 'human:ali',
          name: 'Ali (Human Gate)',
          type: ActorType.HUMAN,
          adapter: AdapterType.MANUAL,
          capabilities: ['approval', 'architecture_decision', 'merge'],
          availability: ActorAvailability.AVAILABLE,
          autonomyLevel: AutonomyLevel.HUMAN_ONLY,
          owner: 'ali-ahadi1105',
          config: {},
        },
      ],
      policies: {
        defaultAutonomy: AutonomyLevel.SEMI_AUTONOMOUS,
        requireApproval: true,
        timeoutSeconds: 300,
        maxRetries: 1,
        autoFallback: true,
        testCommand: 'pnpm test || npm test',
        skipTests: false,
        defaultImplementer: 'opencode',
        defaultReviewer: 'claude',
        customPolicies: {},
      },
      stages: [
        { name: 'issue', description: 'Create GitHub Issue first (System of Record)', required: true, config: {} },
        { name: 'branch', description: 'Create isolated Git Branch', required: true, config: {} },
        { name: 'implement', actor: 'opencode', description: 'Implementation via opencode with automatic fallback to claude', required: true, timeoutSeconds: 300, config: {} },
        { name: 'review', actor: 'claude', description: 'Review and verification via claude', required: true, timeoutSeconds: 300, config: {} },
        { name: 'test', description: 'Run automated test suite', required: true, config: {} },
        { name: 'pr', description: 'Commit, push, and open Pull Request', required: true, config: {} },
      ],
    };
  }
}
