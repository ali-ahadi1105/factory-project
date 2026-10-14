import { Module } from '@nestjs/common';
import { ConfigLoaderService } from './config';
import { DatabaseService, FactoryStoreService } from './store';
import {
  LineageService,
  OrchestratorService,
  ReporterService,
  StageRunnerService,
  DoctorService,
  InitService,
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
    DoctorService,
    InitService,
  ],
  exports: [
    ConfigLoaderService,
    DatabaseService,
    FactoryStoreService,
    LineageService,
    ReporterService,
    StageRunnerService,
    OrchestratorService,
    DoctorService,
    InitService,
    GitHubAdapter,
    TelegramAdapter,
  ],
})
export class AppModule {}
