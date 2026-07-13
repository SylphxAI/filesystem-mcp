//! Root-scoped filesystem path policy and search engine.

pub mod apply_diff;
pub mod audit;
pub mod content;
pub mod mutations;
pub mod search;
pub mod walk;

pub use walk::format_entry_stats;

pub use apply_diff::{
    apply_diffs_to_file_content, apply_indentation, apply_single_valid_diff, escape_regex,
    get_context_around_line, get_indentation, has_valid_line_number_logic, lines_match,
    validate_diff_block, validate_line_numbers, verify_content_match, ApplyDiffResult, DiffBlock,
    DiffOperation, DiffResult,
};
pub use content::{
    delete_items, read_content, stat_items, write_content, DeleteItemsResult, ReadContentOptions,
    ReadContentResult, ReadFormat, StatItemResult, WriteContentResult, WriteItem, CONTENT_ROUTE,
};
pub use mutations::{
    copy_items, create_directories, move_items, CreateDirResult, TransferOp, TransferResult,
    MUTATIONS_ROUTE,
};
pub use audit::{
    append_audit_batch, append_audit_batch_with_limit, content_hash, generate_operation_id,
    rollback_snapshot_path, RollbackMetadata, WriteAuditFileRecord, WriteAuditRequestRecord,
    DEFAULT_MAX_ROLLBACK_BYTES,
};

use std::path::{Component, Path, PathBuf};

pub const ENGINE_NAME: &str = "filesystem-core";
pub const ENGINE_VERSION: &str = "0.1.0";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PolicyErrorCode {
    InvalidParams,
    InvalidRequest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolicyError {
    pub code: PolicyErrorCode,
    pub message: String,
}

impl PolicyError {
    fn invalid_params(message: impl Into<String>) -> Self {
        Self {
            code: PolicyErrorCode::InvalidParams,
            message: message.into(),
        }
    }

    fn invalid_request(message: impl Into<String>) -> Self {
        Self {
            code: PolicyErrorCode::InvalidRequest,
            message: message.into(),
        }
    }
}

/// Separator-aware containment check aligned with the TypeScript adapter.
pub fn is_path_inside(candidate: &Path, root: &Path) -> bool {
    let Ok(relative) = candidate.strip_prefix(root) else {
        return false;
    };

    if relative.as_os_str().is_empty() {
        return true;
    }

    !relative
        .components()
        .any(|component| matches!(component, Component::ParentDir))
}

fn is_absolute_user_path(user_path: &str) -> bool {
    Path::new(user_path).is_absolute() || looks_like_windows_absolute(user_path)
}

fn looks_like_windows_absolute(user_path: &str) -> bool {
    let bytes = user_path.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
}

/// Resolve a user-relative path under `root`, following symlinks when the target exists.
pub fn resolve_path(relative_path: &str, root: &Path) -> Result<PathBuf, PolicyError> {
    if relative_path.is_empty() {
        return Ok(root.to_path_buf());
    }

    if is_absolute_user_path(relative_path) {
        return Err(PolicyError::invalid_params(format!(
            "Absolute paths are not allowed: {relative_path}"
        )));
    }

    let absolute_path = root.join(relative_path);

    if !is_path_inside(&absolute_path, root) {
        return Err(PolicyError::invalid_request(format!(
            "Path traversal detected: {relative_path}"
        )));
    }

    match std::fs::canonicalize(&absolute_path) {
        Ok(real_path) => {
            if !is_path_inside(&real_path, root) {
                return Err(PolicyError::invalid_request(format!(
                    "Path traversal via symlink detected: resolved path '{}' is outside project root",
                    real_path.display()
                )));
            }
            Ok(real_path)
        }
        Err(_) => {
            let parent = absolute_path.parent().unwrap_or(root);
            match std::fs::canonicalize(parent) {
                Ok(real_parent) => {
                    if !is_path_inside(&real_parent, root) {
                        return Err(PolicyError::invalid_request(format!(
                            "Path traversal via symlink detected: {relative_path}"
                        )));
                    }
                    Ok(absolute_path)
                }
                Err(_) => Ok(absolute_path),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::symlink;

    #[test]
    fn rejects_sibling_prefix_paths() {
        let root = PathBuf::from("/mock/project/root");
        let sibling = PathBuf::from("/mock/project/root-secret/secret.txt");
        assert!(!is_path_inside(&sibling, &root));
    }

    #[test]
    fn accepts_nested_child_paths() {
        let root = PathBuf::from("/mock/project/root");
        let child = root.join("src/a.ts");
        assert!(is_path_inside(&child, &root));
    }

    #[test]
    fn rejects_absolute_user_paths() {
        let root = PathBuf::from("/tmp/project");
        let result = resolve_path("/etc/passwd", &root);
        assert_eq!(result.unwrap_err().code, PolicyErrorCode::InvalidParams);
    }

    #[test]
    fn rejects_windows_drive_paths_on_posix() {
        let root = PathBuf::from("/tmp/project");
        let result = resolve_path(r"C:\Windows\System32", &root);
        assert_eq!(result.unwrap_err().code, PolicyErrorCode::InvalidParams);
    }

    #[test]
    fn rejects_parent_traversal() {
        let root = PathBuf::from("/tmp/project");
        let result = resolve_path("../outside/file", &root);
        assert_eq!(result.unwrap_err().code, PolicyErrorCode::InvalidRequest);
    }

    #[test]
    fn resolves_existing_relative_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().to_path_buf();
        let nested = root.join("src");
        fs::create_dir_all(&nested).expect("mkdir");
        let file = nested.join("a.ts");
        fs::write(&file, "export {}").expect("write");

        let resolved = resolve_path("src/a.ts", &root).expect("resolve");
        assert_eq!(resolved, file.canonicalize().expect("canonicalize"));
    }

    #[test]
    fn rejects_symlink_escape() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().join("root");
        let outside = temp.path().join("outside");
        fs::create_dir_all(&root).expect("root");
        fs::create_dir_all(&outside).expect("outside");
        let secret = outside.join("secret.txt");
        fs::write(&secret, "secret").expect("write");
        symlink(&outside, root.join("escape-link")).expect("symlink");

        let result = resolve_path("escape-link/secret.txt", &root);
        assert_eq!(result.unwrap_err().code, PolicyErrorCode::InvalidRequest);
    }
}