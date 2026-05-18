use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

use rand::RngCore;
use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_CONFIG_FILE_NAME: &str = "config.jsonc";
const DEFAULT_KNOWN_HOSTS_PATH: &str = "~/.ssh/known_hosts";
const MIN_UI_FONT_SIZE: u16 = 12;
const MAX_UI_FONT_SIZE: u16 = 24;
const MIN_TERMINAL_FONT_SIZE: u16 = 8;
const MAX_TERMINAL_FONT_SIZE: u16 = 32;
const VALID_TERMINAL_FONT_WEIGHTS: &[&str] = &[
    "normal", "bold", "100", "200", "300", "400", "500", "600", "700", "800", "900",
];

pub type Result<T> = std::result::Result<T, ConfigError>;

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("config file changed on disk")]
    ConfigModified,
    #[error("auth token is required for non-localhost bind address")]
    AuthTokenRequired,
    #[error("failed to resolve home directory")]
    HomeDirUnavailable,
    #[error("{context}: {source}")]
    Io {
        context: &'static str,
        #[source]
        source: std::io::Error,
    },
    #[error("decode config: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("store mutex poisoned")]
    LockPoisoned,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub auth: AuthConfig,
    #[serde(default)]
    pub tmux: TmuxConfig,
    #[serde(default)]
    pub connections: Vec<ConnectionConfig>,
    #[serde(default)]
    pub ui: UIConfig,
    #[serde(default)]
    pub intelligence: IntelligenceConfig,
    #[serde(default)]
    pub logs: LogsConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerConfig {
    #[serde(default = "default_bind")]
    pub bind: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthConfig {
    #[serde(default)]
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TmuxConfig {
    #[serde(default = "default_tmux_path")]
    pub path: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    #[serde(default)]
    pub id: String,
    #[serde(default, rename = "type")]
    pub connection_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub host: String,
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub port: u16,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub user: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub private_key_path: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub known_hosts_path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UIConfig {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub window_theme: String,
    #[serde(default = "default_ui_font_size")]
    pub font_size: u16,
    #[serde(default = "default_terminal_font_size")]
    pub terminal_font_size: u16,
    #[serde(default = "default_terminal_font_weight")]
    pub terminal_font_weight: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceProviderConfig {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub api_key: String,
    #[serde(default, rename = "baseURL", skip_serializing_if = "String::is_empty")]
    pub base_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsConfig {
    #[serde(default = "default_log_level")]
    pub level: String,
    #[serde(default)]
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub active_provider: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub providers: Vec<IntelligenceProviderConfig>,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub provider: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub model: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub api_key: String,
    #[serde(default, rename = "baseURL", skip_serializing_if = "String::is_empty")]
    pub base_url: String,
    #[serde(default = "default_max_bytes", skip_serializing_if = "is_zero_u32")]
    pub max_bytes: u32,
    #[serde(default = "default_timeout_sec", skip_serializing_if = "is_zero_u32")]
    pub timeout_sec: u32,
    #[serde(
        default = "default_min_session_interval_sec",
        skip_serializing_if = "is_zero_u32"
    )]
    pub min_session_interval_sec: u32,
    #[serde(
        default = "default_max_concurrency",
        skip_serializing_if = "is_zero_u32"
    )]
    pub max_concurrency: u32,
    #[serde(
        default = "default_cache_ttl_sec",
        rename = "cacheTTLSec",
        skip_serializing_if = "is_zero_u32"
    )]
    pub cache_ttl_sec: u32,
}

#[derive(Debug, Clone)]
pub struct Store {
    inner: Arc<Mutex<StoreInner>>,
}

#[derive(Debug, Clone)]
struct StoreInner {
    path: PathBuf,
    mod_time: Option<SystemTime>,
    config: Config,
}

impl Config {
    pub fn load(path: impl AsRef<Path>) -> Result<Store> {
        load(path)
    }

    pub fn validate_auth(&self) -> Result<()> {
        if self.is_localhost_bind() || !self.auth.token.trim().is_empty() {
            return Ok(());
        }
        Err(ConfigError::AuthTokenRequired)
    }

