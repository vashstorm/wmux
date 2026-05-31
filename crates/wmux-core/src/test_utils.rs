//! Test fixture helpers for wmux-core unit tests.
//!
//! Provides shared utilities for creating test app fixtures with temporary
//! directories, config files, and assets directories.

use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

use crate::config::Config;
use crate::logging::LoggingHandle;
use crate::state::AppState;

/// Test fixture that owns a temporary directory with config and assets paths.
///
/// This struct manages the lifecycle of test fixtures, ensuring the temporary
/// directory is cleaned up when the fixture is dropped.
pub struct TestAppFixture {
    /// The temporary directory that owns all test files.
    pub temp_dir: TempDir,
    /// Path to the config.jsonc file.
    pub config_path: PathBuf,
    /// Path to the assets directory.
    pub assets_dir: PathBuf,
}

impl TestAppFixture {
    /// Create a new test fixture with minimal default config.
    ///
    /// Creates a temp directory with:
    /// - `config.jsonc` with default Config
    /// - `assets/index.html` placeholder file
    pub fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");

        fs::create_dir_all(&assets_dir).expect("create assets dir");
        write_test_index_html(&assets_dir);
        write_test_config(&config_path, &Config::default());

        Self {
            temp_dir: dir,
            config_path,
            assets_dir,
        }
    }

    /// Create a test fixture with a custom config value.
    ///
    /// The config is serialized to JSON and written to `config.jsonc`.
    pub fn with_config_value(config: serde_json::Value) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");

        fs::create_dir_all(&assets_dir).expect("create assets dir");
        write_test_index_html(&assets_dir);
        fs::write(
            &config_path,
            serde_json::to_string_pretty(&config).expect("serialize config"),
        )
        .expect("write config");

        Self {
            temp_dir: dir,
            config_path,
            assets_dir,
        }
    }

    /// Create a test fixture with a custom Config struct.
    ///
    /// The config is serialized to JSON and written to `config.jsonc`.
    pub fn with_config(config: &Config) -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        let assets_dir = dir.path().join("assets");

        fs::create_dir_all(&assets_dir).expect("create assets dir");
        write_test_index_html(&assets_dir);
        write_test_config(&config_path, config);

        Self {
            temp_dir: dir,
            config_path,
            assets_dir,
        }
    }

    /// Load the config and create an AppState from this fixture.
    ///
    /// This is a convenience method for tests that need a full AppState.
    pub fn create_state(&self) -> AppState {
        let store = Config::load(&self.config_path).expect("load config");
        AppState::new(store, self.assets_dir.clone(), LoggingHandle::empty())
    }
}

impl Default for TestAppFixture {
    fn default() -> Self {
        Self::new()
    }
}

/// Write a minimal index.html placeholder to the given directory.
///
/// Creates `<dir>/index.html` with a simple HTML skeleton.
pub fn write_test_index_html(dir: &Path) {
    fs::write(dir.join("index.html"), "<html></html>").expect("write index.html");
}

/// Write a config file to the given path.
///
/// Serializes the Config to JSON and writes it to `path`.
pub fn write_test_config(path: &Path, config: &Config) {
    fs::write(
        path,
        serde_json::to_string_pretty(config).expect("serialize config"),
    )
    .expect("write config");
}