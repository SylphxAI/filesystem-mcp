use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const AUDIT_SCHEMA_VERSION: &str = "1.0.0";
pub const AUDIT_DIR_NAME: &str = ".filesystem-mcp";
pub const AUDIT_LEDGER_FILE: &str = "audit.jsonl";
pub const ROLLBACK_DIR_NAME: &str = "rollback";
pub const DEFAULT_MAX_ROLLBACK_BYTES: u64 = 1_048_576;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackMetadata {
    pub available: bool,
    pub restore_content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAuditFileRecord {
    pub path: String,
    pub before_hash: String,
    pub after_hash: String,
    pub diff_count: u32,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rollback: Option<RollbackMetadata>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteAuditRequestRecord {
    pub path: String,
    pub before_hash: String,
    pub after_hash: String,
    pub diff_count: u32,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub before_content: Option<String>,
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

pub fn rollback_snapshot_path(root: &Path, operation_id: &str, file_path: &str) -> PathBuf {
    let safe_name = file_path.replace('/', "__");
    root.join(AUDIT_DIR_NAME)
        .join(ROLLBACK_DIR_NAME)
        .join(operation_id)
        .join(format!("{safe_name}.snapshot"))
}

fn store_rollback_snapshot(
    root: &Path,
    operation_id: &str,
    file_path: &str,
    before_content: &str,
    max_rollback_bytes: u64,
) -> Result<RollbackMetadata, String> {
    let bytes = before_content.as_bytes();
    let restore_content_hash = content_hash(before_content);

    if bytes.len() as u64 > max_rollback_bytes {
        return Ok(RollbackMetadata {
            available: false,
            restore_content_hash,
            snapshot_path: None,
            snapshot_bytes: None,
            reason: Some(format!(
                "snapshot_exceeds_max_bytes:{max_rollback_bytes}"
            )),
        });
    }

    let snapshot_path = rollback_snapshot_path(root, operation_id, file_path);
    if let Some(parent) = snapshot_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create rollback directory: {error}"))?;
    }

    fs::write(&snapshot_path, bytes)
        .map_err(|error| format!("Failed to write rollback snapshot: {error}"))?;

    let relative_snapshot = snapshot_path
        .strip_prefix(root)
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|_| snapshot_path.to_string_lossy().into_owned());

    Ok(RollbackMetadata {
        available: true,
        restore_content_hash,
        snapshot_path: Some(relative_snapshot),
        snapshot_bytes: Some(bytes.len() as u64),
        reason: None,
    })
}

fn build_rollback_metadata(
    root: &Path,
    operation_id: &str,
    record: &WriteAuditRequestRecord,
    max_rollback_bytes: u64,
) -> Result<Option<RollbackMetadata>, String> {
    if !record.success {
        return Ok(Some(RollbackMetadata {
            available: false,
            restore_content_hash: record.before_hash.clone(),
            snapshot_path: None,
            snapshot_bytes: None,
            reason: Some("write_not_successful".into()),
        }));
    }

    let Some(before_content) = record.before_content.as_ref() else {
        return Ok(Some(RollbackMetadata {
            available: false,
            restore_content_hash: record.before_hash.clone(),
            snapshot_path: None,
            snapshot_bytes: None,
            reason: Some("before_content_not_provided".into()),
        }));
    };

    Ok(Some(store_rollback_snapshot(
        root,
        operation_id,
        &record.path,
        before_content,
        max_rollback_bytes,
    )?))
}

pub fn append_audit_batch(
    root: &Path,
    tool: &str,
    records: &[WriteAuditRequestRecord],
) -> Result<(String, PathBuf, Vec<WriteAuditFileRecord>), String> {
    append_audit_batch_with_limit(root, tool, records, DEFAULT_MAX_ROLLBACK_BYTES)
}

pub fn append_audit_batch_with_limit(
    root: &Path,
    tool: &str,
    records: &[WriteAuditRequestRecord],
    max_rollback_bytes: u64,
) -> Result<(String, PathBuf, Vec<WriteAuditFileRecord>), String> {
    if records.is_empty() {
        return Err("No audit records to append.".into());
    }

    let operation_id = generate_operation_id();
    let mut enriched_records = Vec::with_capacity(records.len());

    for record in records {
        let rollback = build_rollback_metadata(root, &operation_id, record, max_rollback_bytes)?;
        enriched_records.push(WriteAuditFileRecord {
            path: record.path.clone(),
            before_hash: record.before_hash.clone(),
            after_hash: record.after_hash.clone(),
            diff_count: record.diff_count,
            success: record.success,
            rollback,
        });
    }

    let batch = WriteAuditBatch {
        schema_version: AUDIT_SCHEMA_VERSION.into(),
        operation_id: operation_id.clone(),
        tool: tool.into(),
        recorded_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0),
        records: enriched_records.clone(),
    };

    let ledger_path = audit_ledger_path(root);
    if let Some(parent) = ledger_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create audit directory: {error}"))?;
    }

    let line = serde_json::to_string(&batch)
        .map_err(|error| format!("Failed to serialize audit batch: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&ledger_path)
        .map_err(|error| format!("Failed to open audit ledger: {error}"))?;
    writeln!(file, "{line}")
        .map_err(|error| format!("Failed to append audit ledger: {error}"))?;

    Ok((operation_id, ledger_path, enriched_records))
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
        let records = vec![WriteAuditRequestRecord {
            path: "src/a.ts".into(),
            before_hash: content_hash("before"),
            after_hash: content_hash("after"),
            diff_count: 1,
            success: true,
            before_content: Some("before".into()),
        }];

        let (operation_id, ledger_path, enriched) =
            append_audit_batch(root, "apply_diff", &records).expect("append audit");
        assert!(operation_id.starts_with("op_"));
        assert!(ledger_path.exists());
        assert_eq!(enriched.len(), 1);
        assert_eq!(enriched[0].rollback.as_ref().unwrap().available, true);

        let raw = fs::read_to_string(&ledger_path).expect("read ledger");
        let batch: WriteAuditBatch =
            serde_json::from_str(raw.lines().next().expect("line")).expect("parse");
        assert_eq!(batch.tool, "apply_diff");
        assert_eq!(batch.records.len(), 1);
        assert_eq!(batch.records[0].path, "src/a.ts");
    }

    #[test]
    fn stores_rollback_snapshot_for_successful_writes() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let before = "alpha\nbeta\n";
        let records = vec![WriteAuditRequestRecord {
            path: "src/example.ts".into(),
            before_hash: content_hash(before),
            after_hash: content_hash("gamma\nbeta\n"),
            diff_count: 1,
            success: true,
            before_content: Some(before.into()),
        }];

        let (operation_id, _, enriched) =
            append_audit_batch(root, "apply_diff", &records).expect("append audit");
        let rollback = enriched[0].rollback.as_ref().expect("rollback");
        assert!(rollback.available);
        assert_eq!(rollback.restore_content_hash, content_hash(before));

        let snapshot = rollback_snapshot_path(root, &operation_id, "src/example.ts");
        assert!(snapshot.exists());
        assert_eq!(fs::read_to_string(snapshot).expect("read snapshot"), before);
    }

    #[test]
    fn skips_snapshot_when_content_exceeds_limit() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let oversized = "x".repeat(32);
        let records = vec![WriteAuditRequestRecord {
            path: "big.txt".into(),
            before_hash: content_hash(&oversized),
            after_hash: content_hash("y"),
            diff_count: 1,
            success: true,
            before_content: Some(oversized),
        }];

        let (_, _, enriched) =
            append_audit_batch_with_limit(root, "apply_diff", &records, 16).expect("append audit");
        let rollback = enriched[0].rollback.as_ref().expect("rollback");
        assert!(!rollback.available);
        assert!(rollback
            .reason
            .as_deref()
            .unwrap_or("")
            .contains("snapshot_exceeds_max_bytes"));
    }
}