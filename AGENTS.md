# filesystem-mcp — local agent notes only

Static engineering and delivery standards load from the active Skills runtime
([SylphxAI/skills](https://github.com/SylphxAI/skills) is binding instruction
SSOT). Doctrine and Mission Control are retired historical lineage and must not
be loaded as current instruction authority.

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
