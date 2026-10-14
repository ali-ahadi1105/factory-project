import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as yaml from 'yaml';
import { InitService, InitResult } from '../src/engine/init.service';
import { FactoryConfigSchema } from '../src/config/schema';

describe('InitService (factory init)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-init-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Project Detection', () => {
    it('should detect repository and branch from git config', () => {
      const initService = new InitService(undefined, undefined, {
        execFn: (cmd: string) => {
          if (cmd.includes('remote.origin.url')) {
            return 'git@github.com:ali-ahadi1105/my-new-app.git\n';
          }
          if (cmd.includes('branch --show-current')) {
            return 'develop\n';
          }
          return '';
        },
      });

      const info = initService.detectProjectInfo(tempDir);
      expect(info.repository).toBe('ali-ahadi1105/my-new-app');
      expect(info.owner).toBe('ali-ahadi1105');
      expect(info.defaultBranch).toBe('develop');
    });

    it('should fallback gracefully when git commands fail', () => {
      const initService = new InitService(undefined, undefined, {
        execFn: () => {
          throw new Error('Not a git repository');
        },
      });

      const info = initService.detectProjectInfo(tempDir);
      expect(info.defaultBranch).toBe('main');
      expect(info.projectName).toBe(path.basename(tempDir));
    });
  });

  describe('Project Bootstrapping', () => {
    it('should generate valid factory.yaml, AGENTS.md, and CLAUDE.md in target directory', async () => {
      const initService = new InitService();
      const res: InitResult = await initService.initProject(tempDir, {
        projectName: 'ecommerce-backend',
        repository: 'ali-ahadi1105/ecommerce-backend',
        defaultBranch: 'main',
      });

      expect(res.projectName).toBe('ecommerce-backend');
      expect(res.createdFiles).toContain('factory.yaml');
      expect(res.createdFiles).toContain('AGENTS.md');
      expect(res.createdFiles).toContain('CLAUDE.md');

      const yamlPath = path.join(tempDir, 'factory.yaml');
      expect(fs.existsSync(yamlPath)).toBe(true);

      const parsedYaml = yaml.parse(fs.readFileSync(yamlPath, 'utf-8'));
      const validation = FactoryConfigSchema.safeParse(parsedYaml);
      expect(validation.success).toBe(true);

      expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
    });

    it('should not overwrite existing files without --force', async () => {
      const initService = new InitService();
      const yamlPath = path.join(tempDir, 'factory.yaml');
      fs.writeFileSync(yamlPath, 'custom: config', 'utf-8');

      const res = await initService.initProject(tempDir, { force: false });
      expect(res.skippedFiles).toContain('factory.yaml');
      expect(fs.readFileSync(yamlPath, 'utf-8')).toBe('custom: config');
    });

    it('should overwrite existing files when force is true', async () => {
      const initService = new InitService();
      const yamlPath = path.join(tempDir, 'factory.yaml');
      fs.writeFileSync(yamlPath, 'old: content', 'utf-8');

      const res = await initService.initProject(tempDir, { force: true });
      expect(res.overwrittenFiles).toContain('factory.yaml');
      expect(fs.readFileSync(yamlPath, 'utf-8')).not.toBe('old: content');
    });
  });
});
