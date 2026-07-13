//! Root-scoped create / move / copy mutations (TS handlers under `src/handlers/`).
//!
//! Offline BW2 pure residual deepen: filesystem effects under `resolve_path` policy only.
//! Tool routing remains LegacyOptIn until CLI wire + differential_green (rej-010).
//! No authority_rust / ts_deleted claims.

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::resolve_path;

pub const MUTATIONS_ROUTE: &str = "rust-mutations";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDirResult {
    pub path: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_path: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransferResult {
    pub source: String,
    pub destination: String,
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransferOp {
    pub source: String,
    pub destination: String,
}

fn normalize_display_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn paths_equal(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(left), Ok(right)) => left == right,
        _ => a == b,
    }
}

fn display_resolved(path: &Path) -> String {
    path.display().to_string()
}

/// Create directories (including intermediate parents) under `root`.
/// Parity intent with TS `create_directories` handler.
pub fn create_directories(root: &Path, paths: &[String]) -> Vec<CreateDirResult> {
    paths
        .iter()
        .map(|relative| create_single_directory(root, relative))
        .collect()
}

fn create_single_directory(root: &Path, relative_path: &str) -> CreateDirResult {
    let path_output = normalize_display_path(relative_path);
    let resolved = match resolve_path(relative_path, root) {
        Ok(path) => path,
        Err(error) => {
            return CreateDirResult {
                path: path_output,
                success: false,
                note: None,
                error: Some(error.message),
                resolved_path: Some("Resolution failed".into()),
            };
        }
    };

    if paths_equal(&resolved, root) {
        return CreateDirResult {
            path: path_output,
            success: false,
            note: None,
            error: Some("Creating the project root is not allowed.".into()),
            resolved_path: Some(display_resolved(&resolved)),
        };
    }

    match fs::create_dir_all(&resolved) {
        Ok(()) => CreateDirResult {
            path: path_output,
            success: true,
            note: None,
            error: None,
            resolved_path: Some(display_resolved(&resolved)),
        },
        Err(error) => handle_create_error(path_output, &resolved, relative_path, error),
    }
}

fn handle_create_error(
    path_output: String,
    resolved: &Path,
    relative_path: &str,
    error: std::io::Error,
) -> CreateDirResult {
    // If something already exists at the path, mirror TS EEXIST handling.
    if let Ok(meta) = fs::metadata(resolved) {
        if meta.is_dir() {
            return CreateDirResult {
                path: path_output,
                success: true,
                note: Some("Directory already exists"),
                error: None,
                resolved_path: Some(display_resolved(resolved)),
            };
        }
        return CreateDirResult {
            path: path_output,
            success: false,
            note: None,
            error: Some("Path exists but is not a directory".into()),
            resolved_path: Some(display_resolved(resolved)),
        };
    }

    let message = match error.kind() {
        std::io::ErrorKind::PermissionDenied => {
            format!("Permission denied creating directory: {error}")
        }
        _ => format!("Failed to create directory: {error}"),
    };
    // Keep relative_path available for future message tuning / debug.
    let _ = relative_path;

    CreateDirResult {
        path: path_output,
        success: false,
        note: None,
        error: Some(message),
        resolved_path: Some(display_resolved(resolved)),
    }
}

/// Move or rename items under `root`. Parity intent with TS `move_items`.
pub fn move_items(root: &Path, operations: &[TransferOp]) -> Vec<TransferResult> {
    operations
        .iter()
        .map(|op| move_single(root, op))
        .collect()
}

fn move_single(root: &Path, op: &TransferOp) -> TransferResult {
    let source_output = normalize_display_path(&op.source);
    let dest_output = normalize_display_path(&op.destination);

    if op.source.is_empty() || op.destination.is_empty() {
        return TransferResult {
            source: if source_output.is_empty() {
                "undefined".into()
            } else {
                source_output
            },
            destination: if dest_output.is_empty() {
                "undefined".into()
            } else {
                dest_output
            },
            success: false,
            error: Some("Invalid operation: source and destination must be defined.".into()),
        };
    }

    let source_abs = match resolve_path(&op.source, root) {
        Ok(path) => path,
        Err(error) => {
            return TransferResult {
                source: source_output,
                destination: dest_output,
                success: false,
                error: Some(error.message),
            };
        }
    };
    let dest_abs = match resolve_path(&op.destination, root) {
        Ok(path) => path,
        Err(error) => {
            return TransferResult {
                source: source_output,
                destination: dest_output,
                success: false,
                error: Some(error.message),
            };
        }
    };

    if paths_equal(&source_abs, root) {
        return TransferResult {
            source: source_output,
            destination: dest_output,
            success: false,
            error: Some("Moving the project root is not allowed.".into()),
        };
    }

    if !source_abs.exists() {
        return TransferResult {
            source: source_output,
            destination: dest_output,
            success: false,
            error: Some(format!("Source path not found: {}", op.source)),
        };
    }

    if let Some(dest_dir) = dest_abs.parent() {
        let source_dir = source_abs.parent();
        let needs_mkdir = dest_dir != root
            && source_dir.map(|sd| sd != dest_dir).unwrap_or(true)
            && !dest_dir.as_os_str().is_empty();
        if needs_mkdir {
            if let Err(error) = fs::create_dir_all(dest_dir) {
                // Ignore already-exists race; surface other mkdir failures.
                if !dest_dir.is_dir() {
                    return TransferResult {
                        source: source_output,
                        destination: dest_output,
                        success: false,
                        error: Some(format!("Failed to move item: {error}")),
                    };
                }
            }
        }
    }

    match fs::rename(&source_abs, &dest_abs) {
        Ok(()) => TransferResult {
            source: source_output,
            destination: dest_output,
            success: true,
            error: None,
        },
        Err(error) => TransferResult {
            source: source_output,
            destination: dest_output,
            success: false,
            error: Some(map_transfer_error("move", &error, &op.source, &op.destination)),
        },
    }
}

