//! TRUE differential parity: TS contract oracle vs native Rust MCP tool SSOT.
//!
//! Fail-closed — no SKIP-as-pass. Oracle subprocess must succeed before comparison.
//! Bounded slices (rej-010 / tick-016 main expansion):
//! - `list_files_differential_matches_ts_oracle` — S1 discovery (2 cases)
//! - `read_content_differential_matches_ts_oracle` — S1 read path (4 cases)
//! - `write_content_differential_matches_ts_oracle` — S2 mutation path (4 cases)
//! See scripts/run-filesystem-mcp-differential.sh.

use filesystem_mcp_server::cli_bridge;
use filesystem_mcp_server::tool_routes::{route_for_tool, ToolRoute};
use filesystem_mcp_server::{FilesystemMcp, SERVER_NAME, SERVER_VERSION};
use serde::Deserialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Mutex, OnceLock};

const LIST_FILES_SLICE: &str = "list-files";
const READ_CONTENT_SLICE: &str = "read-content";
const WRITE_CONTENT_SLICE: &str = "write-content";

/// Serialize tool cases that mutate isolated corpus trees (write_content).
static TOOL_CASE_LOCK: Mutex<()> = Mutex::new(());

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn corpus_fixture_path() -> PathBuf {
    repo_root().join("scripts/differential/fixtures/filesystem-mcp-corpus.json")
}

fn golden_corpus_root() -> PathBuf {
    repo_root().join("test/fixtures/golden/corpus")
}

fn copy_dir_all(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).expect("create destination");
    for entry in fs::read_dir(source).expect("read source dir") {
        let entry = entry.expect("dir entry");
        let target = destination.join(entry.file_name());
        if entry.file_type().expect("file type").is_dir() {
            copy_dir_all(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), &target).expect("copy file");
        }
    }
}

fn reset_isolated_corpus(case: &OracleCase) {
    let isolate = case
        .input
        .get("isolate")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !isolate {
        return;
    }

    let destination = PathBuf::from(case.input["root"].as_str().expect("tool case root"));
    if destination.exists() {
        fs::remove_dir_all(&destination).expect("remove isolated corpus");
    }
    copy_dir_all(&golden_corpus_root(), &destination);
}

#[derive(Debug, Deserialize, Clone)]
struct OracleCase {
    id: String,
    slice: String,
    domain: String,
    input: Value,
    output: Value,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OracleCorpus {
    corpus_version: u32,
    fixture_corpus_hash: String,
    scratch_root: String,
    cases: Vec<OracleCase>,
}

fn load_oracle_from_env_or_spawn() -> OracleCorpus {
    if let Ok(path) = std::env::var("FILESYSTEM_MCP_ORACLE_JSON") {
        let raw = fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("read FILESYSTEM_MCP_ORACLE_JSON at {path}: {error}"));
        return serde_json::from_str(&raw).expect("oracle JSON must be valid");
    }