    pub fn is_localhost_bind(&self) -> bool {
        is_localhost_bind(&self.server.bind)
    }

    pub fn expanded(&self) -> Result<Self> {
        let mut expanded = self.clone();
        for connection in &mut expanded.connections {
            connection.private_key_path = expand_user_path(&connection.private_key_path)?;
            connection.known_hosts_path = expand_user_path(&connection.known_hosts_path)?;
        }
        expanded.logs.path = expand_user_path(&expanded.logs.path)?;
        Ok(expanded)
    }

    fn normalize(&mut self) {
        for connection in &mut self.connections {
            if connection.id.trim().is_empty() {
                connection.id = random_hex(16);
            }
            if connection.connection_type.eq_ignore_ascii_case("ssh")
                && connection.known_hosts_path.trim().is_empty()
            {
                connection.known_hosts_path = DEFAULT_KNOWN_HOSTS_PATH.to_string();
            }
        }

        if self.ui.font_size == 0 {
            self.ui.font_size = default_ui_font_size();
        }
        self.ui.font_size = self.ui.font_size.clamp(MIN_UI_FONT_SIZE, MAX_UI_FONT_SIZE);

        if self.ui.terminal_font_size == 0 {
            self.ui.terminal_font_size = default_terminal_font_size();
        }
        self.ui.terminal_font_size = self
            .ui
            .terminal_font_size
            .clamp(MIN_TERMINAL_FONT_SIZE, MAX_TERMINAL_FONT_SIZE);

        if self.ui.window_theme.is_empty() {
            self.ui.window_theme = self.ui.theme.clone();
        }
        if !VALID_TERMINAL_FONT_WEIGHTS.contains(&self.ui.terminal_font_weight.as_str()) {
            self.ui.terminal_font_weight = default_terminal_font_weight();
        }

        if self.intelligence.max_bytes == 0 {
            self.intelligence.max_bytes = default_max_bytes();
        }
        if self.intelligence.timeout_sec == 0 {
            self.intelligence.timeout_sec = default_timeout_sec();
        }
        if self.intelligence.min_session_interval_sec == 0 {
            self.intelligence.min_session_interval_sec = default_min_session_interval_sec();
        }
        if self.intelligence.max_concurrency == 0 {
            self.intelligence.max_concurrency = default_max_concurrency();
        }
        if self.intelligence.cache_ttl_sec == 0 {
            self.intelligence.cache_ttl_sec = default_cache_ttl_sec();
        }

        if self.logs.level.trim().is_empty() {
            self.logs.level = default_log_level();
        }

        if self.intelligence.providers.is_empty() {
            let legacy_provider = self.intelligence.provider.trim();
            if !legacy_provider.is_empty() {
                self.intelligence.providers = vec![IntelligenceProviderConfig {
                    name: legacy_provider.to_string(),
                    provider: legacy_provider.to_string(),
                    model: self.intelligence.model.trim().to_string(),
                    api_key: self.intelligence.api_key.trim().to_string(),
                    base_url: self.intelligence.base_url.trim().to_string(),
                }];
                if self.intelligence.active_provider.is_empty() {
                    self.intelligence.active_provider = legacy_provider.to_string();
                }
            }
        }

        if self.intelligence.active_provider.is_empty() && self.intelligence.providers.len() == 1 {
            self.intelligence.active_provider = self.intelligence.providers[0].name.clone();
        }

        for provider in &mut self.intelligence.providers {
            provider.name = provider.name.trim().to_string();
            provider.provider = provider.provider.trim().to_string();
            provider.model = provider.model.trim().to_string();
            provider.base_url = provider.base_url.trim().to_string();
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        let mut config = Self {
            schema_version: default_schema_version(),
            server: ServerConfig::default(),
            auth: AuthConfig::default(),
            tmux: TmuxConfig::default(),
            connections: Vec::new(),
            ui: UIConfig::default(),
            intelligence: IntelligenceConfig::default(),
            logs: LogsConfig::default(),
        };
        config.normalize();
        config
    }
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            bind: default_bind(),
        }
    }
}

