# Software Factory (`factory-project`)

**System of Coordination for Humans, Agents, and Tools**  
*Architected and developed according to Software Factory Concept v31.*

---

## 1. Vision & Core Invariants

The Software Factory is a **System of Coordination**, not a System of Record. External platforms continue doing what they do best:
- **GitHub**: Source code, branches, commits, PRs, issues
- **Telegram / Chat**: Human discussions & requests
- **Agent Runtimes (`agy`, `claude`)**: Code generation, reviews, audits
- **CI/CD**: Build, automated testing, deployments

The Factory tracks **causality, relations, and execution lifecycle**:
```text
Event / Signal (Telegram / GitHub)
       ↓
Rule / Policy Intake
       ↓
      Work
       ↓
     Actor (Human or Agent)
       ↓
   Execution (Attempt & Run)
       ↓
References & Relations (Lineage Graph)
       ↓
Human Approval Gate (Merge)
```

---

## 2. Core Primitives (Minimal Core)

1. **Work:** Unit of task to be tracked and coordinated.
2. **Actor:** Performer of Work (`human:ali`, `agy`, `claude`). Humans and Agents share the exact same model.
3. **Execution:** Specific run/attempt of a Work item with `correlation_id` and `causation_id`.
4. **Reference:** Persistent canonical URI pointer (`github://issue/...`, `github://pr/...`, `git://commit/...`, `agent://...`).
5. **Relation:** Directed causal edge (`triggered-by`, `performed-by`, `produced`, `verifies`, `caused`, `depends-on`).
6. **Signal:** Ingested external event before it transitions into Work (idempotency enforced).

---

## 3. Technology Stack

- **Runtime:** Node.js v24+/v26+ / TypeScript
- **Architecture:** Clean Modular Architecture (NestJS / TypeScript)
- **Database:** SQLite (`node:sqlite` DatabaseSync) with WAL mode and foreign key constraints
- **Testing:** `jest` + `ts-jest`
- **Agents:**
  - `agy`: Google Antigravity CLI (`gemini-3.8-flash-high`)
  - `claude`: Claude Code CLI (`gemini-3.8-flash-high` via 9Router)

---

## 4. Quickstart

### Installation & Build
```bash
# Install dependencies
pnpm install

# Run full test suite
pnpm test

# Build production bundle
pnpm run build
```

### CLI Commands
```bash
# Initialize database and default actors
node dist/cli.js init

# List registered actors
node dist/cli.js actor list

# Create a Work item manually
node dist/cli.js work create "Implement auth service" --desc "Add JWT token validation"

# List all Work items
node dist/cli.js work list

# Execute a Work item with an agent
node dist/cli.js run <workId> --actor agy

# View ASCII Lineage Tree
node dist/cli.js lineage <workId>

# Run continuous coordination daemon
node dist/cli.js daemon --interval 5
```

---

## 5. Automated Pipeline Flow

When a signal arrives (from Telegram or CLI):
1. **Intake:** Deduplicated via `idempotencyKey`. Creates Work and marks `triggered-by`.
2. **Implementation:** Dispatched to `agy` (Gemini 3.8 Flash) inside an isolated Git feature branch.
3. **Verification:** Dispatched to `claude` (Thinking) with `verifies` relation.
4. **Pull Request:** Pushes branch and opens a GitHub Pull Request with full execution lineage report.
5. **Human Gate:** Ali approves and merges on GitHub.
