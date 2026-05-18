use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttentionState {
    None,
    Attention,
    Explicit,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub name: String,
    pub attached: bool,
    pub window_count: usize,
    pub attention_state: AttentionState,
    pub attention_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    pub id: String,
    pub name: String,
    pub index: usize,
    pub active: bool,
    pub pane_count: usize,
    pub active_pane_id: String,
    pub active_pane_title: String,
    pub attention_state: AttentionState,
    pub attention_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pane {
    pub id: String,
    #[serde(skip)]
    pub window_id: String,
    #[serde(skip)]
    pub window_name: String,
    pub title: String,
    pub index: usize,
    pub active: bool,
    pub width: usize,
    pub height: usize,
    pub left: usize,
    pub top: usize,
    pub dead: bool,
    pub input_off: bool,
    pub in_mode: bool,
    pub alternate_on: bool,
    pub current_command: String,
    pub attention_state: AttentionState,
}

impl Session {
    pub(crate) fn new(id: String, name: String, attached: bool, window_count: usize) -> Self {
        Self {
            id,
            name,
            attached,
            window_count,
            attention_state: AttentionState::None,
            attention_count: 0,
        }
    }
}

impl Window {
    pub(crate) fn new(
        id: String,
        name: String,
        index: usize,
        active: bool,
        pane_count: usize,
        active_pane_id: String,
        active_pane_title: String,
    ) -> Self {
        Self {
            id,
            name,
            index,
            active,
            pane_count,
            active_pane_id,
            active_pane_title,
            attention_state: AttentionState::None,
            attention_count: 0,
        }
    }
}

impl Pane {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        id: String,
        title: String,
        index: usize,
        active: bool,
        width: usize,
        height: usize,
        left: usize,
        top: usize,
        dead: bool,
        input_off: bool,
        in_mode: bool,
        alternate_on: bool,
        current_command: String,
    ) -> Self {
        let attention_state = derive_attention_state(
            dead,
            input_off,
            in_mode,
            alternate_on,
            current_command.as_str(),
        );

        Self {
            id,
            window_id: String::new(),
            window_name: String::new(),
            title,
            index,
            active,
            width,
            height,
            left,
            top,
            dead,
            input_off,
            in_mode,
            alternate_on,
            current_command,
            attention_state,
        }
    }
}

pub fn derive_attention_state(
    dead: bool,
    input_off: bool,
    in_mode: bool,
    alternate_on: bool,
    current_command: &str,
) -> AttentionState {
    if dead || input_off {
        return AttentionState::Explicit;
    }
    if in_mode {
        return AttentionState::Attention;
    }
    if alternate_on && is_tui_command(current_command) {
        return AttentionState::Attention;
    }
    AttentionState::None
}

fn is_tui_command(command: &str) -> bool {
    let command = command.trim().trim_start_matches('-');
    matches!(
        command,
        "vim"
            | "nvim"
            | "vi"
            | "emacs"
            | "nano"
            | "less"
            | "more"
            | "man"
            | "top"
            | "htop"
            | "btop"
            | "ssh"
            | "lazygit"
            | "lazydocker"
            | "tig"
            | "fzf"
            | "tmux"
    )
}
