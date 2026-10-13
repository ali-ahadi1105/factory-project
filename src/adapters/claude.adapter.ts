import { Injectable, Logger } from '@nestjs/common';
import { BaseAgentAdapter, AgentResult } from './base.adapter';
import { ExecutionStatus, Work, Execution, CanonicalUri } from '../core';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

@Injectable()
export class ClaudeAdapter extends BaseAgentAdapter {
  readonly id = 'claude';
  readonly name = 'Claude Code CLI';
  readonly capabilities = ['planning', 'architecture', 'code_review', 'security_audit', 'refactoring', 'tests'];

  private readonly logger = new Logger(ClaudeAdapter.name);
  private readonly executablePath: string;

  constructor(customPath?: string) {
    super();
    this.executablePath = customPath || path.join(os.homedir(), '.local/bin/claude');
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
    timeoutSeconds = 300,
  ): Promise<AgentResult> {
    if (!(await this.isAvailable())) {
      return {
        status: ExecutionStatus.FAILED,
        logs: '',
        error: `claude binary not found at ${this.executablePath}`,
        producedReferences: [],
      };
    }

    const promptText = `Task: ${work.title}\n\nContext & Requirements:\n${work.description}\n\nWork ID: ${work.id}`;

    return new Promise<AgentResult>((resolve) => {
      let output = '';
      const proc = spawn(
        this.executablePath,
        ['-p', promptText, '--allowedTools', 'Write,Edit,Read,Bash'],
        {
          cwd: workingDirectory,
          env: process.env,
        },
      );

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
