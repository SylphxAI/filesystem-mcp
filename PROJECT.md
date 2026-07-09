# Filesystem MCP Project

Filesystem MCP is a production MCP server that gives AI agents secure,
token-efficient filesystem tools with project-root confinement and batch
operations. It publishes npm and Docker artifacts for MCP hosts.

## Goals

- Own the filesystem MCP server, tool schemas, path-safety model, batch
  operations, docs, package, Docker image, and release workflows.
- Keep filesystem side effects explicit, validated, root-confined, and safe for
  autonomous agents.
- Publish artifacts only with CI, release intent, npm/Docker readback, and
  GitHub release evidence.

## Non-Goals

- Do not own downstream agent policy, host configuration, or project-specific
  filesystem rules.
- Do not bypass root confinement or make shell execution a hidden filesystem
  transport.
- Do not treat source revert as complete recovery after npm or Docker publish.

## Boundaries

Owned contexts are MCP tool APIs, filesystem operation semantics, root
confinement, validation schemas, docs, npm package, Docker image, and release
workflows.

Public surfaces:

- npm package and CLI in `package.json`.
- MCP tools documented in `README.md`.
- Docker image `sylphx/filesystem-mcp`.
- Required contexts `Validate Code Quality`, `Build and Archive Artifacts`,
  `Publish to NPM`, `Publish to Docker Hub`, and `Create GitHub Release`.

## Delivery

Current CI model: `legacy-ci`. Release path is `.github/workflows/publish.yml`
and the central reusable release workflow in `.github/workflows/release.yml`.
Production proof must include required contexts, package build output, npm
readback, Docker image readback, GitHub release evidence, and MCP smoke tests.

Recovery class: `forward-fix-only`, because published npm/Docker versions and
consumer MCP behavior cannot be fully undone by source revert.

## References

- Machine manifest: `.doctrine/project.json`
- Public docs: `README.md`
- SOTA family roadmap: `docs/roadmap/sota-family-roadmap.md`
- Package: `package.json`
- CI/publish: `.github/workflows/publish.yml`
- Release: `.github/workflows/release.yml`
- Doctrine: https://github.com/SylphxAI/doctrine
