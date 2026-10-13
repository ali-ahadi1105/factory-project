import { Injectable } from '@nestjs/common';
import { BaseAgentAdapter, AgentResult } from './base.adapter';
import { ExecutionStatus, Work, Execution, CanonicalUri } from '../core';

@Injectable()
export class MockAgentAdapter extends BaseAgentAdapter {
  readonly id = 'mock-agent';
  readonly name = 'Mock Testing Agent';
  readonly capabilities = ['code_generation', 'code_review', 'planning', 'testing'];

  public shouldFail = false;
  public customLogs = 'Mock agent execution succeeded.';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(
    work: Work,
    execution: Execution,
    workingDirectory: string,
    timeoutSeconds = 10,
  ): Promise<AgentResult> {
    if (this.shouldFail) {
      return {
        status: ExecutionStatus.FAILED,
        logs: 'Simulated failure in mock agent',
        error: 'Mock intentional error',
        producedReferences: [],
      };
    }

    return {
      status: ExecutionStatus.COMPLETED,
      logs: this.customLogs,
      producedReferences: [
        CanonicalUri.agentRun(this.id, execution.id),
      ],
    };
  }
}