impl Default for TmuxConfig {
    fn default() -> Self {
        Self {
            path: default_tmux_path(),
        }
    }
}

impl Default for UIConfig {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            window_theme: default_theme(),
            font_size: default_ui_font_size(),
            terminal_font_size: default_terminal_font_size(),
            terminal_font_weight: default_terminal_font_weight(),
        }
    }
}

impl Default for LogsConfig {
    fn default() -> Self {
        Self {
            level: default_log_level(),
            path: String::new(),
        }
    }
}

impl Default for IntelligenceConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            active_provider: String::new(),
            providers: Vec::new(),
            provider: String::new(),
            model: String::new(),
            api_key: String::new(),
            base_url: String::new(),
            max_bytes: default_max_bytes(),
            timeout_sec: default_timeout_sec(),
            min_session_interval_sec: default_min_session_interval_sec(),
            max_concurrency: default_max_concurrency(),
            cache_ttl_sec: default_cache_ttl_sec(),
        }
    }
}

impl Store {
    pub fn path(&self) -> Result<PathBuf> {
        Ok(self.lock()?.path.clone())
    }

    pub fn snapshot(&self) -> Result<Config> {
        Ok(self.lock()?.config.clone())
    }

    pub fn mod_time(&self) -> Result<Option<SystemTime>> {
        Ok(self.lock()?.mod_time)
    }

    pub fn replace(&self, config: Config) -> Result<()> {
        let mut inner = self.lock()?;
        inner.config = config;
        save_locked(&mut inner)
    }

    pub fn replace_in_memory(&self, mut config: Config) -> Result<()> {
        let mut inner = self.lock()?;
        config.normalize();
        inner.config = config;
        Ok(())
    }

    pub fn update(&self, update: impl FnOnce(&mut Config) -> Result<()>) -> Result<()> {
        let mut inner = self.lock()?;
        let mut next = inner.config.clone();
        update(&mut next)?;
        inner.config = next;
        save_locked(&mut inner)
    }

    pub fn save(&self) -> Result<()> {
        let mut inner = self.lock()?;
        save_locked(&mut inner)
    }

    pub fn reload(&self) -> Result<()> {
        let mut inner = self.lock()?;
        let (config, mod_time) = load_config_file(&inner.path)?;
        inner.config = config;
        inner.mod_time = Some(mod_time);
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, StoreInner>> {
        self.inner.lock().map_err(|_| ConfigError::LockPoisoned)
    }
}

pub fn default_config_path() -> &'static str {
    DEFAULT_CONFIG_FILE_NAME
}

pub fn default_config() -> Config {
    Config::default()
}

pub fn load(path: impl AsRef<Path>) -> Result<Store> {
    let path = resolve_path(path.as_ref())?;
    if !path.exists() {
        let store = Store {
            inner: Arc::new(Mutex::new(StoreInner {
                path,
                mod_time: None,
                config: Config::default(),
            })),
        };
        store.save()?;
        return Ok(store);
    }

    let (config, mod_time) = load_config_file(&path)?;
    Ok(Store {
        inner: Arc::new(Mutex::new(StoreInner {
            path,
            mod_time: Some(mod_time),
            config,
        })),
    })
}

pub fn parse_config(data: &str) -> Result<Config> {
    if data.trim().is_empty() {
        return Ok(Config::default());
    }

    let clean = strip_jsonc_comments(data);
    let mut config: Config = serde_json::from_str(&clean)?;
    config.normalize();
    Ok(config)
}

pub fn strip_jsonc_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    let mut in_string = false;
    let mut escaped = false;

    while let Some(ch) = chars.next() {
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch == '"' {
            in_string = true;
            out.push(ch);
            continue;
        }

        if ch == '/' {
            match chars.peek().copied() {
                Some('/') => {
                    let _ = chars.next();
                    for next in chars.by_ref() {
                        if next == '\n' {
                            out.push('\n');
                            break;
                        }
                    }
                    continue;
                }
                Some('*') => {
                    let _ = chars.next();
                    let mut prev = '\0';
                    for next in chars.by_ref() {
                        if next == '\n' {
                            out.push('\n');
                        }
                        if prev == '*' && next == '/' {
                            break;
                        }
                        prev = next;
                    }
                    continue;
                }
                _ => {}
            }
        }

        out.push(ch);
    }

    out
}

