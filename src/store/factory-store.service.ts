import { Injectable } from '@nestjs/common';
import { DatabaseService } from './database.service';
import {
  Work,
  Actor,
  Execution,
  Reference,
  Relation,
  Signal,
  WorkStatus,
  ExecutionStatus,
  SignalStatus,
  LineageGraph,
  LineageNode,
  LineageEdge,
} from '../core';

@Injectable()
export class FactoryStoreService {
  constructor(private readonly dbService: DatabaseService) {}

  private get db() {
    return this.dbService.getDb();
  }

  // --- WORKS ---

  saveWork(work: Work): Work {
    const stmt = this.db.prepare(`
      INSERT INTO works (id, title, description, type, status, priority, assigned_actor_id, context, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        description = excluded.description,
        type = excluded.type,
        status = excluded.status,
        priority = excluded.priority,
        assigned_actor_id = excluded.assigned_actor_id,
        context = excluded.context,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      work.id,
      work.title,
      work.description,
      work.type,
      work.status,
      work.priority,
      work.assignedActorId || null,
      JSON.stringify(work.context || {}),
      work.createdAt,
      work.updatedAt,
    );
    return work;
  }

  getWork(id: string): Work | null {
    const row = this.db.prepare('SELECT * FROM works WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      status: row.status,
      priority: row.priority,
      assignedActorId: row.assigned_actor_id || undefined,
      context: JSON.parse(row.context || '{}'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listWorks(status?: WorkStatus): Work[] {
    const query = status ? 'SELECT * FROM works WHERE status = ? ORDER BY created_at DESC' : 'SELECT * FROM works ORDER BY created_at DESC';
    const rows = (status ? this.db.prepare(query).all(status) : this.db.prepare(query).all()) as any[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      type: r.type,
      status: r.status,
      priority: r.priority,
      assignedActorId: r.assigned_actor_id || undefined,
      context: JSON.parse(r.context || '{}'),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
  }

  // --- ACTORS ---

  saveActor(actor: Actor): Actor {
    const stmt = this.db.prepare(`
      INSERT INTO actors (id, name, type, adapter_type, capabilities, availability, autonomy_level, owner, config, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        type = excluded.type,
        adapter_type = excluded.adapter_type,
        capabilities = excluded.capabilities,
        availability = excluded.availability,
        autonomy_level = excluded.autonomy_level,
        owner = excluded.owner,
        config = excluded.config
    `);
    stmt.run(
      actor.id,
      actor.name,
      actor.type,
      actor.adapterType,
      JSON.stringify(actor.capabilities || []),
      actor.availability,
      actor.autonomyLevel,
      actor.owner || null,
      JSON.stringify(actor.config || {}),
      actor.createdAt,
    );
    return actor;
  }

  getActor(id: string): Actor | null {
    const row = this.db.prepare('SELECT * FROM actors WHERE id = ?').get(id) as any;
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      adapterType: row.adapter_type,
      capabilities: JSON.parse(row.capabilities || '[]'),
      availability: row.availability,
      autonomyLevel: row.autonomy_level,
      owner: row.owner || undefined,
      config: JSON.parse(row.config || '{}'),
      createdAt: row.created_at,
    };
  }

  listActors(): Actor[] {
    const rows = this.db.prepare('SELECT * FROM actors ORDER BY name ASC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      adapterType: r.adapter_type,
      capabilities: JSON.parse(r.capabilities || '[]'),
      availability: r.availability,
      autonomyLevel: r.autonomy_level,
      owner: r.owner || undefined,
      config: JSON.parse(r.config || '{}'),
      createdAt: r.created_at,
    }));
  }

  // --- EXECUTIONS ---

  saveExecution(exec: Execution): Execution {
    const stmt = this.db.prepare(`
      INSERT INTO executions (id, work_id, actor_id, status, correlation_id, causation_id, logs, error, produced_references, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        logs = excluded.logs,
        error = excluded.error,
        produced_references = excluded.produced_references,
        finished_at = excluded.finished_at
    `);
    stmt.run(
      exec.id,
      exec.workId,
      exec.actorId,
      exec.status,
      exec.correlationId,
      exec.causationId,
      exec.logs || '',
      exec.error || null,
      JSON.stringify(exec.producedReferences || []),
      exec.startedAt,
      exec.finishedAt || null,
    );
    return exec;
  }

  getExecution(id: string): Execution | null {
    const r = this.db.prepare('SELECT * FROM executions WHERE id = ?').get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      workId: r.work_id,
      actorId: r.actor_id,
      status: r.status,
      correlationId: r.correlation_id,
      causationId: r.causation_id,
      logs: r.logs || '',
      error: r.error || undefined,
      producedReferences: JSON.parse(r.produced_references || '[]'),
      startedAt: r.started_at,
      finishedAt: r.finished_at || undefined,
    };
  }

  listExecutionsForWork(workId: string): Execution[] {
    const rows = this.db.prepare('SELECT * FROM executions WHERE work_id = ? ORDER BY started_at ASC').all(workId) as any[];
    return rows.map((r) => ({
      id: r.id,
      workId: r.work_id,
      actorId: r.actor_id,
      status: r.status,
      correlationId: r.correlation_id,
      causationId: r.causation_id,
      logs: r.logs || '',
      error: r.error || undefined,
      producedReferences: JSON.parse(r.produced_references || '[]'),
      startedAt: r.started_at,
      finishedAt: r.finished_at || undefined,
    }));
  }

  // --- REFERENCES ---

  saveReference(ref: Reference): Reference {
    const stmt = this.db.prepare(`
      INSERT INTO references_store (id, uri, scheme, target_type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(uri) DO UPDATE SET
        metadata = excluded.metadata
    `);
    stmt.run(
      ref.id,
      ref.uri,
      ref.scheme,
      ref.targetType,
      JSON.stringify(ref.metadata || {}),
      ref.createdAt,
    );
    return ref;
  }

  getReferenceByUri(uri: string): Reference | null {
    const r = this.db.prepare('SELECT * FROM references_store WHERE uri = ?').get(uri) as any;
    if (!r) return null;
    return {
      id: r.id,
      uri: r.uri,
      scheme: r.scheme,
      targetType: r.target_type,
      metadata: JSON.parse(r.metadata || '{}'),
      createdAt: r.created_at,
    };
  }

  listReferences(): Reference[] {
    const rows = this.db.prepare('SELECT * FROM references_store ORDER BY created_at DESC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      uri: r.uri,
      scheme: r.scheme,
      targetType: r.target_type,
      metadata: JSON.parse(r.metadata || '{}'),
      createdAt: r.created_at,
    }));
  }

  // --- RELATIONS ---

  saveRelation(rel: Relation): Relation {
    const stmt = this.db.prepare(`
      INSERT INTO relations (id, source_ref, target_ref, relation_type, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      rel.id,
      rel.sourceRef,
      rel.targetRef,
      rel.relationType,
      JSON.stringify(rel.metadata || {}),
      rel.createdAt,
    );
    return rel;
  }

  getRelationsForSource(sourceRef: string): Relation[] {
    const rows = this.db.prepare('SELECT * FROM relations WHERE source_ref = ?').all(sourceRef) as any[];
    return rows.map((r) => ({
      id: r.id,
      sourceRef: r.source_ref,
      targetRef: r.target_ref,
      relationType: r.relation_type,
      metadata: JSON.parse(r.metadata || '{}'),
      createdAt: r.created_at,
    }));
  }

  getRelationsForTarget(targetRef: string): Relation[] {
    const rows = this.db.prepare('SELECT * FROM relations WHERE target_ref = ?').all(targetRef) as any[];
    return rows.map((r) => ({
      id: r.id,
      sourceRef: r.source_ref,
      targetRef: r.target_ref,
      relationType: r.relation_type,
      metadata: JSON.parse(r.metadata || '{}'),
      createdAt: r.created_at,
    }));
  }

  getAllRelations(): Relation[] {
    const rows = this.db.prepare('SELECT * FROM relations ORDER BY created_at ASC').all() as any[];
    return rows.map((r) => ({
      id: r.id,
      sourceRef: r.source_ref,
      targetRef: r.target_ref,
      relationType: r.relation_type,
      metadata: JSON.parse(r.metadata || '{}'),
      createdAt: r.created_at,
    }));
  }

  // --- SIGNALS ---

  saveSignal(sig: Signal): Signal {
    const stmt = this.db.prepare(`
      INSERT INTO signals (id, source, signal_type, payload, source_ref, idempotency_key, correlation_id, causation_id, status, occurred_at, processed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        status = excluded.status,
        processed_at = excluded.processed_at
    `);
    stmt.run(
      sig.id,
      sig.source,
      sig.signalType,
      JSON.stringify(sig.payload || {}),
      sig.sourceRef || null,
      sig.idempotencyKey,
      sig.correlationId,
      sig.causationId || null,
      sig.status,
      sig.occurredAt,
      sig.processedAt || null,
    );
    return sig;
  }

  getSignalByIdempotencyKey(key: string): Signal | null {
    const r = this.db.prepare('SELECT * FROM signals WHERE idempotency_key = ?').get(key) as any;
    if (!r) return null;
    return {
      id: r.id,
      source: r.source,
      signalType: r.signal_type,
      payload: JSON.parse(r.payload || '{}'),
      sourceRef: r.source_ref || undefined,
      idempotencyKey: r.idempotency_key,
      correlationId: r.correlation_id,
      causationId: r.causation_id || undefined,
      status: r.status,
      occurredAt: r.occurred_at,
      processedAt: r.processed_at || undefined,
    };
  }

  // --- LINEAGE GRAPH QUERY ---

  getLineageGraph(rootRef: string): LineageGraph {
    const nodesMap = new Map<string, LineageNode>();
    const edges: LineageEdge[] = [];
    const edgeKeySet = new Set<string>();
    const visited = new Set<string>();

    const addEdge = (from: string, to: string, relationType: any, metadata: any) => {
      const key = `${from}|${to}|${relationType}`;
      if (!edgeKeySet.has(key)) {
        edgeKeySet.add(key);
        edges.push({ from, to, relationType, metadata });
      }
    };

    const traverse = (currentRef: string) => {
      if (visited.has(currentRef)) return;
      visited.add(currentRef);

      if (!nodesMap.has(currentRef)) {
        nodesMap.set(currentRef, {
          ref: currentRef,
          type: this.guessRefType(currentRef),
          label: currentRef,
        });
      }

      // Outgoing edges
      const outgoing = this.getRelationsForSource(currentRef);
      for (const rel of outgoing) {
        addEdge(rel.sourceRef, rel.targetRef, rel.relationType, rel.metadata);
        traverse(rel.targetRef);
      }

      // Incoming edges
      const incoming = this.getRelationsForTarget(currentRef);
      for (const rel of incoming) {
        addEdge(rel.sourceRef, rel.targetRef, rel.relationType, rel.metadata);
        traverse(rel.sourceRef);
      }
    };

    traverse(rootRef);

    return {
      rootRef,
      nodes: Array.from(nodesMap.values()),
      edges,
    };
  }

  private guessRefType(ref: string): string {
    if (ref.startsWith('factory://work/')) return 'work';
    if (ref.startsWith('agent://')) return 'agent_execution';
    if (ref.startsWith('github://issue/')) return 'github_issue';
    if (ref.startsWith('github://pr/')) return 'github_pr';
    if (ref.startsWith('git://commit/')) return 'git_commit';
    if (ref.startsWith('signal://')) return 'signal';
    return 'reference';
  }
}
