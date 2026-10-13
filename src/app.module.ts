import { Module } from '@nestjs/common';
import { DatabaseService, FactoryStoreService } from './store';
import { LineageService, OrchestratorService } from './engine';
import { AgyAdapter, ClaudeAdapter, MockAgentAdapter, GitHubAdapter } from './adapters';

@Module({
  providers: [
    DatabaseService,
    FactoryStoreService,
    LineageService,
    AgyAdapter,
    ClaudeAdapter,
    MockAgentAdapter,
    GitHubAdapter,
    OrchestratorService,
  ],
  exports: [
    DatabaseService,
    FactoryStoreService,
    LineageService,
    OrchestratorService,
    GitHubAdapter,
  ],
})
export class AppModule {}
