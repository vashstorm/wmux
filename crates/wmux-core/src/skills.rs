//! Skill definition loader and persistence for Omni voice skills.
//!
//! Loads skill definitions from markdown files in a `skills/` directory.
//! Each `.md` file contains YAML frontmatter with metadata and markdown body
//! for the description.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::protocol::{OmniSkillRiskLevel, VOICE_BACKEND_ROUTES, VOICE_FRONTEND_ROUTES};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum OmniSkillPromptMode {
    #[default]
    Description,
    Full,
}

/// A skill definition loaded from a markdown file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmniSkillDef {
    /// Skill identifier (snake_case, e.g. "navigate_frontend").
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Risk classification for this skill. This is derived internally and is not user-editable.
    #[serde(default = "default_risk_level", skip_serializing)]
    pub risk_level: OmniSkillRiskLevel,
    /// Whether this skill is exposed to the realtime model.
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Prompt loading mode for backwards compatibility with older skill files.
    #[serde(default, skip_serializing)]
    pub prompt_mode: OmniSkillPromptMode,
    /// Description text (from markdown body).
    pub description: String,
    /// JSON schema for Qwen function-call parameters.
    #[serde(default = "default_parameters", skip_serializing)]
    pub parameters: serde_json::Value,
    /// Original markdown file text.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub full_prompt: String,
}

/// Raw frontmatter parsed from a markdown skill file.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SkillFrontmatter {
    #[serde(default)]
    name: Option<String>,
    #[serde(default = "default_enabled")]
    enabled: bool,
    #[serde(default)]
    prompt_mode: OmniSkillPromptMode,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
struct SkillFrontmatterOut {
    enabled: bool,
}

/// Load all skill definitions from the given directory.
///
/// Reads every `.md` file, parses YAML frontmatter, and returns a sorted
/// vector of `OmniSkillDef`.  Files that fail to parse are logged and
/// skipped.
pub fn load_skills_from_dir(dir: impl AsRef<Path>) -> Vec<OmniSkillDef> {
    let dir = dir.as_ref();
    let mut skills = Vec::new();

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!("failed to read skills directory {}: {}", dir.display(), e);
            return skills;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!("failed to read directory entry: {}", e);
                continue;
            }
        };

        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }

        match load_skill_file(&path) {
            Ok(skill) => skills.push(skill),
            Err(e) => {
                tracing::warn!("failed to load skill file {}: {}", path.display(), e);
            }
        }
    }

    skills.sort_by(|a, b| a.id.cmp(&b.id));
    skills
}

pub fn get_skill_from_dir(dir: impl AsRef<Path>, id: &str) -> anyhow::Result<OmniSkillDef> {
    validate_skill_id(id)?;
    let path = skill_path(dir.as_ref(), id);
    load_skill_file(&path)
}

pub fn save_skill_to_dir(
    dir: impl AsRef<Path>,
    skill: &OmniSkillDef,
) -> anyhow::Result<OmniSkillDef> {
    validate_skill_id(&skill.id)?;
    std::fs::create_dir_all(dir.as_ref())?;
    let path = skill_path(dir.as_ref(), &skill.id);
    let frontmatter = SkillFrontmatterOut {
        enabled: skill.enabled,
    };
    let yaml = serde_yaml::to_string(&frontmatter)?;
    let content = format!("---\n{}---\n\n{}\n", yaml, skill.description.trim());
    std::fs::write(&path, content)?;
    load_skill_file(&path)
}

pub fn delete_skill_from_dir(dir: impl AsRef<Path>, id: &str) -> anyhow::Result<()> {
    validate_skill_id(id)?;
    let path = skill_path(dir.as_ref(), id);
    if path.exists() {
        std::fs::remove_file(path)?;
    }
    Ok(())
}

