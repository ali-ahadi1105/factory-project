import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FactoryConfigSchema,
  ActorConfigSchema,
  PolicyConfigSchema,
  WorkflowStageSchema,
  ConfigLoaderService,
} from '../src/config';
import { DatabaseService, FactoryStoreService } from '../src/store';
import { LineageService, OrchestratorService } from '../src/engine';
import { MockAgentAdapter, GitHubAdapter, TelegramAdapter } from '../src/adapters';
import {
  ActorType,
  AdapterType,
  ActorAvailability,
  AutonomyLevel,
} from '../src/core';

describe('Factory Configuration and Schema', () => {
  describe('Schema Validation', () => {
    it('should validate minimal valid config and apply defaults', () => {
      const parsed = FactoryConfigSchema.parse({});
      expect(parsed.name).toBe('software-factory');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.defaultBranch).toBe('main');
      expect(parsed.actors).toEqual([]);
      expect(parsed.policies.requireApproval).toBe(true);
      expect(parsed.policies.timeoutSeconds).toBe(300);
      expect(parsed.policies.autoFallback).toBe(true);
      expect(parsed.stages).toEqual([]);
    });

    it('should parse and transform actor config correctly', () => {
      const actor = ActorConfigSchema.parse({
        id: 'test-agent',
        name: 'Test Agent',
        type: 'internal_agent',
        adapter: 'cli',
        capabilities: ['test_capability'],
        autonomy: 'semi_autonomous',
        model: 'gemini-3.8-flash',
      });

      expect(actor.id).toBe('test-agent');
      expect(actor.name).toBe('Test Agent');
      expect(actor.type).toBe(ActorType.INTERNAL_AGENT);
      expect(actor.adapter).toBe(AdapterType.CLI);
      expect(actor.autonomyLevel).toBe(AutonomyLevel.SEMI_AUTONOMOUS);
      expect(actor.model).toBe('gemini-3.8-flash');
      expect(actor.availability).toBe(ActorAvailability.AVAILABLE);
    });

    it('should reject actor config missing id or name', () => {
      expect(() => ActorConfigSchema.parse({ name: 'No ID' })).toThrow();
      expect(() => ActorConfigSchema.parse({ id: 'no-name' })).toThrow();
      expect(() => ActorConfigSchema.parse({ id: '', name: '' })).toThrow();
    });

    it('should parse policy config with custom values', () => {
      const policies = PolicyConfigSchema.parse({
        requireApproval: false,
        timeoutSeconds: 600,
        maxRetries: 3,
        autoFallback: false,
        testCommand: 'npm run test:all',
        skipTests: true,
      });

      expect(policies.requireApproval).toBe(false);
      expect(policies.timeoutSeconds).toBe(600);
      expect(policies.maxRetries).toBe(3);
      expect(policies.autoFallback).toBe(false);
      expect(policies.testCommand).toBe('npm run test:all');
      expect(policies.skipTests).toBe(true);
    });

    it('should resolve workflows into stages if stages is omitted', () => {
      const config = FactoryConfigSchema.parse({
        name: 'workflow-test',
        workflows: [
          { name: 'build', required: true },
          { name: 'deploy', required: false },
        ],
      });

      expect(config.stages.length).toBe(2);
      expect(config.stages[0].name).toBe('build');
      expect(config.stages[1].name).toBe('deploy');
    });

    it('should validate stage config', () => {
      const stage = WorkflowStageSchema.parse({
        name: 'custom-stage',
        actor: 'custom-actor',
        description: 'Runs custom tasks',
        required: true,
        timeoutSeconds: 120,
      });

      expect(stage.name).toBe('custom-stage');
      expect(stage.actor).toBe('custom-actor');
      expect(stage.timeoutSeconds).toBe(120);
    });
  });

  describe('ConfigLoaderService', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-cfg-test-'));
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should provide fallback defaults when factory.yaml is absent', () => {
      const loader = new ConfigLoaderService(tempDir);

      expect(loader.hasConfigFile()).toBe(false);
      expect(loader.findConfigFile()).toBeNull();

      const config = loader.getConfig();
      expect(config.name).toBe('software-factory');
      expect(config.actors.length).toBeGreaterThanOrEqual(3);
      expect(config.actors.map((a) => a.id)).toContain('agy');
      expect(config.actors.map((a) => a.id)).toContain('claude');
      expect(config.actors.map((a) => a.id)).toContain('human:ali');
      expect(loader.getLoadedPath()).toBeNull();
    });

    it('should load and validate a custom factory.yaml file', () => {
      const yamlContent = `
name: custom-factory
version: 2.0.0
description: Custom Factory Description
repository: my-org/my-factory
defaultBranch: develop

actors:
  - id: custom-bot
    name: Custom Bot
    type: internal_agent
    adapter: mcp
    model: custom-model
    capabilities:
      - custom_cap
    availability: available
    autonomy: semi_autonomous

policies:
  requireApproval: false
  timeoutSeconds: 450

stages:
  - name: test-stage
    description: Test description
    required: true
`;

      const yamlPath = path.join(tempDir, 'factory.yaml');
      fs.writeFileSync(yamlPath, yamlContent, 'utf-8');

      const loader = new ConfigLoaderService(tempDir);
      expect(loader.hasConfigFile()).toBe(true);

      const config = loader.loadConfig();
      expect(config.name).toBe('custom-factory');
      expect(config.version).toBe('2.0.0');
      expect(config.defaultBranch).toBe('develop');
      expect(config.actors.length).toBe(1);
      expect(config.actors[0].id).toBe('custom-bot');
      expect(config.actors[0].adapter).toBe('mcp');
      expect(config.policies.requireApproval).toBe(false);
      expect(config.policies.timeoutSeconds).toBe(450);
      expect(config.stages.length).toBe(1);
      expect(loader.getLoadedPath()).toBe(yamlPath);
    });

    it('should support factory.yml extension', () => {
      const yamlContent = `
name: yml-factory
version: 1.1.0
`;
      const yamlPath = path.join(tempDir, 'factory.yml');
      fs.writeFileSync(yamlPath, yamlContent, 'utf-8');

      const loader = new ConfigLoaderService(tempDir);
      expect(loader.hasConfigFile()).toBe(true);
      expect(loader.findConfigFile()).toBe(yamlPath);

      const config = loader.loadConfig();
      expect(config.name).toBe('yml-factory');
      expect(loader.getLoadedPath()).toBe(yamlPath);
    });

    it('should validate valid configuration file without throwing', () => {
      const yamlContent = `
name: valid-factory
version: 1.0.0
`;
      const yamlPath = path.join(tempDir, 'factory.yaml');
      fs.writeFileSync(yamlPath, yamlContent, 'utf-8');

      const loader = new ConfigLoaderService(tempDir);
      const res = loader.validateConfigFile();
      expect(res.valid).toBe(true);
      expect(res.config?.name).toBe('valid-factory');
      expect(res.errors?.length).toBe(0);
      expect(res.path).toBe(yamlPath);
    });

    it('should return errors for invalid YAML syntax', () => {
      const invalidYaml = `
name: invalid-factory
actors: [unclosed list
`;
      const yamlPath = path.join(tempDir, 'factory.yaml');
      fs.writeFileSync(yamlPath, invalidYaml, 'utf-8');

      const loader = new ConfigLoaderService(tempDir);
      const res = loader.validateConfigFile();
      expect(res.valid).toBe(false);
      expect(res.errors && res.errors[0]).toContain('YAML Syntax Error');
    });

    it('should return schema validation errors for malformed schema values', () => {
      const invalidContent = `
name: 123
actors:
  - id: ""
    name: ""
`;
      const yamlPath = path.join(tempDir, 'factory.yaml');
      fs.writeFileSync(yamlPath, invalidContent, 'utf-8');

      const loader = new ConfigLoaderService(tempDir);
      const res = loader.validateConfigFile();
      expect(res.valid).toBe(false);
      expect(res.errors?.length).toBeGreaterThan(0);
    });

    it('should report file not found when explicit path does not exist', () => {
      const loader = new ConfigLoaderService(tempDir);
      const nonExistent = path.join(tempDir, 'missing.yaml');
      const res = loader.validateConfigFile(nonExistent);
      expect(res.valid).toBe(false);
      expect(res.errors && res.errors[0]).toContain('Configuration file not found');

      expect(() => loader.loadConfig(nonExistent)).toThrow('Configuration file not found');
    });

    it('should load project root sample factory.yaml correctly', () => {
      const projectRoot = path.resolve(__dirname, '..');
      const rootLoader = new ConfigLoaderService(projectRoot);
      const res = rootLoader.validateConfigFile();
      expect(res.valid).toBe(true);
      expect(res.config?.name).toBe('software-factory');
      expect(res.config?.actors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Orchestrator Auto-Sync with Database', () => {
    let dbService: DatabaseService;
    let store: FactoryStoreService;
    let lineage: LineageService;
    let agyMock: MockAgentAdapter;
    let claudeMock: MockAgentAdapter;
    let githubAdapter: GitHubAdapter;
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-sync-test-'));
      dbService = new DatabaseService(':memory:');
      dbService.connect();
      store = new FactoryStoreService(dbService);
      lineage = new LineageService(store);
      agyMock = new MockAgentAdapter('agy');
      claudeMock = new MockAgentAdapter('claude');
      githubAdapter = new GitHubAdapter();
    });

    afterEach(() => {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('should auto-sync configured actors into factory.db on orchestrator startup', () => {
      const customYaml = `
name: sync-factory
actors:
  - id: custom-qa-agent
    name: QA Automation Bot
    type: internal_agent
    adapter: cli
    model: gemini-3.8-flash
    capabilities:
      - test_automation
      - fuzzing
    availability: available
    autonomy: semi_autonomous
`;
      fs.writeFileSync(path.join(tempDir, 'factory.yaml'), customYaml, 'utf-8');

      const configLoader = new ConfigLoaderService(tempDir);

      new OrchestratorService(
        store,
        lineage,
        agyMock as any,
        claudeMock as any,
        githubAdapter,
        undefined,
        undefined,
        configLoader,
      );

      const actor = store.getActor('custom-qa-agent');
      expect(actor).not.toBeNull();
      expect(actor?.name).toBe('QA Automation Bot');
      expect(actor?.capabilities).toContain('test_automation');
      expect(actor?.capabilities).toContain('fuzzing');
      expect(actor?.config.model).toBe('gemini-3.8-flash');
    });

    it('should fallback to default actors if configLoader is not provided', () => {
      new OrchestratorService(
        store,
        lineage,
        agyMock as any,
        claudeMock as any,
        githubAdapter,
      );

      const agy = store.getActor('agy');
      const claude = store.getActor('claude');
      const ali = store.getActor('human:ali');

      expect(agy).not.toBeNull();
      expect(claude).not.toBeNull();
      expect(ali).not.toBeNull();
    });

    it('should update existing actor if configuration changes', () => {
      // First save an actor
      store.saveActor({
        id: 'worker',
        name: 'Initial Worker',
        type: ActorType.INTERNAL_AGENT,
        adapterType: AdapterType.CLI,
        capabilities: ['initial'],
        availability: ActorAvailability.AVAILABLE,
        autonomyLevel: AutonomyLevel.SEMI_AUTONOMOUS,
        config: {},
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const updatedYaml = `
name: update-factory
actors:
  - id: worker
    name: Updated Worker Name
    capabilities:
      - updated_capability
`;
      fs.writeFileSync(path.join(tempDir, 'factory.yaml'), updatedYaml, 'utf-8');

      const configLoader = new ConfigLoaderService(tempDir);

      new OrchestratorService(
        store,
        lineage,
        agyMock as any,
        claudeMock as any,
        githubAdapter,
        undefined,
        undefined,
        configLoader,
      );

      const worker = store.getActor('worker');
      expect(worker?.name).toBe('Updated Worker Name');
      expect(worker?.capabilities).toContain('updated_capability');
    });
  });
});
