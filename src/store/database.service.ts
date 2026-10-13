import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SCHEMA_SQL } from './schema';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db: DatabaseSync | null = null;
  private readonly dbPath: string;

  constructor(customPath?: string) {
    if (customPath) {
      this.dbPath = customPath;
    } else {
      const dir = process.env.FACTORY_DATA_DIR || path.join(process.cwd(), 'data');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.dbPath = path.join(dir, 'factory.db');
    }
  }

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    this.close();
  }

  connect(): DatabaseSync {
    if (this.db) return this.db;

    if (this.dbPath !== ':memory:') {
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(SCHEMA_SQL);
    return this.db;
  }

  getDb(): DatabaseSync {
    if (!this.db) {
      return this.connect();
    }
    return this.db;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  getDbPath(): string {
    return this.dbPath;
  }
}
