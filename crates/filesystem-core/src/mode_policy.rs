//! Pure chmod/chown mode & ownership arg policy (parity with handlers/chmod-items.ts
//! and handlers/chown-items.ts validation surface).
//!
//! Offline bulk residual (FLEET-BULK-FILESYSTEM-MCP-v1). I/O residual
//! (fs.chmod/chown) remains product effect — pure parse/validate only.
//! authority_rust=false; no route flip; no ts_deleted.

/// Mode must be an octal string like `755` or `0755` (3–4 digits, 0–7 only).
#[must_use]
pub fn is_valid_octal_mode_string(mode: &str) -> bool {
    let len = mode.len();
    if !(3..=4).contains(&len) {
        return false;
    }
    mode.bytes().all(|b| (b'0'..=b'7').contains(&b))
}

/// Parse octal mode string to numeric mode bits (base-8).
///
/// Returns `None` when the string is not a valid 3–4 digit octal mode.
#[must_use]
pub fn parse_octal_mode(mode: &str) -> Option<u32> {
    if !is_valid_octal_mode_string(mode) {
        return None;
    }
    u32::from_str_radix(mode, 8).ok()
}

/// Format permission bits as a 3-digit octal string (mode & 0o777).
///
/// Parity with stats-utils.ts: `(stats.mode & 0o777).toString(8).padStart(3, '0')`.
#[must_use]
pub fn format_mode_octal(mode: u32) -> String {
    format!("{:03o}", mode & 0o777)
}

/// Normalize display path to forward slashes (handler pathOutput).
#[must_use]
pub fn normalize_display_path(path: &str) -> String {
    path.replace('\\', "/")
}

/// True when the resolved absolute path equals the project root (forbid mutation).
///
/// Mirrors: `if (targetPath === PROJECT_ROOT) return error … not allowed`.
#[must_use]
pub fn is_project_root_path(resolved: &std::path::Path, root: &std::path::Path) -> bool {
    resolved == root
}

/// Pure chown identity validation: uid/gid must be non-negative integers
/// representable as i64 (TS z.number().int()).
#[must_use]
pub fn is_valid_ownership_id(id: i64) -> bool {
    id >= 0
}

/// Validate chown pair.
#[must_use]
pub fn is_valid_ownership(uid: i64, gid: i64) -> bool {
    is_valid_ownership_id(uid) && is_valid_ownership_id(gid)
}

/// Root-mutation denial message (chmod).
pub const CHMOD_ROOT_DENIED: &str = "Changing permissions of the project root is not allowed.";

/// Root-mutation denial message (chown) — shared policy class.
pub const CHOWN_ROOT_DENIED: &str = "Changing ownership of the project root is not allowed.";

/// Build chmod result shape for a pure policy decision (no I/O).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModePolicyDecision {
    pub path: String,
    pub allowed: bool,
    pub mode: Option<u32>,
    pub mode_string: Option<String>,
    pub error: Option<String>,
}

/// Pure pre-I/O gate for a single chmod path + mode string.
#[must_use]
pub fn evaluate_chmod_gate(
    relative_path: &str,
    mode_string: &str,
    resolved_is_root: bool,
) -> ModePolicyDecision {
    let path = normalize_display_path(relative_path);
    if resolved_is_root {
        return ModePolicyDecision {
            path,
            allowed: false,
            mode: None,
            mode_string: None,
            error: Some(CHMOD_ROOT_DENIED.into()),
        };
    }
    match parse_octal_mode(mode_string) {
        Some(mode) => ModePolicyDecision {
            path,
            allowed: true,
            mode: Some(mode),
            mode_string: Some(mode_string.to_string()),
            error: None,
        },
        None => ModePolicyDecision {
            path,
            allowed: false,
            mode: None,
            mode_string: None,
            error: Some(format!(
                "Mode must be an octal string like '755' or '0755': got '{mode_string}'"
            )),
        },
    }
}

