//! Fast root-scoped directory walking for list_files.

use std::fs;
use std::path::Path;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use walkdir::WalkDir;

use crate::is_path_inside;
use crate::resolve_path;

pub const WALK_ROUTE: &str = "rust-walk";

const DEFAULT_EXCLUDES: &[&str] = &["node_modules", ".git", "dist", "target"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListStats {
    pub path: String,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symbolic_link: bool,
    pub size: u64,
    pub atime: String,
    pub mtime: String,
    pub ctime: String,
    pub birthtime: String,
    pub mode: String,
    pub uid: u32,
    pub gid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ListEntry {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<ListStats>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ListFilesMetrics {
    pub entries_found: usize,
    pub elapsed_ms: u64,
    pub route: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ListFilesResult {
    pub entries: Vec<ListEntry>,
    pub metrics: ListFilesMetrics,
}

fn should_skip_rel(rel: &str) -> bool {
    rel.split('/').any(|part| DEFAULT_EXCLUDES.contains(&part))
}

fn system_time_to_iso(time: SystemTime) -> String {
    let Ok(duration) = time.duration_since(UNIX_EPOCH) else {
        return "1970-01-01T00:00:00.000Z".into();
    };
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();
    // Deterministic UTC formatting without extra crates.
    format_timestamp_utc(secs, millis)
}

fn format_timestamp_utc(secs: u64, millis: u32) -> String {
    // Delegate to a minimal RFC3339 formatter for the supported test range.
    let days = secs / 86_400;
    let day_seconds = secs % 86_400;
    let hours = day_seconds / 3_600;
    let minutes = (day_seconds % 3_600) / 60;
    let seconds = day_seconds % 60;

    let mut year = 1970i32;
    let mut remaining_days = days as i32;
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let mut month = 1u32;
    let day;
    let month_lengths = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut day_of_year = remaining_days as u32;
    day = loop {
        let len = month_lengths[(month - 1) as usize];
        if day_of_year < len {
            break day_of_year + 1;
        }
        day_of_year -= len;
        month += 1;
    };

    format!(
        "{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{millis:03}Z"
    )
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

pub fn format_entry_stats(relative_path: &str, meta: &fs::Metadata) -> ListStats {
    format_stats(relative_path, meta)
}

#[cfg(target_family = "unix")]
fn format_stats(relative_path: &str, meta: &fs::Metadata) -> ListStats {
    use std::os::unix::fs::MetadataExt;

    let mode = format!("{:03o}", meta.mode() & 0o777);
    ListStats {
        path: relative_path.to_string(),
        is_file: meta.is_file(),
        is_directory: meta.is_dir(),
        is_symbolic_link: meta.file_type().is_symlink(),
        size: meta.len(),
        atime: system_time_to_iso(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(meta.atime() as u64)),
        mtime: system_time_to_iso(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(meta.mtime() as u64)),
        ctime: system_time_to_iso(SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(meta.ctime() as u64)),
        birthtime: system_time_to_iso(meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
        mode,
        uid: meta.uid(),
        gid: meta.gid(),
    }
}

#[cfg(not(target_family = "unix"))]
fn format_stats(relative_path: &str, meta: &fs::Metadata) -> ListStats {
    ListStats {
        path: relative_path.to_string(),
        is_file: meta.is_file(),
        is_directory: meta.is_dir(),
        is_symbolic_link: meta.file_type().is_symlink(),
        size: meta.len(),
        atime: system_time_to_iso(meta.accessed().unwrap_or(SystemTime::UNIX_EPOCH)),
        mtime: system_time_to_iso(meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
        ctime: system_time_to_iso(meta.modified().unwrap_or(SystemTime::UNIX_EPOCH)),
        birthtime: system_time_to_iso(meta.created().unwrap_or(SystemTime::UNIX_EPOCH)),
        mode: "644".into(),
        uid: 0,
        gid: 0,
    }
}

fn display_path(relative_path: &str, is_directory: bool) -> String {
    let normalized = relative_path.replace('\\', "/");
    if is_directory && !normalized.ends_with('/') {
        format!("{normalized}/")
    } else {
        normalized
    }
}

fn relative_from_root(canonical_root: &Path, absolute: &Path) -> Option<String> {
    let rel = absolute.strip_prefix(canonical_root).ok()?;
    if rel.as_os_str().is_empty() {
        return Some(String::new());
    }
    Some(rel.to_string_lossy().replace('\\', "/"))
}

fn push_entry(
    entries: &mut Vec<ListEntry>,
    canonical_root: &Path,
    absolute: &Path,
    include_stats: bool,
) {
    let Some(mut rel) = relative_from_root(canonical_root, absolute) else {
        return;
    };
    if should_skip_rel(&rel) {
        return;
    }

    let Ok(meta) = fs::symlink_metadata(absolute) else {
        return;
    };
    let is_directory = meta.is_dir();
    rel = display_path(&rel, is_directory);
    let stats = if include_stats {
        Some(format_stats(&rel.trim_end_matches('/'), &meta))
    } else {
        None
    };
    entries.push(ListEntry { path: rel, stats });
}

pub fn list_files(
    root: &Path,
    relative_path: &str,
    recursive: bool,
    include_stats: bool,
) -> Result<ListFilesResult, String> {
    let started = Instant::now();
    let target = resolve_path(relative_path, root).map_err(|err| err.message)?;
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("INVALID_ROOT: {err}"))?;

    if !is_path_inside(&target, &canonical_root) {
        return Err("Path traversal detected.".into());
    }

    let mut entries = Vec::new();
    let meta = fs::symlink_metadata(&target).map_err(|err| format!("LIST_FAILED: {err}"))?;

    if meta.is_file() {
        let rel = relative_path.replace('\\', "/");
        let stats = if include_stats {
            Some(format_stats(&rel, &meta))
        } else {
            None
        };
        entries.push(ListEntry { path: rel, stats });
    } else if meta.is_dir() {
        let walker = if recursive {
            WalkDir::new(&target)
        } else {
            WalkDir::new(&target).max_depth(1)
        };

        for entry in walker.into_iter().filter_map(Result::ok) {
            let path = entry.path();
            if path == target {
                continue;
            }
            let canonical = match path.canonicalize() {
                Ok(value) => value,
                Err(_) => path.to_path_buf(),
            };
            if !is_path_inside(&canonical, &canonical_root) {
                continue;
            }
            push_entry(&mut entries, &canonical_root, path, include_stats);
        }

        entries.sort_by(|left, right| left.path.cmp(&right.path));
    } else {
        return Err(format!(
            "Path is neither a file nor a directory: {relative_path}"
        ));
    }

    let entries_found = entries.len();
    let elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(ListFilesResult {
        entries,
        metrics: ListFilesMetrics {
            entries_found,
            elapsed_ms,
            route: WALK_ROUTE,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn lists_directory_entries_non_recursively() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().to_path_buf();
        fs::create_dir_all(root.join("subdir")).expect("mkdir");
        fs::write(root.join("file1.txt"), "one").expect("write");
        fs::write(root.join("subdir/nested.txt"), "two").expect("write");

        let result = list_files(&root, ".", false, false).expect("list");
        assert_eq!(result.metrics.route, WALK_ROUTE);
        assert!(result.entries.iter().any(|entry| entry.path == "file1.txt"));
        assert!(result.entries.iter().any(|entry| entry.path == "subdir/"));
        assert!(!result.entries.iter().any(|entry| entry.path.contains("nested")));
    }

    #[test]
    fn lists_directory_entries_recursively_with_stats() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().to_path_buf();
        fs::create_dir_all(root.join("nested")).expect("mkdir");
        fs::write(root.join("nested/item.txt"), "data").expect("write");

        let result = list_files(&root, ".", true, true).expect("list");
        let nested = result
            .entries
            .iter()
            .find(|entry| entry.path.ends_with("nested/item.txt"))
            .expect("nested file");
        assert!(nested.stats.as_ref().expect("stats").is_file);
    }

    #[test]
    fn returns_single_file_entry_for_file_paths() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().to_path_buf();
        fs::write(root.join("solo.txt"), "solo").expect("write");

        let result = list_files(&root, "solo.txt", false, true).expect("list");
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].path, "solo.txt");
        assert!(result.entries[0].stats.as_ref().expect("stats").is_file);
    }

    #[test]
    fn format_timestamp_utc_epoch_and_leap_day() {
        assert_eq!(format_timestamp_utc(0, 0), "1970-01-01T00:00:00.000Z");
        assert_eq!(format_timestamp_utc(1, 1), "1970-01-01T00:00:01.001Z");
        // 2000-03-01 00:00:00 UTC = 951868800
        assert_eq!(format_timestamp_utc(951_868_800, 0), "2000-03-01T00:00:00.000Z");
        // leap day 2000-02-29
        assert_eq!(format_timestamp_utc(951_782_400, 0), "2000-02-29T00:00:00.000Z");
        assert!(is_leap_year(2000));
        assert!(is_leap_year(2004));
        assert!(!is_leap_year(1900));
        assert!(!is_leap_year(2001));
        assert!(is_leap_year(2400));
    }

    #[test]
    fn should_skip_rel_and_display_path_pure() {
        assert!(should_skip_rel("node_modules/x"));
        assert!(should_skip_rel("src/.git/config"));
        assert!(should_skip_rel("pkg/dist/out"));
        assert!(should_skip_rel("a/target/b"));
        assert!(!should_skip_rel("src/lib"));
        assert!(!should_skip_rel(""));
        assert_eq!(display_path("src/a", false), "src/a");
        assert_eq!(display_path("src/a", true), "src/a/");
        assert_eq!(display_path("src/a/", true), "src/a/");
        assert_eq!(display_path(r"src\a", false), "src/a");
    }



    #[test]
    fn bw7_format_timestamp_utc_time_of_day_and_millis() {
        let secs = 12 * 3600 + 34 * 60 + 56;
        assert_eq!(format_timestamp_utc(secs, 789), "1970-01-01T12:34:56.789Z");
        assert!(!is_leap_year(2100));
        assert!(is_leap_year(2000));
        assert_eq!(display_path("a/b/", true), "a/b/");
        assert_eq!(display_path(r"a\b", false), "a/b");
        assert_eq!(display_path(r"a\b", true), "a/b/");
        assert!(!should_skip_rel("my_node_modules_backup/x"));
        assert!(should_skip_rel("a/node_modules/b"));
        assert!(should_skip_rel(".git"));
        assert!(should_skip_rel("dist"));
    }
}