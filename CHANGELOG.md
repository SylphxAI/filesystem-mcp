# Changelog

## 0.8.0

### Minor Changes

- 55fa473: Ship Rust streamable HTTP Web MCP transport on `/mcp` and `/mcp/health`. Route `MCP_TRANSPORT=http` through the npm bin to the Rust rmcp server.

## 0.7.2

### Patch Changes

- Republish multi-arch natives from main tip including search_files MCP Success envelope fix (cli_bridge LegacyToolSuccessEnvelope) and expanded main differential (search_files + stat_items).

## 0.7.1

### Patch Changes

- Ship multi-arch native MCP binaries via optionalDependencies platform packages (darwin-arm64, darwin-x64, linux-x64-gnu, linux-arm64-gnu). Arch-aware bin wrapper fails closed on wrong-arch or missing native; TypeScript transport remains explicit opt-in.

## 0.7.0

### Minor Changes

- 09de01f: Ship Rust-default rmcp transport with native read_content, write_content, and stat_items on the primary path.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.1] - 2026-05-03

### Security

- **Path confinement bypass (sibling-prefix)**: Hardened `resolvePath()` to use a separator-aware containment check (`path.relative()`) instead of `String.prototype.startsWith()`. The previous prefix-based check accepted sibling paths whose absolute form shared the project root's string prefix (e.g. `../root-secret/file.txt` against root `/mock/project/root` resolved to `/mock/project/root-secret/file.txt`, which started with the root string and was incorrectly admitted). Affected every handler that flowed paths through `resolvePath()`: read, write, edit, delete, copy, move, search, list, stat, replace, chmod, chown. Disclosed by external researcher; tracked alongside Issue #151. Added regression tests covering sibling-prefix paths, single-character delta cases, and post-`realpath` re-validation.

### Fixed

- Documentation alignment: README, badges, and install instructions now reference the actual published name `@sylphx/filesystem-mcp` (not `@sylphlab/filesystem-mcp`). Docker image references updated to `sylphx/filesystem-mcp` and the publish workflow's image name corrected (was erroneously pointing at `sylphlab/pdf-reader-mcp`). Closes #151.

## [0.6.0] - 2025-11-11

### Security

- **CRITICAL FIX**: Prevented path traversal attacks via symbolic links in all filesystem operations
  - Modified `resolvePath()` to resolve symlinks before security validation using `fs.realpath()`
  - Added validation of parent directories for non-existent paths
  - Updated all filesystem handlers to properly await async `resolvePath()` calls
  - Fixes vulnerability where attackers could access files outside project root via symlinks (Issue #134)
  - All versions before 0.6.0 are vulnerable to this attack

### Changed

- Made `resolvePath()` function async to support symlink resolution
- Updated 13 handler files to await `resolvePath()` calls

## [0.5.9] - 2025-06-04

### Changed

- Updated project ownership to `sylphlab`.
- Updated package name to `@sylphlab/filesystem-mcp`.
- Updated `README.md`, `LICENSE`, and GitHub Actions workflow (`publish.yml`) to reflect new ownership and package name.

## [0.5.8] - 2025-04-05

### Fixed

- Removed `build` directory exclusion from `.dockerignore` to fix Docker build context error where `COPY build ./build` failed.

## [0.5.7] - 2025-04-05

### Fixed

- Corrected artifact archiving in CI/CD workflow (`.github/workflows/publish.yml`) to include the `build` directory itself, resolving Docker build context errors (5f5c7c4).

## [0.5.6] - 2025-05-04

### Fixed

- Corrected CI/CD artifact handling (`package-lock.json` inclusion, extraction paths) in `publish.yml` to ensure successful npm and Docker publishing (4372afa).
- Simplified CI/CD structure back to a single workflow (`publish.yml`) with conditional artifact upload, removing `ci.yml` and `build-reusable.yml` (38029ca).

### Changed

- Bumped version to 0.5.6 due to previous failed release attempt of 0.5.5.

## [0.5.5] - 2025-05-04

### Changed

- Refined GitHub Actions workflow (`publish.yml`) triggers: publishing jobs (`publish-npm`, `publish-docker`, `create-release`) now run _only_ on version tag pushes (`v*.*.*`), not on pushes to `main` (9c0df99).

### Fixed

- Corrected artifact extraction path in the `publish-docker` CI/CD job to resolve "Dockerfile not found" error (708d3f5).

## [0.5.3] - 2025-05-04

### Added

- Enhanced path error reporting in `resolvePath` to include original path, resolved path, and project root for better debugging context (3810f14).
- Created `.clinerules` file to document project-specific patterns and preferences, starting with tool usage recommendations (3810f14).
- Enhanced `ENOENT` (File not found) error reporting in `readContent` handler to include resolved path, relative path, and project root (8b82e1c).

### Changed

- Updated `write_content` tool description to recommend using edit tools (`edit_file`, `replace_content`) for modifications (5521102).
- Updated `edit_file` tool description to reinforce its recommendation for modifications (5e44ef2).
- Refactored GitHub Actions workflow (`publish.yml`) to parallelize npm and Docker publishing using separate jobs dependent on a shared build job, improving release speed (3b51c2b).
- Bumped version to 0.5.3.

### Fixed

- Corrected TypeScript errors in `readContent.ts` related to variable scope and imports during error reporting enhancement (8b82e1c).

<!-- Previous versions can be added below -->
