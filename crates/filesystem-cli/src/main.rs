use filesystem_core::{resolve_path, PolicyErrorCode, ENGINE_NAME, ENGINE_VERSION};
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
        other => serde_json::to_string(&ErrorEnvelope {
            status: "error",
            code: "UNSUPPORTED_TOOL".into(),
            message: format!("Unsupported tool: {other}"),
            next_action: "Use resolve_path.".into(),
        })
        .expect("serialize"),
    };

    println!("{output}");
}