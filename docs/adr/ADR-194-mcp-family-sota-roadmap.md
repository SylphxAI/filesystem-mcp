# ADR-194: Adopt Filesystem MCP Family SOTA Roadmap

Date: 2026-07-09
Status: Proposed in PR #194
Slug: mcp-family-sota-roadmap

## Context

Filesystem MCP is the safe local operation engine in the SylphxAI MCP family.
It needs a repo-local roadmap that sharpens its responsibility for root-scoped
filesystem access and guarded writes while preserving separation from code
retrieval, architecture understanding, media extraction, and deliberation.

## Decision

Adopt `docs/roadmap/sota-family-roadmap.md` as the local roadmap for Filesystem
MCP's family role.

Filesystem MCP owns root confinement, path policy, read/write operations,
search, batch behavior, diff apply semantics, operation evidence, and release
artifacts for the filesystem server.

## Consequences

- Architecture Reader and CodeRAG can identify relevant files, but Filesystem
  MCP owns safe filesystem side effects.
- Rust is the target for path canonicalization, policy, walking, search, IO,
  hashing, diff preview/apply, operation ledgers, and MCP serving through
  `modelcontextprotocol/rust-sdk` / `rmcp`.
- Write-capable tools require conflict detection, auditability, and clear
  recovery semantics.
- Shell execution must not become a hidden transport for filesystem behavior.

## Amendment: Rust-Native MCP Runtime

The family runtime direction now targets Rust MCP servers. Filesystem MCP may
keep TypeScript compatibility wrappers during migration, but the target MCP
server runtime is Rust with `rmcp`.

## Verification

- Roadmap added at `docs/roadmap/sota-family-roadmap.md`.
- README and PROJECT link to the roadmap.
- Docs-only validation: `git diff --check`.