pub fn builtin_skill_defs() -> Vec<OmniSkillDef> {
    vec![
        builtin_skill(
            "navigate_frontend",
            "Navigate Frontend",
            OmniSkillRiskLevel::Safe,
            "Navigate to frontend pages.",
            json!({
                "type": "object",
                "properties": {
                    "route": {
                        "type": "string",
                        "enum": VOICE_FRONTEND_ROUTES,
                        "description": "Target frontend route/page."
                    }
                },
                "required": ["route"]
            }),
        ),
        builtin_skill(
            "invoke_backend_route",
            "Invoke Backend Route",
            OmniSkillRiskLevel::Dynamic,
            "Invoke an allowlisted backend route.",
            json!({
                "type": "object",
                "properties": {
                    "route_id": {
                        "type": "string",
                        "enum": VOICE_BACKEND_ROUTES,
                        "description": "Backend route to invoke (allowlist enforced)."
                    },
                    "params": {
                        "type": "object",
                        "description": "Route-specific parameters (e.g., target_name, session_name).",
                        "additionalProperties": true
                    }
                },
                "required": ["route_id"]
            }),
        ),
        builtin_skill(
            "list_sessions",
            "List Sessions",
            OmniSkillRiskLevel::Safe,
            "List all tmux sessions for a target connection.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
                    }
                },
                "required": ["target_name"]
            }),
        ),
        builtin_skill(
            "create_session",
            "Create Session",
            OmniSkillRiskLevel::Write,
            "Create a new tmux session on a target connection.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Name for the new session."
                    }
                },
                "required": ["target_name", "session_name"]
            }),
        ),
        builtin_skill(
            "rename_session",
            "Rename Session",
            OmniSkillRiskLevel::Write,
            "Rename an existing tmux session.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
                    },
                    "old_name": { "type": "string", "description": "Current session name." },
                    "new_name": { "type": "string", "description": "New session name." }
                },
                "required": ["target_name", "old_name", "new_name"]
            }),
        ),
        builtin_skill(
            "delete_session",
            "Delete Session",
            OmniSkillRiskLevel::Dangerous,
            "Delete a tmux session. This is destructive and requires confirmation.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
                    },
                    "session_name": { "type": "string", "description": "Session to delete." }
                },
                "required": ["target_name", "session_name"]
            }),
        ),
        builtin_skill(
            "send_to_pane",
            "Send To Pane",
            OmniSkillRiskLevel::Dynamic,
            "Send text or commands to a tmux pane.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name. Use 'local' for the local tmux server. Do not put the session name here."
                    },
                    "session_name": { "type": "string", "description": "Session name." },
                    "window_name": { "type": "string", "description": "Window name or index." },
                    "pane_index": { "type": "integer", "description": "Pane index within window." },
                    "text": { "type": "string", "description": "Text to send to the pane." },
                    "execute": { "type": "boolean", "default": false, "description": "If true, execute as command (dangerous)." },
                    "append_enter": { "type": "boolean", "default": false, "description": "If true, append Enter key after text (dangerous)." },
                    "control": { "type": "boolean", "default": false, "description": "If true, send as control sequence (dangerous)." },
                    "multiline": { "type": "boolean", "default": false, "description": "If true, text contains multiple lines (dangerous)." }
                },
                "required": ["target_name", "session_name", "window_name", "pane_index", "text"]
            }),
        ),
        builtin_skill(
            "confirm_action",
            "Confirm Action",
            OmniSkillRiskLevel::FlowControl,
            "Confirm a pending dangerous action.",
            json!({
                "type": "object",
                "properties": {
                    "confirmation_id": {
                        "type": "string",
                        "format": "uuid",
                        "description": "Confirmation ID from intent_received event."
                    }
                },
                "required": ["confirmation_id"]
            }),
        ),
        builtin_skill(
            "cancel_action",
            "Cancel Action",
            OmniSkillRiskLevel::FlowControl,
            "Cancel a pending dangerous action.",
            json!({
                "type": "object",
                "properties": {
                    "confirmation_id": {
                        "type": "string",
                        "format": "uuid",
                        "description": "Confirmation ID to cancel."
                    }
                },
                "required": ["confirmation_id"]
            }),
        ),
        builtin_skill(
            "get_current_focus",
            "Get Current Focus",
            OmniSkillRiskLevel::Safe,
            "Read the currently focused connection, session, window, and pane from the UI state.",
            json!({
                "type": "object",
                "properties": {}
            }),
        ),
        builtin_skill(
            "read_pane_output",
            "Read Pane Output",
            OmniSkillRiskLevel::Safe,
            "Read the last N lines of visible output from a tmux pane.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name." },
                    "window_name": { "type": "string", "description": "Window name or index." },
                    "pane_index": { "type": "string", "description": "Pane index or ID." },
                    "lines": { "type": "integer", "default": 50, "description": "Number of lines to capture (max 500)." }
                },
                "required": ["target_name", "session_name", "window_name", "pane_index"]
            }),
        ),
        builtin_skill(
            "get_config",
            "Get Config",
            OmniSkillRiskLevel::Safe,
            "Read the current server configuration (auth token fields are redacted).",
            json!({
                "type": "object",
                "properties": {}
            }),
        ),
        builtin_skill(
            "check_health",
            "Check Health",
            OmniSkillRiskLevel::Safe,
            "Check backend server health and tmux connection availability.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name to check. Omit to check server health only." }
                }
            }),
        ),
        builtin_skill(
            "create_window",
            "Create Window",
            OmniSkillRiskLevel::Write,
            "Create a new tmux window inside an existing session.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name to create the window in." },
                    "window_name": { "type": "string", "description": "Name for the new window." }
                },
                "required": ["target_name", "session_name", "window_name"]
            }),
        ),
        builtin_skill(
            "rename_window",
            "Rename Window",
            OmniSkillRiskLevel::Write,
            "Rename an existing tmux window.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name containing the window." },
                    "window_name": { "type": "string", "description": "Current window name or index." },
                    "new_name": { "type": "string", "description": "New name for the window." }
                },
                "required": ["target_name", "session_name", "window_name", "new_name"]
            }),
        ),
        builtin_skill(
            "split_pane",
            "Split Pane",
            OmniSkillRiskLevel::Write,
            "Split a tmux pane horizontally or vertically to create a new pane.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name." },
                    "window_name": { "type": "string", "description": "Window name or index." },
                    "pane_index": { "type": "string", "description": "Pane index or ID to split." },
                    "horizontal": { "type": "boolean", "default": false, "description": "If true, split side-by-side. If false, split top/bottom." }
                },
                "required": ["target_name", "session_name", "window_name", "pane_index"]
            }),
        ),
        builtin_skill(
            "focus_pane",
            "Focus Pane",
            OmniSkillRiskLevel::Safe,
            "Switch the UI focus to a specific session, window, and pane without sending any input.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name." },
                    "window_name": { "type": "string", "description": "Window name or index." },
                    "pane_index": { "type": "string", "description": "Pane index or ID to focus." }
                },
                "required": ["target_name", "session_name", "window_name", "pane_index"]
            }),
        ),
        builtin_skill(
            "run_project",
            "Run Project",
            OmniSkillRiskLevel::Dangerous,
            "Change to a project directory and run its start command in a pane. Requires confirmation.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name." },
                    "window_name": { "type": "string", "description": "Window name or index." },
                    "pane_index": { "type": "string", "description": "Pane index or ID to run the project in." },
                    "project_path": { "type": "string", "description": "Absolute path to the project directory." },
                    "start_command": { "type": "string", "description": "Command to run, e.g. 'npm run dev', 'cargo run', 'make run'." }
                },
                "required": ["target_name", "session_name", "window_name", "pane_index", "project_path", "start_command"]
            }),
        ),
        builtin_skill(
            "delete_window",
            "Delete Window",
            OmniSkillRiskLevel::Dangerous,
            "Delete a tmux window and all its panes. This is destructive and requires confirmation.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name containing the window." },
                    "window_name": { "type": "string", "description": "Window name or index to delete." }
                },
                "required": ["target_name", "session_name", "window_name"]
            }),
        ),
        builtin_skill(
            "kill_pane",
            "Kill Pane",
            OmniSkillRiskLevel::Dangerous,
            "Kill a specific tmux pane, terminating any running process. This is destructive and requires confirmation.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name." },
                    "window_name": { "type": "string", "description": "Window name or index." },
                    "pane_index": { "type": "string", "description": "Pane index or ID to kill." }
                },
                "required": ["target_name", "session_name", "window_name", "pane_index"]
            }),
        ),
        builtin_skill(
            "clear_pane",
            "Clear Pane",
            OmniSkillRiskLevel::Write,
            "Clear the visible content and scroll history of a tmux pane.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name." },
                    "window_name": { "type": "string", "description": "Window name or index." },
                    "pane_index": { "type": "string", "description": "Pane index or ID to clear." }
                },
                "required": ["target_name", "session_name", "window_name", "pane_index"]
            }),
        ),
    ]
}

