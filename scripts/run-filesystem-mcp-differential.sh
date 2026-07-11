#!/usr/bin/env bash
# Filesystem MCP list_files differential parity — TS contract oracle vs native Rust CLI/rmcp SSOT.
# Slice: list-files (tick-010 main-bound land). Fail-closed: requires bun (no SKIP-as-pass).
# See PARITY-VERIFICATION-STANDARD.md, DECISION-001 / rej-010.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRATCH="${SCRATCH_DIR:-/tmp/filesystem-mcp-differential}"
mkdir -p "$SCRATCH"
LOG="$SCRATCH/differential.log"
ARTIFACT="$SCRATCH/verification.json"
ORACLE_JSON="$SCRATCH/oracle.json"
ORACLE_WORKSPACE="$REPO_ROOT/test/fixtures/differential-scratch"
# Resolve /tmp → /private/tmp (macOS) so PROJECT_ROOT confinement accepts scratch paths.
REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"
ORACLE_WORKSPACE="$REPO_ROOT/test/fixtures/differential-scratch"
SLICE_FILTER="list-files"
: >"$LOG"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slice)
      SLICE_FILTER="${2:-}"
      shift 2
      ;;
    *)
      echo "::error::unknown argument: $1" | tee -a "$LOG"
      exit 1
      ;;
  esac
done

case "$SLICE_FILTER" in
  all|list-files) ;;
  *)
    echo "::error::invalid --slice value: $SLICE_FILTER (supported: list-files|all)" | tee -a "$LOG"
    exit 1
    ;;
esac

cd "$REPO_ROOT"

if ! command -v bun >/dev/null 2>&1; then
  echo "::error::bun required for filesystem-mcp differential parity — no SKIP-as-pass" | tee -a "$LOG"
  exit 1
fi

echo "=== filesystem-mcp differential parity $(date -Iseconds) slice=$SLICE_FILTER ===" | tee -a "$LOG"

echo "--- build TypeScript handlers (oracle imports src/) ---" | tee -a "$LOG"
bun run build 2>&1 | tee -a "$LOG"

echo "--- build Rust rmcp server + CLI ---" | tee -a "$LOG"
bun run build:rust 2>&1 | tee -a "$LOG"

echo "--- TS contract oracle (list_files) ---" | tee -a "$LOG"
rm -rf "$ORACLE_WORKSPACE"
mkdir -p "$ORACLE_WORKSPACE"
FILESYSTEM_MCP_DIFF_SCRATCH="$ORACLE_WORKSPACE" \
  bun run "$REPO_ROOT/scripts/differential/filesystem-mcp-oracle.ts" >"$ORACLE_JSON" 2>>"$LOG"

run_rust_slice_test() {
  local label="$1"
  local test_name="$2"
  echo "--- Rust bounded slice: $label ---" | tee -a "$LOG"
  FILESYSTEM_MCP_ORACLE_JSON="$ORACLE_JSON" \
    cargo test -p filesystem-mcp-server --test filesystem_mcp_differential "$test_name" -- --nocapture 2>&1 | tee -a "$LOG"
}

case "$SLICE_FILTER" in
  list-files)
    run_rust_slice_test "list-files" list_files_differential_matches_ts_oracle
    ;;
  all)
    run_rust_slice_test "list-files" list_files_differential_matches_ts_oracle
    echo "--- Rust differential test (list-files package + contracts) ---" | tee -a "$LOG"
    FILESYSTEM_MCP_ORACLE_JSON="$ORACLE_JSON" \
      cargo test -p filesystem-mcp-server --test filesystem_mcp_differential list_files_differential_matches_ts_oracle -- --nocapture 2>&1 | tee -a "$LOG"
    ;;
esac

CANDIDATE_SHA="${CANDIDATE_SHA:-$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
BASELINE_TS_SHA="$(git -C "$REPO_ROOT" log -1 --format=%H -- scripts/differential src/handlers/list-files.ts test/fixtures/golden 2>/dev/null || echo unknown)"
RUST_SHA="$CANDIDATE_SHA"
BEHAVIOR_SPEC_HASH="$(sha256sum "$REPO_ROOT/scripts/differential/fixtures/filesystem-mcp-corpus.json" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$REPO_ROOT/scripts/differential/fixtures/filesystem-mcp-corpus.json" | awk '{print $1}')"
FIXTURE_CORPUS_HASH="$(jq -r '.fixtureCorpusHash' "$ORACLE_JSON")"
CASE_COUNT="$(jq '.cases | length' "$ORACLE_JSON")"
LIST_CASE_COUNT="$(jq '[.cases[] | select(.slice=="list-files")] | length' "$ORACLE_JSON")"

jq -n \
  --arg verifiedAt "$(date -Iseconds)" \
  --arg candidateSha "$CANDIDATE_SHA" \
  --arg baselineTsSha "$BASELINE_TS_SHA" \
  --arg rustCandidateSha "$RUST_SHA" \
  --arg behaviorSpecHash "$BEHAVIOR_SPEC_HASH" \
  --arg fixtureCorpusHash "$FIXTURE_CORPUS_HASH" \
  --argjson caseCount "$CASE_COUNT" \
  --argjson listCaseCount "$LIST_CASE_COUNT" \
  --arg sliceFilter "$SLICE_FILTER" \
  '{
    schemaVersion: 2,
    slice: ("filesystem-mcp.tools.list_files|" + $sliceFilter),
    status: "differential_green",
    verifiedAt: $verifiedAt,
    lastComparedMainSha: $candidateSha,
    mergeGroupSha: $candidateSha,
    baselineTsSha: $baselineTsSha,
    rustCandidateSha: $rustCandidateSha,
    behaviorSpecHash: $behaviorSpecHash,
    fixtureCorpusHash: $fixtureCorpusHash,
    caseCount: $caseCount,
    listFilesCaseCount: $listCaseCount,
    harness: "scripts/run-filesystem-mcp-differential.sh",
    differentialTest: "crates/filesystem-mcp-server/tests/filesystem_mcp_differential.rs#list_files_differential_matches_ts_oracle",
    boundedSlices: {
      "list-files": "crates/filesystem-mcp-server/tests/filesystem_mcp_differential.rs#list_files_differential_matches_ts_oracle"
    },
    oracle: "scripts/differential/filesystem-mcp-oracle.ts",
    promotionPolicy: "NO_PROMOTIONS — differential_green recorded per rej-010; promotion_hold until prod_audit_pass; authority_rust NOT claimed"
  }' >"$ARTIFACT"

echo "filesystem-mcp-differential: OK (slice=$SLICE_FILTER cases=$CASE_COUNT list_files=$LIST_CASE_COUNT corpus=$FIXTURE_CORPUS_HASH)" | tee -a "$LOG"
echo "verification artifact: $ARTIFACT" | tee -a "$LOG"
