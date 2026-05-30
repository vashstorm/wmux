//! Skill definition loader for Omni voice skills.
//!
//! Loads skill definitions from markdown files in a `skills/` directory.
//! Each `.md` file contains YAML frontmatter with metadata and markdown body
//! for the description.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::protocol::OmniSkillRiskLevel;

/// A skill definition loaded from a markdown file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmniSkillDef {
    /// Skill identifier (snake_case, e.g. "navigate_frontend").
    pub id: String,
    /// Human-readable display name.
    pub name: String,
    /// Risk classification for this skill.
    pub risk_level: OmniSkillRiskLevel,
    /// Description text (from markdown body).
    pub description: String,
}

/// Raw frontmatter parsed from a markdown skill file.
#[derive(Debug, Deserialize)]
struct SkillFrontmatter {
    id: String,
    name: String,
    risk_level: OmniSkillRiskLevel,
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

/// Parse a single markdown skill file.
///
/// Expects the format:
/// ```markdown
/// ---
/// id: skill_id
/// name: Skill Name
/// risk_level: Safe
/// ---
///
/// Description text...
/// ```
fn load_skill_file(path: &Path) -> anyhow::Result<OmniSkillDef> {
    let content = std::fs::read_to_string(path)?;

    // Split frontmatter from body
    let (frontmatter_yaml, body) = parse_frontmatter(&content)?;

    let frontmatter: SkillFrontmatter = serde_yaml::from_str(frontmatter_yaml)?;

    let description = body.trim().to_string();

    Ok(OmniSkillDef {
        id: frontmatter.id,
        name: frontmatter.name,
        risk_level: frontmatter.risk_level,
        description,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn parse_frontmatter_extracts_yaml_and_body() {
        let text = "---\nid: test_skill\nname: Test Skill\nrisk_level: Safe\n---\n\nThis is the description.\n";
        let (yaml, body) = parse_frontmatter(text).unwrap();
        assert!(yaml.contains("id: test_skill"));
        assert_eq!(body.trim(), "This is the description.");
    }

    #[test]
    fn load_skill_file_parses_correctly() {
        let mut tmp = tempfile::NamedTempFile::with_suffix(".md").unwrap();
        write!(
            tmp,
            "---\nid: list_sessions\nname: List Sessions\nrisk_level: Safe\n---\n\nList all tmux sessions.\n"
        )
        .unwrap();

        let skill = load_skill_file(tmp.path()).unwrap();
        assert_eq!(skill.id, "list_sessions");
        assert_eq!(skill.name, "List Sessions");
        assert_eq!(skill.risk_level, OmniSkillRiskLevel::Safe);
        assert_eq!(skill.description, "List all tmux sessions.");
    }

    #[test]
    fn load_skills_from_dir_reads_multiple_files() {
        let dir = tempfile::tempdir().unwrap();

        let mut f1 = std::fs::File::create(dir.path().join("a.md")).unwrap();
        write!(
            f1,
            "---\nid: skill_a\nname: Skill A\nrisk_level: Safe\n---\n\nDesc A.\n"
        )
        .unwrap();

        let mut f2 = std::fs::File::create(dir.path().join("b.md")).unwrap();
        write!(
            f2,
            "---\nid: skill_b\nname: Skill B\nrisk_level: Dangerous\n---\n\nDesc B.\n"
        )
        .unwrap();

        // non-md file should be ignored
        let mut _f3 = std::fs::File::create(dir.path().join("ignore.txt")).unwrap();
        write!(&_f3, "ignored").unwrap();

        let skills = load_skills_from_dir(dir.path());
        assert_eq!(skills.len(), 2);
        assert_eq!(skills[0].id, "skill_a");
        assert_eq!(skills[1].id, "skill_b");
    }
}
