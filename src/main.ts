import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OrchestratorService } from './engine';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const orchestrator = app.get(OrchestratorService);
  console.log('Software Factory Application Context initialized.');
}

if (require.main === module) {
  bootstrap();
}
