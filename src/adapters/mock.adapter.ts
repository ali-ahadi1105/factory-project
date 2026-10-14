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
  public lastActor?: Actor;
  public lastModel?: string;
  public lastWork?: Work;
  public executedWorks: Work[] = [];

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
