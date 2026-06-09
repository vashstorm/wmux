import { Alert } from "@mui/material"
import { useAppState } from "../state/store.js"

export function TmuxWarning() {
  const { error, selectedTargetName, connections } = useAppState()

  if (error?.code !== "tmux_not_found" || !selectedTargetName) {
    return null
  }

  const selectedConnection = connections.find(
    (connection) => connection.targetName === selectedTargetName,
  )
  if (selectedConnection?.type !== "local") {
    return null
  }

  return (
    <Alert
      severity="warning"
      sx={{ width: "100%", maxWidth: 720, mb: 2 }}
      data-testid="tmux-warning"
    >
      <strong>Local tmux unavailable.</strong> Install tmux or update the tmux path in Settings before
      using local connections.
    </Alert>
  )
}
