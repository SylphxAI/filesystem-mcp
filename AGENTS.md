# Agent Instructions

Engineering doctrine: https://github.com/SylphxAI/doctrine

Before changing behavior, read `PROJECT.md`, `.doctrine/project.json`, the
central doctrine entry points, and triggered doctrine standards. This file is a
thin runtime adapter; keep enterprise policy in doctrine.

## Local Commands

- `pnpm install --frozen-lockfile` - install dependencies.
- `pnpm run validate` - formatting, lint, typecheck, and tests.
- `pnpm run build` - build package artifacts.
- `pnpm run docs:build` - build documentation.

## Local Hazards

- This is a security-sensitive MCP filesystem server. Path confinement, batch
  write/edit behavior, chmod/chown, and delete/copy/move tools are public safety
  contracts.
- Release workflows publish npm, Docker Hub images, GitHub releases, and docs.
  Published artifacts are forward-fix-only.
- Do not mix package/image publishing changes with docs/control-plane changes.

## Reporting

Separate local diff, PR state, CI state, merge state, package/image release
state, and runtime/MCP proof.
