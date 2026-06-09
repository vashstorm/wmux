pub mod config;
pub mod connections;
pub mod projects;
pub mod sessions;
pub mod skills;
pub mod terminal;
pub mod voice;

pub use config::{ConfigResponse, get_config, update_config};
pub use connections::{
    ConnectionHealthResponse, RuntimeConnection, create_connection, delete_connection,
    get_connection, list_connections, list_connections_health,
};
pub use projects::{
    ProjectActionResponse, ProjectListResponse, create_project, delete_project, generate_ai_html,
    get_project, launch_project, list_projects, sync_from_tmux, update_project,
};
pub use sessions::{
    AnalyzeSessionResponse, NamedRequest, PaneOperationResponse, SessionOperationResponse,
    SessionsListResponse, SplitPaneRequest, WindowOperationResponse, WindowsListResponse,
    analyze_session, create_session, create_window, delete_pane, delete_session, delete_window,
    list_panes, list_sessions, list_windows, rename_session, split_pane,
};
pub use skills::{
    SkillListResponse, create_skill, delete_skill, get_skill, list_skills, update_skill,
};
pub use terminal::{
    TerminalQuery, TerminalSessionTarget, attach_terminal_session, parse_initial_size,
};
pub use voice::{
    apply_session_context_defaults, check_skill_danger, execute_voice_action,
    skill_uses_tmux_target,
};
