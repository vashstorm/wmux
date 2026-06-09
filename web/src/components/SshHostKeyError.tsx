import { Alert } from "@mui/material"
import { useAppState } from "../state/store.js"

export function SshHostKeyError() {
  const { error } = useAppState()

  if (error?.code !== "ssh_unknown_host") {
    return null
  }

  return (
    <Alert
      severity="error"
      sx={{ width: "100%", maxWidth: 720, mb: 2 }}
      role="alert"
    >
      <strong>ssh_unknown_host</strong> This host is not trusted yet. Use your system ssh command to
      connect once and add the host key to known_hosts, then retry.
    </Alert>
  )
}
