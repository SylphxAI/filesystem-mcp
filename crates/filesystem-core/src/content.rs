//! Root-scoped read, write, and stat operations for filesystem-mcp.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::audit::content_hash;
use crate::resolve_path;
use crate::walk::ListStats;
use crate::format_entry_stats;

pub const CONTENT_ROUTE: &str = "rust-content";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReadContentResult {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatItemResult {
    pub path: String,
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<ListStats>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteContentResult {
    pub path: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_content_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actual_content_hash: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ReadContentOptions {
    pub start_line: Option<u32>,
    pub end_line: Option<u32>,
    pub format: ReadFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadFormat {
    Lines,
    Raw,
}

impl Default for ReadContentOptions {
    fn default() -> Self {
        Self {
            start_line: None,
            end_line: None,
            format: ReadFormat::Lines,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteItemsResult {
    pub path: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone)]
pub struct WriteItem {
    pub path: String,
    pub content: String,
    pub append: bool,
    pub expected_content_hash: Option<String>,
}

pub fn read_content(
    root: &Path,
    paths: &[String],
    options: &ReadContentOptions,
) -> Vec<ReadContentResult> {
    paths
        .iter()
        .map(|relative| read_single_file(root, relative, options))
        .collect()
}

pub fn stat_items(root: &Path, paths: &[String]) -> Vec<StatItemResult> {
    paths
        .iter()
        .map(|relative| stat_single_path(root, relative))
        .collect()
}

pub fn write_content(root: &Path, items: &[WriteItem]) -> Vec<WriteContentResult> {
    items
        .iter()
        .map(|item| write_single_item(root, item))
        .collect()
}

fn normalize_display_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn read_single_file(
    root: &Path,
    relative_path: &str,
    options: &ReadContentOptions,
) -> ReadContentResult {
    let path_output = normalize_display_path(relative_path);
    let resolved = match resolve_path(relative_path, root) {
        Ok(path) => path,
        Err(error) => {
            return ReadContentResult {
                path: path_output,
                content: None,
                error: Some(format!("Error resolving path: {}", error.message)),
            };
        }
    };

    let meta = match fs::metadata(&resolved) {
        Ok(meta) => meta,
        Err(error) => {
            return ReadContentResult {
                path: path_output,
                content: None,
                error: Some(fs_read_error_message(&error, relative_path, &resolved)),
            };
        }
    };

    if !meta.is_file() {
        return ReadContentResult {
            path: path_output,
            content: None,
            error: Some(format!("Path is not a regular file: {relative_path}")),
        };
    }

    let bytes = match fs::read(&resolved) {
        Ok(bytes) => bytes,
        Err(error) => {
            return ReadContentResult {
                path: path_output,
                content: None,
                error: Some(fs_read_error_message(&error, relative_path, &resolved)),
            };
        }
    };

    let file_content = String::from_utf8_lossy(&bytes).into_owned();
    if options.start_line.is_some() || options.end_line.is_some() {
        let lines: Vec<&str> = file_content.split('\n').collect();
        let start = options
            .start_line
            .map(|line| line.saturating_sub(1) as usize)
            .unwrap_or(0)
            .min(lines.len());
        let end = options
            .end_line
            .map(|line| line as usize)
            .unwrap_or(lines.len())
            .min(lines.len());
        let filtered = &lines[start..end];
        let content = match options.format {
            ReadFormat::Raw => Value::String(filtered.join("\n")),
            ReadFormat::Lines => Value::Array(
                filtered
                    .iter()
                    .enumerate()
                    .map(|(index, line)| {
                        serde_json::json!({
                            "lineNumber": start + index + 1,
                            "content": *line,
                        })
                    })
                    .collect(),
            ),
        };
        return ReadContentResult {
            path: path_output,
            content: Some(content),
            error: None,
        };
    }

    ReadContentResult {
        path: path_output,
        content: Some(Value::String(file_content)),
        error: None,
    }
}

fn stat_single_path(root: &Path, relative_path: &str) -> StatItemResult {
    let path_output = normalize_display_path(relative_path);
    let resolved = match resolve_path(relative_path, root) {
        Ok(path) => path,
        Err(error) => {
            return StatItemResult {
                path: path_output,
                status: "error",
                stats: None,
                error: Some(format!("Error resolving path: {}", error.message)),
            };
        }
    };

    match fs::metadata(&resolved) {
        Ok(meta) => StatItemResult {
            path: path_output,
            status: "success",
            stats: Some(format_entry_stats(relative_path, &meta)),
            error: None,
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => StatItemResult {
            path: path_output,
            status: "error",
            stats: None,
            error: Some("Path not found".into()),
        },
        Err(error) => StatItemResult {
            path: path_output,
            status: "error",
            stats: None,
            error: Some(format!(
                "Failed to get stats: {}",
                fs_read_error_message(&error, relative_path, &resolved)
            )),
        },
    }
}

fn write_single_item(root: &Path, item: &WriteItem) -> WriteContentResult {
    let path_output = normalize_display_path(&item.path);
    let resolved = match resolve_path(&item.path, root) {
        Ok(path) => path,
        Err(error) => {
            return WriteContentResult {
                path: path_output,
                success: false,
                operation: None,
                error: Some(format!("Error resolving path: {}", error.message)),
                code: None,
                expected_content_hash: item.expected_content_hash.clone(),
                actual_content_hash: None,
            };
        }
    };

    if !item.append {
        if let Some(expected) = item.expected_content_hash.as_deref() {
            let actual = match fs::read_to_string(&resolved) {
                Ok(content) => content_hash(&content),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
                Err(error) => {
                    return WriteContentResult {
                        path: path_output,
                        success: false,
                        operation: None,
                        error: Some(format!(
                            "Failed to read file for conflict check: {}",
                            error
                        )),
                        code: None,
                        expected_content_hash: item.expected_content_hash.clone(),
                        actual_content_hash: None,
                    };
                }
            };
            if actual != expected {
                return WriteContentResult {
                    path: path_output,
                    success: false,
                    operation: None,
                    error: Some("Content hash mismatch; refusing to overwrite stale file.".into()),
                    code: Some("CONFLICT"),
                    expected_content_hash: item.expected_content_hash.clone(),
                    actual_content_hash: Some(actual),
                };
            }
        }
    }

    if let Some(parent) = resolved.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return WriteContentResult {
                path: path_output,
                success: false,
                operation: None,
                error: Some(format!("Failed to create parent directories: {error}")),
                code: None,
                expected_content_hash: item.expected_content_hash.clone(),
                actual_content_hash: None,
            };
        }
    }

    let write_result = if item.append {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&resolved)
            .and_then(|mut file| file.write_all(item.content.as_bytes()))
    } else {
        fs::write(&resolved, item.content.as_bytes())
    };

    match write_result {
        Ok(()) => WriteContentResult {
            path: path_output,
            success: true,
            operation: Some(if item.append { "appended" } else { "written" }),
            error: None,
            code: None,
            expected_content_hash: item.expected_content_hash.clone(),
            actual_content_hash: None,
        },
        Err(error) => WriteContentResult {
            path: path_output,
            success: false,
            operation: None,
            error: Some(format!(
                "Failed to {} file: {error}",
                if item.append { "append" } else { "write" }
            )),
            code: None,
            expected_content_hash: item.expected_content_hash.clone(),
            actual_content_hash: None,
        },
    }
}

fn fs_read_error_message(
    error: &std::io::Error,
    relative_path: &str,
    target_path: &Path,
) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => format!(
            "File not found at resolved path '{}' (from relative path '{relative_path}')",
            target_path.display()
        ),
        std::io::ErrorKind::PermissionDenied => {
            format!("Permission denied reading file: {relative_path}")
        }
        _ => format!("Filesystem error: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_fixture_file_without_legacy_runtime() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let file = root.join("probe.txt");
        fs::write(&file, "alpha\nbeta\n").expect("write");

        let results = read_content(
            root,
            &["probe.txt".into()],
            &ReadContentOptions::default(),
        );
        assert_eq!(results[0].path, "probe.txt");
        assert_eq!(results[0].content.as_ref().and_then(Value::as_str), Some("alpha\nbeta\n"));
    }

    #[test]
    fn writes_and_stats_through_rust_content_route() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let writes = write_content(
            root,
            &[WriteItem {
                path: "nested/out.txt".into(),
                content: "hello".into(),
                append: false,
                expected_content_hash: None,
            }],
        );
        assert!(writes[0].success);

        let stats = stat_items(root, &["nested/out.txt".into()]);
        assert_eq!(stats[0].status, "success");
        assert!(stats[0].stats.as_ref().is_some_and(|entry| entry.is_file));
    }
}

pub fn delete_items(root: &Path, paths: &[String]) -> Vec<DeleteItemsResult> {
    paths
        .iter()
        .map(|relative| delete_single_path(root, relative))
        .collect()
}

fn delete_single_path(root: &Path, relative_path: &str) -> DeleteItemsResult {
    let path_output = normalize_display_path(relative_path);
    let resolved = match resolve_path(relative_path, root) {
        Ok(path) => path,
        Err(error) => {
            return DeleteItemsResult {
                path: path_output,
                success: false,
                note: None,
                error: Some(error.message),
            };
        }
    };

    if paths_equal(&resolved, root) {
        return DeleteItemsResult {
            path: path_output,
            success: false,
            note: None,
            error: Some("Deleting the project root is not allowed.".into()),
        };
    }

    let meta = match fs::symlink_metadata(&resolved) {
        Ok(meta) => meta,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return DeleteItemsResult {
                path: path_output,
                success: true,
                note: Some("Path not found, nothing to delete"),
                error: None,
            };
        }
        Err(error) => {
            return delete_io_error(path_output, relative_path, error);
        }
    };

    let result = if meta.is_dir() {
        fs::remove_dir_all(&resolved)
    } else {
        fs::remove_file(&resolved)
    };

    match result {
        Ok(()) => DeleteItemsResult {
            path: path_output,
            success: true,
            note: None,
            error: None,
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => DeleteItemsResult {
            path: path_output,
            success: true,
            note: Some("Path not found, nothing to delete"),
            error: None,
        },
        Err(error) => delete_io_error(path_output, relative_path, error),
    }
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(left), Ok(right)) => left == right,
        _ => a == b,
    }
}

fn delete_io_error(path_output: String, relative_path: &str, error: std::io::Error) -> DeleteItemsResult {
    let message = match error.kind() {
        std::io::ErrorKind::PermissionDenied => {
            format!("Permission denied deleting {relative_path}")
        }
        _ => format!(
            "Failed to delete {relative_path}: {error} (code: {})",
            error
                .raw_os_error()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".into())
        ),
    };
    DeleteItemsResult {
        path: path_output,
        success: false,
        note: None,
        error: Some(message),
    }
}

