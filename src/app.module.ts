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
  ProgressDispatcherService,
} from './engine';
import {
  AgyAdapter,
  ClaudeAdapter,
  MockAgentAdapter,
  OpencodeAdapter,
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
    ProgressDispatcherService,
    AgyAdapter,
    ClaudeAdapter,
    MockAgentAdapter,
    OpencodeAdapter,
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
    ProgressDispatcherService,
    GitHubAdapter,
    TelegramAdapter,
  ],
})
export class AppModule {}
