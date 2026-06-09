//! Wmux Tauri library crate.
//!
//! This crate provides the Tauri-specific functionality for the desktop app.
//! It re-exports core types from wmux-core and provides Tauri command bindings.

pub mod commands;
pub mod state;

pub use wmux_core::{IpcError, IpcResult};

pub use state::IpcState;

/// Re-export protocol error codes for convenience.
pub use wmux_core::protocol::{ERROR_BAD_REQUEST, ERROR_CONFLICT, ERROR_NOT_FOUND};