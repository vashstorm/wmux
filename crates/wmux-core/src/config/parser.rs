//! JSONC (JSON with Comments) parsing utilities.

/// Strips comments from JSONC input, preserving string literals and line endings.
///
/// Handles both single-line (`//`) and multi-line (`/* ... */`) comments.
/// Preserves newline characters to maintain line numbers for error reporting.
pub fn strip_jsonc_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;

    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
            out.push(ch);
            continue;
        }

        if ch == '/' {
            match chars.peek().copied() {
                Some('/') => {
                    let _ = chars.next();
                    for next in chars.by_ref() {
                        if next == '\n' {
                            out.push('\n');
                            break;
                        }
                    }
                    continue;
                }
                Some('*') => {
                    let _ = chars.next();
                    let mut prev = '\0';
                    for next in chars.by_ref() {
                        if next == '\n' {
                            out.push('\n');
                        }
                        if prev == '*' && next == '/' {
                            break;
                        }
                        prev = next;
                    }
                    continue;
                }
                _ => {}
            }
        }

        out.push(ch);
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_single_line_comments() {
        let input = "{\n  // comment\n  \"key\": \"value\"\n}";
        let output = strip_jsonc_comments(input);
        assert_eq!(
            output,
            "{\n  \n  \"key\": \"value\"\n}"
        );
    }

    #[test]
    fn strip_multi_line_comments() {
        let input = "{\n  /* multi\n  line */\n  \"key\": \"value\"\n}";
        let output = strip_jsonc_comments(input);
        assert_eq!(
            output,
            "{\n  \n\n  \"key\": \"value\"\n}"
        );
    }

    #[test]
    fn preserve_strings_with_slashes() {
        let input = "{\"url\": \"https://example.com\" // comment\n}";
        let output = strip_jsonc_comments(input);
        assert_eq!(
            output,
            "{\"url\": \"https://example.com\" \n}"
        );
    }

    #[test]
    fn preserve_strings_with_escaped_quotes() {
        let input = "{\"text\": \"say \\\"hello\\\"\" // comment\n}";
        let output = strip_jsonc_comments(input);
        assert_eq!(
            output,
            "{\"text\": \"say \\\"hello\\\"\" \n}"
        );
    }

    #[test]
    fn handle_nested_comment_markers_in_strings() {
        let input = "{\"pattern\": \"/* not a comment */\" // real comment\n}";
        let output = strip_jsonc_comments(input);
        assert_eq!(
            output,
            "{\"pattern\": \"/* not a comment */\" \n}"
        );
    }

    #[test]
    fn empty_input() {
        let output = strip_jsonc_comments("");
        assert_eq!(output, "");
    }

    #[test]
    fn no_comments() {
        let input = "{\"key\": \"value\"}";
        let output = strip_jsonc_comments(input);
        assert_eq!(output, input);
    }
}