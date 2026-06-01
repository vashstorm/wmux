import type { SelectedPane } from "../state/store.js"

/**
 * URL representation of workspace location.
 * Used for URL search params serialization.
 */
export interface WorkspaceLocation {
  connection: string
  session: string
  window?: string
  pane?: string
}

/**
 * Check if a workspace location is structurally valid.
 * Rules:
 * - connection + session are REQUIRED
 * - pane without window is INVALID
 * - empty connection or session is INVALID
 */
export function isStructurallyValidWorkspaceLocation(location: WorkspaceLocation): boolean {
  // connection and session must be non-empty
  if (!location.connection || !location.session) {
    return false
  }

  // pane without window is invalid
  if (location.pane !== undefined && location.window === undefined) {
    return false
  }

  return true
}

/**
 * Parse URL search string into a WorkspaceLocation.
 * Returns null if:
 * - search is empty/missing
 * - connection or session is missing
 * - pane is present without window
 */
export function parseWorkspaceUrl(search: string): WorkspaceLocation | null {
  // Handle empty or "?" only
  if (!search || search === "?") {
    return null
  }

  // Strip leading "?" if present
  const searchStr = search.startsWith("?") ? search.slice(1) : search

  // Parse with URLSearchParams
  const params = new URLSearchParams(searchStr)

  const connection = params.get("connection")
  const session = params.get("session")
  const window = params.get("window")
  const pane = params.get("pane")

  // connection and session must be present
  if (!connection || !session) {
    return null
  }

  const location: WorkspaceLocation = {
    connection,
    session,
  }

  // Add optional fields only if they exist
  if (window !== null) {
    location.window = window
  }

  if (pane !== null) {
    location.pane = pane
  }

  // Validate structure
  if (!isStructurallyValidWorkspaceLocation(location)) {
    return null
  }

  return location
}

/**
 * Format a WorkspaceLocation into a URL search string.
 * Returns empty string if:
 * - location is null
 * - connection or session is missing/empty
 */
export function formatWorkspaceUrl(location: WorkspaceLocation | null): string {
  if (!location) {
    return ""
  }

  // Validate structure
  if (!isStructurallyValidWorkspaceLocation(location)) {
    return ""
  }

  const params = new URLSearchParams()
  params.set("connection", location.connection)
  params.set("session", location.session)

  if (location.window !== undefined) {
    params.set("window", location.window)
  }

  if (location.pane !== undefined) {
    params.set("pane", location.pane)
  }

  return `?${params.toString()}`
}

/**
 * Convert WorkspaceLocation to SelectedPane.
 * Maps connection -> targetName.
 */
export function toSelectedPane(location: WorkspaceLocation): SelectedPane {
  return {
    targetName: location.connection,
    session: location.session,
    window: location.window,
    pane: location.pane,
  }
}

/**
 * Convert SelectedPane to WorkspaceLocation.
 * Maps targetName -> connection.
 * Returns null for null input.
 */
export function fromSelectedPane(pane: SelectedPane | null): WorkspaceLocation | null {
  if (!pane) {
    return null
  }

  return {
    connection: pane.targetName,
    session: pane.session,
    window: pane.window,
    pane: pane.pane,
  }
}

/**
 * Determine the history action for navigating from previous to next pane.
 * Returns "push" for:
 * - null -> non-null
 * - session change
 * - window change (within same session)
 * Returns "replace" for:
 * - any -> null
 * - null -> null
 * - pane-only change (same session + same window)
 * - identical location (no-op)
 */
export function getWorkspaceHistoryAction(
  previous: SelectedPane | null,
  next: SelectedPane | null,
): "push" | "replace" {
  // Both null -> replace (no-op)
  if (!previous && !next) {
    return "replace"
  }

  // Any -> null -> replace (clearing selection)
  if (!next) {
    return "replace"
  }

  // null -> non-null -> push
  if (!previous) {
    return "push"
  }

  // Session change -> push
  if (previous.session !== next.session) {
    return "push"
  }

  // Connection change -> push (different target)
  if (previous.targetName !== next.targetName) {
    return "push"
  }

  // Same session, different window -> push
  if (previous.window !== next.window) {
    return "push"
  }

  // Same session + same window, pane change -> replace
  // Also handles: same pane (no-op) -> replace
  return "replace"
}