    let script = repo_root().join("scripts/differential/filesystem-mcp-oracle.ts");
    // Unique scratch under repo root (PROJECT_ROOT confinement rejects /tmp paths).
    // Include a random suffix so concurrent cargo-test workers never clobber each other.
    let scratch = repo_root().join(format!(
        "test/fixtures/differential-scratch-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let _ = fs::remove_dir_all(&scratch);
    fs::create_dir_all(&scratch).expect("create oracle scratch");
    let output = Command::new("bun")
        .arg("run")
        .arg(&script)
        .current_dir(repo_root())
        .env("FILESYSTEM_MCP_DIFF_SCRATCH", &scratch)
        .output()
        .unwrap_or_else(|error| panic!("spawn TS oracle at {}: {error}", script.display()));

    assert!(
        output.status.success(),
        "TS oracle failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    serde_json::from_slice(&output.stdout).expect("oracle output must be valid JSON")
}

/// Cache oracle once per test process so parallel `cargo test` workers share a
/// single TS baseline (avoids scratch rm/race between list/read/write slices).
fn run_ts_oracle() -> OracleCorpus {
    static ORACLE: OnceLock<OracleCorpus> = OnceLock::new();
    ORACLE.get_or_init(load_oracle_from_env_or_spawn).clone()
}

fn sorted_string_array(value: &Value) -> Value {
    let mut entries = value
        .as_array()
        .expect("string array payload")
        .iter()
        .map(|entry| entry.as_str().expect("string entry").to_string())
        .collect::<Vec<_>>();
    entries.sort();
    Value::Array(entries.into_iter().map(Value::String).collect())
}

fn normalize_write_payload(payload: &Value) -> Value {
    let entries = payload
        .as_array()
        .expect("write_content array payload")
        .iter()
        .map(|entry| {
            let object = entry.as_object().expect("write_content result object");
            let mut normalized = serde_json::Map::new();
            normalized.insert(
                "path".into(),
                object.get("path").cloned().unwrap_or(Value::Null),
            );
            normalized.insert(
                "success".into(),
                object.get("success").cloned().unwrap_or(Value::Null),
            );
            normalized.insert(
                "operation".into(),
                object.get("operation").cloned().unwrap_or(Value::Null),
            );
            if let Some(code) = object.get("code").filter(|value| !value.is_null()) {
                normalized.insert("code".into(), code.clone());
            }
            if let Some(error) = object.get("error").filter(|value| !value.is_null()) {
                normalized.insert("error".into(), error.clone());
            }
            Value::Object(normalized)
        })
        .collect::<Vec<_>>();
    Value::Array(entries)
}

fn normalize_tool_payload(tool: &str, payload: Value) -> Value {
    match tool {
        "list_files" => sorted_string_array(&payload),
        "write_content" => normalize_write_payload(&payload),
        _ => payload,
    }
}

fn parse_rmcp_text_payload(result: &rmcp::model::CallToolResult) -> Value {
    let content = result.content.first().expect("rmcp tool result content");
    let text = content
        .as_text()
        .expect("rmcp tool result must contain text content")
        .text
        .clone();
    serde_json::from_str(&text).expect("parse rmcp text payload")
}

fn compare_tool_case(case: &OracleCase) {
    let tool = case.input["tool"].as_str().expect("tool case tool name");
    let root = case.input["root"].as_str().expect("tool case root");
    let args = case.input["args"].clone();

    // Isolate-mutating tools (write_content) must not race with each other under cargo test.
    let _guard = if case
        .input
        .get("isolate")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        Some(TOOL_CASE_LOCK.lock().expect("tool case lock"))
    } else {
        None
    };

    reset_isolated_corpus(case);

    let mut cli_input = args;
    if let Some(object) = cli_input.as_object_mut() {
        object.insert("root".into(), Value::String(root.to_string()));
    }

    let rmcp_result = cli_bridge::invoke_cli_tool(tool, cli_input).expect("rmcp cli_bridge invoke");
    let payload = normalize_tool_payload(tool, parse_rmcp_text_payload(&rmcp_result));

    let native = serde_json::json!({
        "status": "ok",
        "engine": "filesystem-core",
        "payload": payload,
    });

    assert_eq!(
        native, case.output,
        "tool differential mismatch for case {}",
        case.id
    );
}

fn compare_tool_route_case(case: &OracleCase) {
    let tool = case.input["tool"].as_str().expect("tool route tool");
    let route = route_for_tool(tool).expect("tool must be routed");
    let route_name = match route {
        ToolRoute::RustCore => "RustCore",
        ToolRoute::LegacyOptIn => "LegacyOptIn",
    };
    let native = serde_json::json!({ "route": route_name });
    assert_eq!(
        native, case.output,
        "tool route mismatch for case {}",
        case.id
    );
}

fn compare_server_contract_case(case: &OracleCase) {
    let tools = FilesystemMcp::new().tool_router.list_all();
    let names: Vec<String> = tools.iter().map(|tool| tool.name.to_string()).collect();
    for expected in case.input["tools"]
        .as_array()
        .expect("server contract tools")
    {
        let tool_name = expected.as_str().expect("tool name");
        assert!(
            names.iter().any(|name| name == tool_name),
            "rmcp server missing tool {tool_name}"
        );
    }

    let native = serde_json::json!({
        "name": SERVER_NAME,
        "version": SERVER_VERSION,
        "tools": case.input["tools"],
    });
    assert_eq!(
        native, case.output,
        "server contract mismatch for case {}",
        case.id
    );
}

fn assert_oracle_metadata(oracle: &OracleCorpus) {
    assert_eq!(oracle.corpus_version, 1);
    assert!(!oracle.fixture_corpus_hash.is_empty());
    assert!(!oracle.cases.is_empty(), "oracle must emit cases");
    assert!(
        fs::metadata(&oracle.scratch_root).is_ok(),
        "oracle scratch root must exist at {}",
        oracle.scratch_root
    );
}

fn assert_slice_metadata(case: &OracleCase) {
    match case.slice.as_str() {
        LIST_FILES_SLICE => {
            assert_eq!(case.domain, "tool");
            assert_eq!(case.input["tool"].as_str(), Some("list_files"));
        }
        READ_CONTENT_SLICE => {
            assert_eq!(case.domain, "tool");
            assert_eq!(case.input["tool"].as_str(), Some("read_content"));
        }
        WRITE_CONTENT_SLICE => {
            assert_eq!(case.domain, "tool");
            assert_eq!(case.input["tool"].as_str(), Some("write_content"));
        }
        "tool-route-contract" => assert_eq!(case.domain, "toolRouteContract"),
        "server-contract" => assert_eq!(case.domain, "serverContract"),
        other => panic!("unknown slice {other} for case {}", case.id),
    }
}

fn compare_case(case: &OracleCase) {
    match case.domain.as_str() {
        "tool" => compare_tool_case(case),
        "toolRouteContract" => compare_tool_route_case(case),
        "serverContract" => compare_server_contract_case(case),
        other => panic!("unknown oracle domain {other} in case {}", case.id),
    }
}

fn cases_for_slice<'a>(oracle: &'a OracleCorpus, slice: &str) -> Vec<&'a OracleCase> {
    oracle
        .cases
        .iter()
        .filter(|case| case.slice == slice)
        .collect()
}

fn run_bounded_slice(slice: &str, min_cases: usize) {
    let _ = fs::read_to_string(corpus_fixture_path()).expect("read filesystem-mcp corpus fixture");
    let oracle = run_ts_oracle();
    assert_oracle_metadata(&oracle);

    let cases = cases_for_slice(&oracle, slice);
    assert!(
        cases.len() >= min_cases,
        "slice {slice} must have at least {min_cases} oracle cases, got {}",
        cases.len()
    );

    for case in cases {
        assert_slice_metadata(case);
        compare_case(case);
    }
}

#[test]
fn list_files_differential_matches_ts_oracle() {
    run_bounded_slice(LIST_FILES_SLICE, 2);
}

#[test]
fn read_content_differential_matches_ts_oracle() {
    run_bounded_slice(READ_CONTENT_SLICE, 4);
}

#[test]
fn write_content_differential_matches_ts_oracle() {
    run_bounded_slice(WRITE_CONTENT_SLICE, 4);
}
