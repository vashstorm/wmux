import { useState, useEffect } from "react"
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Typography,
  Box,
} from "@mui/material"
import {
  createConnection,
  updateConnection,
  listConnectionHealth,
  connectionDisplayName,
} from "../api/client.js"
import { getErrorMessage } from "../api/errors.js"
import { useAppState } from "../state/store.js"

export function NewConnectionForm() {
  const {
    showNewConnectionForm,
    setShowNewConnectionForm,
    editingConnection,
    setEditingConnection,
    setConnections,
    connections,
    setLoading,
    setError,
    setConnectionHealth,
  } = useAppState()
  const [type, setType] = useState<"local" | "ssh">("local")
  const [host, setHost] = useState("")
  const [port, setPort] = useState("")
  const [user, setUser] = useState("")
  const [privateKeyPath, setPrivateKeyPath] = useState("")
  const [knownHostsPath, setKnownHostsPath] = useState("")

  const isEditMode = editingConnection !== null
  const show = showNewConnectionForm || !!editingConnection

  useEffect(() => {
    if (editingConnection) {
      setType(editingConnection.type as "local" | "ssh")
      setHost(editingConnection.host ?? "")
      setPort(editingConnection.port ? String(editingConnection.port) : "")
      setUser(editingConnection.user ?? "")
      setPrivateKeyPath(editingConnection.privateKeyPath ?? "")
      setKnownHostsPath(editingConnection.knownHostsPath ?? "")
    } else {
      setType("local")
      setHost("")
      setPort("")
      setUser("")
      setPrivateKeyPath("")
      setKnownHostsPath("")
    }
  }, [editingConnection])

  const handleClose = () => {
    setShowNewConnectionForm(false)
    setEditingConnection(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading("creatingConnection", true)
    setError(null)

    try {
      const payload: {
        type: string
        host?: string
        port?: number
        user?: string
        privateKeyPath?: string
        knownHostsPath?: string
      } = {
        type,
      }

      if (type === "ssh") {
        if (host.trim()) payload.host = host.trim()
        if (port.trim()) payload.port = Number.parseInt(port.trim(), 10)
        if (user.trim()) payload.user = user.trim()
        if (privateKeyPath.trim()) payload.privateKeyPath = privateKeyPath.trim()
        if (knownHostsPath.trim()) payload.knownHostsPath = knownHostsPath.trim()
      }

      if (isEditMode) {
        const updated = await updateConnection(editingConnection.targetName, {
          ...editingConnection,
          ...payload,
          targetName: editingConnection.targetName,
        })
        setConnections(
          connections.map((c) => (c.targetName === editingConnection.targetName ? updated : c)),
        )
      } else {
        const newConnection = await createConnection(payload)
        setConnections([...connections, newConnection])
      }

      handleClose()

      try {
        const healthData = await listConnectionHealth()
        const healthMap: Record<
          string,
          {
            targetName: string
            status: "online" | "offline"
            checkedAt: string
            errorCode?: string
            message?: string
          }
        > = {}
        for (const h of healthData) {
          healthMap[h.targetName] = h
        }
        setConnectionHealth(healthMap)
      } catch {
        // non-critical
      }
    } catch (err) {
      if (err instanceof Error && "code" in err) {
        const apiErr = err as { code: string; message: string }
        setError({ code: apiErr.code, message: getErrorMessage(apiErr.code, apiErr.message) })
      } else {
        setError({
          code: "unknown_error",
          message: err instanceof Error ? err.message : "Unknown error",
        })
      }
    } finally {
      setLoading("creatingConnection", false)
    }
  }

  const computedName = type === "local" ? "local" : host.trim() || "ssh"

  return (
    <Dialog
      open={show}
      onClose={handleClose}
      fullWidth
      maxWidth="sm"
      data-testid="new-connection-form"
    >
      <DialogTitle>{isEditMode ? "Edit Connection" : "New Connection"}</DialogTitle>
      <DialogContent dividers>
        <Box
          component="form"
          onSubmit={handleSubmit}
          sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}
        >
          <Box sx={{ mb: 1 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Connection
            </Typography>
            <Typography variant="body1" data-testid="computed-connection-name">
              {computedName}
            </Typography>
          </Box>

          <FormControl fullWidth size="small">
            <InputLabel id="conn-type-label">Type</InputLabel>
            <Select
              labelId="conn-type-label"
              id="conn-type"
              value={type}
              label="Type"
              onChange={(e) => setType(e.target.value as "local" | "ssh")}
              data-testid="connection-type-select"
            >
              <MenuItem value="local">Local</MenuItem>
              <MenuItem value="ssh">SSH</MenuItem>
            </Select>
          </FormControl>

          {type === "ssh" && (
            <>
              <TextField
                id="conn-host"
                label="Host *"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="example.com"
                required={type === "ssh"}
                fullWidth
                size="small"
                data-testid="connection-host-input"
              />

              <TextField
                id="conn-port"
                label="Port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                fullWidth
                size="small"
                data-testid="connection-port-input"
              />

              <TextField
                id="conn-user"
                label="User *"
                type="text"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="root"
                required={type === "ssh"}
                fullWidth
                size="small"
                data-testid="connection-user-input"
              />

              <TextField
                id="conn-key"
                label="Private Key Path"
                type="text"
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
                placeholder="~/.ssh/id_rsa"
                fullWidth
                size="small"
                data-testid="connection-key-input"
              />

              <TextField
                id="conn-known-hosts"
                label="Known Hosts Path"
                type="text"
                value={knownHostsPath}
                onChange={(e) => setKnownHostsPath(e.target.value)}
                placeholder="~/.ssh/known_hosts"
                fullWidth
                size="small"
                data-testid="connection-known-hosts-input"
              />
            </>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button type="button" onClick={handleClose} data-testid="cancel-connection">
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          onClick={handleSubmit}
          data-testid="save-connection"
          disabled={type === "ssh" && (!host.trim() || !user.trim())}
        >
          {isEditMode ? "Update" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
