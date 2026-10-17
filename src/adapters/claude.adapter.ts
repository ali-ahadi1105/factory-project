import { Injectable, Logger } from '@nestjs/common';
import { BaseAgentAdapter, AgentResult } from './base.adapter';
import { ExecutionStatus, Work, Execution, CanonicalUri, Actor } from '../core';
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

  /**
   * Claude CLI emits this style of message when it is handed a model
   * identifier it does not understand (e.g. a gateway-routed model id such as
   * `ag/gemini-3.8-flash-low`). It falls back to its default model, so the
   * warning must be surfaced cleanly and never crash the pipeline on its own.
   */
  private static readonly UNRECOGNIZED_MODEL_PATTERN =
    /unrecognized model|unknown model|invalid model|model .*not (?:found|supported|available|recognized)|there'?s an issue with the selected model|falling back to (?:the )?default model/i;

  constructor(customPath?: string) {
    super();
    this.executablePath = customPath || path.join(os.homedir(), '.local/bin/claude');
  }

  /**
   * Extract the first output line reporting an unrecognized/unsupported model.
   * Returns undefined when no such warning is present.
   */
  static extractModelWarning(text: string): string | undefined {
    if (!text) {
      return undefined;
    }
    const match = text
      .split(/\r?\n/)
      .find((line) => ClaudeAdapter.UNRECOGNIZED_MODEL_PATTERN.test(line));
    return match?.trim() || undefined;
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
        error: `claude binary not found at ${this.executablePath}`,
        producedReferences: [],
      };
    }

    const promptText = `Task: ${work.title}\n\nContext & Requirements:\n${work.description}\n\nWork ID: ${work.id}`;

    const model = actor?.config?.model || actor?.model || (work.context?.model as string);
    const args = [
      '-p',
      promptText,
      '--dangerously-skip-permissions',
      '--allowedTools',
      'Write,Edit,Read,Bash',
    ];
    if (model) {
      args.push('--model', model);
    }

    return new Promise<AgentResult>((resolve) => {
      let output = '';
      const proc = spawn(
        this.executablePath,
        args,
        {
          cwd: workingDirectory,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
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
        const producedReferences: string[] = [
          CanonicalUri.agentRun(this.id, execution.id),
        ];

        const modelWarning = ClaudeAdapter.extractModelWarning(output);
        const status = code === 0 ? ExecutionStatus.COMPLETED : ExecutionStatus.FAILED;
        let error = code !== 0 ? `Process exited with code ${code}` : undefined;

        if (modelWarning) {
          if (code !== 0) {
            // Surface a clean, actionable message instead of the raw CLI noise.
            // The orchestrator classifies this as a non-fatal review failure.
            error = `Claude CLI unrecognized model${model ? ` "${model}"` : ''}: ${modelWarning}`;
            this.logger.warn(`[Claude] ${error}`);
          } else {
            this.logger.warn(
              `[Claude] Proceeding despite an unrecognized model warning${model ? ` for "${model}"` : ''}: ${modelWarning}`,
            );
          }
        }

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
