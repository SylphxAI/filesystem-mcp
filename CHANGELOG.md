# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Refined GitHub Actions workflow (`publish.yml`) triggers: publishing jobs (`publish-npm`, `publish-docker`, `create-release`) now run *only* on version tag pushes (`v*.*.*`), not on pushes to `main` (9c0df99).

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