/// Copy items under `root` (recursive for directories). Parity intent with TS `copy_items`.
pub fn copy_items(root: &Path, operations: &[TransferOp]) -> Vec<TransferResult> {
    operations
        .iter()
        .map(|op| copy_single(root, op))
        .collect()
}

fn copy_single(root: &Path, op: &TransferOp) -> TransferResult {
    let source_output = normalize_display_path(&op.source);
    let dest_output = normalize_display_path(&op.destination);

    let source_abs = match resolve_path(&op.source, root) {
        Ok(path) => path,
        Err(error) => {
            return TransferResult {
                source: source_output,
                destination: dest_output,
                success: false,
                error: Some(error.message),
            };
        }
    };
    let dest_abs = match resolve_path(&op.destination, root) {
        Ok(path) => path,
        Err(error) => {
            return TransferResult {
                source: source_output,
                destination: dest_output,
                success: false,
                error: Some(error.message),
            };
        }
    };

    if paths_equal(&source_abs, root) {
        return TransferResult {
            source: source_output,
            destination: dest_output,
            success: false,
            error: Some("Copying the project root is not allowed.".into()),
        };
    }

    if !source_abs.exists() {
        return TransferResult {
            source: source_output,
            destination: dest_output,
            success: false,
            error: Some(format!("Source path not found: {}", op.source)),
        };
    }

    if let Some(dest_dir) = dest_abs.parent() {
        if let Err(error) = fs::create_dir_all(dest_dir) {
            if !dest_dir.is_dir() {
                return TransferResult {
                    source: source_output,
                    destination: dest_output,
                    success: false,
                    error: Some(format!("Failed to copy item: {error}")),
                };
            }
        }
    }

    match copy_recursive(&source_abs, &dest_abs) {
        Ok(()) => TransferResult {
            source: source_output,
            destination: dest_output,
            success: true,
            error: None,
        },
        Err(error) => TransferResult {
            source: source_output,
            destination: dest_output,
            success: false,
            error: Some(map_transfer_error("copy", &error, &op.source, &op.destination)),
        },
    }
}

/// Recursive copy with overwrite (TS `fs.cp` force + recursive + !errorOnExist).
fn copy_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    let meta = fs::symlink_metadata(src)?;
    if meta.is_dir() {
        fs::create_dir_all(dst)?;
        for entry in fs::read_dir(src)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let dest_child = dst.join(entry.file_name());
            if file_type.is_dir() {
                copy_recursive(&entry.path(), &dest_child)?;
            } else if file_type.is_symlink() {
                // Follow TS force-copy: materialize symlink target content when possible.
                let target = fs::read_link(entry.path())?;
                // Prefer copying pointed-to data if it is a file under the same tree.
                let resolved = entry.path().parent().unwrap_or(src).join(&target);
                if resolved.is_dir() {
                    copy_recursive(&resolved, &dest_child)?;
                } else if resolved.exists() {
                    if let Some(parent) = dest_child.parent() {
                        fs::create_dir_all(parent)?;
                    }
                    fs::copy(&resolved, &dest_child)?;
                } else {
                    // Fall back to recreating the symlink (best-effort).
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::symlink;
                        let _ = fs::remove_file(&dest_child);
                        symlink(&target, &dest_child)?;
                    }
                    #[cfg(not(unix))]
                    {
                        return Err(std::io::Error::new(
                            std::io::ErrorKind::Other,
                            "symlink copy not supported on this platform",
                        ));
                    }
                }
            } else {
                if let Some(parent) = dest_child.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(entry.path(), &dest_child)?;
            }
        }
        Ok(())
    } else {
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(src, dst)?;
        Ok(())
    }
}

