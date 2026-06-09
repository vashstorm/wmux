import { useEffect, useRef } from "react"
import { useAppState } from "../state/store.js"
import { listSessions, listWindows, listPanes } from "../api/client.js"
import {
  parseWorkspaceUrl,
  formatWorkspaceUrl,
  toSelectedPane,
  fromSelectedPane,
  getWorkspaceHistoryAction,
} from "../navigation/workspaceUrl.js"

/**
 * Hook that synchronizes workspace navigation state with browser URL.
 *
 * Behavior:
 * - On mount: restore state from URL (parseWorkspaceUrl -> restore to selectedPane)
 * - On popstate: restore from URL without pushing/replacing state
 * - On selectedPane change: write URL via pushState/replaceState as appropriate
 *
 * Feedback loop prevention:
 * - suppressNextWrittenSearchRef: suppresses URL writes caused by URL restore
 * - lastWrittenSearchRef: prevents duplicate URL writes
 * - initializedRef: prevents running restore logic multiple times
 */
export function useWorkspaceNavigation(): void {
  const {
    connections,
    selectedPane,
    setSelectedTargetName,
    setSessions,
    setWindows,
    setPanes,
    setSelectedPane,
  } = useAppState()

  // Refs for feedback loop prevention.
  const suppressNextWrittenSearchRef = useRef<string | null>(null)
  const lastWrittenSearchRef = useRef<string>("")
  const initializedRef = useRef(false)
  const previousSelectedPaneRef = useRef<typeof selectedPane>(null)
  const restoredConnectionsRef = useRef(new Set<string>())
  const selectedPaneRef = useRef<typeof selectedPane>(selectedPane)
  selectedPaneRef.current = selectedPane

  function sameSelectedPane(
    a: typeof selectedPane,
    b: typeof selectedPane,
  ): boolean {
    if (a === b) return true
    if (!a || !b) return false
    return (
      a.targetName === b.targetName &&
      a.session === b.session &&
      a.window === b.window &&
      a.pane === b.pane
    )
  }

  function restoreWasOvertaken(startedFrom: typeof selectedPane): boolean {
    return !sameSelectedPane(selectedPaneRef.current, startedFrom)
  }

  function applyRestoredSelectedPane(pane: typeof selectedPane): void {
    const formatted = formatWorkspaceUrl(fromSelectedPane(pane))
    const currentFormatted = formatWorkspaceUrl(fromSelectedPane(selectedPaneRef.current))

    if (formatted !== currentFormatted) {
      suppressNextWrittenSearchRef.current = formatted
    }
    setSelectedPane(pane)
  }

  // Restore state from URL on mount
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const search = window.location.search
    const location = parseWorkspaceUrl(search)

    if (!location) {
      // No valid URL, nothing to restore
      return
    }

    // Check if connection exists
    const connectionExists = connections.some((c) => c.targetName === location.connection)

    if (!connectionExists) {
      // Connection not available yet - will be handled by connections effect
      return
    }

    // Restore navigation state
    restoredConnectionsRef.current.add(location.connection)
    restoreFromLocation(location)
  }, [connections])

  // Separate effect to handle when connections become available after initial mount.
  // Intentionally depends only on `connections` — NOT on `selectedPane`.
  //
  // Why: when the user clicks a session, React commits the new selectedPane to state
  // but the "write URL" effect (declared later) hasn't run yet, so
  // window.location.search still contains the *previous* session's URL. If we
  // included selectedPane in the deps, this effect would fire, read the stale URL,
  // and call restoreFromLocation() with the old session — causing the auto-jump-back
  // bug. Using selectedPaneRef.current (kept in sync on every render) lets us read
  // the current value without adding it to the dependency array.
  useEffect(() => {
    if (!initializedRef.current) return

    const search = window.location.search
    const location = parseWorkspaceUrl(search)

    if (!location) return

    // Skip if this connection was already handled in a previous render cycle
    if (restoredConnectionsRef.current.has(location.connection)) return

    // Check if we already restored this location (use ref to avoid stale-URL race)
    const currentPane = selectedPaneRef.current
    if (
      currentPane?.targetName === location.connection &&
      currentPane?.session === location.session
    ) {
      return
    }

    // Check if connection now exists
    const connectionExists = connections.some((c) => c.targetName === location.connection)

    if (connectionExists) {
      restoredConnectionsRef.current.add(location.connection)
      restoreFromLocation(location)
    }
  }, [connections])

  // Restore from location helper
  async function restoreFromLocation(
    location: ReturnType<typeof parseWorkspaceUrl>,
  ): Promise<void> {
    if (!location) return

    const startedFrom = selectedPaneRef.current
    try {
      setSelectedTargetName(location.connection)

      // Validate session exists
      const sessionsResponse = await listSessions(location.connection)
      if (restoreWasOvertaken(startedFrom)) return
      const sessions = sessionsResponse.data ?? []
      setSessions(location.connection, sessions)

      const sessionExists = sessions.some(
        (s) => s.name === location.session || s.id === location.session,
      )

      if (!sessionExists) {
        applyRestoredSelectedPane(null)
        window.history.replaceState(null, "", window.location.pathname)
        return
      }

      // If window specified, load windows and panes
      if (location.window) {
        const windowsResponse = await listWindows(location.connection, location.session)
        if (restoreWasOvertaken(startedFrom)) return
        const windows = windowsResponse.data ?? []
        setWindows(location.connection, location.session, windows)

        const windowExists = windows.some((w) => w.ID === location.window)

        if (!windowExists) {
          applyRestoredSelectedPane(null)
          window.history.replaceState(null, "", window.location.pathname)
          return
        }

        // Load panes
        const panesResponse = await listPanes(
          location.connection,
          location.session,
          location.window,
        )
        if (restoreWasOvertaken(startedFrom)) return
        const panes = panesResponse.data ?? []
        setPanes(location.connection, location.session, location.window, panes)

        // Validate pane exists if specified
        if (location.pane) {
          const paneExists = panes.some((p) => p.ID === location.pane)
          if (!paneExists) {
            applyRestoredSelectedPane(null)
            window.history.replaceState(null, "", window.location.pathname)
            return
          }
        }

        if (restoreWasOvertaken(startedFrom)) return
        applyRestoredSelectedPane(toSelectedPane(location))
      } else {
        // No window specified — load windows and select the first one
        const windowsResponse = await listWindows(location.connection, location.session)
        if (restoreWasOvertaken(startedFrom)) return
        const windows = windowsResponse.data ?? []
        setWindows(location.connection, location.session, windows)

        if (windows.length === 0) {
          applyRestoredSelectedPane(toSelectedPane(location))
          return
        }

        const firstWindow = windows[0]
        if (!firstWindow) {
          applyRestoredSelectedPane(toSelectedPane(location))
          return
        }

        const panesResponse = await listPanes(location.connection, location.session, firstWindow.ID)
        if (restoreWasOvertaken(startedFrom)) return
        const panes = panesResponse.data ?? []
        setPanes(location.connection, location.session, firstWindow.ID, panes)

        const activePane = panes.find((p) => p.Active) ?? panes[0]

        if (restoreWasOvertaken(startedFrom)) return
        applyRestoredSelectedPane({
          targetName: location.connection,
          session: location.session,
          window: firstWindow.ID,
          pane: activePane?.ID,
        })
      }
    } catch (error) {
      if (restoreWasOvertaken(startedFrom)) return
      applyRestoredSelectedPane(null)
      window.history.replaceState(null, "", window.location.pathname)
    }
  }

  // popstate event listener
  useEffect(() => {
    const handlePopstate = async (): Promise<void> => {
      const search = window.location.search
      const location = parseWorkspaceUrl(search)

      if (!location) {
        applyRestoredSelectedPane(null)
      } else {
        // Just restore selectedPane, don't reload data during popstate
        // (user is navigating back/forward through history we created)
        applyRestoredSelectedPane(toSelectedPane(location))
      }
    }

    window.addEventListener("popstate", handlePopstate)

    return () => {
      window.removeEventListener("popstate", handlePopstate)
    }
  }, [setSelectedPane])

  // Write URL when selectedPane changes
  useEffect(() => {
    const location = fromSelectedPane(selectedPane)
    const formatted = formatWorkspaceUrl(location)

    // During URL restore or popstate handling, suppress only the exact URL write
    // caused by that restore. User navigation while an async restore is in flight
    // must still update the URL.
    if (suppressNextWrittenSearchRef.current === formatted) {
      suppressNextWrittenSearchRef.current = null
      lastWrittenSearchRef.current = formatted
      previousSelectedPaneRef.current = selectedPane
      return
    }

    // Skip duplicate writes
    const fullPath = formatted || window.location.pathname

    if (formatted === lastWrittenSearchRef.current) return

    // Determine action
    const action = getWorkspaceHistoryAction(previousSelectedPaneRef.current, selectedPane)

    if (action === "push") {
      window.history.pushState(null, "", fullPath)
    } else {
      window.history.replaceState(null, "", fullPath)
    }

    lastWrittenSearchRef.current = formatted
    previousSelectedPaneRef.current = selectedPane
  }, [selectedPane])
}
