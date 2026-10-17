import { Injectable, Logger } from '@nestjs/common';
import { BaseAgentAdapter, AgentResult } from './base.adapter';
import { ExecutionStatus, Work, Execution, CanonicalUri, Actor } from '../core';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

@Injectable()
export class OpencodeAdapter extends BaseAgentAdapter {
  readonly id = 'opencode';
  readonly name = 'OpenCode CLI';
  readonly capabilities = [
    'code_generation',
    'implementation',
    'refactoring',
    'tests',
    'debugging',
  ];

  private readonly logger = new Logger(OpencodeAdapter.name);
  private readonly executablePath: string;

  constructor(customPath?: string) {
    super();
    this.executablePath = customPath || this.resolveExecutablePath();
  }

  private resolveExecutablePath(): string {
    const homeDir = os.homedir();
    const candidatePaths = [
      path.join(homeDir, '.opencode', 'bin', 'opencode'),
      path.join(homeDir, '.local', 'bin', 'opencode'),
      '/usr/local/bin/opencode',
      '/usr/bin/opencode',
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return path.join(homeDir, '.opencode', 'bin', 'opencode');
  }

  async isAvailable(): Promise<boolean> {
    try {
      return fs.existsSync(this.executablePath);
    } catch {
      return false;
    }
  }

  async execute(
    work: Work,
    execution: Execution,
    workingDirectory: string,
    timeoutSeconds = 600,
    actor?: Actor,
  ): Promise<AgentResult> {
    if (!(await this.isAvailable())) {
      return {
        status: ExecutionStatus.FAILED,
        logs: '',
        error: `opencode binary not found at ${this.executablePath}`,
        producedReferences: [],
      };
    }

    const promptText = `Task: ${work.title}\n\nContext & Instructions:\n${work.description}\n\nWork ID: ${work.id}`;

    // Model selection: from actor or context, with default to deepseek-v4.1-flash-free
    const model =
      actor?.config?.model ||
      actor?.model ||
      (work.context?.model as string) ||
      'opencode/deepseek-v4.1-flash-free';

    const args = ['run', '--standalone', '--auto'];
    if (model) {
      args.push('-m', model);
    }
    args.push(promptText);

    const env = {
      ...process.env,
      https_proxy: process.env.https_proxy || 'http://127.0.0.1:10808',
      http_proxy: process.env.http_proxy || 'http://127.0.0.1:10808',
    };

    return new Promise<AgentResult>((resolve) => {
      let output = '';
      const proc = spawn(this.executablePath, args, {
        cwd: workingDirectory,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeoutTimer = setTimeout(() => {
        proc.kill('SIGTERM');
        resolve({
          status: ExecutionStatus.TIMED_OUT,
          logs: output,
          error: `Execution timed out after ${timeoutSeconds}s`,
          producedReferences: [],
        });
      }, timeoutSeconds * 1000);

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.stderr.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeoutTimer);
        const status = code === 0 ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED;
        const producedReferences: string[] = [
          CanonicalUri.agentRun(this.id, execution.id),
        ];

        // Check if output has a session ID
        const sessionMatch = output.match(/ses_[a-zA-Z0-9_-]+/);
        if (sessionMatch) {
          producedReferences.push(`agent://${this.id}/session/${sessionMatch[0]}`);
        }

        resolve({
          status,
          logs: output,
          error: code !== 0 ? `Process exited with code ${code}` : undefined,
          producedReferences,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timeoutTimer);
        resolve({
          status: ExecutionStatus.FAILED,
          logs: output,
          error: err.message,
          producedReferences: [],
        });
      });
    });
  }
}
