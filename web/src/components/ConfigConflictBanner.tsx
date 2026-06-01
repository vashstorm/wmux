import { useState } from "react"
import { Alert, Button, Stack } from "@mui/material"
import { useAppState } from "../state/store.js"

export function ConfigConflictBanner() {
  const { configConflict, setConfigConflict } = useAppState()
  const [loadingAction, setLoadingAction] = useState<"reload" | "retry" | null>(null)

  if (!configConflict) {
    return null
  }

  const runAction = async (action: "reload" | "retry", callback: () => Promise<void>) => {
    setLoadingAction(action)
    try {
      await callback()
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <Alert
      severity="warning"
      onClose={() => setConfigConflict(null)}
      data-testid="config-conflict"
      action={
        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            onClick={() => runAction("reload", configConflict.onReload)}
            disabled={loadingAction !== null}
          >
            {loadingAction === "reload" ? "Reloading..." : "Reload"}
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={() => runAction("retry", configConflict.onRetry)}
            disabled={loadingAction !== null}
          >
            {loadingAction === "retry" ? "Retrying..." : "Retry"}
          </Button>
        </Stack>
      }
    >
      Configuration conflict. The config file changed on disk before your save completed. Reload the
      latest config or retry after reviewing your pending changes.
    </Alert>
  )
}
