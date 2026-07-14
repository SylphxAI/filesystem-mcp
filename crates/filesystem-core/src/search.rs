//! Fast root-scoped regex search over the project tree.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

use regex::Regex;
use walkdir::WalkDir;

use crate::resolve_path;

const DEFAULT_EXCLUDES: &[&str] = &["node_modules", ".git", "dist", "target"];
const DEFAULT_MAX_FILE_BYTES: u64 = 1_048_576;
const DEFAULT_CONTEXT_LINES: usize = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchMatch {
    pub file: String,
    pub line: u32,
    pub matched_text: String,
    pub context: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SearchStats {
    pub files_scanned: usize,
    pub matches_found: usize,
    pub elapsed_ms: u64,
}

pub fn compile_search_regex(pattern: &str) -> Result<Regex, String> {
    let (body, flags) = parse_regex_literal(pattern);
    let mut regex_flags = String::new();
    if flags.contains('i') {
        regex_flags.push('i');
    }
    if flags.contains('m') {
        regex_flags.push('m');
    }
    if flags.contains('s') {
        regex_flags.push('s');
    }

    let compiled = if regex_flags.is_empty() {
        Regex::new(&body)
    } else {
        Regex::new(&format!("(?{regex_flags}){body}"))
    };

    compiled.map_err(|err| format!("INVALID_REGEX: {err}"))
}

fn parse_regex_literal(pattern: &str) -> (String, String) {
    if let Some(rest) = pattern.strip_prefix('/') {
        if let Some(end) = rest.rfind('/') {
            let body = &rest[..end];
            let flags = &rest[end + 1..];
            return (body.to_string(), flags.to_string());
        }
    }
    (pattern.to_string(), String::new())
}

fn matches_file_pattern(file_name: &str, pattern: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    if let Some(ext) = pattern.strip_prefix("*.") {
        return file_name.ends_with(&format!(".{ext}"));
    }
    if let Some(suffix) = pattern.strip_prefix('*') {
        return file_name.ends_with(suffix);
    }
    file_name == pattern
}

fn should_skip_dir(rel: &str) -> bool {
    rel.split('/').any(|part| DEFAULT_EXCLUDES.contains(&part))
}

pub fn search_files(
    root: &Path,
    relative_path: &str,
    regex_pattern: &str,
    file_pattern: &str,
    max_file_bytes: Option<u64>,
    context_lines: Option<usize>,
) -> Result<(Vec<SearchMatch>, SearchStats), String> {
    let started = Instant::now();
    let search_root = resolve_path(relative_path, root).map_err(|err| err.message)?;
    let regex = compile_search_regex(regex_pattern)?;
    let max_bytes = max_file_bytes.unwrap_or(DEFAULT_MAX_FILE_BYTES);
    let context = context_lines.unwrap_or(DEFAULT_CONTEXT_LINES);
    let canonical_root = root
        .canonicalize()
        .map_err(|err| format!("INVALID_ROOT: {err}"))?;

    let mut matches = Vec::new();
    let mut files_scanned = 0usize;

    for entry in WalkDir::new(&search_root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if path.is_dir() {
            continue;
        }

        let rel = path
            .strip_prefix(&canonical_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");

        if should_skip_dir(&rel) {
            continue;
        }

        let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("");
        if !matches_file_pattern(file_name, file_pattern) {
            continue;
        }

        let Ok(meta) = fs::metadata(path) else {
            continue;
        };
        if !meta.is_file() || meta.len() > max_bytes {
            continue;
        }

        let Ok(content) = fs::read_to_string(path) else {
            continue;
        };

        files_scanned += 1;
        let lines: Vec<&str> = content.lines().collect();
        for (line_idx, line) in lines.iter().enumerate() {
            if !regex.is_match(line) {
                continue;
            }
            let line_number = (line_idx + 1) as u32;
            let start = line_idx.saturating_sub(context);
            let end = (line_idx + context + 1).min(lines.len());
            matches.push(SearchMatch {
                file: rel.clone(),
                line: line_number,
                matched_text: regex
                    .find(line)
                    .map(|m| m.as_str().to_string())
                    .unwrap_or_else(|| line.to_string()),
                context: lines[start..end].iter().map(|value| (*value).to_string()).collect(),
            });
        }
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let matches_found = matches.len();
    Ok((
        matches,
        SearchStats {
            files_scanned,
            matches_found,
            elapsed_ms,
        },
    ))
}

pub fn search_files_from_root(
    root: PathBuf,
    relative_path: &str,
    regex_pattern: &str,
    file_pattern: &str,
) -> Result<(Vec<SearchMatch>, SearchStats), String> {
    search_files(&root, relative_path, regex_pattern, file_pattern, None, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn finds_matches_in_fixture_tree() {
        let temp = tempfile::tempdir().expect("tempdir");
        let root = temp.path().to_path_buf();
        let nested = root.join("src");
        fs::create_dir_all(&nested).expect("mkdir");
        fs::write(nested.join("auth.ts"), "export function loginUser() {}\n").expect("write");
        fs::write(root.join("package.json"), r#"{"name":"demo"}"#).expect("write");

        let (matches, stats) =
            search_files(&root, ".", "loginUser", "*.ts", None, None).expect("search");
        assert!(stats.files_scanned >= 1);
        assert_eq!(matches.len(), 1);
        assert!(matches[0].file.ends_with("src/auth.ts"));
        assert_eq!(matches[0].line, 1);
    }

    #[test]
    fn rejects_invalid_regex_patterns() {
        let temp = tempfile::tempdir().expect("tempdir");
        let err = search_files(temp.path(), ".", "[invalid", "*", None, None).unwrap_err();
        assert!(err.starts_with("INVALID_REGEX"));
    }


    #[test]
    fn compile_search_regex_supports_literal_flags_and_file_patterns() {
        let re = compile_search_regex("/foo/i").expect("slash flags");
        assert!(re.is_match("FOO"));
        let re = compile_search_regex("bar").expect("plain");
        assert!(re.is_match("bar"));
        assert!(!re.is_match("BAR"));
        assert!(matches_file_pattern("auth.ts", "*.ts"));
        assert!(matches_file_pattern("readme.md", "*"));
        assert!(matches_file_pattern("app.config.js", "*.js"));
        assert!(!matches_file_pattern("auth.ts", "*.js"));
        assert!(matches_file_pattern("exact.txt", "exact.txt"));
        assert!(should_skip_dir("src/node_modules/pkg"));
        assert!(should_skip_dir("target/debug"));
        assert!(!should_skip_dir("src/lib"));
    }

    #[test]
    fn parse_regex_literal_and_suffix_file_patterns() {
        let (body, flags) = parse_regex_literal("/ab+c/im");
        assert_eq!(body, "ab+c");
        assert_eq!(flags, "im");
        let (body, flags) = parse_regex_literal("no-slash");
        assert_eq!(body, "no-slash");
        assert_eq!(flags, "");
        // incomplete slash form treated as plain
        let (body, flags) = parse_regex_literal("/only-open");
        assert_eq!(body, "/only-open");
        assert_eq!(flags, "");
        assert!(matches_file_pattern("readme.md", "*md"));
        assert!(matches_file_pattern("app.test.ts", "*.ts"));
        assert!(!matches_file_pattern("app.test.ts", "*.js"));
        assert!(matches_file_pattern("exact", "exact"));
        assert!(!matches_file_pattern("exact", "other"));
    }


    #[test]
    fn bw7_compile_search_regex_flags_and_file_pattern_edges() {
        let re = compile_search_regex("/foo/i").expect("i");
        assert!(re.is_match("FOO"));
        let re = compile_search_regex("/foo.bar/s").expect("s");
        // with s flag, . matches newline
        assert!(re.is_match("foo\nbar"));
        assert!(matches_file_pattern("README.md", "*md"));
        assert!(!matches_file_pattern("README.txt", "*md"));
        assert!(should_skip_dir("a/.git/b"));
        assert!(should_skip_dir("node_modules"));
        assert!(!should_skip_dir("src"));
        let (body, flags) = parse_regex_literal("/x/g");
        assert_eq!(body, "x");
        assert_eq!(flags, "g");
        assert!(matches_file_pattern("app.test.ts", "*.ts"));
        assert!(!matches_file_pattern("app.test.ts", "*.js"));
    }


    #[test]
    fn bw8_compile_search_regex_m_flag_and_invalid() {
        let re = compile_search_regex("/^foo$/m").expect("m");
        assert!(re.is_match("foo"));
        assert!(re.is_match("x\nfoo\ny"));
        let err = compile_search_regex("/[unterminated/").unwrap_err();
        assert!(err.contains("INVALID_REGEX") || err.contains("regex"), "{err}");
        let (body, flags) = parse_regex_literal("//i");
        assert_eq!(body, "");
        assert_eq!(flags, "i");
        assert!(matches_file_pattern("file", "*") || matches_file_pattern("file", "file"));
        assert!(!should_skip_dir("src/lib"));
        assert!(should_skip_dir("a/dist/b"));
        assert!(should_skip_dir("target"));
    }
}