pub fn expand_user_path(path: &str) -> Result<String> {
    let trimmed = path.trim();
    let Some(rest) = trimmed.strip_prefix("~/") else {
        return Ok(path.to_string());
    };
    let home = std::env::var("HOME").map_err(|_| ConfigError::HomeDirUnavailable)?;
    Ok(Path::new(&home).join(rest).to_string_lossy().into_owned())
}

pub fn is_localhost_bind(bind: &str) -> bool {
    let host = extract_bind_host(bind);
    if host.is_empty() {
        return false;
    }
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.octets() == [127, 0, 0, 1],
        Ok(IpAddr::V6(ip)) => ip.octets() == [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        Err(_) => false,
    }
}

fn load_config_file(path: &Path) -> Result<(Config, SystemTime)> {
    let data = fs::read_to_string(path).map_err(|source| ConfigError::Io {
        context: "read config",
        source,
    })?;
    let config = parse_config(&data)?;
    let mod_time = fs::metadata(path)
        .map_err(|source| ConfigError::Io {
            context: "stat config",
            source,
        })?
        .modified()
        .map_err(|source| ConfigError::Io {
            context: "stat config modified time",
            source,
        })?;
    Ok((config, mod_time))
}

fn save_locked(inner: &mut StoreInner) -> Result<()> {
    inner.config.normalize();

    let existing = match fs::metadata(&inner.path) {
        Ok(metadata) => Some(metadata),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(source) => {
            return Err(ConfigError::Io {
                context: "stat config before save",
                source,
            });
        }
    };

    match (&existing, inner.mod_time) {
        (None, Some(_)) => return Err(ConfigError::ConfigModified),
        (Some(_), None) => return Err(ConfigError::ConfigModified),
        (Some(metadata), Some(stored)) => {
            let current = metadata.modified().map_err(|source| ConfigError::Io {
                context: "stat config modified time",
                source,
            })?;
            if current != stored {
                return Err(ConfigError::ConfigModified);
            }
        }
        (None, None) => {}
    }

    let data = marshal_config(&inner.config)?;
    let tmp_path = PathBuf::from(format!("{}.tmp.{}", inner.path.display(), random_hex(8)));
    let file = create_temp_file(&tmp_path, existing.as_ref())?;
    write_and_sync_temp_file(file, &data)?;
    fs::rename(&tmp_path, &inner.path).map_err(|source| {
        let _ = fs::remove_file(&tmp_path);
        ConfigError::Io {
            context: "replace config",
            source,
        }
    })?;
    sync_directory(inner.path.parent().unwrap_or_else(|| Path::new(".")))?;

    inner.mod_time = Some(
        fs::metadata(&inner.path)
            .map_err(|source| ConfigError::Io {
                context: "stat config after save",
                source,
            })?
            .modified()
            .map_err(|source| ConfigError::Io {
                context: "stat config modified time",
                source,
            })?,
    );
    Ok(())
}

fn marshal_config(config: &Config) -> Result<Vec<u8>> {
    let mut normalized = config.clone();
    normalized.normalize();
    let mut data = serde_json::to_vec_pretty(&normalized)?;
    data.push(b'\n');
    Ok(data)
}

fn create_temp_file(path: &Path, existing: Option<&fs::Metadata>) -> Result<File> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        options.mode(existing.map_or(0o600, |metadata| metadata.permissions().mode() & 0o777));
    }
    options.open(path).map_err(|source| ConfigError::Io {
        context: "create temp config",
        source,
    })
}

fn write_and_sync_temp_file(mut file: File, data: &[u8]) -> Result<()> {
    file.write_all(data).map_err(|source| ConfigError::Io {
        context: "write temp config",
        source,
    })?;
    file.sync_all().map_err(|source| ConfigError::Io {
        context: "sync temp config",
        source,
    })?;
    Ok(())
}

