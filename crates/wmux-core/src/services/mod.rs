pub mod config;
pub mod connections;
pub mod projects;
pub mod sessions;
pub mod skills;
pub mod terminal;
pub mod voice;

pub use config::{get_config, update_config, ConfigResponse};
pub use connections::{
    create_connection, delete_connection, get_connection, list_connections,
    list_connections_health, ConnectionHealthResponse, RuntimeConnection,
};
pub use projects::{
    create_project, delete_project, generate_ai_html, get_project, launch_project, list_projects,
    sync_from_tmux, update_project, ProjectActionResponse, ProjectListResponse,
};
pub use sessions::{
    analyze_session, create_session, create_window, delete_pane, delete_session, delete_window,
    list_panes, list_sessions, list_windows, rename_session, split_pane, AnalyzeSessionResponse,
    NamedRequest, PaneOperationResponse, SessionOperationResponse, SessionsListResponse,
    SplitPaneRequest, WindowOperationResponse, WindowsListResponse,
};
pub use skills::{
    create_skill, delete_skill, get_skill, list_skills, update_skill, SkillListResponse,
};
pub use terminal::{
    attach_terminal_session, parse_initial_size, TerminalQuery, TerminalSessionTarget,
};
pub use voice::{
    apply_session_context_defaults, check_skill_danger, execute_voice_action,
    skill_uses_tmux_target,
};