pub fn skill_prompt(skill: &OmniSkillDef) -> &str {
    match skill.prompt_mode {
        OmniSkillPromptMode::Description => skill.description.as_str(),
        OmniSkillPromptMode::Full => skill.full_prompt.as_str(),
    }
}

/// Parse a single markdown skill file.
///
/// Expects the format:
/// ```markdown
/// ---
/// enabled: true
/// ---
///
/// # Skill Name
///
/// Markdown prompt text...
/// ```
fn load_skill_file(path: &Path) -> anyhow::Result<OmniSkillDef> {
    let content = std::fs::read_to_string(path)?;

    // Split frontmatter from body
    let (frontmatter_yaml, body) = parse_frontmatter(&content)?;

    let frontmatter: SkillFrontmatter = serde_yaml::from_str(frontmatter_yaml)?;

    let file_id = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .ok_or_else(|| anyhow::anyhow!("skill file has no valid stem: {}", path.display()))?
        .to_string();
    let id = file_id;
    validate_skill_id(&id)?;
    let description = body.trim().to_string();
    let name = frontmatter.name.unwrap_or_else(|| {
        display_name_from_markdown(&description).unwrap_or_else(|| titleize_skill_id(&id))
    });
    let risk_level = builtin_risk_level(&id).unwrap_or_else(default_risk_level);
    let parameters = parameters_for_loaded_skill(&id, &description)?;

    Ok(OmniSkillDef {
        id,
        name,
        risk_level,
        enabled: frontmatter.enabled,
        prompt_mode: frontmatter.prompt_mode,
        description,
        parameters,
        full_prompt: content.trim().to_string(),
    })
}

