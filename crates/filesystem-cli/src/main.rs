use filesystem_core::audit::WriteAuditFileRecord;
use filesystem_core::search::SearchMatch;
use filesystem_core::walk::{ListEntry, ListFilesMetrics};
use filesystem_core::{
    append_audit_batch, content_hash, resolve_path, PolicyErrorCode, ENGINE_NAME, ENGINE_VERSION,
};
use serde::{Deserialize, Serialize};
use std::io::{self, Read};
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
struct Request {
    tool: String,
    input: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct SuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    resolved_path: String,
}

#[derive(Debug, Serialize)]
struct SearchSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    results: Vec<SearchMatchDto>,
    metrics: SearchMetricsDto,
}

#[derive(Debug, Serialize)]
struct SearchMatchDto {
    file: String,
    line: u32,
    matched_text: String,
    context: Vec<String>,
}

#[derive(Debug, Serialize)]
struct SearchMetricsDto {
    files_scanned: usize,
    matches_found: usize,
    elapsed_ms: u64,
}

#[derive(Debug, Serialize)]
struct ListFilesSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    entries: Vec<ListEntry>,
    metrics: ListFilesMetrics,
}

#[derive(Debug, Serialize)]
struct ContentHashSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    hash: String,
}

#[derive(Debug, Serialize)]
struct AuditSuccessEnvelope {
    status: &'static str,
    engine: &'static str,
    version: &'static str,
    operation_id: String,
    ledger_path: String,
    record_count: usize,
}

#[derive(Debug, Serialize)]
struct ErrorEnvelope {
    status: &'static str,
    code: String,
    message: String,
    next_action: String,
}

fn policy_code(code: PolicyErrorCode) -> &'static str {
    match code {
        PolicyErrorCode::InvalidParams => "INVALID_PARAMS",
        PolicyErrorCode::InvalidRequest => "INVALID_REQUEST",
    }
}

fn map_search_match(entry: SearchMatch) -> SearchMatchDto {
    SearchMatchDto {
        file: entry.file,
        line: entry.line,
        matched_text: entry.matched_text,
        context: entry.context,
    }
}

fn handle_list_files(input: &serde_json::Value) -> Result<ListFilesSuccessEnvelope, ErrorEnvelope> {
    let root = input
        .get("root")
        .and_then(|value| value.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let relative_path = input
        .get("path")
        .and_then(|value| value.as_str())
        .unwrap_or(".");

    let recursive = input
        .get("recursive")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    let include_stats = input
        .get("include_stats")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);

    match filesystem_core::walk::list_files(&root, relative_path, recursive, include_stats) {
        Ok(result) => Ok(ListFilesSuccessEnvelope {
            status: "ok",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            entries: result.entries,
            metrics: result.metrics,
        }),
        Err(message) => {
            let code = if message.contains("Path traversal") || message.starts_with("INVALID_ROOT") {
                "INVALID_REQUEST"
            } else if message.contains("Absolute paths") {
                "INVALID_PARAMS"
            } else {
                "LIST_FAILED"
            };
            Err(ErrorEnvelope {
                status: "error",
                code: code.into(),
                message,
                next_action: "Use a root-scoped relative directory path.".into(),
            })
        }
    }
}

fn handle_search_files(input: &serde_json::Value) -> Result<SearchSuccessEnvelope, ErrorEnvelope> {
    let root = input
        .get("root")
        .and_then(|value| value.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let relative_path = input
        .get("path")
        .and_then(|value| value.as_str())
        .unwrap_or(".");

    let regex = input
        .get("regex")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "regex is required".into(),
            next_action: "Pass a regex pattern string.".into(),
        })?;

    let file_pattern = input
        .get("file_pattern")
        .and_then(|value| value.as_str())
        .unwrap_or("*");

    match filesystem_core::search::search_files(&root, relative_path, regex, file_pattern, None, None) {
        Ok((results, stats)) => Ok(SearchSuccessEnvelope {
            status: "ok",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            results: results.into_iter().map(map_search_match).collect(),
            metrics: SearchMetricsDto {
                files_scanned: stats.files_scanned,
                matches_found: stats.matches_found,
                elapsed_ms: stats.elapsed_ms,
            },
        }),
        Err(message) => {
            let code = if message.starts_with("INVALID_REGEX") {
                "INVALID_PARAMS"
            } else if message.starts_with("INVALID_ROOT") || message.contains("Path traversal") {
                "INVALID_REQUEST"
            } else {
                "SEARCH_FAILED"
            };
            Err(ErrorEnvelope {
                status: "error",
                code: code.into(),
                message,
                next_action: "Use a root-scoped relative path and a valid regex pattern.".into(),
            })
        }
    }
}

