import { Alert, Button } from "@mui/material"
import { useAppState } from "../state/store.js"

export function ErrorBanner() {
  const { error, setError } = useAppState()

  if (error && ["conflict", "tmux_not_found", "ssh_unknown_host"].includes(error.code)) {
    return null
  }

  if (!error) return null

  return (
    <Alert
      severity="error"
      variant="filled"
      onClose={() => setError(null)}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => setError(null)}
        >
          Dismiss
        </Button>
      }
      sx={{
        position: "fixed",
        bottom: "var(--spacing-xl)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        maxWidth: 520,
        width: "calc(100% - var(--spacing-xl) * 2)",
      }}
      data-testid="error-banner"
    >
      <strong>Error: {error.code}</strong> {error.message}
    </Alert>
  )
}
