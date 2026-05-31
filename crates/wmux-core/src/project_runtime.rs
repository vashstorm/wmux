use serde::{Deserialize, Serialize};

use crate::storage::models::{ProjectLayout, ProjectLayoutPane, ProjectLayoutWindow};
use crate::tmux::{Adapter, CommandRunner, Pane, TmuxError, Window};

pub type Result<T> = std::result::Result<T, TmuxError>;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimePane {
    pub id: String,
    pub index: u32,
    pub active: bool,
    pub width: u32,
    pub height: u32,
    pub title: String,
}

impl RuntimePane {
    pub fn from_tmux_pane(pane: &Pane) -> Self {
        Self {
            id: pane.id.clone(),
            index: pane.index as u32,
            active: pane.active,
            width: pane.width as u32,
            height: pane.height as u32,
            title: pane.title.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeWindow {
    pub name: String,
    pub index: u32,
    pub active: bool,
    pub panes: Vec<RuntimePane>,
    pub window_layout: Option<String>,
}

impl RuntimeWindow {
    pub fn from_tmux_window(window: &Window, panes: Vec<RuntimePane>) -> Self {
        Self {
            name: window.name.clone(),
            index: window.index as u32,
            active: window.active,
            panes,
            window_layout: window.window_layout.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRuntimeSnapshot {
    pub schema_version: u32,
    pub operation: String,
    pub session_name: String,
    pub status: String,
    pub layout_json: String,
    pub windows: Vec<RuntimeWindow>,
    pub window_count: usize,
    pub pane_count: usize,
}

impl ProjectRuntimeSnapshot {
    pub fn launch(session_name: &str, windows: Vec<RuntimeWindow>) -> Self {
        let pane_count = windows.iter().map(|w| w.panes.len()).sum();
        let window_count = windows.len();
        let layout = ProjectLayout {
            schema_version: 1,
            windows: windows
                .iter()
                .map(RuntimeWindow::to_layout_window)
                .collect(),
        };
        let layout_json = serde_json::to_string(&layout).unwrap_or_default();
        Self {
            schema_version: 1,
            operation: "launch".to_string(),
            session_name: session_name.to_string(),
            status: "created".to_string(),
            layout_json,
            windows,
            window_count,
            pane_count,
        }
    }

    pub fn sync(session_name: &str, windows: Vec<RuntimeWindow>) -> Self {
        let pane_count = windows.iter().map(|w| w.panes.len()).sum();
        let window_count = windows.len();
        let layout = ProjectLayout {
            schema_version: 1,
            windows: windows
                .iter()
                .map(RuntimeWindow::to_layout_window)
                .collect(),
        };
        let layout_json = serde_json::to_string(&layout).unwrap_or_default();
        Self {
            schema_version: 1,
            operation: "sync".to_string(),
            session_name: session_name.to_string(),
            status: "synced".to_string(),
            layout_json,
            windows,
            window_count,
            pane_count,
        }
    }
}

impl RuntimeWindow {
    fn to_layout_window(&self) -> ProjectLayoutWindow {
        ProjectLayoutWindow {
            name: self.name.clone(),
            index: self.index,
            active: self.active,
            panes: self.panes.iter().map(RuntimePane::to_layout_pane).collect(),
            window_layout: self.window_layout.clone(),
        }
    }
}

impl RuntimePane {
    fn to_layout_pane(&self) -> ProjectLayoutPane {
        ProjectLayoutPane {
            index: self.index,
            active: self.active,
            width: self.width,
            height: self.height,
        }
    }
}

pub async fn snapshot_from_tmux<R: CommandRunner>(
    adapter: &Adapter<R>,
    session_name: &str,
) -> Result<ProjectRuntimeSnapshot> {
    let windows = adapter.list_windows(session_name).await?;

    let mut runtime_windows = Vec::with_capacity(windows.len());
    for window in &windows {
        let panes = adapter.list_panes(session_name, &window.id).await?;
        let layout = adapter.get_window_layout(&window.id).await.ok();

        let window_with_layout = window.clone().with_layout(layout.unwrap_or_default());
        let runtime_panes = panes.iter().map(RuntimePane::from_tmux_pane).collect();
        runtime_windows.push(RuntimeWindow::from_tmux_window(
            &window_with_layout,
            runtime_panes,
        ));
    }

    Ok(ProjectRuntimeSnapshot::sync(session_name, runtime_windows))
}

pub async fn launch_or_sync_project<R: CommandRunner>(
    adapter: &Adapter<R>,
    session_name: &str,
    layout: &ProjectLayout,
) -> Result<ProjectRuntimeSnapshot> {
    let exists = adapter.has_session(session_name).await?;

    if !exists {
        launch_project(adapter, session_name, layout).await
    } else {
        snapshot_from_tmux(adapter, session_name).await
    }
}

async fn launch_project<R: CommandRunner>(
    adapter: &Adapter<R>,
    session_name: &str,
    layout: &ProjectLayout,
) -> Result<ProjectRuntimeSnapshot> {
    adapter.new_session(session_name).await?;

    let mut runtime_windows = Vec::with_capacity(layout.windows.len());

    for (i, layout_window) in layout.windows.iter().enumerate() {
        let window = if i == 0 {
            adapter.list_windows(session_name).await?.first().cloned()
        } else {
            adapter
                .new_window(session_name, &layout_window.name)
                .await
                .ok()
        };

        let window = match window {
            Some(w) => w,
            None => continue,
        };

        let mut runtime_panes = Vec::with_capacity(layout_window.panes.len());

        let pane_count = layout_window.panes.len();
        if pane_count > 1 {
            for split_idx in 1..pane_count {
                let horizontal = split_idx % 2 == 0;
                let pane = adapter.split_window(&window.id, horizontal).await.ok();
                if let Some(p) = pane {
                    runtime_panes.push(RuntimePane::from_tmux_pane(&p));
                }
            }
        }

        let panes = adapter.list_panes(session_name, &window.id).await?;
        for pane in &panes {
            if !runtime_panes.iter().any(|rp| rp.id == pane.id) {
                runtime_panes.push(RuntimePane::from_tmux_pane(pane));
            }
        }

        runtime_panes.sort_by_key(|p| p.index);

        let layout_str = adapter.get_window_layout(&window.id).await.ok();
        let window_with_layout = window.clone().with_layout(layout_str.unwrap_or_default());
        runtime_windows.push(RuntimeWindow::from_tmux_window(
            &window_with_layout,
            runtime_panes,
        ));
    }

    Ok(ProjectRuntimeSnapshot::launch(
        session_name,
        runtime_windows,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::collections::VecDeque;
    use std::os::unix::process::ExitStatusExt;
    use std::process::ExitStatus;
    use std::sync::{Arc, Mutex};

    const FIELD_SEPARATOR: &str = "\x1f";

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct Call {
        program: String,
        args: Vec<String>,
    }

    #[derive(Debug, Clone)]
    enum MockResponse {
        Output {
            stdout: String,
            stderr: String,
            code: i32,
        },
        #[allow(dead_code)]
        NotFound,
    }

    #[derive(Debug, Clone, Default)]
    struct MockRunner {
        calls: Arc<Mutex<Vec<Call>>>,
        responses: Arc<Mutex<VecDeque<MockResponse>>>,
    }

    impl MockRunner {
        fn with_responses(responses: Vec<MockResponse>) -> Self {
            let runner = Self::default();
            for response in responses {
                runner.push_response(response);
            }
            runner
        }

        fn push_response(&self, response: MockResponse) {
            self.responses
                .lock()
                .expect("responses lock")
                .push_back(response);
        }

        fn calls(&self) -> Vec<Call> {
            self.calls.lock().expect("calls lock").clone()
        }
    }

    impl CommandRunner for MockRunner {
        async fn run(&self, program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
            self.calls.lock().expect("calls lock").push(Call {
                program: program.to_string(),
                args: args.iter().map(|arg| (*arg).to_string()).collect(),
            });

            match self.responses.lock().expect("responses lock").pop_front() {
                Some(MockResponse::Output {
                    stdout,
                    stderr,
                    code,
                }) => Ok(output(stdout, stderr, code)),
                Some(MockResponse::NotFound) => Err(std::io::Error::new(
                    std::io::ErrorKind::NotFound,
                    "tmux mock not found",
                )),
                None => Ok(output(String::new(), String::new(), 0)),
            }
        }
    }

    fn output(stdout: String, stderr: String, code: i32) -> std::process::Output {
        std::process::Output {
            status: exit_status(code),
            stdout: stdout.into_bytes(),
            stderr: stderr.into_bytes(),
        }
    }

    fn exit_status(code: i32) -> ExitStatus {
        ExitStatus::from_raw(code << 8)
    }

    fn joined(fields: &[&str]) -> String {
        fields.join(FIELD_SEPARATOR)
    }

    fn session_format() -> String {
        joined(&["$1", "test-project", "0", "1"])
    }

    fn window_format(id: &str, name: &str, index: usize, pane_id: &str) -> String {
        let index_str = index.to_string();
        joined(&[id, name, &index_str, "1", "1", pane_id, "zsh"])
    }

    fn pane_format(id: &str, index: usize) -> String {
        let index_str = index.to_string();
        joined(&[
            id, "zsh", &index_str, "1", "80", "24", "0", "0", "0", "0", "0", "0", "zsh",
        ])
    }

    fn make_layout() -> ProjectLayout {
        ProjectLayout {
            schema_version: 1,
            windows: vec![ProjectLayoutWindow {
                name: "main".to_string(),
                index: 0,
                active: true,
                panes: vec![
                    ProjectLayoutPane {
                        index: 0,
                        active: true,
                        width: 80,
                        height: 24,
                    },
                    ProjectLayoutPane {
                        index: 1,
                        active: false,
                        width: 40,
                        height: 24,
                    },
                ],
                window_layout: None,
            }],
        }
    }

    #[tokio::test]
    async fn test_launch_or_sync_launches_absent_session() {
        let runner = MockRunner::with_responses(vec![
            MockResponse::Output {
                stdout: String::new(),
                stderr: "can't find session: test-project".to_string(),
                code: 1,
            },
            MockResponse::Output {
                stdout: session_format(),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: window_format("@1", "main", 0, "%1"),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: pane_format("%1", 0),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: pane_format("%2", 1),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: format!("{}\n{}", pane_format("%1", 0), pane_format("%2", 1)),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: "abcd12".to_string(),
                stderr: String::new(),
                code: 0,
            },
        ]);

        let adapter = Adapter::with_runner("tmux", runner.clone());
        let layout = make_layout();

        let snapshot = launch_or_sync_project(&adapter, "test-project", &layout)
            .await
            .expect("launch project");

        assert_eq!(snapshot.operation, "launch");
        assert_eq!(snapshot.session_name, "test-project");
        assert_eq!(snapshot.window_count, 1);
        assert_eq!(snapshot.pane_count, 2);

        let calls = runner.calls();
        assert!(
            calls
                .iter()
                .any(|c| c.args.contains(&"has-session".to_string()))
        );
        assert!(
            calls
                .iter()
                .any(|c| c.args.contains(&"new-session".to_string()))
        );
        assert!(
            calls
                .iter()
                .any(|c| c.args.contains(&"split-window".to_string()))
        );

        assert!(
            !calls
                .iter()
                .any(|c| c.args.contains(&"send-keys".to_string()))
        );
        assert!(
            !calls
                .iter()
                .any(|c| c.args.contains(&"kill-session".to_string()))
        );
    }

    #[tokio::test]
    async fn test_launch_or_sync_syncs_existing_session() {
        let runner = MockRunner::with_responses(vec![
            MockResponse::Output {
                stdout: String::new(),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: window_format("@1", "main", 0, "%1"),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: format!("{}\n{}", pane_format("%1", 0), pane_format("%2", 1)),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: "abcd12".to_string(),
                stderr: String::new(),
                code: 0,
            },
        ]);

        let adapter = Adapter::with_runner("tmux", runner.clone());
        let layout = make_layout();

        let snapshot = launch_or_sync_project(&adapter, "test-project", &layout)
            .await
            .expect("sync project");

        assert_eq!(snapshot.operation, "sync");
        assert_eq!(snapshot.session_name, "test-project");
        assert_eq!(snapshot.window_count, 1);
        assert_eq!(snapshot.pane_count, 2);

        let calls = runner.calls();
        assert!(
            calls
                .iter()
                .any(|c| c.args.contains(&"has-session".to_string()))
        );
        assert!(
            calls
                .iter()
                .any(|c| c.args.contains(&"list-windows".to_string()))
        );
        assert!(
            calls
                .iter()
                .any(|c| c.args.contains(&"list-panes".to_string()))
        );

        assert!(
            !calls
                .iter()
                .any(|c| c.args.contains(&"new-session".to_string()))
        );
        assert!(
            !calls
                .iter()
                .any(|c| c.args.contains(&"send-keys".to_string()))
        );
        assert!(
            !calls
                .iter()
                .any(|c| c.args.contains(&"kill-session".to_string()))
        );
    }

    #[tokio::test]
    async fn test_snapshot_from_tmux_builds_json() {
        let runner = MockRunner::with_responses(vec![
            MockResponse::Output {
                stdout: window_format("@1", "editor", 0, "%5"),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: format!("{}\n{}", pane_format("%5", 0), pane_format("%6", 1)),
                stderr: String::new(),
                code: 0,
            },
            MockResponse::Output {
                stdout: "d78c,80x24,0,0,5".to_string(),
                stderr: String::new(),
                code: 0,
            },
        ]);

        let adapter = Adapter::with_runner("tmux", runner.clone());

        let snapshot = snapshot_from_tmux(&adapter, "dev").await.expect("snapshot");

        assert_eq!(snapshot.operation, "sync");
        assert_eq!(snapshot.session_name, "dev");
        assert_eq!(snapshot.windows.len(), 1);
        assert_eq!(snapshot.windows[0].name, "editor");
        assert_eq!(snapshot.windows[0].panes.len(), 2);
        assert!(snapshot.windows[0].window_layout.is_some());
        assert!(snapshot.layout_json.contains("schemaVersion"));
    }

    #[test]
    fn test_runtime_pane_from_tmux() {
        let pane = crate::tmux::Pane::new(
            "%1".to_string(),
            "zsh".to_string(),
            0,
            true,
            80,
            24,
            0,
            0,
            false,
            false,
            false,
            false,
            "zsh".to_string(),
        );

        let runtime_pane = RuntimePane::from_tmux_pane(&pane);

        assert_eq!(runtime_pane.id, "%1");
        assert_eq!(runtime_pane.index, 0);
        assert!(runtime_pane.active);
        assert_eq!(runtime_pane.width, 80);
        assert_eq!(runtime_pane.height, 24);
        assert_eq!(runtime_pane.title, "zsh");
    }

    #[test]
    fn test_runtime_window_from_tmux() {
        let window = crate::tmux::Window::new(
            "@1".to_string(),
            "editor".to_string(),
            0,
            true,
            2,
            "%1".to_string(),
            "vim".to_string(),
        )
        .with_layout("d78c,80x24,0,0,5".to_string());

        let panes = vec![RuntimePane {
            id: "%1".to_string(),
            index: 0,
            active: true,
            width: 80,
            height: 24,
            title: "vim".to_string(),
        }];

        let runtime_window = RuntimeWindow::from_tmux_window(&window, panes);

        assert_eq!(runtime_window.name, "editor");
        assert_eq!(runtime_window.index, 0);
        assert!(runtime_window.active);
        assert_eq!(runtime_window.panes.len(), 1);
        assert_eq!(
            runtime_window.window_layout,
            Some("d78c,80x24,0,0,5".to_string())
        );
    }
}
