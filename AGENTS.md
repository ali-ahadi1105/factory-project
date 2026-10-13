# Software Factory (factory-project)

System of Coordination for software development, orchestrating humans, agents (agy, claude), and tools (GitHub, Telegram).

## Core Architecture (Based on Concept v31)
- **Role:** System of Coordination, NOT System of Record. External data stays in external systems; Factory stores only `Reference + Relation + Coordination State`.
- **Minimal Core Primitives:**
  - `Work`: Task to track/perform (`status`, `title`, `description`, `context`, `id`)
  - `Actor`: Performer of work (Human or Agent share the SAME model with `actor_type`, `id`, `capabilities`, `adapter`)
  - `Execution`: Run/attempt of Work (`id`, `work_id`, `actor_id`, `status`, `correlation_id`, `causation_id`, `logs`)
  - `Reference`: Persistent pointer to entity (`uri` like `github://issue/1`, `git://commit/sha`, `file://path`)
  - `Relation`: Link between entities (`relation_type`: `triggered-by`, `performed-by`, `produced`, `depends-on`, `verifies`, `derived-from`, `caused`)
  - `Event` / `Signal`: Incoming triggers moving the flow.

## Technology Stack & Environment
- **Runtime:** Node.js v24+/v26+ with TypeScript
- **Architecture:** Clean Modular Architecture (NestJS / TypeScript)
- **Package Manager:** `pnpm`
- **Database:** SQLite (`factory.db`) using better-sqlite3 or sqlite3 for local persistence of Core primitives and relations
- **CLI & Daemon:** Standalone entrypoint / commands for daemon, work, lineage, signal intake
- **Testing:** `jest` / `vitest` via `pnpm test`
- **Agent Executables:**
  - `agy`: `$HOME/.local/bin/agy` (Google Antigravity CLI)
  - `claude`: `$HOME/.local/bin/claude` (Claude Code CLI)

## Standards
- Strict TypeScript (`strict: true`)
- Full documentation & typed DTOs/Entities
- 100% test coverage for core domain services and adapters
- Non-blocking error handling and graceful degradation
