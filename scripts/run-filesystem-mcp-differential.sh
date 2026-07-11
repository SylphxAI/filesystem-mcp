#!/usr/bin/env bash
# Filesystem MCP differential parity — TS contract oracle vs native Rust CLI/rmcp SSOT.
# Slices (tick-016 fail-closed allow-list): list-files | read-content | write-content | all
# Fail-closed: requires bun (no SKIP-as-pass). Unknown --slice exits 1.
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
SLICE_FILTER="all"
: >"$LOG"

# Fail-closed allow-list of main-bound differential slices.
ALLOWED_SLICES="all|list-files|read-content|write-content"

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
  all|list-files|read-content|write-content) ;;
  *)
    echo "::error::invalid --slice value: $SLICE_FILTER (supported: $ALLOWED_SLICES)" | tee -a "$LOG"
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

echo "--- TS contract oracle (list_files + read_content + write_content) ---" | tee -a "$LOG"
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
  read-content)
    run_rust_slice_test "read-content" read_content_differential_matches_ts_oracle
    ;;
  write-content)
    run_rust_slice_test "write-content" write_content_differential_matches_ts_oracle
    ;;
  all)
    run_rust_slice_test "list-files" list_files_differential_matches_ts_oracle
    run_rust_slice_test "read-content" read_content_differential_matches_ts_oracle
    run_rust_slice_test "write-content" write_content_differential_matches_ts_oracle
    ;;
esac

CANDIDATE_SHA="${CANDIDATE_SHA:-$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
BASELINE_TS_SHA="$(git -C "$REPO_ROOT" log -1 --format=%H -- scripts/differential src/handlers/list-files.ts src/handlers/read-content.ts src/handlers/write-content.ts test/fixtures/golden 2>/dev/null || echo unknown)"
RUST_SHA="$CANDIDATE_SHA"
BEHAVIOR_SPEC_HASH="$(sha256sum "$REPO_ROOT/scripts/differential/fixtures/filesystem-mcp-corpus.json" 2>/dev/null | awk '{print $1}' || shasum -a 256 "$REPO_ROOT/scripts/differential/fixtures/filesystem-mcp-corpus.json" | awk '{print $1}')"
FIXTURE_CORPUS_HASH="$(jq -r '.fixtureCorpusHash' "$ORACLE_JSON")"
CASE_COUNT="$(jq '.cases | length' "$ORACLE_JSON")"
LIST_CASE_COUNT="$(jq '[.cases[] | select(.slice=="list-files")] | length' "$ORACLE_JSON")"
READ_CASE_COUNT="$(jq '[.cases[] | select(.slice=="read-content")] | length' "$ORACLE_JSON")"
WRITE_CASE_COUNT="$(jq '[.cases[] | select(.slice=="write-content")] | length' "$ORACLE_JSON")"

jq -n \
  --arg verifiedAt "$(date -Iseconds)" \
  --arg candidateSha "$CANDIDATE_SHA" \
  --arg baselineTsSha "$BASELINE_TS_SHA" \
  --arg rustCandidateSha "$RUST_SHA" \
  --arg behaviorSpecHash "$BEHAVIOR_SPEC_HASH" \
  --arg fixtureCorpusHash "$FIXTURE_CORPUS_HASH" \
  --argjson caseCount "$CASE_COUNT" \
  --argjson listCaseCount "$LIST_CASE_COUNT" \
  --argjson readCaseCount "$READ_CASE_COUNT" \
  --argjson writeCaseCount "$WRITE_CASE_COUNT" \
  --arg sliceFilter "$SLICE_FILTER" \
  '{
    schemaVersion: 2,
    slice: ("filesystem-mcp.tools.list_files|tools.read_content|tools.write_content|" + $sliceFilter),
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
    readContentCaseCount: $readCaseCount,
    writeContentCaseCount: $writeCaseCount,
    harness: "scripts/run-filesystem-mcp-differential.sh",
    differentialTest: "crates/filesystem-mcp-server/tests/filesystem_mcp_differential.rs#list_files_differential_matches_ts_oracle;read_content_differential_matches_ts_oracle;write_content_differential_matches_ts_oracle",
    boundedSlices: {
      "list-files": "crates/filesystem-mcp-server/tests/filesystem_mcp_differential.rs#list_files_differential_matches_ts_oracle",
      "read-content": "crates/filesystem-mcp-server/tests/filesystem_mcp_differential.rs#read_content_differential_matches_ts_oracle",
      "write-content": "crates/filesystem-mcp-server/tests/filesystem_mcp_differential.rs#write_content_differential_matches_ts_oracle"
    },
    oracle: "scripts/differential/filesystem-mcp-oracle.ts",
    promotionPolicy: "NO_PROMOTIONS — differential_green recorded per rej-010; promotion_hold until prod_audit_pass; authority_rust NOT claimed"
  }' >"$ARTIFACT"

echo "filesystem-mcp-differential: OK (slice=$SLICE_FILTER cases=$CASE_COUNT list_files=$LIST_CASE_COUNT read_content=$READ_CASE_COUNT write_content=$WRITE_CASE_COUNT corpus=$FIXTURE_CORPUS_HASH)" | tee -a "$LOG"
echo "verification artifact: $ARTIFACT" | tee -a "$LOG"
