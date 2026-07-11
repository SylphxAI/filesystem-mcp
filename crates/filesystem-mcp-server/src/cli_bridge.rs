use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde_json::Value;

use rmcp::model::CallToolResult;

#[derive(Debug, serde::Deserialize)]
struct CliLegacySuccess {
    status: String,
    result: Value,
}

#[derive(Debug, serde::Deserialize)]
struct CliError {
    status: String,
    message: String,
}

fn cli_binary_candidates(root: &std::path::Path) -> [PathBuf; 3] {
    [
        root.join("target/release/filesystem-cli"),
        root.join("target/debug/filesystem-cli"),
        root.join("bin/native/filesystem-cli"),
    ]
}

fn workspace_roots_to_probe() -> Vec<PathBuf> {
    let mut roots = Vec::new();

    // Crate manifest → workspace root (crates/filesystem-mcp-server → repo root).
    roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));

    if let Ok(exe) = std::env::current_exe() {
        let mut dir = exe.parent().map(|parent| parent.to_path_buf());
        while let Some(mut current) = dir {
            roots.push(current.clone());
            if !current.pop() {
                break;
            }
            dir = Some(current);
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }

    roots
}

pub fn resolve_cli_binary() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FILESYSTEM_CLI_BIN") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    for root in workspace_roots_to_probe() {
        for candidate in cli_binary_candidates(&root) {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }

    None
}

pub fn invoke_cli_tool(tool: &str, arguments: Value) -> Result<CallToolResult, rmcp::ErrorData> {
    let cli = resolve_cli_binary().ok_or_else(|| {
        rmcp::ErrorData::invalid_request(
            "filesystem-cli is unavailable. Run `bun run build:rust`.",
            None,
        )
    })?;

    let request = serde_json::json!({ "tool": tool, "input": arguments });
    let payload = serde_json::to_string(&request).map_err(|error| {
        rmcp::ErrorData::internal_error(format!("Failed to serialize CLI request: {error}"), None)
    })?;

    let mut child = Command::new(cli)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            rmcp::ErrorData::internal_error(format!("Failed to spawn filesystem-cli: {error}"), None)
        })?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(payload.as_bytes()).map_err(|error| {
            rmcp::ErrorData::internal_error(format!("Failed to write CLI request: {error}"), None)
        })?;
    }

    let output = child.wait_with_output().map_err(|error| {
        rmcp::ErrorData::internal_error(format!("filesystem-cli failed: {error}"), None)
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(rmcp::ErrorData::internal_error(
            format!(
                "filesystem-cli exited with status {:?}: {stderr}",
                output.status.code()
            ),
            None,
        ));
    }

    let stdout = String::from_utf8(output.stdout).map_err(|error| {
        rmcp::ErrorData::internal_error(
            format!("filesystem-cli returned non-UTF8 output: {error}"),
            None,
        )
    })?;

    if let Ok(success) = serde_json::from_str::<CliLegacySuccess>(&stdout) {
        if success.status == "ok" {
            return serde_json::from_value(success.result).map_err(|error| {
                rmcp::ErrorData::internal_error(
                    format!("filesystem-cli returned invalid CallToolResult: {error}"),
                    None,
                )
            });
        }
    }

    if let Ok(error) = serde_json::from_str::<CliError>(&stdout) {
        if error.status == "error" {
            return Err(rmcp::ErrorData::internal_error(error.message, None));
        }
    }

    Err(rmcp::ErrorData::internal_error(
        format!("filesystem-cli returned unexpected JSON: {stdout}"),
        None,
    ))
}
