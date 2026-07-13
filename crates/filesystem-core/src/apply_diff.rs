//! Pure apply-diff engine (TS `src/utils/apply-diff-utils.ts` + `string-utils.ts`).
//!
//! Offline BW2 pure residual deepen: content transform + validation only (no I/O).
//! Tool routing remains LegacyOptIn until route flip + differential_green (rej-010).

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum DiffOperation {
    #[default]
    Replace,
    Insert,
}

impl DiffOperation {
    fn as_str(self) -> &'static str {
        match self {
            Self::Replace => "replace",
            Self::Insert => "insert",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DiffBlock {
    pub search: String,
    pub replace: String,
    pub start_line: i64,
    pub end_line: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation: Option<DiffOperation>,
}

impl DiffBlock {
    fn operation_or_default(&self) -> DiffOperation {
        self.operation.unwrap_or(DiffOperation::Replace)
    }

    /// Insert is encoded as `end_line == start_line - 1` (TS apply-diff contract).
    fn is_insert(&self) -> bool {
        self.end_line == self.start_line - 1
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffResult {
    pub operation: String,
    pub start_line: i64,
    pub end_line: i64,
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyDiffResult {
    pub success: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub new_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub diff_results: Option<Vec<DiffResult>>,
}

/// Escape regex specials — parity with TS `escapeRegex`.
pub fn escape_regex(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '$' | '(' | ')' | '*' | '+' | '.' | '?' | '[' | '\\' | ']' | '^' | '{' | '|' | '}' => {
                out.push('\\');
                out.push(ch);
            }
            _ => out.push(ch),
        }
    }
    out
}

/// Leading whitespace of a line — parity with TS `getIndentation`.
pub fn get_indentation(line: Option<&str>) -> String {
    let Some(line) = line else {
        return String::new();
    };
    line.chars()
        .take_while(|c| c.is_whitespace())
        .collect()
}

/// Apply indent prefix to each line — parity with TS `applyIndentation`.
pub fn apply_indentation(content: &str, indent: &str) -> Vec<String> {
    content
        .split('\n')
        .map(|line| format!("{indent}{line}"))
        .collect()
}

/// Line equality with optional leading-ws ignore — parity with TS `linesMatch`.
pub fn lines_match(
    file_line: Option<&str>,
    search_line: Option<&str>,
    ignore_leading_whitespace: bool,
) -> bool {
    let (Some(file_line), Some(search_line)) = (file_line, search_line) else {
        return false;
    };
    if ignore_leading_whitespace {
        file_line.trim_start() == search_line.trim_start()
    } else {
        file_line == search_line
    }
}

/// Context window around a 1-based line — parity with TS `getContextAroundLine`.
pub fn get_context_around_line(lines: &[String], line_number: i64, context_size: usize) -> String {
    if line_number < 1 {
        return format!("Error: Invalid line number ({line_number}) provided for context.");
    }

    let line_usize = line_number as usize;
    let start = line_usize.saturating_sub(1).saturating_sub(context_size);
    let end = (line_usize + context_size).min(lines.len());
    let mut context_lines: Vec<String> = Vec::new();

    for i in start..end {
        let current = i + 1;
        let prefix = if current as i64 == line_number {
            format!("> {current}")
        } else {
            format!("  {current}")
        };
        let content = lines.get(i).map(String::as_str).unwrap_or("");
        context_lines.push(format!("{prefix} | {content}"));
    }

    if start > 0 {
        context_lines.insert(0, "  ...".to_string());
    }
    if end < lines.len() {
        context_lines.push("  ...".to_string());
    }

    context_lines.join("\n")
}

/// Structural validity of a potential diff block (fields + types via construction).
pub fn has_valid_line_number_logic(start_line: i64, end_line: i64) -> bool {
    if start_line <= 0 {
        return false;
    }
    // TS rejects end_line < start_line for non-insert; insert uses end = start - 1
    // and is validated separately via validate_diff_block.
    if end_line < start_line {
        return false;
    }
    true
}

pub fn validate_diff_block(diff: &DiffBlock) -> bool {
    if diff.start_line <= 0 {
        return false;
    }
    // Insert: end_line == start_line - 1 with empty search
    if diff.is_insert() {
        return diff.search.is_empty();
    }
    has_valid_line_number_logic(diff.start_line, diff.end_line)
}

pub fn validate_line_numbers(diff: &DiffBlock, lines: &[String]) -> Result<(), (String, String)> {
    let start_line = diff.start_line;
    let end_line = diff.end_line;

    if start_line < 1 {
        let error = format!("Invalid line numbers [{start_line}-{end_line}]");
        let context = format!(
            "File has {} lines total.\n{}",
            lines.len(),
            get_context_around_line(lines, 1, 3)
        );
        return Err((error, context));
    }
    // Insert: end_line == start_line - 1 with empty search (validated in validate_diff_block).
    if diff.is_insert() {
        if start_line as usize > lines.len() + 1 {
            let error = format!("Invalid line numbers [{start_line}-{end_line}]");
            let context = format!(
                "File has {} lines total.\n{}",
                lines.len(),
                get_context_around_line(lines, start_line.min(lines.len() as i64).max(1), 3)
            );
            return Err((error, context));
        }
        return Ok(());
    }
    if end_line < start_line {
        let error = format!("Invalid line numbers [{start_line}-{end_line}]");
        let context = format!(
            "File has {} lines total.\n{}",
            lines.len(),
            get_context_around_line(lines, start_line, 3)
        );
        return Err((error, context));
    }
    if end_line as usize > lines.len() {
        let error = format!("Invalid line numbers [{start_line}-{end_line}]");
        let context_line = start_line.min(lines.len() as i64).max(1);
        let context = format!(
            "File has {} lines total.\n{}",
            lines.len(),
            get_context_around_line(lines, context_line, 3)
        );
        return Err((error, context));
    }
    Ok(())
}

fn normalize_newlines(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\r', "\n")
}

pub fn verify_content_match(diff: &DiffBlock, lines: &[String]) -> Result<(), (String, String)> {
    if diff.is_insert() {
        return Ok(());
    }

    let start_line = diff.start_line;
    let end_line = diff.end_line;
    if start_line < 1 || end_line < start_line || end_line as usize > lines.len() {
        return Err((
            format!(
                "Internal Error: Invalid line numbers [{start_line}-{end_line}] in verifyContentMatch."
            ),
            String::new(),
        ));
    }

    let start_idx = (start_line as usize) - 1;
    let end_idx = end_line as usize;
    let actual_block = lines[start_idx..end_idx].join("\n");
    let normalized_search = normalize_newlines(&diff.search).trim().to_string();
    let normalized_actual = normalize_newlines(&actual_block).trim().to_string();

    if normalized_actual != normalized_search {
        let error = format!(
            "Content mismatch at lines {start_line}-{end_line}. Expected content does not match actual content."
        );
        let context = format!(
            "--- EXPECTED (Search Block) ---\n{}\n--- ACTUAL (Lines {start_line}-{end_line}) ---\n{}\n--- DIFF ---\nExpected length: {}, Actual length: {}",
            diff.search,
            actual_block,
            diff.search.len(),
            actual_block.len()
        );
        return Err((error, context));
    }
    Ok(())
}

/// Mutate `lines` applying one validated diff (bottom-up caller order).
pub fn apply_single_valid_diff(lines: &mut Vec<String>, diff: &DiffBlock) {
    let replace_lines: Vec<String> = normalize_newlines(&diff.replace)
        .split('\n')
        .map(str::to_string)
        .collect();
    let start_idx = (diff.start_line as usize).saturating_sub(1);

    if diff.is_insert() {
        if start_idx <= lines.len() {
            lines.splice(start_idx..start_idx, replace_lines);
        }
        return;
    }

    let end_idx = (diff.end_line as usize).min(lines.len());
    if start_idx < lines.len() && end_idx >= start_idx && end_idx <= lines.len() {
        let delete_count = end_idx - start_idx;
        lines.splice(start_idx..start_idx + delete_count, replace_lines);
    }
}

fn record_failed(
    results: &mut Vec<DiffResult>,
    errors: &mut Vec<String>,
    diff: &DiffBlock,
    error: String,
    context: Option<String>,
) {
    results.push(DiffResult {
        operation: diff.operation_or_default().as_str().to_string(),
        start_line: diff.start_line,
        end_line: diff.end_line,
        success: false,
        error: Some(error.clone()),
        context,
    });
    errors.push(error);
}

/// Apply ordered diffs to in-memory file content — pure SSOT for MCP apply_diff.
pub fn apply_diffs_to_file_content(original_content: &str, diffs: &[DiffBlock]) -> ApplyDiffResult {
    let valid: Vec<&DiffBlock> = diffs.iter().filter(|d| validate_diff_block(d)).collect();
    if valid.is_empty() {
        return ApplyDiffResult {
            success: true,
            new_content: Some(original_content.to_string()),
            error: None,
            context: None,
            diff_results: None,
        };
    }

    let mut lines: Vec<String> = original_content.split('\n').map(str::to_string).collect();
    let mut diff_results: Vec<DiffResult> = Vec::new();
    let mut error_messages: Vec<String> = Vec::new();
    let mut has_errors = false;

    // Apply bottom-up (descending end_line) so earlier indices stay stable.
    let mut ordered = valid;
    ordered.sort_by(|a, b| b.end_line.cmp(&a.end_line));

    for diff in ordered {
        if let Err((error, context)) = validate_line_numbers(diff, &lines) {
            record_failed(
                &mut diff_results,
                &mut error_messages,
                diff,
                error,
                Some(context),
            );
            has_errors = true;
            continue;
        }

        if diff.is_insert() && !diff.search.is_empty() {
            record_failed(
                &mut diff_results,
                &mut error_messages,
                diff,
                "Insert operations must have empty search string".into(),
                Some(format!(
                    "Invalid insert operation at line {}",
                    diff.start_line
                )),
            );
            has_errors = true;
            continue;
        }

        if let Err((error, context)) = verify_content_match(diff, &lines) {
            record_failed(
                &mut diff_results,
                &mut error_messages,
                diff,
                error,
                if context.is_empty() {
                    None
                } else {
                    Some(context)
                },
            );
            has_errors = true;
            continue;
        }

        apply_single_valid_diff(&mut lines, diff);
        diff_results.push(DiffResult {
            operation: diff.operation_or_default().as_str().to_string(),
            start_line: diff.start_line,
            end_line: diff.end_line,
            success: true,
            error: None,
            context: Some(format!(
                "Successfully applied {} at lines {}-{}",
                diff.operation_or_default().as_str(),
                diff.start_line,
                diff.end_line
            )),
        });
    }

    if has_errors {
        let success_count = diff_results.iter().filter(|r| r.success).count();
        ApplyDiffResult {
            success: false,
            new_content: None,
            error: Some(format!(
                "Some diffs failed: {}",
                error_messages.join("; ")
            )),
            context: Some(format!(
                "Applied {success_count} of {} diffs successfully",
                diff_results.len()
            )),
            diff_results: Some(diff_results),
        }
    } else {
        ApplyDiffResult {
            success: true,
            new_content: Some(lines.join("\n")),
            error: None,
            context: None,
            diff_results: Some(diff_results),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_regex_escapes_specials() {
        assert_eq!(escape_regex("a+b"), r"a\+b");
        assert_eq!(escape_regex("file.txt"), r"file\.txt");
    }

    #[test]
    fn indentation_helpers() {
        assert_eq!(get_indentation(Some("  foo")), "  ");
        assert_eq!(get_indentation(None), "");
        assert_eq!(
            apply_indentation("a\nb", "  "),
            vec!["  a".to_string(), "  b".to_string()]
        );
        assert!(lines_match(Some("  x"), Some("x"), true));
        assert!(!lines_match(Some("  x"), Some("x"), false));
    }

    #[test]
    fn context_around_middle_line() {
        let lines: Vec<String> = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5"]
            .into_iter()
            .map(str::to_string)
            .collect();
        let context = get_context_around_line(&lines, 3, 1);
        assert_eq!(
            context,
            "  ...\n  2 | Line 2\n> 3 | Line 3\n  4 | Line 4\n  ..."
        );
    }

    #[test]
    fn context_invalid_line() {
        let lines = vec!["a".to_string()];
        assert!(get_context_around_line(&lines, 0, 1).contains("Error: Invalid line number"));
    }

    #[test]
    fn replace_single_line_content() {
        let original = "export const version = '1.0.0';\n";
        let diffs = vec![DiffBlock {
            search: "export const version = '1.0.0';".into(),
            replace: "export const version = '1.0.1';".into(),
            start_line: 1,
            end_line: 1,
            operation: Some(DiffOperation::Replace),
        }];
        let result = apply_diffs_to_file_content(original, &diffs);
        assert!(result.success, "{:?}", result.error);
        assert_eq!(
            result.new_content.as_deref(),
            Some("export const version = '1.0.1';\n")
        );
    }

    #[test]
    fn content_mismatch_fails() {
        let original = "aaa\nbbb\nccc\n";
        let diffs = vec![DiffBlock {
            search: "xxx".into(),
            replace: "yyy".into(),
            start_line: 2,
            end_line: 2,
            operation: None,
        }];
        let result = apply_diffs_to_file_content(original, &diffs);
        assert!(!result.success);
        assert!(result
            .error
            .as_deref()
            .unwrap_or("")
            .contains("Content mismatch"));
    }

    #[test]
    fn insert_at_line() {
        let original = "a\nc\n";
        let diffs = vec![DiffBlock {
            search: String::new(),
            replace: "b".into(),
            start_line: 2,
            end_line: 1, // insert: end = start - 1
            operation: Some(DiffOperation::Insert),
        }];
        let result = apply_diffs_to_file_content(original, &diffs);
        assert!(result.success, "{:?}", result.error);
        assert_eq!(result.new_content.as_deref(), Some("a\nb\nc\n"));
    }

    #[test]
    fn empty_valid_set_returns_original() {
        let original = "unchanged\n";
        // Invalid block filtered out → empty valid set
        let diffs = vec![DiffBlock {
            search: "x".into(),
            replace: "y".into(),
            start_line: 5,
            end_line: 1,
            operation: None,
        }];
        let result = apply_diffs_to_file_content(original, &diffs);
        assert!(result.success);
        assert_eq!(result.new_content.as_deref(), Some(original));
    }

    #[test]
    fn multi_replace_bottom_up() {
        let original = "one\ntwo\nthree\n";
        let diffs = vec![
            DiffBlock {
                search: "one".into(),
                replace: "1".into(),
                start_line: 1,
                end_line: 1,
                operation: None,
            },
            DiffBlock {
                search: "three".into(),
                replace: "3".into(),
                start_line: 3,
                end_line: 3,
                operation: None,
            },
        ];
        let result = apply_diffs_to_file_content(original, &diffs);
        assert!(result.success, "{:?}", result.error);
        assert_eq!(result.new_content.as_deref(), Some("1\ntwo\n3\n"));
    }

    #[derive(Debug, serde::Deserialize)]
    struct ApplyDiffGoldenFixture {
        cases: Vec<ApplyDiffGoldenCase>,
    }

    #[derive(Debug, serde::Deserialize)]
    struct ApplyDiffGoldenCase {
        id: String,
        original: String,
        diffs: Vec<DiffBlock>,
        #[serde(rename = "expectSuccess")]
        expect_success: bool,
        #[serde(default, rename = "expectNewContent")]
        expect_new_content: Option<String>,
        #[serde(default, rename = "errorContains")]
        error_contains: Option<String>,
    }

    /// Pure residual (BW3): bind `apply_diff_golden.json` via include_str! so
    /// fixture drift fails cargo test. No CLI wire / route flip / authority.
    #[test]
    fn apply_diff_golden_fixture_cases() {
        let raw = include_str!("../fixtures/apply_diff_golden.json");
        let fixture: ApplyDiffGoldenFixture =
            serde_json::from_str(raw).expect("parse apply_diff_golden.json");
        assert!(!fixture.cases.is_empty(), "golden fixture must have cases");
        for case in fixture.cases {
            let result = apply_diffs_to_file_content(&case.original, &case.diffs);
            assert_eq!(
                result.success, case.expect_success,
                "case {} success mismatch: {:?}",
                case.id, result.error
            );
            if let Some(expected) = case.expect_new_content.as_deref() {
                assert_eq!(
                    result.new_content.as_deref(),
                    Some(expected),
                    "case {} content",
                    case.id
                );
            }
            if let Some(needle) = case.error_contains.as_deref() {
                let err = result.error.as_deref().unwrap_or("");
                assert!(
                    err.contains(needle),
                    "case {} expected error containing {needle:?}, got {err:?}",
                    case.id
                );
            }
        }
    }


    #[test]
    fn validate_diff_block_insert_and_line_logic() {
        assert!(!has_valid_line_number_logic(0, 1));
        assert!(!has_valid_line_number_logic(2, 1));
        assert!(has_valid_line_number_logic(1, 1));
        assert!(has_valid_line_number_logic(1, 3));

        let insert_ok = DiffBlock {
            search: String::new(),
            replace: "x".into(),
            start_line: 2,
            end_line: 1,
            operation: Some(DiffOperation::Insert),
        };
        assert!(validate_diff_block(&insert_ok));
        let insert_bad = DiffBlock {
            search: "not-empty".into(),
            replace: "x".into(),
            start_line: 2,
            end_line: 1,
            operation: Some(DiffOperation::Insert),
        };
        assert!(!validate_diff_block(&insert_bad));
        let replace_ok = DiffBlock {
            search: "a".into(),
            replace: "b".into(),
            start_line: 1,
            end_line: 1,
            operation: None,
        };
        assert!(validate_diff_block(&replace_ok));
        let replace_bad_start = DiffBlock {
            search: "a".into(),
            replace: "b".into(),
            start_line: 0,
            end_line: 1,
            operation: None,
        };
        assert!(!validate_diff_block(&replace_bad_start));
    }

    #[test]
    fn escape_regex_covers_remaining_specials() {
        for ch in ['$', '(', ')', '*', '+', '.', '?', '[', '\\', ']', '^', '{', '|', '}'] {
            let escaped = escape_regex(&ch.to_string());
            assert_eq!(escaped, format!("\\{ch}"));
        }
        assert_eq!(escape_regex("plain"), "plain");
    }

    #[test]
    fn indentation_and_line_number_logic_pure() {
        assert_eq!(get_indentation(Some("    foo")), "    ");
        assert_eq!(get_indentation(Some("\tbar")), "\t");
        assert_eq!(get_indentation(Some("baz")), "");
        assert_eq!(get_indentation(None), "");
        let lines = apply_indentation("a\nb", "  ");
        assert_eq!(lines, vec!["  a".to_string(), "  b".to_string()]);
        assert!(has_valid_line_number_logic(1, 1));
        assert!(has_valid_line_number_logic(1, 3));
        assert!(!has_valid_line_number_logic(0, 1));
        assert!(!has_valid_line_number_logic(3, 1));
        assert!(!has_valid_line_number_logic(-1, 2));
        assert!(lines_match(Some("alpha"), Some("alpha"), false));
        assert!(!lines_match(Some("alpha"), Some("ALPHA"), false));
        assert!(lines_match(Some("  alpha"), Some("alpha"), true));
        assert!(!lines_match(None, Some("x"), false));
        let hay = vec!["alpha".into(), "beta".into(), "gamma".into()];
        let ctx = get_context_around_line(&hay, 2, 1);
        assert!(ctx.contains("alpha") || ctx.contains("beta") || ctx.contains("gamma"));
    }

    #[test]
    fn normalize_newlines_crlf_to_lf() {
        assert_eq!(normalize_newlines("a\r\nb\rc"), "a\nb\nc");
        assert_eq!(normalize_newlines("plain"), "plain");
    }


    #[test]
    fn bw7_lines_match_and_context_edges() {
        // ignore_leading_whitespace uses trim_start on both sides
        assert!(lines_match(Some("  alpha"), Some("alpha"), true));
        assert!(lines_match(Some("alpha"), Some("  alpha"), true));
        assert!(!lines_match(Some("  alpha"), Some("alpha"), false));
        assert!(!lines_match(Some("alpha"), Some("ALPHA"), false));
        // None pair always false (not both Some)
        assert!(!lines_match(None, None, false));
        assert!(!lines_match(Some("a"), None, true));
        let lines = vec!["L1".into(), "L2".into(), "L3".into()];
        let bad = get_context_around_line(&lines, 0, 1);
        assert!(bad.contains("Invalid line number"), "{bad}");
        let ctx = get_context_around_line(&lines, 1, 0);
        assert!(ctx.contains("L1"), "{ctx}");
        let multi = apply_indentation("x\ny", "--");
        assert_eq!(multi, vec!["--x".to_string(), "--y".to_string()]);
        assert!(has_valid_line_number_logic(5, 5));
        assert!(!has_valid_line_number_logic(5, 4));
    }

    #[test]
    fn bw7_escape_regex_and_normalize_newlines_matrix() {
        assert_eq!(escape_regex("a.b*c"), "a\\.b\\*c");
        assert_eq!(normalize_newlines("a\r\nb\rc"), "a\nb\nc");
        assert_eq!(normalize_newlines("\r\n"), "\n");
        assert_eq!(normalize_newlines("plain"), "plain");
    }

}
