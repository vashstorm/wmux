//! Voice action policy module for risk assessment and confirmation management.
//!
//! This module provides:
//! - Risk classification for voice-initiated actions (safe/write/dangerous)
//! - Confirmation state machine for dangerous operations
//! - Structured JSON-lines audit logging with secret redaction

pub mod audit;
pub mod executor;
pub mod policy;

pub use audit::{
    ActionResult, AuditEntry, AuditLogger, ConfirmationState as AuditConfirmationState,
};
pub use executor::{OmniExecutorError, OmniSkillExecution, OmniSkillExecutor};
pub use policy::{
    ActionRiskLevel, ConfirmationState, DangerousAction, PendingConfirmation, classify_risk_level,
    is_dangerous,
};
