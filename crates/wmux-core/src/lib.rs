extern crate self as wmux_core;

pub mod app;
pub mod config;
pub mod handlers;
pub mod http;
pub mod intelligence;
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

pub fn version() -> &'static str {
    match option_env!("WMUX_VERSION") {
        Some(version) => version,
        None => env!("CARGO_PKG_VERSION"),
    }
}
