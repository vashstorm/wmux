extern crate self as wmux_core;

pub mod app;
pub mod config;
pub mod handlers;
pub mod http;
pub mod middleware;
pub mod protocol;
pub mod routes;
pub mod session;
pub mod state;
pub mod tmux;

pub fn version() -> &'static str {
    match option_env!("WMUX_VERSION") {
        Some(version) => version,
        None => env!("CARGO_PKG_VERSION"),
    }
}
