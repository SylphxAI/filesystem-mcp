# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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