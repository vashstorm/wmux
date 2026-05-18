use std::path::PathBuf;

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
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    if cli.version {
        println!("{}", wmux_core::version());
        return Ok(());
    }

    let store = wmux_core::config::Config::load(&cli.config)
        .with_context(|| format!("failed to load config from {}", cli.config.display()))?;
    let config = store
        .snapshot()
        .context("failed to read config snapshot")?
        .expanded()
        .context("failed to expand config paths")?;
    config.validate_auth().context("invalid config")?;

    if cli.print_config_and_exit {
        serde_json::to_writer_pretty(std::io::stdout(), &config)
            .context("failed to print config")?;
        println!();
        return Ok(());
    }

    let logging_handle = wmux_core::logging::init_tracing(&config.logs)
        .with_context(|| "failed to initialize logging")?;
    let config_path = store.path().context("failed to resolve config path")?;
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
    let state = wmux_core::state::AppState::new(store, PathBuf::from("web/dist"), logging_handle);
    let app = wmux_core::routes::router(state);

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
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
