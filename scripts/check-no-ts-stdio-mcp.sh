#!/usr/bin/env bash
# S3 gate: default MCP stdio transport must delegate solely to Rust rmcp.
# TS stdio adapter is retired (transport/stdio-ts-adapter → ts_deleted).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN="${ROOT}/bin/filesystem-mcp"
RUST_MAIN="${ROOT}/crates/filesystem-mcp-server/src/main.rs"
TS_ADAPTER_GATE="${ROOT}/scripts/check-ts-adapter-deletion-ready.sh"
LEDGER="${ROOT}/docs/specs/migration-ledger.json"
MATRIX="${ROOT}/__tests__/tsAdapterDeletion.matrix.test.ts"

violations=0

report_violation() {
  echo "VIOLATION: $*"
  violations=$((violations + 1))
}

echo "=== check-no-ts-stdio-mcp $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

[[ -f "${BIN}" ]] || report_violation "missing bin/filesystem-mcp"
[[ -f "${TS_ADAPTER_GATE}" ]] || report_violation "missing scripts/check-ts-adapter-deletion-ready.sh"
[[ -f "${LEDGER}" ]] || report_violation "missing docs/specs/migration-ledger.json"
[[ -f "${RUST_MAIN}" ]] || report_violation "missing crates/filesystem-mcp-server/src/main.rs"
[[ -f "${MATRIX}" ]] || report_violation "missing __tests__/tsAdapterDeletion.matrix.test.ts"

if [[ -f "${ROOT}/src/index.ts" ]]; then
  report_violation "src/index.ts must be deleted (transport/stdio-ts-adapter ts_deleted)"
fi

if [[ -f "${ROOT}/dist/index.js" ]]; then
  report_violation "dist/index.js must be deleted (transport/stdio-ts-adapter ts_deleted)"
fi

if [[ -f "${LEDGER}" ]]; then
  node - "${LEDGER}" <<'NODE'
const [ledgerPath] = process.argv.slice(2);
const ledger = JSON.parse(require("node:fs").readFileSync(ledgerPath, "utf8"));
const stdioRust = ledger.capabilities.find((cap) => cap.id === "transport/stdio-rust-rmcp");
const tsAdapter = ledger.capabilities.find((cap) => cap.id === "transport/stdio-ts-adapter");
const http = ledger.capabilities.find((cap) => cap.id === "transport/web-mcp-http");
if (!stdioRust) {
  console.error("[check-no-ts-stdio-mcp] missing capability transport/stdio-rust-rmcp");
  process.exit(1);
}
if (!tsAdapter) {
  console.error("[check-no-ts-stdio-mcp] missing capability transport/stdio-ts-adapter");
  process.exit(1);
}
if (!http) {
  console.error("[check-no-ts-stdio-mcp] missing capability transport/web-mcp-http");
  process.exit(1);
}
const rustAuthorityStates = new Set(["rust_impl", "authority_rust", "ts_deleted"]);
if (!rustAuthorityStates.has(stdioRust.state)) {
  console.error(
    `[check-no-ts-stdio-mcp] transport/stdio-rust-rmcp is ${stdioRust.state}; expected rust_impl, authority_rust, or ts_deleted`
  );
  process.exit(1);
}
if (tsAdapter.state !== "ts_deleted") {
  console.error(
    `[check-no-ts-stdio-mcp] transport/stdio-ts-adapter is ${tsAdapter.state}; expected ts_deleted`
  );
  process.exit(1);
}
if (!["rust_impl", "ts_deleted", "authority_rust"].includes(http.state)) {
  console.error(
    `[check-no-ts-stdio-mcp] transport/web-mcp-http is ${http.state}; expected rust_impl, authority_rust, or ts_deleted`
  );
  process.exit(1);
}
NODE
fi

if [[ -f "${BIN}" ]]; then
  grep -q 'resolve_rust_bin' "${BIN}" || report_violation "bin/filesystem-mcp must resolve Rust rmcp server via resolve_rust_bin"
  grep -q 'printf.*stdio' "${BIN}" || report_violation "bin/filesystem-mcp must default transport to stdio"
  if grep -qE 'use_ts_transport|exec node' "${BIN}"; then
    report_violation "bin/filesystem-mcp must not launch node or retain TS stdio opt-in"
  fi
fi

if [[ -f "${RUST_MAIN}" ]]; then
  grep -q 'transport::stdio' "${RUST_MAIN}" || report_violation "Rust MCP server must expose rmcp stdio transport"
fi

if [[ "${violations}" -gt 0 ]]; then
  echo ""
  echo "FAIL: ${violations} MCP stdio TS authority violation(s)."
  echo "Authority: crates/filesystem-mcp-server/src/main.rs via bin/filesystem-mcp (default stdio)."
  exit 1
fi

echo "PASS: MCP stdio transport delegates solely to Rust rmcp."
