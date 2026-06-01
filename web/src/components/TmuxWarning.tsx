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
    <div className="inline-warning-banner" data-testid="tmux-warning" role="alert">
      <strong>Local tmux unavailable.</strong>
      <span>Install tmux or update the tmux path in Settings before using local connections.</span>
    </div>
  )
}
