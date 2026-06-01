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
 * - isApplyingNavigationRef: suppresses URL write effect during URL restore
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

  // Refs for feedback loop prevention
  // Using a counter instead of boolean to handle cases where setSelectedPane
  // is called with the same value (e.g., null → null), which wouldn't trigger
  // the effect but we still need to reset the suppression.
  const suppressCountRef = useRef(0)
  const lastWrittenSearchRef = useRef<string>("")
  const initializedRef = useRef(false)
  const previousSelectedPaneRef = useRef<typeof selectedPane>(null)
  const restoredConnectionsRef = useRef(new Set<string>())

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
    restoreFromLocation(location)
  }, [connections])

  // Separate effect to handle when connections become available after initial mount
  useEffect(() => {
    if (!initializedRef.current) return

    const search = window.location.search
    const location = parseWorkspaceUrl(search)

    if (!location) return

    // Skip if this connection was already handled in a previous render cycle
    if (restoredConnectionsRef.current.has(location.connection)) return

    // Check if we already restored this location
    if (
      selectedPane?.targetName === location.connection &&
      selectedPane?.session === location.session
    ) {
      return
    }

    // Check if connection now exists
    const connectionExists = connections.some((c) => c.targetName === location.connection)

    if (connectionExists) {
      restoredConnectionsRef.current.add(location.connection)
      restoreFromLocation(location)
    }
  }, [connections, selectedPane])

  // Restore from location helper
  async function restoreFromLocation(
    location: ReturnType<typeof parseWorkspaceUrl>,
  ): Promise<void> {
    if (!location) return

    suppressCountRef.current++
    try {
      setSelectedTargetName(location.connection)

      // Validate session exists
      const sessionsResponse = await listSessions(location.connection)
      const sessions = sessionsResponse.data ?? []
      setSessions(location.connection, sessions)

      const sessionExists = sessions.some(
        (s) => s.name === location.session || s.id === location.session,
      )

      if (!sessionExists) {
        setSelectedPane(null)
        window.history.replaceState(null, "", window.location.pathname)
        return
      }

      // If window specified, load windows and panes
      if (location.window) {
        const windowsResponse = await listWindows(location.connection, location.session)
        const windows = windowsResponse.data ?? []
        setWindows(location.connection, location.session, windows)

        const windowExists = windows.some((w) => w.ID === location.window)

        if (!windowExists) {
          setSelectedPane(null)
          window.history.replaceState(null, "", window.location.pathname)
          return
        }

        // Load panes
        const panesResponse = await listPanes(
          location.connection,
          location.session,
          location.window,
        )
        const panes = panesResponse.data ?? []
        setPanes(location.connection, location.session, location.window, panes)

        // Validate pane exists if specified
        if (location.pane) {
          const paneExists = panes.some((p) => p.ID === location.pane)
          if (!paneExists) {
            setSelectedPane(null)
            window.history.replaceState(null, "", window.location.pathname)
            return
          }
        }

        setSelectedPane(toSelectedPane(location))
      } else {
        // No window specified — load windows and select the first one
        const windowsResponse = await listWindows(location.connection, location.session)
        const windows = windowsResponse.data ?? []
        setWindows(location.connection, location.session, windows)

        if (windows.length === 0) {
          setSelectedPane(toSelectedPane(location))
          return
        }

        const firstWindow = windows[0]
        if (!firstWindow) {
          setSelectedPane(toSelectedPane(location))
          return
        }

        const panesResponse = await listPanes(location.connection, location.session, firstWindow.ID)
        const panes = panesResponse.data ?? []
        setPanes(location.connection, location.session, firstWindow.ID, panes)

        const activePane = panes.find((p) => p.Active) ?? panes[0]

        setSelectedPane({
          targetName: location.connection,
          session: location.session,
          window: firstWindow.ID,
          pane: activePane?.ID,
        })
      }
    } catch (error) {
      setSelectedPane(null)
      window.history.replaceState(null, "", window.location.pathname)
    } finally {
      // If the URL-write effect already decremented (because selectedPane changed),
      // this is a no-op. If selectedPane didn't change (e.g., null → null),
      // this ensures suppression is cleared synchronously.
      if (suppressCountRef.current > 0) {
        suppressCountRef.current--
      }
    }
  }

  // popstate event listener
  useEffect(() => {
    const handlePopstate = async (): Promise<void> => {
      const search = window.location.search
      const location = parseWorkspaceUrl(search)

      suppressCountRef.current++
      try {
        if (!location) {
          setSelectedPane(null)
        } else {
          // Just restore selectedPane, don't reload data during popstate
          // (user is navigating back/forward through history we created)
          setSelectedPane(toSelectedPane(location))
        }
      } finally {
        // Same rationale as restoreFromLocation: synchronous safety net.
        if (suppressCountRef.current > 0) {
          suppressCountRef.current--
        }
      }
    }

    window.addEventListener("popstate", handlePopstate)

    return () => {
      window.removeEventListener("popstate", handlePopstate)
    }
  }, [setSelectedPane])

  // Write URL when selectedPane changes
  useEffect(() => {
    // During URL restore or popstate handling, suppress the write
    // but update tracking refs to prevent future duplicate writes.
    // Use a counter to handle cases where selectedPane doesn't change
    // (e.g., null → null), which wouldn't trigger the effect again.
    if (suppressCountRef.current > 0) {
      suppressCountRef.current--
      const location = fromSelectedPane(selectedPane)
      const formatted = formatWorkspaceUrl(location)
      lastWrittenSearchRef.current = formatted
      previousSelectedPaneRef.current = selectedPane
      return
    }

    // Skip duplicate writes
    const location = fromSelectedPane(selectedPane)
    const formatted = formatWorkspaceUrl(location)
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
