# filesystem-mcp — local agent notes only

Doctrine and fleet delivery law live in the **host always-on constitution**
(`~/.grok/AGENTS.md` / Doctrine template). This file must **not** restate,
weaken, or fork that law (including PR-vs-direct-trunk delivery).

Local truth: `PROJECT.md`, `.doctrine/project.json` when present.

## Boundary hazards

- This is a security-sensitive MCP filesystem server. Path confinement, batch
- Release workflows publish npm, Docker Hub images, GitHub releases, and docs.
- Do not mix package/image publishing changes with docs/control-plane changes.

## Local commands

- `pnpm install --frozen-lockfile` - install dependencies.
- `pnpm run validate` - formatting, lint, typecheck, and tests.
- `pnpm run build` - build package artifacts.
- `pnpm run docs:build` - build documentation.
- Prefer the **narrowest** affected check before full workspace runs.
- Report layers honestly: local diff · trunk FF · deploy · prod proof (do not collapse).

## Validation notes

- Prefer the **narrowest** affected check before full workspace runs.
- Report layers honestly: local diff · trunk FF · deploy · prod proof (do not collapse).
