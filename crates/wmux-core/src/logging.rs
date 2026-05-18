use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Mutex;

use tracing::Level;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, EnvFilter};

use crate::config::{ConfigError, LogsConfig};

pub fn init_tracing(config: &LogsConfig) -> Result<(), ConfigError> {
    let level = Level::from_str(&config.level).unwrap_or(Level::INFO);

    let filter = EnvFilter::builder()
        .with_default_directive(level.into())
        .from_env_lossy();

    let console_layer = tracing_subscriber::fmt::layer().with_target(false);

    if config.path.trim().is_empty() {
        tracing_subscriber::registry()
            .with(filter)
            .with(console_layer)
            .try_init()
            .ok();
        return Ok(());
    }

    let log_file_path = resolve_log_file_path(&config.path)?;

    let file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)
        .map_err(|source| ConfigError::Io {
            context: "open log file",
            source,
        })?;

    let file_layer = tracing_subscriber::fmt::layer()
        .with_ansi(false)
        .with_target(false)
        .with_writer(Mutex::new(file));

    tracing_subscriber::registry()
        .with(filter)
        .with(console_layer)
        .with(file_layer)
        .try_init()
        .ok();

    Ok(())
}

fn resolve_log_file_path(config_path: &str) -> Result<PathBuf, ConfigError> {
    let path = PathBuf::from(config_path);

    let denotes_directory = config_path.ends_with('/') || config_path.ends_with("\\");
    let is_existing_directory = path.exists() && path.is_dir();

    if denotes_directory || is_existing_directory {
        if !path.exists() {
            std::fs::create_dir_all(&path).map_err(|source| ConfigError::Io {
                context: "create log directory",
                source,
            })?;
        }
        Ok(path.join("wmux.log"))
    } else {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|source| ConfigError::Io {
                    context: "create log directory",
                    source,
                })?;
            }
        }
        Ok(path)
    }
}