fn handle_content_hash(input: &serde_json::Value) -> Result<ContentHashSuccessEnvelope, ErrorEnvelope> {
    let content = input
        .get("content")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "content is required".into(),
            next_action: "Pass the file content string to hash.".into(),
        })?;

    Ok(ContentHashSuccessEnvelope {
        status: "ok",
        engine: ENGINE_NAME,
        version: ENGINE_VERSION,
        hash: content_hash(content),
    })
}

fn handle_record_write_audit(input: &serde_json::Value) -> Result<AuditSuccessEnvelope, ErrorEnvelope> {
    let root = input
        .get("root")
        .and_then(|value| value.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let tool = input
        .get("tool")
        .and_then(|value| value.as_str())
        .unwrap_or("apply_diff");

    let records_value = input.get("records").ok_or_else(|| ErrorEnvelope {
        status: "error",
        code: "INVALID_PARAMS".into(),
        message: "records is required".into(),
        next_action: "Pass an array of write audit file records.".into(),
    })?;

    let records: Vec<WriteAuditFileRecord> =
        serde_json::from_value(records_value.clone()).map_err(|error| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: format!("Invalid records payload: {error}"),
            next_action: "Each record needs path, beforeHash, afterHash, diffCount, and success.".into(),
        })?;

    match append_audit_batch(&root, tool, &records) {
        Ok((operation_id, ledger_path)) => Ok(AuditSuccessEnvelope {
            status: "ok",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            operation_id,
            ledger_path: ledger_path.to_string_lossy().into_owned(),
            record_count: records.len(),
        }),
        Err(message) => Err(ErrorEnvelope {
            status: "error",
            code: "AUDIT_FAILED".into(),
            message,
            next_action: "Ensure the project root is writable and records are non-empty.".into(),
        }),
    }
}

fn handle_resolve_path(input: &serde_json::Value) -> Result<SuccessEnvelope, ErrorEnvelope> {
    let relative_path = input
        .get("relative_path")
        .and_then(|value| value.as_str())
        .ok_or_else(|| ErrorEnvelope {
            status: "error",
            code: "INVALID_PARAMS".into(),
            message: "relative_path is required".into(),
            next_action: "Pass a relative path string under the project root.".into(),
        })?;

    let root = input
        .get("root")
        .and_then(|value| value.as_str())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    match resolve_path(relative_path, &root) {
        Ok(resolved) => Ok(SuccessEnvelope {
            status: "ok",
            engine: ENGINE_NAME,
            version: ENGINE_VERSION,
            resolved_path: resolved.to_string_lossy().into_owned(),
        }),
        Err(error) => Err(ErrorEnvelope {
            status: "error",
            code: policy_code(error.code).into(),
            message: error.message,
            next_action: "Use a path relative to the configured project root.".into(),
        }),
    }
}

fn main() {
    let mut payload = String::new();
    if io::stdin().read_to_string(&mut payload).is_err() {
        eprintln!("Failed to read stdin");
        std::process::exit(1);
    }

    let request: Request = match serde_json::from_str(&payload) {
        Ok(value) => value,
        Err(error) => {
            let envelope = ErrorEnvelope {
                status: "error",
                code: "INVALID_REQUEST".into(),
                message: format!("Invalid JSON request: {error}"),
                next_action: "Send {\"tool\":\"resolve_path\",\"input\":{...}} on stdin.".into(),
            };
            println!("{}", serde_json::to_string(&envelope).expect("serialize"));
            std::process::exit(1);
        }
    };

    let output = match request.tool.as_str() {
        "resolve_path" => match handle_resolve_path(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "search_files" => match handle_search_files(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "list_files" => match handle_list_files(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "content_hash" => match handle_content_hash(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        "record_write_audit" => match handle_record_write_audit(&request.input) {
            Ok(success) => serde_json::to_string(&success).expect("serialize"),
            Err(error) => serde_json::to_string(&error).expect("serialize"),
        },
        other => serde_json::to_string(&ErrorEnvelope {
            status: "error",
            code: "UNSUPPORTED_TOOL".into(),
            message: format!("Unsupported tool: {other}"),
            next_action: "Use resolve_path, search_files, list_files, content_hash, or record_write_audit.".into(),
        })
        .expect("serialize"),
    };

    println!("{output}");
}