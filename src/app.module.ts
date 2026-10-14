import { Module } from '@nestjs/common';
import { ConfigLoaderService } from './config';
import { DatabaseService, FactoryStoreService } from './store';
import {
  LineageService,
  OrchestratorService,
  ReporterService,
  StageRunnerService,
} from './engine';
import {
  AgyAdapter,
  ClaudeAdapter,
  MockAgentAdapter,
  GitHubAdapter,
  TelegramAdapter,
} from './adapters';

@Module({
  providers: [
    ConfigLoaderService,
    DatabaseService,
    FactoryStoreService,
    LineageService,
    ReporterService,
    AgyAdapter,
    ClaudeAdapter,
    MockAgentAdapter,
    GitHubAdapter,
    TelegramAdapter,
    StageRunnerService,
    OrchestratorService,
  ],
  exports: [
    ConfigLoaderService,
    DatabaseService,
    FactoryStoreService,
    LineageService,
    ReporterService,
    StageRunnerService,
    OrchestratorService,
    GitHubAdapter,
    TelegramAdapter,
  ],
})
export class AppModule {}