fn sync_directory(path: &Path) -> Result<()> {
    let dir = File::open(path).map_err(|source| ConfigError::Io {
        context: "open config directory",
        source,
    })?;
    dir.sync_all().map_err(|source| ConfigError::Io {
        context: "sync config directory",
        source,
    })
}

fn resolve_path(path: &Path) -> Result<PathBuf> {
    let path = if path.as_os_str().is_empty() {
        std::env::current_dir()
            .map_err(|source| ConfigError::Io {
                context: "get working directory",
                source,
            })?
            .join(DEFAULT_CONFIG_FILE_NAME)
    } else {
        path.to_path_buf()
    };
    if path.is_absolute() {
        return Ok(path);
    }
    Ok(std::env::current_dir()
        .map_err(|source| ConfigError::Io {
            context: "get working directory",
            source,
        })?
        .join(path))
}

fn extract_bind_host(bind: &str) -> String {
    let trimmed = bind.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if let Some(rest) = trimmed.strip_prefix('[') {
        return rest
            .find(']')
            .map(|end| rest[..end].to_string())
            .unwrap_or_default();
    }
    if let Some((host, _port)) = trimmed.rsplit_once(':') {
        if host.contains(':') {
            return String::new();
        }
        return host.trim_matches(['[', ']']).to_string();
    }
    trimmed.trim_matches(['[', ']']).to_string()
}

