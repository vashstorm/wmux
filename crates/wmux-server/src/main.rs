use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Context;
use clap::Parser;

#[derive(Debug, Parser)]
#[command(
    name = "wmux",
    about = "Web-based tmux management service",
    disable_version_flag = true
)]
struct Cli {
    #[arg(short = 'c', long = "config", value_name = "path", default_value = wmux_core::config::default_config_path())]
    config: PathBuf,

    #[arg(long = "version")]
    version: bool,

    #[arg(long = "print-config-and-exit")]
    print_config_and_exit: bool,
}

#[tokio::main]
async fn main() -> ExitCode {
    unsafe {
        std::env::set_var("LANG", "en_US.UTF-8");
        std::env::set_var("LC_ALL", "en_US.UTF-8");
    }
    let cli = Cli::parse();
    match run(cli).await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{}", wmux_core::app::format_startup_error(&error));
            ExitCode::FAILURE
        }
    }
}

async fn run(cli: Cli) -> anyhow::Result<()> {
    if cli.version {
        println!("{}", wmux_core::version());
        return Ok(());
    }

    let startup = wmux_core::app::load_startup_config(cli.config)?;
    let store = startup.store;
    let config_path = startup.config_path;
    let config = startup.config;

    if cli.print_config_and_exit {
        serde_json::to_writer_pretty(std::io::stdout(), &config)
            .context("failed to print config")?;
        println!();
        return Ok(());
    }

    let logging_handle = wmux_core::logging::init_tracing(&config.logs, &config.path, &config_path)
        .with_context(|| "failed to initialize logging")?;

    let mut state = wmux_core::state::AppState::with_storage(
        store.clone(),
        PathBuf::from("web/dist"),
        logging_handle.clone(),
        &config_path,
    )
    .await
    .context("failed to initialize SQLite storage")?;

    if let Some(pool) = state.storage.clone() {
        let cleanup_holder = wmux_core::storage::cleanup::spawn_cleanup_task(pool.clone());
        state.set_cleanup_handle(cleanup_holder);
        let sync_holder = wmux_core::storage::sync::spawn_sync_task(pool, store.clone());
        state.set_sync_handle(sync_holder);
    }

    tracing::info!(
        version = wmux_core::version(),
        config = %config_path.display(),
        bind = %config.server.bind,
        "starting wmux"
    );

    let listener = tokio::net::TcpListener::bind(&config.server.bind)
        .await
        .with_context(|| format!("failed to bind {}", config.server.bind))?;
    println!("http://{}", config.server.bind);
    let shutdown_state = state.clone();
    let app = wmux_core::routes::router(state);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            if let Some(handle_holder) = &shutdown_state.cleanup_handle {
                if let Some(handle) = handle_holder.lock().unwrap().take() {
                    handle.abort();
                }
            }
            if let Some(handle_holder) = &shutdown_state.sync_handle {
                if let Some(handle) = handle_holder.lock().unwrap().take() {
                    handle.abort();
                }
            }
            tracing::info!("closing all sessions");
            shutdown_state.sessions.shutdown().await;
            tracing::info!("all sessions closed");
        })
        .await
        .context("server failed")
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(error) = tokio::signal::ctrl_c().await {
            tracing::error!(raw_error = %error, "failed to install ctrl-c handler");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(error) => {
                tracing::error!(raw_error = %error, "failed to install terminate handler");
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received");
}
