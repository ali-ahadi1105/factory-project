import { ExecutionStatus, Work, Execution } from '../core';

export interface AgentResult {
  status: ExecutionStatus;
  logs: string;
  error?: string;
  producedReferences: string[];
}

export abstract class BaseAgentAdapter {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly capabilities: string[];

  abstract isAvailable(): Promise<boolean>;

  abstract execute(
    work: Work,
    execution: Execution,
    workingDirectory: string,
    timeoutSeconds?: number,
  ): Promise<AgentResult>;
}
