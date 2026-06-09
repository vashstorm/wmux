use std::path::PathBuf;

use anyhow::{Context, Result};

use crate::config::{Config, Store};

#[derive(Debug)]
pub struct StartupConfig {
    pub store: Store,
    pub config_path: PathBuf,
    pub config: Config,
}

pub fn load_startup_config(config_path: PathBuf) -> Result<StartupConfig> {
    let store = Config::load(&config_path)
        .with_context(|| format!("failed to load config from {}", config_path.display()))?;
    let loaded_config_path = store.path().with_context(|| {
        format!(
            "failed to resolve loaded config path requested as {}",
            config_path.display()
        )
    })?;
    let config = store
        .snapshot()
        .with_context(|| {
            format!(
                "failed to read config snapshot from {}",
                loaded_config_path.display()
            )
        })?
        .expanded()
        .with_context(|| {
            format!(
                "failed to expand paths in config {}",
                loaded_config_path.display()
            )
        })?;
    config
        .validate_auth()
        .with_context(|| format!("invalid auth config in {}", loaded_config_path.display()))?;
    config
        .validate_path()
        .with_context(|| format!("invalid path config in {}", loaded_config_path.display()))?;
    config
        .validate_omni()
        .with_context(|| format!("invalid voice config in {}", loaded_config_path.display()))?;

    Ok(StartupConfig {
        store,
        config_path: loaded_config_path,
        config,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn startup_config_empty_file_uses_bootable_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        let config_path = dir.path().join("config.jsonc");
        fs::write(&config_path, "").expect("write empty config");

        let startup = load_startup_config(config_path.clone()).expect("load startup config");

        assert_eq!(startup.config_path, config_path);
        assert_eq!(startup.config.path, ".");
        assert!(startup.config_path.exists());
    }
}