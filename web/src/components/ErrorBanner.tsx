import { useAppState } from "../state/store.js"
import ErrorOutlinedIcon from "@mui/icons-material/ErrorOutlined"
import CloseIcon from "@mui/icons-material/Close"

export function ErrorBanner() {
  const { error, setError } = useAppState()

  if (error && ["conflict", "tmux_not_found", "ssh_unknown_host"].includes(error.code)) {
    return null
  }

  if (!error) return null

  return (
    <div className="error-banner" data-testid="error-banner">
      <ErrorOutlinedIcon className="error-banner-icon" />
      <div className="error-banner-content">
        <span className="error-banner-code">Error: {error.code}</span>
        <span className="error-banner-message">{error.message}</span>
      </div>
      <button
        type="button"
        className="error-banner-dismiss"
        onClick={() => setError(null)}
        aria-label="Dismiss error"
      >
        <CloseIcon className="error-banner-dismiss-icon" />
      </button>
    </div>
  )
}
