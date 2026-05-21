use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tracing::Level;
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::{EnvFilter, Layer, layer::SubscriberExt, util::SubscriberInitExt};

use crate::config::{ConfigError, LogsConfig, resolve_log_file_path};

/// Wrapper for Arc<Mutex<RotatingFileWriter>> that implements MakeWriter.
#[derive(Clone)]
struct SharedFileWriter(Arc<Mutex<RotatingFileWriter>>);

impl<'a> MakeWriter<'a> for SharedFileWriter {
    type Writer = OwningMutexWriter;

    fn make_writer(&self) -> Self::Writer {
        OwningMutexWriter(self.0.clone())
    }
}

/// Owning writer that locks on each write operation.
struct OwningMutexWriter(Arc<Mutex<RotatingFileWriter>>);

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
    pub(crate) writer: Arc<Mutex<RotatingFileWriter>>,
    path: PathBuf,
}

impl ErrorLogHandle {
    /// Create an ErrorLogHandle for testing.
    pub fn new(writer: Arc<Mutex<RotatingFileWriter>>, path: PathBuf) -> Self {
        Self { writer, path }
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
        self.writer
            .lock()
            .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "mutex poisoned"))?
            .clear()
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
        let writer = open_rotating_writer(&log_file_path, config, "open log file")?;
        Some(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_target(false)
                .with_writer(SharedFileWriter(writer)),
        )
    };

    let (error_log_handle, error_layer): (Option<ErrorLogHandle>, Option<_>) =
        if config.error_path.trim().is_empty() {
            (None, None)
        } else {
            let error_file_path = resolve_log_file_path(&config.error_path, "wmux-error.log")?;
            let shared_file =
                open_rotating_writer(&error_file_path, config, "open error log file")?;
            let handle = ErrorLogHandle {
                writer: shared_file.clone(),
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

fn open_rotating_writer(
    path: &Path,
    config: &LogsConfig,
    context: &'static str,
) -> Result<Arc<Mutex<RotatingFileWriter>>, ConfigError> {
    RotatingFileWriter::open(
        path.to_path_buf(),
        config.rotation_size_bytes,
        config.retention_days,
    )
    .map(|writer| Arc::new(Mutex::new(writer)))
    .map_err(|source| ConfigError::Io { context, source })
}

pub struct RotatingFileWriter {
    path: PathBuf,
    file: Option<File>,
    rotation_size_bytes: u64,
    retention_days: u64,
}

impl RotatingFileWriter {
    pub fn open(
        path: PathBuf,
        rotation_size_bytes: u64,
        retention_days: u64,
    ) -> std::io::Result<Self> {
        cleanup_rotated_logs(&path, retention_days)?;
        let file = open_append_file(&path)?;
        Ok(Self {
            path,
            file: Some(file),
            rotation_size_bytes,
            retention_days,
        })
    }

    pub fn clear(&mut self) -> std::io::Result<()> {
        let file = self.file_mut()?;
        file.set_len(0)?;
        file.seek(SeekFrom::Start(0))?;
        file.sync_all()
    }

    fn rotate_if_needed(&mut self, incoming_bytes: usize) -> std::io::Result<()> {
        if self.rotation_size_bytes == 0 {
            return Ok(());
        }

        let current_len = self
            .file_mut()?
            .metadata()
            .map(|metadata| metadata.len())
            .unwrap_or(0);
        if current_len == 0
            || current_len.saturating_add(incoming_bytes as u64) <= self.rotation_size_bytes
        {
            return Ok(());
        }

        self.rotate()?;
        cleanup_rotated_logs(&self.path, self.retention_days)
    }

    fn rotate(&mut self) -> std::io::Result<()> {
        if let Some(mut file) = self.file.take() {
            file.flush()?;
            file.sync_all()?;
        }

        if self.path.exists() && self.path.metadata()?.len() > 0 {
            std::fs::rename(&self.path, next_rotated_path(&self.path)?)?;
        }

        self.file = Some(open_append_file(&self.path)?);
        Ok(())
    }

    fn file_mut(&mut self) -> std::io::Result<&mut File> {
        self.file
            .as_mut()
            .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::Other, "log file is closed"))
    }
}

impl Write for RotatingFileWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.rotate_if_needed(buf.len())?;
        self.file_mut()?.write(buf)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.file_mut()?.flush()
    }
}

fn open_append_file(path: &Path) -> std::io::Result<File> {
    OpenOptions::new().create(true).append(true).open(path)
}

