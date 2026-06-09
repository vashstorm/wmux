extern crate self as wmux_core;

pub mod app;
pub mod config;
pub mod handlers;
pub mod http;
pub mod intelligence;
pub mod ipc_error;
pub mod logging;
pub mod middleware;
pub mod project_ai;
pub mod project_runtime;
pub mod protocol;
pub mod routes;
pub mod session;
pub mod skills;
pub mod state;
pub mod storage;
pub mod tmux;
pub mod voice;

pub use ipc_error::{IpcError, IpcResult};

pub fn version() -> &'static str {
    match option_env!("WMUX_VERSION") {
        Some(version) => version,
        None => env!("CARGO_PKG_VERSION"),
    }
}

#[cfg(test)]
mod test_utils;
