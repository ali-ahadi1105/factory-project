import { Injectable } from '@nestjs/common';
import { BaseAgentAdapter, AgentResult } from './base.adapter';
import { ExecutionStatus, Work, Execution, CanonicalUri, Actor } from '../core';

@Injectable()
export class MockAgentAdapter extends BaseAgentAdapter {
  readonly id: string;
  readonly name = 'Mock Testing Agent';
  readonly capabilities = ['code_generation', 'code_review', 'planning', 'testing'];

  public shouldFail = false;
  public customLogs = 'Mock agent execution succeeded.';
  public customError = 'Mock intentional error';
  /**
   * Number of initial executions that should fail (typically with a transient
   * error) before the agent starts succeeding. Useful for retry tests.
   */
  public failuresBeforeSuccess = 0;
  public lastActor?: Actor;
  public lastModel?: string;
  public lastWork?: Work;
  public executedWorks: Work[] = [];

  private attempts = 0;

  constructor(customId = 'mock-agent') {
    super();
    this.id = customId;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(
    work: Work,
    execution: Execution,
    workingDirectory: string,
    timeoutSeconds = 10,
    actor?: Actor,
  ): Promise<AgentResult> {
    this.lastActor = actor;
    this.lastModel = actor?.config?.model || actor?.model;
    this.lastWork = work;
    this.executedWorks.push(work);
    this.attempts++;

    if (this.shouldFail) {
      return {
        status: ExecutionStatus.FAILED,
        logs: 'Simulated failure in mock agent',
        error: this.customError,
        producedReferences: [],
      };
    }

    if (this.failuresBeforeSuccess > 0 && this.attempts <= this.failuresBeforeSuccess) {
      return {
        status: ExecutionStatus.FAILED,
        logs: this.customLogs,
        error: this.customError,
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
