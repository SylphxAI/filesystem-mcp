# SOTA Family Roadmap

Status: adoption plan
Owner: Filesystem MCP
Scope: repo-local future plan and its role in the SylphxAI MCP family
Decision record: `docs/adr/ADR-194-mcp-family-sota-roadmap.md`

## Family Role

Filesystem MCP is the safe local operation engine for the MCP family. It gives
agents root-confined read, search, list, edit, duplicate-file, move, delete,
chmod, and chown capabilities with explicit validation and auditability.

It is the execution-side complement to evidence tools. Other MCPs help agents
understand files and decisions; Filesystem MCP changes the local project only
through guarded operations.

## Family Fit

| Project                 | Relationship                                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Architecture Reader MCP | Identifies architecture impact and affected files. Filesystem MCP performs safe reads or edits when an agent acts.             |
| CodeRAG                 | Finds relevant code evidence. Filesystem MCP applies file operations and can expose exact file content to retrieval workflows. |
| Reader MCPs             | Read media and documents. Filesystem MCP owns generic filesystem access and write safety, not media interpretation.            |
| Consultant MCP          | Reviews high-risk operations and policies. Filesystem MCP provides operation evidence and write ledgers.                       |
| Smart Reader MCP        | Routes media reads. Filesystem MCP stays broader and owns root-scoped filesystem tools.                                        |

## SOTA End State

Filesystem MCP should become the highest-trust local filesystem server for
agents: fast enough for large repositories, safe enough for autonomous writes,
and auditable enough to reconstruct every side effect.

## Runtime Direction

Rust should own path canonicalization, root confinement, symlink policy,
directory walking, streaming IO, hashing, search, diff preview, diff apply, and
operation ledgers. The TypeScript adapter can remain while tool schemas and
release compatibility are preserved.

WASM is not the default runtime for filesystem tools because the host capability
model is the product boundary. WASM may be used only for sandboxed transforms
that cannot escape the host policy engine.

## Roadmap

### Phase 0: Safety Contract

- Document every read and write tool with exact side-effect semantics.
- Add fixtures for symlink escape, path traversal, hidden files, binary files,
  oversized files, permission errors, and stale-write conflicts.
- Add dry-run examples for write-capable tools.
- Add operation evidence fields: root, resolved path, before hash, after hash,
  line range, operation id, and policy decision.

### Phase 1: Rust Policy And IO Core

- Implement canonical path and root policy in Rust.
- Add fast ignore-aware directory walk and content search.
- Add streaming reads and bounded memory behavior.
- Add deterministic diff preview and apply primitives.

### Phase 2: Write Integrity And Audit

- Require exact current hash or conflict detection for write operations.
- Add operation ledger entries for every side effect.
- Add rollback metadata where safe and honest recovery warnings where not safe.
- Add structured output for partial success and per-file failure.

### Phase 3: Policy Profiles

- Add read-only, write-approved, CI-safe, and high-risk-denied profiles.
- Add allowlist and denylist configuration with tests.
- Add policy export so other MCPs and agents know available capabilities.

### Phase 4: Native Distribution

- Ship platform-specific optional binary packages.
- Add `doctor` diagnostics for native engine, permissions, path policy, and
  unsupported filesystem features.
- Publish benchmark fixtures for walk, search, read batch, write batch, and diff
  apply operations.

## Star And Adoption Strategy

The public promise is safe speed: agents can work with files without falling
back to unbounded shell commands. Star growth comes from trustable safety
examples, clear write semantics, strong path-confinement proof, and immediate
batch-operation wins.

## Validation Gates

- Symlink escape attempts are denied.
- Writes detect stale content before mutating files.
- Search respects ignore and policy rules.
- Large repositories meet published walk and search latency gates.
- Audit output reconstructs every write operation.
