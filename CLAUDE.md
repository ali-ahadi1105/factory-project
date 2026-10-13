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

## Mandatory Factory Pipeline Protocol (For All Agents & Orchestrators)
Whenever a development task or bug fix is requested (via Telegram, CLI, or Chat):
1. **Never perform local-only modifications without completing the full lifecycle.**
2. **Phase 1 - Issue First:** An Issue MUST be created on GitHub (`ali-ahadi1105/factory-project`) to establish the task in the System of Record.
3. **Phase 2 - Feature Branch:** Work MUST be isolated in `feature/issue-{num}-{slug}`.
4. **Phase 3 - Implementation & Fallback:** Try `agy` (Gemini 3.8 Flash). If `agy` encounters tool permission limits or timeout, automatically fallback to `claude`. Verify all project tests pass (`pnpm test`).
5. **Phase 4 - Code Review:** `claude` reviews the diff for security and code quality.
6. **Phase 5 - Push & Pull Request:** Commit, push branch to origin, and open a Pull Request linking `Closes #{issue}` for human approval.
7. **Deliverable Delivery:** Always provide the GitHub Issue link, Pull Request link, test verification status, and Lineage graph.
