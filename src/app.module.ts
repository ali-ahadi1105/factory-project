import { Module } from '@nestjs/common';
import { DatabaseService, FactoryStoreService } from './store';
import { LineageService, OrchestratorService } from './engine';
import {
  AgyAdapter,
  ClaudeAdapter,
  MockAgentAdapter,
  GitHubAdapter,
  TelegramAdapter,
} from './adapters';

@Module({
  providers: [
    DatabaseService,
    FactoryStoreService,
    LineageService,
    AgyAdapter,
    ClaudeAdapter,
    MockAgentAdapter,
    GitHubAdapter,
    TelegramAdapter,
    OrchestratorService,
  ],
  exports: [
    DatabaseService,
    FactoryStoreService,
    LineageService,
    OrchestratorService,
    GitHubAdapter,
    TelegramAdapter,
  ],
})
export class AppModule {}