/// Extract YAML frontmatter and markdown body from text.
///
/// Frontmatter is delimited by `---` on its own line at the very start
/// of the file and again after the YAML block.
fn parse_frontmatter(content: &str) -> anyhow::Result<(&str, &str)> {
    if !content.starts_with("---") {
        anyhow::bail!("missing frontmatter delimiter at start of file");
    }

    let after_first = &content[3..];
    let Some(end_pos) = after_first.find("\n---") else {
        anyhow::bail!("missing closing frontmatter delimiter");
    };

    let yaml = after_first[..end_pos].trim();
    let body = &after_first[end_pos + 4..];

    Ok((yaml, body))
}

fn skill_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.md"))
}

fn validate_skill_id(id: &str) -> anyhow::Result<()> {
    let valid = !id.is_empty()
        && id.len() <= 64
        && id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_');
    if valid {
        Ok(())
    } else {
        anyhow::bail!("invalid skill id: {id}")
    }
}

fn default_enabled() -> bool {
    true
}

fn default_parameters() -> serde_json::Value {
    json!({ "type": "object" })
}

fn default_risk_level() -> OmniSkillRiskLevel {
    OmniSkillRiskLevel::Safe
}

fn builtin_skill(
    id: &str,
    name: &str,
    risk_level: OmniSkillRiskLevel,
    description: &str,
    parameters: serde_json::Value,
) -> OmniSkillDef {
    OmniSkillDef {
        id: id.to_string(),
        name: name.to_string(),
        risk_level,
        enabled: true,
        prompt_mode: OmniSkillPromptMode::Description,
        description: description.to_string(),
        parameters,
        full_prompt: description.to_string(),
    }
}

fn builtin_risk_level(id: &str) -> Option<OmniSkillRiskLevel> {
    builtin_skill_defs()
        .into_iter()
        .find(|skill| skill.id == id)
        .map(|skill| skill.risk_level)
}

fn parameters_for_loaded_skill(id: &str, markdown: &str) -> anyhow::Result<serde_json::Value> {
    if let Some(parameters) = parameters_from_markdown(markdown)? {
        return Ok(parameters);
    }
    Ok(builtin_skill_defs()
        .into_iter()
        .find(|skill| skill.id == id)
        .map(|skill| skill.parameters)
        .unwrap_or_else(default_parameters))
}

fn parameters_from_markdown(markdown: &str) -> anyhow::Result<Option<serde_json::Value>> {
    let mut in_parameters_section = false;
    let mut in_json_fence = false;
    let mut json_lines = Vec::new();

    for line in markdown.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("## ") {
            in_parameters_section = trimmed.eq_ignore_ascii_case("## Parameters");
            continue;
        }

        if !in_parameters_section {
            continue;
        }

        if !in_json_fence {
            if trimmed.starts_with("```json") || trimmed == "```" {
                in_json_fence = true;
            }
            continue;
        }

        if trimmed == "```" {
            let json = json_lines.join("\n");
            let parameters = serde_json::from_str(&json)?;
            return Ok(Some(parameters));
        }

        json_lines.push(line);
    }

    if in_json_fence {
        anyhow::bail!("unterminated parameters JSON code fence");
    }

    Ok(None)
}

fn display_name_from_markdown(markdown: &str) -> Option<String> {
    markdown.lines().find_map(|line| {
        let heading = line.strip_prefix("# ")?;
        let heading = heading.trim();
        (!heading.is_empty()).then(|| heading.to_string())
    })
}

