//! Pure replace-content engine (TS `src/handlers/replace-content.ts` helpers).
//!
//! Offline BW2 pure residual deepen: in-memory search/replace transform only (no I/O).
//! Tool routing remains LegacyOptIn until CLI wire + differential_green (rej-010).
//! No authority_rust / ts_deleted claims.
//!
//! Regex construction mirrors TS `createSearchRegex` + `applyReplaceOperation`:
//! - always global within a file
//! - optional ignore_case
//! - multiline only when `use_regex` and pattern contains `^` or `$`
//! - invalid regex → zero replacements (silent no-op)

use regex::RegexBuilder;
use serde::{Deserialize, Serialize};

use crate::escape_regex;

pub const REPLACE_CONTENT_ROUTE: &str = "rust-replace-content";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct ReplaceOperation {
    pub search: String,
    pub replace: String,
    #[serde(default)]
    pub use_regex: bool,
    #[serde(default)]
    pub ignore_case: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReplaceResult {
    pub new_content: String,
    pub replacements_made: usize,
    /// True when `new_content != original` (after all ops).
    pub modified: bool,
}

/// Build the search pattern string (escaped when not regex) — parity with TS.
pub fn build_search_pattern(op: &ReplaceOperation) -> String {
    if op.use_regex {
        op.search.clone()
    } else {
        escape_regex(&op.search)
    }
}

/// Whether multiline mode should be enabled — parity with TS createSearchRegex.
pub fn needs_multiline(op: &ReplaceOperation) -> bool {
    op.use_regex && (op.search.contains('^') || op.search.contains('$'))
}

/// Compile a global search regex for one operation.
/// Returns `None` for invalid patterns (TS returns undefined → 0 replacements).
pub fn create_search_regex(op: &ReplaceOperation) -> Option<regex::Regex> {
    let pattern = build_search_pattern(op);
    RegexBuilder::new(&pattern)
        .case_insensitive(op.ignore_case)
        .multi_line(needs_multiline(op))
        .build()
        .ok()
}

/// Apply a single replace operation to content — parity with TS `applyReplaceOperation`.
pub fn apply_replace_operation(
    current_content: &str,
    op: &ReplaceOperation,
) -> ApplyReplaceResult {
    let Some(search_regex) = create_search_regex(op) else {
        return ApplyReplaceResult {
            new_content: current_content.to_string(),
            replacements_made: 0,
            modified: false,
        };
    };

    let replacements_made = search_regex.find_iter(current_content).count();
    if replacements_made == 0 {
        return ApplyReplaceResult {
            new_content: current_content.to_string(),
            replacements_made: 0,
            modified: false,
        };
    }

    let new_content = search_regex
        .replace_all(current_content, op.replace.as_str())
        .into_owned();
    let modified = new_content != current_content;

    // TS only counts when replacements were made; still report find_iter count.
    ApplyReplaceResult {
        new_content,
        replacements_made,
        modified,
    }
}

/// Apply ordered operations to in-memory content — pure SSOT for replace_content body.
///
/// Parity with TS loop in `processSingleFileReplacement`:
/// - accumulate replacement counts across ops
/// - only advance content when replacementsMade > 0 && newContent !== fileContent
pub fn apply_operations_to_content(
    original_content: &str,
    operations: &[ReplaceOperation],
) -> ApplyReplaceResult {
    let mut file_content = original_content.to_string();
    let mut total_replacements = 0usize;

    for op in operations {
        let step = apply_replace_operation(&file_content, op);
        if step.replacements_made > 0 && step.new_content != file_content {
            file_content = step.new_content;
            total_replacements += step.replacements_made;
        }
    }

    ApplyReplaceResult {
        modified: file_content != original_content,
        new_content: file_content,
        replacements_made: total_replacements,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(search: &str, replace: &str) -> ReplaceOperation {
        ReplaceOperation {
            search: search.into(),
            replace: replace.into(),
            use_regex: false,
            ignore_case: false,
        }
    }

    fn op_regex(search: &str, replace: &str) -> ReplaceOperation {
        ReplaceOperation {
            search: search.into(),
            replace: replace.into(),
            use_regex: true,
            ignore_case: false,
        }
    }

    fn op_ci(search: &str, replace: &str) -> ReplaceOperation {
        ReplaceOperation {
            search: search.into(),
            replace: replace.into(),
            use_regex: false,
            ignore_case: true,
        }
    }

    #[test]
    fn simple_literal_replace_counts_all_matches() {
        let result = apply_operations_to_content(
            "Hello world, world!",
            &[op("world", "planet")],
        );
        assert!(result.modified);
        assert_eq!(result.replacements_made, 2);
        assert_eq!(result.new_content, "Hello planet, planet!");
    }

    #[test]
    fn sequential_operations_accumulate_counts() {
        // 2 from world→galaxy + 2 from galaxy→universe = 4
        let result = apply_operations_to_content(
            "Hello world, world!",
            &[op("world", "galaxy"), op("galaxy", "universe")],
        );
        assert!(result.modified);
        assert_eq!(result.replacements_made, 4);
        assert_eq!(result.new_content, "Hello universe, universe!");
    }

    #[test]
    fn regex_with_capture_groups() {
        let original = "Error: world not found.\nWarning: world might be deprecated.";
        let result = apply_operations_to_content(
            original,
            &[op_regex("^(Error|Warning):", "Log[$1]:")],
        );
        assert!(result.modified);
        assert_eq!(result.replacements_made, 2);
        assert_eq!(
            result.new_content,
            "Log[Error]: world not found.\nLog[Warning]: world might be deprecated."
        );
    }

    #[test]
    fn case_insensitive_literal() {
        let result =
            apply_operations_to_content("Hello world, world!", &[op_ci("hello", "Greetings")]);
        assert!(result.modified);
        assert_eq!(result.replacements_made, 1);
        assert_eq!(result.new_content, "Greetings world, world!");
    }

    #[test]
    fn no_match_is_unmodified() {
        let original = "Nothing to see here.";
        let result = apply_operations_to_content(original, &[op("world", "planet")]);
        assert!(!result.modified);
        assert_eq!(result.replacements_made, 0);
        assert_eq!(result.new_content, original);
    }

    #[test]
    fn empty_content_no_match() {
        let result = apply_operations_to_content("", &[op("anything", "something")]);
        assert!(!result.modified);
        assert_eq!(result.replacements_made, 0);
        assert_eq!(result.new_content, "");
    }

    #[test]
    fn invalid_regex_is_silent_noop() {
        let original = "abc";
        let result = apply_operations_to_content(
            original,
            &[op_regex("[unterminated", "x")],
        );
        assert!(!result.modified);
        assert_eq!(result.replacements_made, 0);
        assert_eq!(result.new_content, original);
    }

    #[test]
    fn literal_escapes_regex_metacharacters() {
        let result =
            apply_operations_to_content("price is $5.00+", &[op("$5.00+", "€5")]);
        assert!(result.modified);
        assert_eq!(result.replacements_made, 1);
        assert_eq!(result.new_content, "price is €5");
    }

    #[test]
    fn multiline_anchor_only_when_use_regex() {
        // use_regex + ^ should match line starts under multi_line
        let original = "foo\nbar\nfoo";
        let result =
            apply_operations_to_content(original, &[op_regex("^foo", "baz")]);
        assert!(result.modified);
        assert_eq!(result.replacements_made, 2);
        assert_eq!(result.new_content, "baz\nbar\nbaz");
    }

    #[test]
    fn build_search_pattern_escapes_when_not_regex() {
        assert_eq!(
            build_search_pattern(&op("a+b", "x")),
            r"a\+b"
        );
        assert_eq!(
            build_search_pattern(&op_regex("a+b", "x")),
            "a+b"
        );
    }

    #[derive(Debug, serde::Deserialize)]
    struct ReplaceContentGoldenFixture {
        cases: Vec<ReplaceContentGoldenCase>,
    }

    #[derive(Debug, serde::Deserialize)]
    struct ReplaceContentGoldenCase {
        id: String,
        original: String,
        operations: Vec<ReplaceOperation>,
        #[serde(rename = "expectModified")]
        expect_modified: bool,
        #[serde(rename = "expectReplacements")]
        expect_replacements: usize,
        #[serde(rename = "expectNewContent")]
        expect_new_content: String,
    }

    /// Pure residual (BW3): bind `replace_content_golden.json` via include_str!.
    /// No CLI wire / route flip / authority (rej-010).
    #[test]
    fn replace_content_golden_fixture_cases() {
        let raw = include_str!("../fixtures/replace_content_golden.json");
        let fixture: ReplaceContentGoldenFixture =
            serde_json::from_str(raw).expect("parse replace_content_golden.json");
        assert!(!fixture.cases.is_empty());
        for case in fixture.cases {
            let result = apply_operations_to_content(&case.original, &case.operations);
            assert_eq!(
                result.modified, case.expect_modified,
                "case {} modified",
                case.id
            );
            assert_eq!(
                result.replacements_made, case.expect_replacements,
                "case {} replacements",
                case.id
            );
            assert_eq!(
                result.new_content, case.expect_new_content,
                "case {} content",
                case.id
            );
        }
    }

    #[test]
    fn build_search_pattern_and_needs_multiline_pure() {
        let lit = ReplaceOperation {
            search: "a.b".into(),
            replace: "x".into(),
            use_regex: false,
            ignore_case: false,
        };
        assert_eq!(build_search_pattern(&lit), "a\\.b");
        assert!(!needs_multiline(&lit));
        let re = ReplaceOperation {
            search: "^foo$".into(),
            replace: "bar".into(),
            use_regex: true,
            ignore_case: true,
        };
        assert_eq!(build_search_pattern(&re), "^foo$");
        assert!(needs_multiline(&re));
        let re2 = ReplaceOperation {
            search: "plain".into(),
            replace: "x".into(),
            use_regex: true,
            ignore_case: false,
        };
        assert!(!needs_multiline(&re2));
        assert!(create_search_regex(&lit).is_some());
        let bad = ReplaceOperation {
            search: "[invalid".into(),
            replace: "x".into(),
            use_regex: true,
            ignore_case: false,
        };
        assert!(create_search_regex(&bad).is_none());
    }


    #[test]
    fn bw7_create_search_regex_and_ignore_case() {
        let lit = op("a+b", "x");
        let re = create_search_regex(&lit).expect("lit");
        assert!(re.is_match("a+b"));
        assert!(!re.is_match("aab"));
        let ci = ReplaceOperation {
            search: "Foo".into(),
            replace: "bar".into(),
            use_regex: false,
            ignore_case: true,
        };
        let re = create_search_regex(&ci).expect("ci");
        assert!(re.is_match("foo"));
        assert!(re.is_match("FOO"));
        let bad = ReplaceOperation {
            search: "[unterminated".into(),
            replace: "x".into(),
            use_regex: true,
            ignore_case: false,
        };
        assert!(create_search_regex(&bad).is_none());
        assert!(!needs_multiline(&op("plain", "x")));
        assert!(needs_multiline(&op_regex("^line", "x")));
        assert!(needs_multiline(&op_regex("end$", "x")));
        assert!(!needs_multiline(&op_regex("no-anchors", "x")));
    }

}
