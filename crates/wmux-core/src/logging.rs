use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::{Arc, Mutex};

use tracing::Level;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::{ConfigError, LogsConfig, resolve_log_file_path};

/// Wrapper for Arc<Mutex<File>> that implements MakeWriter.
#[derive(Clone)]
struct SharedFileWriter(Arc<Mutex<std::fs::File>>);

impl<'a> MakeWriter<'a> for SharedFileWriter {
    type Writer = OwningMutexWriter;

    fn make_writer(&self) -> Self::Writer {
        OwningMutexWriter(self.0.clone())
    }
}

/// Owning writer that locks on each write operation.
struct OwningMutexWriter(Arc<Mutex<std::fs::File>>);

impl Write for OwningMutexWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "mutex poisoned"))
            .and_then(|mut guard| guard.write(buf))
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.0
            .lock()
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "mutex poisoned"))
            .and_then(|mut guard| guard.flush())
    }
}

/// A cloneable handle to the shared error log file.
#[derive(Clone)]
pub struct ErrorLogHandle {
    pub file: Arc<Mutex<std::fs::File>>,
    path: PathBuf,
}

impl ErrorLogHandle {
    /// Create an ErrorLogHandle for testing.
    pub fn new(file: Arc<Mutex<std::fs::File>>, path: PathBuf) -> Self {
        Self { file, path }
    }

    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// Read the last `max_lines` lines from the error log file.
    /// Returns (lines, truncated) where truncated=true if more lines existed.
    pub fn read_lines(&self, max_lines: usize) -> (Vec<String>, bool) {
        // Open a fresh read-mode file handle since the stored file is in append mode
        // which cannot be read from on some platforms (EBADF on macOS)
        let mut file = match std::fs::File::open(&self.path) {
            Ok(f) => f,
            Err(_) => return (Vec::new(), false),
        };
        let mut content = String::new();
        if file.read_to_string(&mut content).is_err() {
            return (Vec::new(), false);
        }
        let all_lines: Vec<&str> = content.lines().collect();
        let total = all_lines.len();
        let truncated = total > max_lines;
        let lines: Vec<String> = all_lines
            .iter()
            .skip(if truncated { total - max_lines } else { 0 })
            .map(|s| s.to_string())
            .collect();
        (lines, truncated)
    }

    /// Clear (truncate) the error log file.
    pub fn clear(&self) -> Result<(), std::io::Error> {
        let mut file = self
            .file
            .lock()
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "mutex poisoned"))?;
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        file.sync_all()?;
        Ok(())
    }
}

/// Returned by init_tracing, holds optional error log handle.
#[derive(Clone)]
pub struct LoggingHandle {
    pub error_log: Option<ErrorLogHandle>,
}

impl LoggingHandle {
    /// Create an empty handle for testing.
    pub fn empty() -> Self {
        Self { error_log: None }
    }
}

pub fn init_tracing(config: &LogsConfig) -> Result<LoggingHandle, ConfigError> {
    let level = Level::from_str(&config.level).unwrap_or(Level::INFO);

    let filter = EnvFilter::builder()
        .with_default_directive(level.into())
        .from_env_lossy();

    let console_layer = tracing_subscriber::fmt::layer().with_target(false);

    let main_file_layer: Option<_> = if config.path.trim().is_empty() {
        None
    } else {
        let log_file_path = resolve_log_file_path(&config.path, "wmux.log")?;
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_file_path)
            .map_err(|source| ConfigError::Io {
                context: "open log file",
                source,
            })?;
        Some(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_target(false)
                .with_writer(Mutex::new(file)),
        )
    };

    let (error_log_handle, error_layer): (Option<ErrorLogHandle>, Option<_>) =
        if config.error_path.trim().is_empty() {
            (None, None)
        } else {
            let error_file_path = resolve_log_file_path(&config.error_path, "wmux-error.log")?;
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&error_file_path)
                .map_err(|source| ConfigError::Io {
                    context: "open error log file",
                    source,
                })?;
            let shared_file = Arc::new(Mutex::new(file));
            let handle = ErrorLogHandle {
                file: shared_file.clone(),
                path: error_file_path,
            };
            let writer = SharedFileWriter(shared_file);
            let layer = tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_target(false)
                .with_writer(writer)
                .with_filter(tracing_subscriber::filter::LevelFilter::ERROR);
            (Some(handle), Some(layer))
        };

    // Build registry with optional layers
    let registry = tracing_subscriber::registry()
        .with(filter)
        .with(console_layer)
        .with(main_file_layer)
        .with(error_layer);

    registry.try_init().ok();

    Ok(LoggingHandle {
        error_log: error_log_handle,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn error_log_handle_read_lines_returns_last_n() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test-error.log");
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .expect("open");

        for i in 0..5 {
            writeln!(file, "error line {}", i).expect("write");
        }
        file.sync_all().expect("sync");

        let handle = ErrorLogHandle {
            file: Arc::new(Mutex::new(file)),
            path,
        };

        let (lines, truncated) = handle.read_lines(3);
        assert_eq!(lines.len(), 3);
        assert!(truncated);
        assert_eq!(lines[0], "error line 2");
        assert_eq!(lines[2], "error line 4");
    }

    #[test]
    fn error_log_handle_read_lines_no_truncation() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test-error.log");
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .expect("open");

        writeln!(file, "only line").expect("write");
        file.sync_all().expect("sync");

        let handle = ErrorLogHandle {
            file: Arc::new(Mutex::new(file)),
            path,
        };

        let (lines, truncated) = handle.read_lines(1000);
        assert_eq!(lines.len(), 1);
        assert!(!truncated);
    }

    #[test]
    fn error_log_handle_clear_then_write() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test-error.log");
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .expect("open");

        let handle = ErrorLogHandle {
            file: Arc::new(Mutex::new(file)),
            path: path.clone(),
        };

        // Write before
        {
            let mut f = handle.file.lock().expect("lock");
            writeln!(f, "before clear").expect("write");
            f.sync_all().expect("sync before");
        }

        // Clear
        handle.clear().expect("clear");

        // Write after
        {
            let mut f = handle.file.lock().expect("lock");
            writeln!(f, "after clear").expect("write");
            f.sync_all().expect("sync after");
        }

        // Read - should only have "after clear"
        let (lines, _) = handle.read_lines(10);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], "after clear");
    }

    #[test]
    fn logging_handle_empty_has_no_error_log() {
        let handle = LoggingHandle::empty();
        assert!(handle.error_log.is_none());
    }
}