fn titleize_skill_id(id: &str) -> String {
    id.split('_')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => {
                    let mut word = first.to_uppercase().collect::<String>();
                    word.push_str(chars.as_str());
                    word
                }
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parse_frontmatter_extracts_yaml_and_body() {
        let text = "---\nenabled: true\n---\n\n# Test Skill\n\nThis is the description.\n";
        let (yaml, body) = parse_frontmatter(text).unwrap();
        assert!(yaml.contains("enabled: true"));
        assert_eq!(body.trim(), "# Test Skill\n\nThis is the description.");
    }

    #[test]
    fn load_skill_file_parses_correctly() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("list_sessions.md");
        let mut tmp = std::fs::File::create(&path).unwrap();
        write!(
            tmp,
            "{}",
            r#"---
enabled: true
---

# List Sessions

List all tmux sessions.

## Parameters

```json
{"type":"object","required":["target_name"],"properties":{"target_name":{"type":"string"}}}
```
"#
        )
        .unwrap();

        let skill = load_skill_file(&path).unwrap();
        assert_eq!(skill.id, "list_sessions");
        assert_eq!(skill.name, "List Sessions");
        assert_eq!(skill.risk_level, OmniSkillRiskLevel::Safe);
        assert!(skill.enabled);
        assert_eq!(skill.prompt_mode, OmniSkillPromptMode::Description);
        assert_eq!(
            skill.description,
            "# List Sessions\n\nList all tmux sessions.\n\n## Parameters\n\n```json\n{\"type\":\"object\",\"required\":[\"target_name\"],\"properties\":{\"target_name\":{\"type\":\"string\"}}}\n```"
        );
        assert_eq!(skill.parameters["required"][0], "target_name");
    }

    #[test]
    fn load_skills_from_dir_reads_multiple_files() {
        let dir = tempfile::tempdir().unwrap();

        let mut f1 = std::fs::File::create(dir.path().join("skill_a.md")).unwrap();
        write!(f1, "---\nenabled: true\n---\n\n# Skill A\n\nDesc A.\n").unwrap();

        let mut f2 = std::fs::File::create(dir.path().join("skill_b.md")).unwrap();
        write!(f2, "---\nenabled: true\n---\n\n# Skill B\n\nDesc B.\n").unwrap();

        // non-md file should be ignored
        let mut _f3 = std::fs::File::create(dir.path().join("ignore.txt")).unwrap();
        write!(&_f3, "ignored").unwrap();

        let skills = load_skills_from_dir(dir.path());
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].id, "skill_a");
        assert_eq!(skills[1].id, "skill_b");
    }

    #[test]
    fn save_skill_to_dir_round_trips_parameters() {
        let dir = tempfile::tempdir().unwrap();
        let skill = OmniSkillDef {
            id: "custom_skill".to_string(),
            name: "Custom Skill".to_string(),
            risk_level: OmniSkillRiskLevel::Write,
            enabled: false,
            prompt_mode: OmniSkillPromptMode::Full,
            description: "# Custom Skill\n\nUse this custom skill.\n\n## Parameters\n\n```json\n{\"type\":\"object\",\"required\":[\"name\"],\"properties\":{\"name\":{\"type\":\"string\"}}}\n```".to_string(),
            parameters: default_parameters(),
            full_prompt: String::new(),
        };

        let saved = save_skill_to_dir(dir.path(), &skill).unwrap();
        assert_eq!(saved.id, "custom_skill");
        assert_eq!(saved.name, "Custom Skill");
        assert!(!saved.enabled);
        assert_eq!(saved.prompt_mode, OmniSkillPromptMode::Description);
        assert_eq!(saved.parameters["required"][0], "name");
        let saved_text = std::fs::read_to_string(dir.path().join("custom_skill.md")).unwrap();
        assert!(!saved_text.contains("\nid:"));
        assert!(!saved_text.contains("\nname:"));
        assert!(!saved_text.contains("\nrisk_level:"));
        assert!(!saved_text.contains("\nprompt_mode:"));
        assert!(!saved_text.contains("\nparameters:"));
        assert!(saved_text.contains("## Parameters"));
    }

    #[test]
    fn parameters_from_markdown_reads_json_fence() {
        let markdown = "# Example\n\n## Parameters\n\n```json\n{\"type\":\"object\",\"required\":[\"query\"]}\n```";
        let parameters = parameters_from_markdown(markdown).unwrap().unwrap();
        assert_eq!(parameters["type"], "object");
        assert_eq!(parameters["required"][0], "query");
    }
}