/// Pure pre-I/O gate for a single chown path + uid/gid.
#[must_use]
pub fn evaluate_chown_gate(
    relative_path: &str,
    uid: i64,
    gid: i64,
    resolved_is_root: bool,
) -> ModePolicyDecision {
    let path = normalize_display_path(relative_path);
    if resolved_is_root {
        return ModePolicyDecision {
            path,
            allowed: false,
            mode: None,
            mode_string: None,
            error: Some(CHOWN_ROOT_DENIED.into()),
        };
    }
    if !is_valid_ownership(uid, gid) {
        return ModePolicyDecision {
            path,
            allowed: false,
            mode: None,
            mode_string: None,
            error: Some("UID/GID must be non-negative integers".into()),
        };
    }
    ModePolicyDecision {
        path,
        allowed: true,
        mode: None,
        mode_string: Some(format!("{uid}:{gid}")),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn octal_mode_valid_matrix() {
        assert!(is_valid_octal_mode_string("755"));
        assert!(is_valid_octal_mode_string("644"));
        assert!(is_valid_octal_mode_string("0755"));
        assert!(is_valid_octal_mode_string("0000"));
        assert!(!is_valid_octal_mode_string("75"));
        assert!(!is_valid_octal_mode_string("75555"));
        assert!(!is_valid_octal_mode_string("789"));
        assert!(!is_valid_octal_mode_string("75a"));
        assert!(!is_valid_octal_mode_string(""));
    }

    #[test]
    fn parse_octal_mode_values() {
        assert_eq!(parse_octal_mode("755"), Some(0o755));
        assert_eq!(parse_octal_mode("644"), Some(0o644));
        assert_eq!(parse_octal_mode("0755"), Some(0o755));
        assert_eq!(parse_octal_mode("000"), Some(0));
        assert_eq!(parse_octal_mode("888"), None);
        assert_eq!(parse_octal_mode("12"), None);
    }

    #[test]
    fn format_mode_masks_to_9_bits() {
        assert_eq!(format_mode_octal(0o100644), "644");
        assert_eq!(format_mode_octal(0o755), "755");
        assert_eq!(format_mode_octal(0o7), "007");
    }

    #[test]
    fn normalize_display_path_slashes() {
        assert_eq!(normalize_display_path(r"a\b\c"), "a/b/c");
        assert_eq!(normalize_display_path("a/b"), "a/b");
    }

    #[test]
    fn project_root_detection() {
        let root = Path::new("/proj");
        assert!(is_project_root_path(Path::new("/proj"), root));
        assert!(!is_project_root_path(Path::new("/proj/src"), root));
    }

    #[test]
    fn chmod_gate_root_and_bad_mode() {
        let denied = evaluate_chmod_gate(".", "755", true);
        assert!(!denied.allowed);
        assert_eq!(denied.error.as_deref(), Some(CHMOD_ROOT_DENIED));

        let bad = evaluate_chmod_gate("a.txt", "999", false);
        assert!(!bad.allowed);
        assert!(bad.error.as_ref().unwrap().contains("octal"));

        let ok = evaluate_chmod_gate(r"dir\file", "644", false);
        assert!(ok.allowed);
        assert_eq!(ok.mode, Some(0o644));
        assert_eq!(ok.path, "dir/file");
    }

    #[test]
    fn chown_gate_matrix() {
        assert!(is_valid_ownership(0, 0));
        assert!(!is_valid_ownership(-1, 0));
        let denied = evaluate_chown_gate(".", 0, 0, true);
        assert!(!denied.allowed);
        let ok = evaluate_chown_gate("x", 501, 20, false);
        assert!(ok.allowed);
        assert_eq!(ok.mode_string.as_deref(), Some("501:20"));
        let bad = evaluate_chown_gate("x", -1, 0, false);
        assert!(!bad.allowed);
    }

    #[test]
    fn residual_mode_ownership_edges() {
        // length bounds: only 3–4 digits
        assert!(!is_valid_octal_mode_string(""));
        assert!(!is_valid_octal_mode_string("12"));
        assert!(!is_valid_octal_mode_string("12345"));
        assert!(is_valid_octal_mode_string("000"));
        assert!(is_valid_octal_mode_string("0777"));
        // digit class 0–7 only; no whitespace
        assert!(!is_valid_octal_mode_string(" 755"));
        assert!(!is_valid_octal_mode_string("755 "));
        assert!(!is_valid_octal_mode_string("78a"));
        assert!(!is_valid_octal_mode_string("089"));
        assert_eq!(parse_octal_mode(""), None);
        assert_eq!(parse_octal_mode("xyz"), None);
        assert_eq!(parse_octal_mode("0777"), Some(0o777));
        // format: mask to 9 bits; zero pad
        assert_eq!(format_mode_octal(0), "000");
        assert_eq!(format_mode_octal(0o7777), "777");
        // ownership: negative / ok
        assert!(!is_valid_ownership_id(-1));
        assert!(is_valid_ownership_id(0));
        assert!(is_valid_ownership_id(i64::MAX));
        assert!(!is_valid_ownership(-1, 0));
        assert!(!is_valid_ownership(0, -1));
        assert!(is_valid_ownership(0, 0));
        // display path: backslash → forward slash only (no empty→dot)
        assert_eq!(normalize_display_path(""), "");
        let four_bs: String = std::iter::repeat('\\').take(4).collect();
        assert_eq!(normalize_display_path(&four_bs), "////");
        let a_bs_b: String = ['a', '\\', '\\', 'b'].into_iter().collect();
        assert_eq!(normalize_display_path(&a_bs_b), "a//b");
        // project root equality (not canonicalize)
        let root = Path::new("/proj");
        assert!(is_project_root_path(root, root));
        assert!(!is_project_root_path(Path::new("/other"), root));
        assert!(!is_project_root_path(Path::new("/proj/src"), root));
        // chmod gate: 4-digit leading zero allowed
        let ok4 = evaluate_chmod_gate("f", "0644", false);
        assert!(ok4.allowed);
        assert_eq!(ok4.mode, Some(0o644));
        // chown gate root still denied even with valid ids
        let denied = evaluate_chown_gate(".", 0, 0, true);
        assert!(!denied.allowed);
        assert_eq!(denied.error.as_deref(), Some(CHOWN_ROOT_DENIED));
    }
}