fn random_hex(byte_len: usize) -> String {
    let mut bytes = vec![0_u8; byte_len];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn default_schema_version() -> u32 {
    1
}

fn default_bind() -> String {
    "127.0.0.1:7331".to_string()
}

fn default_tmux_path() -> String {
    "tmux".to_string()
}

fn default_theme() -> String {
    "dark".to_string()
}

fn default_ui_font_size() -> u16 {
    16
}

fn default_terminal_font_size() -> u16 {
    14
}

fn default_terminal_font_weight() -> String {
    "normal".to_string()
}

fn default_max_bytes() -> u32 {
    12_000
}

fn default_timeout_sec() -> u32 {
    8
}

fn default_min_session_interval_sec() -> u32 {
    60
}

fn default_max_concurrency() -> u32 {
    3
}

fn default_cache_ttl_sec() -> u32 {
    300
}

fn default_log_level() -> String {
    "info".to_string()
}

fn is_zero_u16(value: &u16) -> bool {
    *value == 0
}

fn is_zero_u32(value: &u32) -> bool {
    *value == 0
}

#[cfg(test)]
mod tests {
    use std::thread;
    use std::time::Duration;

    use super::*;

    #[test]
    fn config_default_matches_go_defaults() {
        let config = Config::default();

        assert_eq!(config.schema_version, 1);
        assert_eq!(config.server.bind, "127.0.0.1:7331");
        assert_eq!(config.tmux.path, "tmux");
        assert!(config.connections.is_empty());
        assert_eq!(config.ui.theme, "dark");
        assert_eq!(config.ui.window_theme, "dark");
        assert_eq!(config.ui.font_size, 16);
        assert_eq!(config.ui.terminal_font_size, 14);
        assert_eq!(config.ui.terminal_font_weight, "normal");
        assert_eq!(config.intelligence.max_bytes, 12_000);
        assert_eq!(config.intelligence.timeout_sec, 8);
        assert_eq!(config.intelligence.min_session_interval_sec, 60);
        assert_eq!(config.intelligence.max_concurrency, 3);
        assert_eq!(config.intelligence.cache_ttl_sec, 300);
        assert_eq!(config.logs.level, "info");
        assert_eq!(config.logs.path, "");
    }

    #[test]
    fn config_loads_jsonc_and_normalizes() {
        let data = r#"{
          // Server settings
          "schemaVersion": 2,
          "server": { "bind": "0.0.0.0:7331" },
          "auth": { "token": "secret-token" },
          "tmux": { "path": "/opt/homebrew/bin/tmux" },
          "connections": [
            {
              "type": "ssh",
              "host": "example.com",
              "port": 22,
              "privateKeyPath": "~/.ssh/id_ed25519"
            }
          ],
          "ui": { "theme": "light" },
          "intelligence": { "enabled": true, "baseURL": "https://example.test/v1" }
        }"#;

        let config = parse_config(data).expect("parse config");

        assert_eq!(config.schema_version, 2);
        assert_eq!(config.server.bind, "0.0.0.0:7331");
        assert_eq!(config.auth.token, "secret-token");
        assert_eq!(config.connections.len(), 1);
        assert!(!config.connections[0].id.is_empty());
        assert_eq!(
            config.connections[0].known_hosts_path,
            DEFAULT_KNOWN_HOSTS_PATH
        );
        assert_eq!(config.ui.window_theme, "light");
    }

    #[test]
    fn config_serializes_go_json_field_names() {
        let mut config = Config::default();
        config.intelligence.base_url = "https://example.test/v1".to_string();
        config.intelligence.providers = vec![IntelligenceProviderConfig {
            name: "main".to_string(),
            provider: "openai".to_string(),
            model: "gpt-4o".to_string(),
            api_key: "key".to_string(),
            base_url: "https://provider.example.test/v1".to_string(),
        }];

        let value = serde_json::to_value(config).expect("serialize");

        assert_eq!(value["intelligence"]["baseURL"], "https://example.test/v1");
        assert_eq!(value["intelligence"]["cacheTTLSec"], 300);
        assert_eq!(
            value["intelligence"]["providers"][0]["baseURL"],
            "https://provider.example.test/v1"
        );
        assert!(value["intelligence"].get("baseUrl").is_none());
        assert!(value["intelligence"].get("cacheTtlSec").is_none());
    }

    #[test]
    fn config_load_creates_default_when_missing() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("config.jsonc");

        let store = Config::load(&path).expect("load config");

        assert!(path.exists());
        assert_eq!(
            store.snapshot().expect("snapshot").server.bind,
            "127.0.0.1:7331"
        );
        let content = fs::read_to_string(path).expect("read config");
        let parsed: serde_json::Value = serde_json::from_str(&content).expect("valid json");
        assert_eq!(parsed["schemaVersion"], 1);
    }

    #[test]
    fn config_store_detects_atomic_write_conflict() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join("config.jsonc");
        let store = Config::load(&path).expect("load config");
        let original_mod_time = store.mod_time().expect("mod time").expect("some mod time");

        for attempt in 0..20 {
            thread::sleep(Duration::from_millis(10));
            fs::write(
                &path,
                format!(
                    r#"{{"schemaVersion":1,"server":{{"bind":"127.0.0.1:{}"}},"auth":{{"token":"changed"}},"tmux":{{"path":"tmux"}},"connections":[],"ui":{{"theme":"dark"}}}}"#,
                    7331 + attempt
                ),
            )
            .expect("overwrite config");
            if fs::metadata(&path)
                .expect("metadata")
                .modified()
                .expect("modified")
                != original_mod_time
            {
                break;
            }
        }

        let err = store
            .update(|config| {
                config.ui.theme = "light".to_string();
                Ok(())
            })
            .expect_err("expected conflict");

        assert!(matches!(err, ConfigError::ConfigModified));
    }

    #[test]
    fn config_auth_rules_match_localhost_policy() {
        for bind in ["127.0.0.1:7331", "localhost:7331", "[::1]:7331"] {
            let mut config = Config::default();
            config.server.bind = bind.to_string();
            config.auth.token.clear();
            config.validate_auth().expect("localhost auth allowed");
        }

        let mut exposed = Config::default();
        exposed.server.bind = "0.0.0.0:7331".to_string();
        exposed.auth.token.clear();
        assert!(matches!(
            exposed.validate_auth(),
            Err(ConfigError::AuthTokenRequired)
        ));
    }

    #[test]
    fn config_expand_user_path_only_expands_slash_prefix() {
        let dir = tempfile::tempdir().expect("tempdir");
        unsafe {
            std::env::set_var("HOME", dir.path());
        }

        assert_eq!(expand_user_path("~").expect("expand"), "~");
        assert_eq!(expand_user_path("/tmp/key").expect("expand"), "/tmp/key");
        assert_eq!(
            expand_user_path("~/.ssh/id_ed25519").expect("expand"),
            dir.path().join(".ssh/id_ed25519").to_string_lossy()
        );
    }
}
