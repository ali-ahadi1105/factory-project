import { Injectable, Logger } from '@nestjs/common';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';

const execAsync = promisify(exec);

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
}

export interface GitHubPr {
  number: number;
  title: string;
  url: string;
  state: string;
  headRefName: string;
  baseRefName: string;
}

@Injectable()
export class GitHubAdapter {
  private readonly logger = new Logger(GitHubAdapter.name);

  async isAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('gh --version');
      return stdout.includes('gh version');
    } catch {
      return false;
    }
  }

  async detectRepo(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync('git remote get-url origin', { cwd });
      const raw = stdout.trim();
      const match = raw.match(/github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/);
      if (match) {
        return `${match[1]}/${match[2]}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  async checkAuth(): Promise<boolean> {
    try {
      const { stdout, stderr } = await execAsync('gh auth status');
      return stdout.includes('Logged in') || stderr.includes('Logged in');
    } catch {
      return false;
    }
  }

  async createIssue(
    repo: string,
    title: string,
    body: string,
    labels: string[] = [],
  ): Promise<GitHubIssue> {
    const labelArgs = labels.map((l) => `--label "${l}"`).join(' ');
    const cmd = `gh issue create --repo "${repo}" --title "${title}" --body "${body}" ${labelArgs}`;
    const { stdout } = await execAsync(cmd);
    const url = stdout.trim();
    const match = url.match(/\/issues\/(\d+)$/);
    const number = match ? parseInt(match[1], 10) : 0;

    return {
      number,
      title,
      body,
      url,
      state: 'OPEN',
    };
  }

  async addIssueComment(repo: string, issueNumber: number, body: string): Promise<void> {
    const tmpBodyFile = path.join(
      os.tmpdir(),
      `gh_comment_${Date.now()}_${Math.random().toString(36).slice(2)}.md`,
    );
    const fs = await import('node:fs');
    fs.writeFileSync(tmpBodyFile, body, 'utf-8');

    try {
      const cmd = `gh issue comment ${issueNumber} --repo "${repo}" --body-file "${tmpBodyFile}"`;
      await execAsync(cmd);
    } finally {
      try {
        if (fs.existsSync(tmpBodyFile)) {
          fs.unlinkSync(tmpBodyFile);
        }
      } catch {}
    }
  }

  async listIssues(repo: string, state: 'open' | 'closed' | 'all' = 'open'): Promise<GitHubIssue[]> {
    const cmd = `gh issue list --repo "${repo}" --state ${state} --json number,title,body,url,state`;
    const { stdout } = await execAsync(cmd);
    try {
      return JSON.parse(stdout);
    } catch {
      return [];
    }
  }

  async createBranch(cwd: string, branchName: string): Promise<void> {
    await execAsync(`git checkout -b "${branchName}"`, { cwd });
  }

  async commitAll(cwd: string, message: string): Promise<string> {
    await execAsync('git add .', { cwd });
    await execAsync(`git commit -m "${message}"`, { cwd });
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd });
    return stdout.trim();
  }

  async pushBranch(cwd: string, branchName: string): Promise<void> {
    await execAsync(`git push -u origin "${branchName}"`, { cwd });
  }

  async createPullRequest(
    cwd: string,
    title: string,
    body: string,
    base = 'main',
  ): Promise<GitHubPr> {
    const tmpBodyFile = path.join(os.tmpdir(), `gh_pr_body_${Date.now()}_${Math.random().toString(36).slice(2)}.md`);
    const fs = await import('node:fs');
    fs.writeFileSync(tmpBodyFile, body, 'utf-8');

    try {
      const escapedTitle = title.replace(/"/g, '\\"');
      const cmd = `gh pr create --title "${escapedTitle}" --body-file "${tmpBodyFile}" --base "${base}"`;
      const { stdout } = await execAsync(cmd, { cwd });
      const url = stdout.trim();
      const match = url.match(/\/pull\/(\d+)$/);
      const number = match ? parseInt(match[1], 10) : 0;

      return {
        number,
        title,
        url,
        state: 'OPEN',
        headRefName: '',
        baseRefName: base,
      };
    } finally {
      try {
        if (fs.existsSync(tmpBodyFile)) {
          fs.unlinkSync(tmpBodyFile);
        }
      } catch {}
    }
  }

  async mergePullRequest(cwd: string, prNumber: number): Promise<boolean> {
    try {
      await execAsync(`gh pr merge ${prNumber} --merge --delete-branch`, { cwd });
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to merge PR ${prNumber}: ${err.message}`);
      return false;
    }
  }
}
