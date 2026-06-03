//! Skill definition loader and persistence for Omni voice skills.
//!
//! Loads skill definitions from markdown files in a `skills/` directory.
//! Each `.md` file may contain one or more YAML-frontmatter markdown blocks.
//! Single-skill files can omit `id` and derive it from the file stem. Grouped
//! files must include `id` in each block.

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
    /// Relative markdown file path this skill was loaded from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_file: Option<String>,
    /// Zero-based order of the skill block inside `source_file`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_order: Option<usize>,
}

/// Raw frontmatter parsed from a markdown skill file.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
struct SkillFrontmatter {
    #[serde(default)]
    id: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    id: Option<String>,
    enabled: bool,
}

struct SkillMarkdownBlock<'a> {
    frontmatter_yaml: &'a str,
    body: &'a str,
    raw: &'a str,
}

/// Load all skill definitions from the given directory.
///
/// Reads every `.md` file, parses YAML frontmatter, and returns a sorted
/// vector of `OmniSkillDef`.  Files that fail to parse are logged and
/// skipped.
pub fn load_skills_from_dir(dir: impl AsRef<Path>) -> Vec<OmniSkillDef> {
    let dir = dir.as_ref();
    let mut skills = Vec::new();

    let paths = match markdown_skill_paths(dir) {
        Ok(paths) => paths,
        Err(e) => {
            tracing::warn!("failed to read skills directory {}: {}", dir.display(), e);
            return skills;
        }
    };

    for path in paths {
        match load_skill_file(&path) {
            Ok(mut loaded) => {
                apply_source_file(&mut loaded, dir, &path);
                skills.extend(loaded);
            }
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
    let path =
        existing_skill_path(dir.as_ref(), id)?.unwrap_or_else(|| skill_path(dir.as_ref(), id));
    let mut skills = load_skill_file(&path)?;
    apply_source_file(&mut skills, dir.as_ref(), &path);
    skills
        .into_iter()
        .find(|skill| skill.id == id)
        .ok_or_else(|| anyhow::anyhow!("skill not found: {id}"))
}

pub fn save_skill_to_dir(
    dir: impl AsRef<Path>,
    skill: &OmniSkillDef,
) -> anyhow::Result<OmniSkillDef> {
    validate_skill_id(&skill.id)?;
    std::fs::create_dir_all(dir.as_ref())?;
    let path = existing_skill_path(dir.as_ref(), &skill.id)?
        .unwrap_or_else(|| skill_path(dir.as_ref(), &skill.id));

    if path.exists() {
        let mut skills = load_skill_file(&path)?;
        let include_id = should_write_group_ids(&path, &skills);
        if let Some(existing) = skills.iter_mut().find(|item| item.id == skill.id) {
            *existing = skill.clone();
        } else {
            skills.push(skill.clone());
            skills.sort_by(|a, b| a.id.cmp(&b.id));
        }
        std::fs::write(&path, render_skill_file(&skills, include_id)?)?;
    } else {
        std::fs::write(
            &path,
            render_skill_file(std::slice::from_ref(skill), false)?,
        )?;
    }

    let mut skills = load_skill_file(&path)?;
    apply_source_file(&mut skills, dir.as_ref(), &path);
    skills
        .into_iter()
        .find(|item| item.id == skill.id)
        .ok_or_else(|| anyhow::anyhow!("saved skill not found: {}", skill.id))
}

pub fn delete_skill_from_dir(dir: impl AsRef<Path>, id: &str) -> anyhow::Result<()> {
    validate_skill_id(id)?;
    if let Some(path) = existing_skill_path(dir.as_ref(), id)? {
        let mut skills = load_skill_file(&path)?;
        skills.retain(|skill| skill.id != id);
        if skills.is_empty() {
            std::fs::remove_file(path)?;
        } else {
            std::fs::write(&path, render_skill_file(&skills, true)?)?;
        }
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
                    },
                    "target_name": {
                        "type": "string",
                        "description": "Target connection name when selecting a session, window, or pane. Defaults to current focus when omitted."
                    },
                    "session_name": {
                        "type": "string",
                        "description": "Session name to select for session/window/pane navigation, or project-associated session for project lookup."
                    },
                    "window_name": {
                        "type": "string",
                        "description": "Window ID, name, or index to select for window/pane navigation."
                    },
                    "pane_index": {
                        "type": "string",
                        "description": "Pane ID or index to select for pane navigation."
                    },
                    "project_id": {
                        "type": "string",
                        "description": "Project ID to open when route is projects."
                    },
                    "project_name": {
                        "type": "string",
                        "description": "Project name to open when route is projects."
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
                    "pane_index": { "type": "string", "description": "Pane index or tmux pane ID within the window." },
                    "text": { "type": "string", "description": "Text to send to the pane, or a tmux key name when control is true." },
                    "execute": { "type": "boolean", "default": false, "description": "If true, execute as command (dangerous)." },
                    "append_enter": { "type": "boolean", "default": false, "description": "If true, append Enter key after text (dangerous)." },
                    "control": { "type": "boolean", "default": false, "description": "If true, interpret text as a tmux key/control sequence (dangerous)." },
                    "control_sequence": { "type": "string", "description": "Optional tmux key/control sequence to send instead of text (dangerous)." },
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
            "new_chat",
            "New Chat",
            OmniSkillRiskLevel::Safe,
            "Start a new AI Assistant chat by clearing the current assistant conversation view and saved voice history. This does not affect tmux sessions, windows, panes, projects, config, or AI Logs.",
            json!({
                "type": "object",
                "properties": {}
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
            "list_projects",
            "List Projects",
            OmniSkillRiskLevel::Safe,
            "List saved projects and their associated tmux session status.",
            json!({
                "type": "object",
                "properties": {}
            }),
        ),
        builtin_skill(
            "create_project",
            "Create Project",
            OmniSkillRiskLevel::Write,
            "Create a saved project entry that can be launched or synced with tmux.",
            json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string", "description": "Project name." },
                    "path": { "type": "string", "default": "", "description": "Project path." },
                    "description": { "type": "string", "default": "", "description": "Project description." },
                    "session_name": { "type": "string", "description": "Optional tmux session name. Defaults to the project name." },
                    "workdir": { "type": "string", "description": "Optional working directory." }
                },
                "required": ["name"]
            }),
        ),
        builtin_skill(
            "update_project",
            "Update Project",
            OmniSkillRiskLevel::Write,
            "Update a saved project entry.",
            json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Project ID to update." },
                    "name": { "type": "string", "description": "Updated project name." },
                    "path": { "type": "string", "description": "Updated project path." },
                    "description": { "type": "string", "description": "Updated project description." },
                    "session_name": { "type": "string", "description": "Updated tmux session name." },
                    "workdir": { "type": "string", "description": "Updated working directory." }
                },
                "required": ["project_id"]
            }),
        ),
        builtin_skill(
            "delete_project",
            "Delete Project",
            OmniSkillRiskLevel::Dangerous,
            "Delete a saved project entry. Optionally terminate the associated tmux session.",
            json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Project ID to delete." },
                    "kill_session": { "type": "boolean", "default": false, "description": "Also terminate the associated tmux session." }
                },
                "required": ["project_id"]
            }),
        ),
        builtin_skill(
            "launch_project",
            "Launch Project",
            OmniSkillRiskLevel::Write,
            "Launch or recreate a project's tmux layout.",
            json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Project ID to launch." }
                },
                "required": ["project_id"]
            }),
        ),
        builtin_skill(
            "sync_project_from_tmux",
            "Sync Project From Tmux",
            OmniSkillRiskLevel::Write,
            "Capture the current tmux session layout into a saved project.",
            json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Project ID to sync." }
                },
                "required": ["project_id"]
            }),
        ),
        builtin_skill(
            "generate_project_ai_html",
            "Generate Project AI HTML",
            OmniSkillRiskLevel::Write,
            "Generate an AI HTML summary for a project dashboard.",
            json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Project ID to analyze." }
                },
                "required": ["project_id"]
            }),
        ),
        builtin_skill(
            "analyze_session",
            "Analyze Session",
            OmniSkillRiskLevel::Write,
            "Run Tmux Analysis for all windows in a session using the active AI provider.",
            json!({
                "type": "object",
                "properties": {
                    "target_name": { "type": "string", "description": "Target connection name. Use 'local' for the local tmux server." },
                    "session_name": { "type": "string", "description": "Session name to analyze." }
                },
                "required": ["target_name", "session_name"]
            }),
        ),
        builtin_skill(
            "list_tmux_analysis",
            "List Tmux Analysis",
            OmniSkillRiskLevel::Safe,
            "List Tmux Analysis usage events and summary metrics.",
            json!({
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "default": 50, "description": "Maximum events to return, up to 200." },
                    "project_id": { "type": "string", "description": "Optional project ID filter." },
                    "status": { "type": "string", "enum": ["success", "error"], "description": "Optional status filter." }
                }
            }),
        ),
        builtin_skill(
            "cleanup_tmux_analysis",
            "Cleanup Tmux Analysis",
            OmniSkillRiskLevel::Dangerous,
            "Delete stale Tmux Analysis records. This is destructive and requires confirmation.",
            json!({
                "type": "object",
                "properties": {
                    "project_id": { "type": "string", "description": "Optional project ID filter." }
                }
            }),
        ),
        builtin_skill(
            "list_ai_logs",
            "List AI Logs",
            OmniSkillRiskLevel::Safe,
            "List AI Logs entries for recent model prompts, tool calls, tool results, and errors.",
            json!({
                "type": "object",
                "properties": {
                    "limit": { "type": "integer", "default": 50, "description": "Maximum logs to return." },
                    "before": { "type": "string", "description": "Optional RFC3339 cursor for pagination." }
                }
            }),
        ),
        builtin_skill(
            "clear_ai_logs",
            "Clear AI Logs",
            OmniSkillRiskLevel::Dangerous,
            "Clear all AI Logs entries. This is destructive and requires confirmation.",
            json!({
                "type": "object",
                "properties": {}
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
        builtin_skill(
            "set_theme",
            "Set Theme",
            OmniSkillRiskLevel::Safe,
            "Switch between light and dark theme for the application UI.",
            json!({
                "type": "object",
                "properties": {
                    "theme": { "type": "string", "enum": ["light", "dark"], "description": "Target theme to apply." }
                },
                "required": ["theme"]
            }),
        ),
        builtin_skill(
            "set_font_size",
            "Set Font Size",
            OmniSkillRiskLevel::Safe,
            "Adjust the UI font size for menus, labels, and panel tabs.",
            json!({
                "type": "object",
                "properties": {
                    "size": { "type": "integer", "minimum": 12, "maximum": 24, "description": "Font size in pixels." }
                },
                "required": ["size"]
            }),
        ),
        builtin_skill(
            "set_terminal_font",
            "Set Terminal Font",
            OmniSkillRiskLevel::Safe,
            "Adjust the terminal's font size and weight.",
            json!({
                "type": "object",
                "properties": {
                    "fontSize": { "type": "integer", "minimum": 10, "maximum": 28, "description": "Terminal font size in pixels." },
                    "fontWeight": { "type": "string", "enum": ["normal", "bold", "500", "600"], "description": "Terminal font weight." }
                },
                "required": ["fontSize"]
            }),
        ),
        builtin_skill(
            "toggle_omni",
            "Toggle Omni",
            OmniSkillRiskLevel::Write,
            "Enable or disable the Omni voice assistant.",
            json!({
                "type": "object",
                "properties": {
                    "enabled": { "type": "boolean", "description": "Whether to enable or disable Omni." }
                },
                "required": ["enabled"]
            }),
        ),
        builtin_skill(
            "set_voice",
            "Set Voice",
            OmniSkillRiskLevel::Write,
            "Switch the Omni voice character (e.g., Cindy, Andy, Emily).",
            json!({
                "type": "object",
                "properties": {
                    "voice": { "type": "string", "description": "Voice character name." }
                },
                "required": ["voice"]
            }),
        ),
        builtin_skill(
            "toggle_continuous_listening",
            "Toggle Continuous Listening",
            OmniSkillRiskLevel::Write,
            "Enable or disable continuous voice listening mode.",
            json!({
                "type": "object",
                "properties": {
                    "enabled": { "type": "boolean", "description": "Whether to enable or disable continuous listening." }
                },
                "required": ["enabled"]
            }),
        ),
        builtin_skill(
            "toggle_vad",
            "Toggle VAD",
            OmniSkillRiskLevel::Write,
            "Enable or disable Voice Activity Detection (VAD).",
            json!({
                "type": "object",
                "properties": {
                    "enabled": { "type": "boolean", "description": "Whether to enable or disable VAD." },
                    "threshold": { "type": "number", "minimum": 0.0, "maximum": 1.0, "description": "VAD sensitivity threshold." }
                }
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

/// Parse a markdown skill file.
///
/// Single-skill files can omit `id` and derive it from the filename:
/// ```markdown
/// ---
/// enabled: true
/// ---
///
/// # Skill Name
///
/// Markdown prompt text...
/// ```
///
/// Grouped files repeat the same frontmatter/body block and must include
/// `id` in each block.
fn load_skill_file(path: &Path) -> anyhow::Result<Vec<OmniSkillDef>> {
    let content = std::fs::read_to_string(path)?;
    let blocks = parse_skill_blocks(&content)?;
    let multiple_blocks = blocks.len() > 1;
    let mut skills = Vec::with_capacity(blocks.len());

    for (source_order, block) in blocks.into_iter().enumerate() {
        let frontmatter: SkillFrontmatter = serde_yaml::from_str(block.frontmatter_yaml)?;

        let id = match frontmatter.id {
            Some(id) => id,
            None if !multiple_blocks => path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .ok_or_else(|| anyhow::anyhow!("skill file has no valid stem: {}", path.display()))?
                .to_string(),
            None => anyhow::bail!("grouped skill file block is missing id: {}", path.display()),
        };
        validate_skill_id(&id)?;

        let description = block.body.trim().to_string();
        let name = frontmatter.name.unwrap_or_else(|| {
            display_name_from_markdown(&description).unwrap_or_else(|| titleize_skill_id(&id))
        });
        let risk_level = builtin_risk_level(&id).unwrap_or_else(default_risk_level);
        let parameters = parameters_for_loaded_skill(&id, &description)?;

        skills.push(OmniSkillDef {
            id,
            name,
            risk_level,
            enabled: frontmatter.enabled,
            prompt_mode: frontmatter.prompt_mode,
            description,
            parameters,
            full_prompt: block.raw.trim().to_string(),
            source_file: None,
            source_order: Some(source_order),
        });
    }

    Ok(skills)
}

fn parse_skill_blocks(content: &str) -> anyhow::Result<Vec<SkillMarkdownBlock<'_>>> {
    let delimiters = frontmatter_delimiters(content);
    if delimiters.first().map(|(start, _)| *start) != Some(0) {
        anyhow::bail!("missing frontmatter delimiter at start of file");
    }
    if delimiters.len() < 2 {
        anyhow::bail!("missing closing frontmatter delimiter");
    }

    let mut blocks = Vec::new();
    let mut index = 0;
    while index < delimiters.len() {
        if index + 1 >= delimiters.len() {
            anyhow::bail!("missing closing frontmatter delimiter");
        }

        let (block_start, yaml_start) = delimiters[index];
        let (yaml_end, body_start) = delimiters[index + 1];
        let block_end = delimiters
            .get(index + 2)
            .map(|(start, _)| *start)
            .unwrap_or(content.len());

        blocks.push(SkillMarkdownBlock {
            frontmatter_yaml: content[yaml_start..yaml_end].trim(),
            body: &content[body_start..block_end],
            raw: &content[block_start..block_end],
        });
        index += 2;
    }

    Ok(blocks)
}

fn frontmatter_delimiters(content: &str) -> Vec<(usize, usize)> {
    let mut delimiters = Vec::new();
    let mut offset = 0;

    for line in content.split_inclusive('\n') {
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed == "---" {
            delimiters.push((offset, offset + line.len()));
        }
        offset += line.len();
    }

    delimiters
}

fn render_skill_file(skills: &[OmniSkillDef], include_id: bool) -> anyhow::Result<String> {
    let mut content = String::new();

    for (index, skill) in skills.iter().enumerate() {
        if index > 0 {
            content.push('\n');
        }

        let frontmatter = SkillFrontmatterOut {
            id: include_id.then(|| skill.id.clone()),
            enabled: skill.enabled,
        };
        let yaml = serde_yaml::to_string(&frontmatter)?;
        content.push_str("---\n");
        content.push_str(&yaml);
        content.push_str("---\n\n");
        content.push_str(skill.description.trim());
        content.push('\n');
    }

    Ok(content)
}

fn apply_source_file(skills: &mut [OmniSkillDef], dir: &Path, path: &Path) {
    let source_file = path
        .strip_prefix(dir)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    for skill in skills {
        skill.source_file = Some(source_file.clone());
    }
}

fn should_write_group_ids(path: &Path, skills: &[OmniSkillDef]) -> bool {
    skills.len() > 1
        || skills
            .first()
            .map(|skill| path.file_stem().and_then(|stem| stem.to_str()) != Some(skill.id.as_str()))
            .unwrap_or(false)
}

#[cfg(test)]
fn load_single_skill_file(path: &Path) -> anyhow::Result<OmniSkillDef> {
    let mut skills = load_skill_file(path)?;
    if skills.len() != 1 {
        anyhow::bail!("expected exactly one skill in {}", path.display());
    }
    Ok(skills.remove(0))
}

/// Parse a single-skill markdown text into frontmatter and body.
///
/// Grouped files are parsed through `parse_skill_blocks`; this helper remains
/// for tests and callers that need legacy single-file behavior.
#[cfg(test)]
fn parse_frontmatter(content: &str) -> anyhow::Result<(&str, &str)> {
    let mut blocks = parse_skill_blocks(content)?;
    let block = blocks
        .pop()
        .ok_or_else(|| anyhow::anyhow!("missing frontmatter delimiter at start of file"))?;
    if !blocks.is_empty() {
        anyhow::bail!("expected a single frontmatter block");
    }
    Ok((block.frontmatter_yaml, block.body))
}

fn skill_path(dir: &Path, id: &str) -> PathBuf {
    dir.join(format!("{id}.md"))
}

fn existing_skill_path(dir: &Path, id: &str) -> anyhow::Result<Option<PathBuf>> {
    for path in markdown_skill_paths(dir)? {
        match load_skill_file(&path) {
            Ok(skills) if skills.iter().any(|skill| skill.id == id) => return Ok(Some(path)),
            Ok(_) => {}
            Err(e) => {
                tracing::warn!("failed to load skill file {}: {}", path.display(), e);
            }
        }
    }
    Ok(None)
}

fn markdown_skill_paths(dir: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    collect_markdown_skill_paths(dir, &mut paths)?;
    paths.sort();
    Ok(paths)
}

fn collect_markdown_skill_paths(dir: &Path, paths: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            collect_markdown_skill_paths(&path, paths)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            paths.push(path);
        }
    }
    Ok(())
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
        source_file: None,
        source_order: None,
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
    use std::collections::BTreeSet;
    use std::io::Write;
    use std::path::PathBuf;

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

        let skill = load_single_skill_file(&path).unwrap();
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
    fn load_skills_from_dir_reads_grouped_subdirectories() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("tmux")).unwrap();

        let mut file = std::fs::File::create(dir.path().join("tmux").join("skill_c.md")).unwrap();
        write!(file, "---\nenabled: true\n---\n\n# Skill C\n\nDesc C.\n").unwrap();

        let skills = load_skills_from_dir(dir.path());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "skill_c");
    }

    #[test]
    fn load_skills_from_dir_reads_grouped_files() {
        let dir = tempfile::tempdir().unwrap();
        let mut file = std::fs::File::create(dir.path().join("sessions.md")).unwrap();
        write!(
            file,
            "{}",
            r#"---
id: list_sessions
enabled: true
---

# List Sessions

List all tmux sessions.

---
id: create_session
enabled: false
---

# Create Session

Create a new tmux session.
"#
        )
        .unwrap();

        let skills = load_skills_from_dir(dir.path());
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].id, "create_session");
        assert!(!skills[0].enabled);
        assert_eq!(skills[1].id, "list_sessions");
        assert!(skills[1].enabled);
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
            source_file: None,
            source_order: None,
        };

        let saved = save_skill_to_dir(dir.path(), &skill).unwrap();
        assert_eq!(saved.id, "custom_skill");
        assert_eq!(saved.source_file.as_deref(), Some("custom_skill.md"));
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
    fn save_skill_to_dir_updates_grouped_file_member() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.md");
        let mut file = std::fs::File::create(&path).unwrap();
        write!(
            file,
            "{}",
            r#"---
id: list_sessions
enabled: true
---

# List Sessions

List all tmux sessions.

---
id: create_session
enabled: true
---

# Create Session

Create a new tmux session.
"#
        )
        .unwrap();

        let saved = save_skill_to_dir(
            dir.path(),
            &OmniSkillDef {
                id: "create_session".to_string(),
                name: "Create Session".to_string(),
                risk_level: OmniSkillRiskLevel::Write,
                enabled: false,
                prompt_mode: OmniSkillPromptMode::Description,
                description: "# Create Session\n\nCreate a grouped tmux session.".to_string(),
                parameters: default_parameters(),
                full_prompt: String::new(),
                source_file: None,
                source_order: None,
            },
        )
        .unwrap();

        assert_eq!(saved.id, "create_session");
        assert_eq!(saved.source_file.as_deref(), Some("sessions.md"));
        assert!(!saved.enabled);
        let skills = load_skills_from_dir(dir.path());
        assert_eq!(skills.len(), 2);
        assert!(skills.iter().any(|skill| skill.id == "list_sessions"));
        assert!(
            std::fs::read_to_string(path)
                .unwrap()
                .contains("Create a grouped tmux session.")
        );
    }

    #[test]
    fn delete_skill_from_dir_removes_grouped_file_member() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sessions.md");
        let mut file = std::fs::File::create(&path).unwrap();
        write!(
            file,
            "{}",
            r#"---
id: list_sessions
enabled: true
---

# List Sessions

List all tmux sessions.

---
id: create_session
enabled: true
---

# Create Session

Create a new tmux session.
"#
        )
        .unwrap();

        delete_skill_from_dir(dir.path(), "create_session").unwrap();

        let skills = load_skills_from_dir(dir.path());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].id, "list_sessions");
        assert!(
            std::fs::read_to_string(path)
                .unwrap()
                .contains("id: list_sessions")
        );
    }

    #[test]
    fn parameters_from_markdown_reads_json_fence() {
        let markdown = "# Example\n\n## Parameters\n\n```json\n{\"type\":\"object\",\"required\":[\"query\"]}\n```";
        let parameters = parameters_from_markdown(markdown).unwrap().unwrap();
        assert_eq!(parameters["type"], "object");
        assert_eq!(parameters["required"][0], "query");
    }

    #[test]
    fn repository_skill_markdown_covers_every_builtin_skill() {
        let skills_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../skills")
            .canonicalize()
            .expect("repository skills dir");
        let loaded = load_skills_from_dir(&skills_dir);
        let builtins = builtin_skill_defs();

        let loaded_ids = loaded
            .iter()
            .map(|skill| skill.id.as_str())
            .collect::<BTreeSet<_>>();
        let builtin_ids = builtins
            .iter()
            .map(|skill| skill.id.as_str())
            .collect::<BTreeSet<_>>();

        assert_eq!(
            loaded_ids, builtin_ids,
            "repository markdown skills must stay in sync with built-in skill definitions"
        );

        let mut seen = BTreeSet::new();
        for skill in &loaded {
            assert!(
                seen.insert(skill.id.as_str()),
                "duplicate skill id: {}",
                skill.id
            );
            assert!(skill.enabled, "{} should be enabled by default", skill.id);
            assert!(
                skill.source_file.is_some(),
                "{} should remember its source markdown file",
                skill.id
            );
            assert!(
                skill.description.starts_with(&format!("# {}", skill.name)),
                "{} should use its display name as the markdown title",
                skill.id
            );

            let builtin = builtins
                .iter()
                .find(|builtin| builtin.id == skill.id)
                .expect("matching builtin");
            assert_eq!(
                skill.risk_level, builtin.risk_level,
                "{} risk level should match the built-in definition",
                skill.id
            );
        }
    }

    #[test]
    fn repository_skill_markdown_has_valid_parameter_schemas() {
        let skills_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../skills")
            .canonicalize()
            .expect("repository skills dir");
        let loaded = load_skills_from_dir(&skills_dir);

        for skill in loaded {
            assert_eq!(
                skill
                    .parameters
                    .get("type")
                    .and_then(serde_json::Value::as_str),
                Some("object"),
                "{} parameters should be an object schema",
                skill.id
            );

            if let Some(required) = skill
                .parameters
                .get("required")
                .and_then(serde_json::Value::as_array)
            {
                let properties = skill
                    .parameters
                    .get("properties")
                    .and_then(serde_json::Value::as_object)
                    .unwrap_or_else(|| panic!("{} should define properties", skill.id));

                for field in required {
                    let field = field.as_str().unwrap_or_else(|| {
                        panic!("{} required entries should be strings", skill.id)
                    });
                    assert!(
                        properties.contains_key(field),
                        "{} required field '{}' should have a property schema",
                        skill.id,
                        field
                    );
                }
            }
        }
    }
}
