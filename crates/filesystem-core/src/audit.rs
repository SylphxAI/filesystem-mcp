use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const AUDIT_SCHEMA_VERSION: &str = "1.0.0";
pub const AUDIT_DIR_NAME: &str = ".filesystem-mcp";
pub const AUDIT_LEDGER_FILE: &str = "audit.jsonl";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAuditFileRecord {
    pub path: String,
    pub before_hash: String,
    pub after_hash: String,
    pub diff_count: u32,
    pub success: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAuditBatch {
    pub schema_version: String,
    pub operation_id: String,
    pub tool: String,
    pub recorded_at_ms: u64,
    pub records: Vec<WriteAuditFileRecord>,
}

pub fn content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn generate_operation_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("op_{millis}")
}

pub fn audit_ledger_path(root: &Path) -> PathBuf {
    root.join(AUDIT_DIR_NAME).join(AUDIT_LEDGER_FILE)
}

pub fn append_audit_batch(root: &Path, tool: &str, records: &[WriteAuditFileRecord]) -> Result<(String, PathBuf), String> {
    if records.is_empty() {
        return Err("No audit records to append.".into());
    }

    let operation_id = generate_operation_id();
    let batch = WriteAuditBatch {
        schema_version: AUDIT_SCHEMA_VERSION.into(),
        operation_id: operation_id.clone(),
        tool: tool.into(),
        recorded_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0),
        records: records.to_vec(),
    };

    let ledger_path = audit_ledger_path(root);
    if let Some(parent) = ledger_path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("Failed to create audit directory: {error}"))?;
    }

    let line = serde_json::to_string(&batch).map_err(|error| format!("Failed to serialize audit batch: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&ledger_path)
        .map_err(|error| format!("Failed to open audit ledger: {error}"))?;
    writeln!(file, "{line}").map_err(|error| format!("Failed to append audit ledger: {error}"))?;

    Ok((operation_id, ledger_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn content_hash_is_stable_for_same_input() {
        let first = content_hash("hello world");
        let second = content_hash("hello world");
        assert_eq!(first, second);
        assert_eq!(first.len(), 64);
    }

    #[test]
    fn append_audit_batch_writes_jsonl_ledger() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let records = vec![WriteAuditFileRecord {
            path: "src/a.ts".into(),
            before_hash: content_hash("before"),
            after_hash: content_hash("after"),
            diff_count: 1,
            success: true,
        }];

        let (operation_id, ledger_path) =
            append_audit_batch(root, "apply_diff", &records).expect("append audit");
        assert!(operation_id.starts_with("op_"));
        assert!(ledger_path.exists());

        let raw = fs::read_to_string(&ledger_path).expect("read ledger");
        let batch: WriteAuditBatch = serde_json::from_str(raw.lines().next().expect("line")).expect("parse");
        assert_eq!(batch.tool, "apply_diff");
        assert_eq!(batch.records.len(), 1);
        assert_eq!(batch.records[0].path, "src/a.ts");
    }
}