fn next_rotated_path(path: &Path) -> std::io::Result<PathBuf> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "invalid log path"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    for index in 0..1000 {
        let suffix = if index == 0 {
            timestamp.to_string()
        } else {
            format!("{timestamp}.{index}")
        };
        let candidate = parent.join(format!("{file_name}.{suffix}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "too many rotated log files for the same timestamp",
    ))
}

fn cleanup_rotated_logs(path: &Path, retention_days: u64) -> std::io::Result<()> {
    if retention_days == 0 {
        return Ok(());
    }

    let Some(parent) = path.parent() else {
        return Ok(());
    };
    if !parent.exists() {
        return Ok(());
    }

    let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
        return Ok(());
    };
    let rotated_prefix = format!("{file_name}.");
    let retention = Duration::from_secs(retention_days.saturating_mul(24 * 60 * 60));
    let cutoff = SystemTime::now()
        .checked_sub(retention)
        .unwrap_or(SystemTime::UNIX_EPOCH);

    for entry in std::fs::read_dir(parent)? {
        let entry = entry?;
        let entry_path = entry.path();
        let Some(entry_name) = entry_path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if !entry_name.starts_with(&rotated_prefix) || !entry.file_type()?.is_file() {
            continue;
        }
        let modified = entry.metadata()?.modified().unwrap_or(SystemTime::now());
        if modified < cutoff {
            std::fs::remove_file(entry_path)?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn error_log_handle_read_lines_returns_last_n() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test-error.log");
        std::fs::write(
            &path,
            (0..5)
                .map(|i| format!("error line {i}\n"))
                .collect::<String>(),
        )
        .expect("write");

        let handle = test_error_log_handle(path);

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
        std::fs::write(&path, "only line\n").expect("write");

        let handle = test_error_log_handle(path);

        let (lines, truncated) = handle.read_lines(1000);
        assert_eq!(lines.len(), 1);
        assert!(!truncated);
    }

    #[test]
    fn error_log_handle_clear_then_write() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("test-error.log");
        let handle = test_error_log_handle(path);

        {
            let mut writer = handle.writer.lock().expect("lock");
            writeln!(writer, "before clear").expect("write");
            writer.flush().expect("sync before");
        }

        handle.clear().expect("clear");

        {
            let mut writer = handle.writer.lock().expect("lock");
            writeln!(writer, "after clear").expect("write");
            writer.flush().expect("sync after");
        }

        let (lines, _) = handle.read_lines(10);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0], "after clear");
    }

    #[test]
    fn logging_handle_empty_has_no_error_log() {
        let handle = LoggingHandle::empty();
        assert!(handle.error_log.is_none());
    }

    #[test]
    fn rotating_file_writer_rotates_when_size_limit_is_exceeded() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("wmux.log");
        let mut writer = RotatingFileWriter::open(path.clone(), 12, 14).expect("open");

        writeln!(writer, "first").expect("write first");
        writer.flush().expect("flush first");
        writeln!(writer, "second").expect("write second");
        writer.flush().expect("flush second");

        let active = std::fs::read_to_string(&path).expect("read active");
        assert_eq!(active, "second\n");
        assert_eq!(rotated_logs(&path).len(), 1);
    }

    #[test]
    fn rotating_file_writer_deletes_expired_rotated_logs() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("wmux.log");
        let old_rotated = dir.path().join("wmux.log.1");
        std::fs::write(&old_rotated, "old").expect("write old");
        let old_file = OpenOptions::new()
            .write(true)
            .open(&old_rotated)
            .expect("open old");
        old_file
            .set_times(
                std::fs::FileTimes::new().set_modified(
                    SystemTime::now()
                        .checked_sub(Duration::from_secs(3 * 24 * 60 * 60))
                        .expect("old time"),
                ),
            )
            .expect("set time");

        let _writer = RotatingFileWriter::open(path, 1024, 1).expect("open");

        assert!(!old_rotated.exists());
    }

    fn test_error_log_handle(path: PathBuf) -> ErrorLogHandle {
        let writer = RotatingFileWriter::open(path.clone(), 0, 0).expect("open writer");
        ErrorLogHandle::new(Arc::new(Mutex::new(writer)), path)
    }

    fn rotated_logs(path: &Path) -> Vec<PathBuf> {
        let file_name = path.file_name().unwrap().to_string_lossy();
        let prefix = format!("{file_name}.");
        let mut logs = std::fs::read_dir(path.parent().unwrap())
            .expect("read dir")
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .filter(|entry_path| {
                entry_path
                    .file_name()
                    .map(|name| name.to_string_lossy().starts_with(&prefix))
                    .unwrap_or(false)
            })
            .collect::<Vec<_>>();
        logs.sort();
        logs
    }
}
