---
layout: doc

title: Performance Benchmarks
description: Reproducible vitest bench results for Filesystem MCP batch operations vs single-file access patterns.
---

# Performance Benchmarks

Filesystem MCP optimizes for **batch operations** and **direct API calls** instead of per-file shell
round trips. These benchmarks measure handler throughput on a local fixture tree using Vitest's bench
runner.

## What we measure

| Scenario | Why it matters |
| --- | --- |
| `read_content` — single file | Baseline latency for one file read |
| `read_content` — 10 files | Token-efficient batch read in one MCP call |
| `list_files` — recursive tree | Directory discovery without shell `find` |
| `search_files` — regex across tree | Code search without spawning `rg` per request |

Results are **machine- and fixture-specific**. Use them to compare regressions on your hardware,
not as absolute SLA numbers.

## Reproduce

```bash
bun run benchmark
```

The `benchmark` script runs `vitest bench` against `__tests__/benchmarks/throughput.bench.ts`.
Regular unit tests exclude `*.bench.ts` files so CI stays fast.

For the full test suite including coverage thresholds:

```bash
bun run test
bun run validate
```

## Design goals the bench protects

- **Batching** — most tools accept arrays and return per-item status.
- **Direct API** — no shell spawn overhead per operation.
- **Project-root confinement** — all paths resolve under the server `cwd`.

See the [README comparison table](https://github.com/SylphxAI/filesystem-mcp#why-not-shell-commands) for how batch MCP calls compare to individual shell commands.