fn map_transfer_error(
    verb: &str,
    error: &std::io::Error,
    source_relative: &str,
    destination_relative: &str,
) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => format!("Source path not found: {source_relative}"),
        std::io::ErrorKind::PermissionDenied => {
            format!(
                "Permission denied {}ing '{source_relative}' to '{destination_relative}'.",
                if verb == "move" { "mov" } else { "copy" }
            )
        }
        _ => format!("Failed to {verb} item: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn create_directories_nested_and_idempotent() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();

        let first = create_directories(root, &["a/b/c".into()]);
        assert!(first[0].success, "{:?}", first[0].error);
        assert!(root.join("a/b/c").is_dir());

        let second = create_directories(root, &["a/b/c".into()]);
        assert!(second[0].success, "{:?}", second[0].error);
        // create_dir_all is idempotent; note is optional when OS returns Ok.
    }

    #[test]
    fn create_directories_rejects_file_collision() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        fs::write(root.join("not-a-dir"), "x").expect("write");

        let results = create_directories(root, &["not-a-dir".into()]);
        assert!(!results[0].success);
        assert!(
            results[0]
                .error
                .as_deref()
                .unwrap_or("")
                .contains("not a directory")
                || results[0]
                    .error
                    .as_deref()
                    .unwrap_or("")
                    .contains("Failed to create"),
            "{:?}",
            results[0].error
        );
    }

    #[test]
    fn create_directories_rejects_root() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let results = create_directories(root, &["".into()]);
        assert!(!results[0].success);
        assert!(
            results[0]
                .error
                .as_deref()
                .unwrap_or("")
                .contains("project root"),
            "{:?}",
            results[0].error
        );
    }

    #[test]
    fn create_directories_rejects_traversal() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let results = create_directories(root, &["../outside".into()]);
        assert!(!results[0].success);
    }

    #[test]
    fn move_items_renames_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        fs::create_dir_all(root.join("src")).expect("mkdir");
        fs::write(root.join("src/a.txt"), "hello").expect("write");

        let results = move_items(
            root,
            &[TransferOp {
                source: "src/a.txt".into(),
                destination: "dst/b.txt".into(),
            }],
        );
        assert!(results[0].success, "{:?}", results[0].error);
        assert!(!root.join("src/a.txt").exists());
        assert_eq!(fs::read_to_string(root.join("dst/b.txt")).unwrap(), "hello");
    }

    #[test]
    fn move_items_source_missing() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let results = move_items(
            root,
            &[TransferOp {
                source: "nope.txt".into(),
                destination: "out.txt".into(),
            }],
        );
        assert!(!results[0].success);
        assert!(
            results[0]
                .error
                .as_deref()
                .unwrap_or("")
                .contains("Source path not found"),
            "{:?}",
            results[0].error
        );
    }

    #[test]
    fn copy_items_file_and_directory() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        fs::create_dir_all(root.join("tree/nested")).expect("mkdir");
        fs::write(root.join("tree/nested/leaf.txt"), "leaf").expect("write");
        fs::write(root.join("solo.txt"), "solo").expect("write");

        let file_copy = copy_items(
            root,
            &[TransferOp {
                source: "solo.txt".into(),
                destination: "copy-solo.txt".into(),
            }],
        );
        assert!(file_copy[0].success, "{:?}", file_copy[0].error);
        assert_eq!(
            fs::read_to_string(root.join("copy-solo.txt")).unwrap(),
            "solo"
        );
        // Original remains (copy, not move).
        assert!(root.join("solo.txt").exists());

        let dir_copy = copy_items(
            root,
            &[TransferOp {
                source: "tree".into(),
                destination: "tree-copy".into(),
            }],
        );
        assert!(dir_copy[0].success, "{:?}", dir_copy[0].error);
        assert_eq!(
            fs::read_to_string(root.join("tree-copy/nested/leaf.txt")).unwrap(),
            "leaf"
        );
        assert!(root.join("tree/nested/leaf.txt").exists());
    }

    #[test]
    fn copy_items_rejects_root() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        let results = copy_items(
            root,
            &[TransferOp {
                source: "".into(),
                destination: "elsewhere".into(),
            }],
        );
        assert!(!results[0].success);
        assert!(
            results[0]
                .error
                .as_deref()
                .unwrap_or("")
                .contains("project root"),
            "{:?}",
            results[0].error
        );
    }

    #[test]
    fn copy_overwrites_existing_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path();
        fs::write(root.join("src.txt"), "new").expect("write");
        fs::write(root.join("dst.txt"), "old").expect("write");
        let results = copy_items(
            root,
            &[TransferOp {
                source: "src.txt".into(),
                destination: "dst.txt".into(),
            }],
        );
        assert!(results[0].success, "{:?}", results[0].error);
        assert_eq!(fs::read_to_string(root.join("dst.txt")).unwrap(), "new");
    }
}
