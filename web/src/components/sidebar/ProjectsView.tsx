import { useState, useEffect, useCallback, useMemo } from "react"
import {
  Box,
  Typography,
  IconButton,
  TextField,
  Button,
  Stack,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControlLabel,
  Checkbox,
  Chip,
} from "@mui/material"
import AddIcon from "@mui/icons-material/Add"
import { ProjectSearch } from "./ProjectSearch.js"
import { SidebarIconButton } from "./SidebarIconButton.js"
import EditIcon from "@mui/icons-material/Edit"
import DeleteIcon from "@mui/icons-material/Delete"
import CloseIcon from "@mui/icons-material/Close"
import FolderOpenIcon from "@mui/icons-material/FolderOpen"
import TerminalIcon from "@mui/icons-material/Terminal"
import { useAppState } from "../../state/store.js"
import {
  listProjects,
  createProject,
  updateProject,
  deleteProject,
  getProject,
  createSession,
  listSessions,
  listWindows,
  listPanes,
} from "../../api/client.js"
import type { Project, NewProject, WindowInfo } from "../../api/client.js"
import { ApiError } from "../../api/errors.js"

function projectSessionName(project: Project): string {
  return (project.sessionName || project.name).trim()
}

const SESSION_WORKSPACE_LOAD_ATTEMPTS = 5
const SESSION_WORKSPACE_RETRY_DELAY_MS = 80

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function ProjectsView() {
  const {
    selectedProject,
    setSelectedProject,
    selectedPane,
    selectedTargetName,
    setSessions,
    setSelectedPane,
    setWindows,
    setPanes,
  } = useAppState()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionActionProjectId, setSessionActionProjectId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState("")
  const [formPath, setFormPath] = useState("")
  const [formDescription, setFormDescription] = useState("")

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null)
  const [killSessionCheckbox, setKillSessionCheckbox] = useState(false)

  const [searchQuery, setSearchQuery] = useState("")

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return projects
    const query = searchQuery.toLowerCase()
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        (p.path && p.path.toLowerCase().includes(query)) ||
        (p.description && p.description.toLowerCase().includes(query)),
    )
  }, [projects, searchQuery])

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await listProjects()
      setProjects(data)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load projects")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  const resetForm = () => {
    setFormName("")
    setFormPath("")
    setFormDescription("")
    setShowForm(false)
    setEditingId(null)
  }

  const handleOpenProjectDetails = (project: Project) => {
    setSelectedProject(project)
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formName.trim()) return
    setError(null)
    try {
      const created = await createProject({
        name: formName.trim(),
        path: formPath.trim(),
        description: formDescription.trim(),
      })
      resetForm()
      await loadProjects()
      setSelectedProject(created)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create project")
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    setError(null)
    try {
      await updateProject(editingId, {
        name: formName.trim() || undefined,
        path: formPath.trim(),
        description: formDescription.trim(),
      })
      await refreshSelectedProject(editingId)
      resetForm()
      await loadProjects()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update project")
    }
  }

  const handleDeleteClick = (project: Project) => {
    setProjectToDelete(project)
    setKillSessionCheckbox(false)
    setDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return
    setError(null)
    try {
      await deleteProject(projectToDelete.id, killSessionCheckbox)
      if (selectedProject?.id === projectToDelete.id) {
        setSelectedProject(null)
      }
      await loadProjects()
      setDeleteDialogOpen(false)
      setProjectToDelete(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete project")
      setDeleteDialogOpen(false)
      setProjectToDelete(null)
    }
  }

  const openSession = useCallback(
    async (targetName: string, sessionName: string) => {
      let windows: WindowInfo[] = []
      for (let attempt = 0; attempt < SESSION_WORKSPACE_LOAD_ATTEMPTS; attempt++) {
        const windowsResponse = await listWindows(targetName, sessionName)
        windows = windowsResponse.data ?? []
        const initialWindow = windows[0]

        if (initialWindow) {
          const panesResponse = await listPanes(targetName, sessionName, initialWindow.ID)
          const panes = panesResponse.data ?? []
          if (panes.length > 0) {
            setWindows(targetName, sessionName, windows)
            setPanes(targetName, sessionName, initialWindow.ID, panes)

            const initialPane = panes[0]
            setSelectedPane({
              targetName,
              session: sessionName,
              window: initialWindow.ID,
              pane: initialPane?.ID,
            })
            return
          }
        }

        if (attempt < SESSION_WORKSPACE_LOAD_ATTEMPTS - 1) {
          await delay(SESSION_WORKSPACE_RETRY_DELAY_MS)
        }
      }

      if (windows.length > 0) {
        setWindows(targetName, sessionName, windows)
      }
      setSelectedPane({ targetName, session: sessionName })
    },
    [setPanes, setSelectedPane, setWindows],
  )

  const handleOpenOrCreateSession = useCallback(
    async (project: Project) => {
      if (sessionActionProjectId !== null) return

      if (!selectedTargetName) {
        setError("No active connection selected")
        return
      }

      const sessionName = projectSessionName(project)
      if (!sessionName) {
        setError("Project session name cannot be empty")
        return
      }

      setSessionActionProjectId(project.id)
      setError(null)
      try {
        const sessionsResponse = await listSessions(selectedTargetName)
        const sessions = sessionsResponse.data ?? []
        setSessions(selectedTargetName, sessions)

        const exists = sessions.some(
          (session) => session.name === sessionName || session.id === sessionName,
        )
        if (!exists) {
          try {
            await createSession(selectedTargetName, sessionName)
          } catch (err) {
            if (!(err instanceof ApiError && err.code === "conflict")) {
              throw err
            }
          }

          const refreshedSessions = await listSessions(selectedTargetName)
          setSessions(selectedTargetName, refreshedSessions.data ?? [])
        }

        await openSession(selectedTargetName, sessionName)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to open project session")
      } finally {
        setSessionActionProjectId(null)
      }
    },
    [openSession, selectedTargetName, sessionActionProjectId, setSessions],
  )

  const refreshSelectedProject = useCallback(
    async (id: string) => {
      if (!selectedProject || selectedProject.id !== id) return
      try {
        const updated = await getProject(id)
        setSelectedProject(updated)
      } catch {
        // stale reads are acceptable
      }
    },
    [selectedProject, setSelectedProject],
  )

  const startEdit = (project: Project) => {
    setEditingId(project.id)
    setFormName(project.name)
    setFormPath(project.path)
    setFormDescription(project.description)
    setShowForm(true)
  }

  return (
    <Box data-testid="projects-view" sx={{ minHeight: 1 }}>
      <ProjectSearch value={searchQuery} onChange={setSearchQuery} />

      <Collapse in={showForm} timeout={200} unmountOnExit>
        <Box
          component="form"
          onSubmit={editingId ? handleUpdate : handleCreate}
          data-testid="project-form"
          sx={{
            mb: 1,
            p: 1,
            bgcolor: "background.default",
            borderRadius: "var(--radius-sm)",
            border: "1px solid",
            borderColor: "divider",
          }}
        >
          <TextField
            size="small"
            fullWidth
            placeholder="Project name"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            data-testid="project-name-input"
            sx={{ mb: 0.5 }}
          />
          <TextField
            size="small"
            fullWidth
            placeholder="Path (optional)"
            value={formPath}
            onChange={(e) => setFormPath(e.target.value)}
            data-testid="project-path-input"
            sx={{ mb: 0.5 }}
          />
          <TextField
            size="small"
            fullWidth
            placeholder="Description (optional)"
            value={formDescription}
            onChange={(e) => setFormDescription(e.target.value)}
            data-testid="project-description-input"
            sx={{ mb: 0.5 }}
          />
          <Stack direction="row" spacing={0.5}>
            <Button
              type="submit"
              size="small"
              variant="contained"
              data-testid="project-submit-button"
            >
              {editingId ? "Update" : "Create"}
            </Button>
            <Button size="small" onClick={resetForm}>
              Cancel
            </Button>
          </Stack>
        </Box>
      </Collapse>

      {error && (
        <Typography
          color="error"
          variant="caption"
          data-testid="projects-error"
          sx={{ display: "block", mb: 1 }}
        >
          {error}
        </Typography>
      )}

      <Box className="sidebar-projects-section" sx={{ px: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          className="sidebar-projects-header"
          sx={{
            alignItems: "center",
            justifyContent: "space-between",
            py: "var(--spacing-xs)",
            px: "var(--spacing-sm)",
            mb: 0.5,
          }}
        >
          <Typography
            className="sidebar-section-label"
            variant="caption"
            sx={{
              fontSize: "var(--font-size-xs)",
              fontWeight: "var(--font-weight-semibold)",
              color: "text.secondary",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Projects
          </Typography>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
            {filteredProjects.length > 0 && (
              <Chip
                label={filteredProjects.length}
                size="small"
                className="sidebar-project-count"
                sx={{
                  fontSize: "var(--font-size-xs)",
                  fontWeight: "var(--font-weight-semibold)",
                  color: "text.disabled",
                  bgcolor: "background.default",
                  border: "1px solid",
                  borderColor: "divider",
                  minHeight: 20,
                  height: 20,
                }}
              />
            )}
            <SidebarIconButton
              className="sidebar-project-create-button"
              icon={showForm ? CloseIcon : AddIcon}
              variant="compact"
              onClick={() => {
                resetForm()
                setShowForm(!showForm)
              }}
              data-testid="projects-add-button"
              aria-label="Add project"
              aria-expanded={showForm}
              title="Add project"
              sx={{
                bgcolor: "background.default",
                border: "1px solid",
                borderColor: "divider",
                color: "text.secondary",
                "&:hover": {
                  bgcolor: "action.hover",
                  color: "primary.main",
                  borderColor: (theme) => `rgba(${theme.palette.primary.main}, 0.3)`,
                },
              }}
            />
          </Stack>
        </Stack>

        {loading && projects.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: "center", py: 2 }}>
            Loading...
          </Typography>
        ) : projects.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="projects-empty"
            sx={{ textAlign: "center", py: 2 }}
          >
            No projects yet
          </Typography>
        ) : filteredProjects.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="projects-search-empty"
            sx={{ textAlign: "center", py: 2 }}
          >
            No projects match your search
          </Typography>
        ) : (
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {filteredProjects.map((project) => {
              const sessionName = projectSessionName(project)
              const isSelected =
                selectedProject?.id === project.id ||
                (selectedPane?.targetName === selectedTargetName &&
                  selectedPane.session === sessionName)
              return (
                <Box
                  key={project.id}
                  data-testid={`project-item-${project.id}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`Open project details for ${project.name}`}
                  aria-busy={sessionActionProjectId === project.id}
                  onClick={() => handleOpenProjectDetails(project)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      handleOpenProjectDetails(project)
                    }
                  }}
                  sx={{
                    position: "relative",
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    px: 1.25,
                    py: 1,
                    borderRadius: "var(--radius-sm)",
                    cursor: sessionActionProjectId === project.id ? "progress" : "pointer",
                    border: "1px solid",
                    borderColor: isSelected
                      ? "var(--color-session-card-selected-border)"
                      : "var(--color-session-card-border)",
                    bgcolor: isSelected
                      ? "var(--color-session-card-selected)"
                      : "var(--color-session-card-bg)",
                    backgroundImage: isSelected
                      ? "linear-gradient(135deg, var(--color-accent-subtle) 0%, transparent 60%)"
                      : "none",
                    boxShadow: isSelected ? "var(--color-session-card-selected-glow)" : "none",
                    "&::before": {
                      content: '""',
                      position: "absolute",
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: "3px",
                      bgcolor: isSelected ? "var(--color-accent)" : "transparent",
                      transition: "background-color var(--transition-base)",
                    },
                    transition: "all var(--transition-base)",
                    "&:hover": {
                      bgcolor: isSelected
                        ? "var(--color-session-card-selected)"
                        : "var(--color-session-card-hover)",
                      borderColor: isSelected
                        ? "var(--color-session-card-selected-border)"
                        : "var(--color-surface-border-hover)",
                      boxShadow: isSelected
                        ? "var(--color-session-card-selected-glow)"
                        : "var(--shadow-sm)",
                      transform: "translateX(2px)",
                      "& .project-actions": { opacity: 1, pointerEvents: "auto" },
                    },
                    "&:hover .project-icon": {
                      transform: "scale(1.08)",
                    },
                  }}
                >
                  {/* Folder icon avatar */}
                  <Box
                    className="project-icon"
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: "var(--radius-sm)",
                      background: isSelected
                        ? "var(--color-accent-gradient)"
                        : "var(--color-surface)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      transition:
                        "transform var(--transition-fast), background var(--transition-base)",
                      boxShadow: isSelected ? "var(--glow-accent)" : "none",
                    }}
                  >
                    <FolderOpenIcon
                      sx={{
                        fontSize: 16,
                        color: isSelected ? "#fff" : "var(--color-text-muted)",
                        transition: "color var(--transition-base)",
                      }}
                    />
                  </Box>

                  {/* Text */}
                  <Box sx={{ flex: 1, minWidth: 0, pr: 9 }}>
                    <Typography
                      sx={{
                        fontSize: "var(--font-size-sm)",
                        fontWeight: isSelected
                          ? "var(--font-weight-semibold)"
                          : "var(--font-weight-medium)",
                        color: isSelected ? "var(--color-accent)" : "var(--color-text)",
                        lineHeight: 1.3,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        transition: "color var(--transition-base)",
                      }}
                    >
                      {project.name}
                    </Typography>
                    {project.path && (
                      <Typography
                        sx={{
                          fontSize: "var(--font-size-2xs)",
                          color: "var(--color-text-muted)",
                          lineHeight: 1.3,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          mt: 0.25,
                        }}
                      >
                        {project.path}
                      </Typography>
                    )}
                  </Box>

                  {/* Action buttons (visible on hover) */}
                  <Stack
                    className="project-actions"
                    direction="row"
                    spacing={0.25}
                    sx={{
                      position: "absolute",
                      right: 8,
                      opacity: 0,
                      pointerEvents: "none",
                      transition: "opacity var(--transition-fast)",
                    }}
                  >
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleOpenOrCreateSession(project)
                      }}
                      data-testid={`project-open-session-${project.id}`}
                      aria-label={`Open or create session for ${project.name}`}
                      title="Open or create session"
                      disabled={sessionActionProjectId !== null}
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: "var(--radius-sm)",
                        color: "var(--color-text-muted)",
                        "&:hover": {
                          bgcolor: "var(--color-surface-hover)",
                          color: "var(--color-accent)",
                        },
                      }}
                    >
                      <TerminalIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        startEdit(project)
                      }}
                      data-testid={`project-edit-${project.id}`}
                      aria-label="Edit"
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: "var(--radius-sm)",
                        color: "var(--color-text-muted)",
                        "&:hover": {
                          bgcolor: "var(--color-surface-hover)",
                          color: "var(--color-accent)",
                        },
                      }}
                    >
                      <EditIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeleteClick(project)
                      }}
                      data-testid={`project-delete-${project.id}`}
                      aria-label="Delete"
                      sx={{
                        width: 24,
                        height: 24,
                        borderRadius: "var(--radius-sm)",
                        color: "var(--color-text-muted)",
                        "&:hover": {
                          bgcolor: "rgba(239,68,68,0.12)",
                          color: "var(--color-danger)",
                        },
                      }}
                    >
                      <DeleteIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Stack>
                </Box>
              )
            })}
          </Stack>
        )}
      </Box>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        slotProps={{
          paper: {
            sx: {
              bgcolor: "background.paper",
              backgroundImage: "none",
              borderRadius: "var(--radius-md)",
              border: "1px solid",
              borderColor: "divider",
              p: 1.5,
              minWidth: 320,
            },
          },
        }}
        data-testid="delete-project-dialog"
      >
        <DialogTitle
          sx={{
            p: 0,
            mb: 1,
            fontSize: "var(--font-size-base)",
            fontWeight: "var(--font-weight-semibold)",
          }}
        >
          Delete Project
        </DialogTitle>
        <DialogContent sx={{ p: 0, mb: 2 }}>
          <DialogContentText
            sx={{ fontSize: "var(--font-size-sm)", color: "text.secondary", mb: 2 }}
          >
            Are you sure you want to delete project <strong>{projectToDelete?.name}</strong>? This
            action cannot be undone.
          </DialogContentText>
          {projectToDelete?.sessionName && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={killSessionCheckbox}
                  onChange={(e) => setKillSessionCheckbox(e.target.checked)}
                  size="small"
                  sx={{
                    color: "primary.main",
                    "&.Mui-checked": {
                      color: "primary.main",
                    },
                  }}
                  data-testid="kill-session-checkbox"
                />
              }
              label={
                <Typography variant="body2" sx={{ fontSize: "var(--font-size-sm)" }}>
                  Also terminate active tmux session <code>{projectToDelete.sessionName}</code>
                </Typography>
              }
            />
          )}
        </DialogContent>
        <DialogActions sx={{ p: 0, justifyContent: "flex-end", gap: 1 }}>
          <Button
            onClick={() => setDeleteDialogOpen(false)}
            size="small"
            sx={{
              textTransform: "none",
              fontWeight: "var(--font-weight-medium)",
              color: "text.secondary",
              "&:hover": {
                bgcolor: "action.hover",
              },
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDelete}
            variant="contained"
            color="error"
            size="small"
            sx={{
              textTransform: "none",
              fontWeight: "var(--font-weight-semibold)",
              boxShadow: "none",
              "&:hover": {
                boxShadow: "none",
                bgcolor: "error.dark",
              },
            }}
            data-testid="confirm-delete-button"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
