import { Injectable, Logger } from '@nestjs/common';
import { BaseAgentAdapter, AgentResult } from './base.adapter';
import { ExecutionStatus, Work, Execution, CanonicalUri, Actor } from '../core';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

@Injectable()
export class AgyAdapter extends BaseAgentAdapter {
  readonly id = 'agy';
  readonly name = 'Google Antigravity CLI';
  readonly capabilities = ['code_generation', 'implementation', 'refactoring', 'tests'];

  private readonly logger = new Logger(AgyAdapter.name);
  private readonly executablePath: string;

  constructor(customPath?: string) {
    super();
    this.executablePath = customPath || path.join(os.homedir(), '.local/bin/agy');
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
    actor?: Actor,
  ): Promise<AgentResult> {
    if (!(await this.isAvailable())) {
      return {
        status: ExecutionStatus.FAILED,
        logs: '',
        error: `agy binary not found at ${this.executablePath}`,
        producedReferences: [],
      };
    }

    const promptText = `Task: ${work.title}\n\nContext & Instructions:\n${work.description}\n\nWork ID: ${work.id}`;

    // Write prompt to a temporary file to avoid shell escaping issues
    const tmpPromptFile = path.join(os.tmpdir(), `agy_prompt_${execution.id}.txt`);
    fs.writeFileSync(tmpPromptFile, promptText, 'utf-8');

    const env = {
      ...process.env,
      https_proxy: process.env.https_proxy || 'http://127.0.0.1:10808',
      http_proxy: process.env.http_proxy || 'http://127.0.0.1:10808',
    };

    const model = actor?.config?.model || actor?.model || (work.context?.model as string);
    const args = ['-p', promptText, '--mode=accept-edits', '--dangerously-skip-permissions'];
    if (model) {
      args.push('--model', model);
    }

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
        try {
          if (fs.existsSync(tmpPromptFile)) {
            fs.unlinkSync(tmpPromptFile);
          }
        } catch {}

        const isSoftDenied =
          output.includes('a tool required the "command" permission') ||
          output.includes('no output produced — a tool required') ||
          output.includes('Eligibility check failed');

        const isFailed = code !== 0 || isSoftDenied;
        const status = isFailed ? ExecutionStatus.FAILED : ExecutionStatus.COMPLETED;
        const error = isSoftDenied
          ? 'Tool permission soft-denied or prompt denied in headless mode'
          : code !== 0
            ? `Process exited with code ${code}`
            : undefined;

        const producedReferences: string[] = [
          CanonicalUri.agentRun(this.id, execution.id),
        ];

        resolve({
          status,
          logs: output,
          error,
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
