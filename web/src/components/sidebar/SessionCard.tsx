import { useRef, useState, memo } from "react"
import { Box, Stack, Typography, TextField, ListItemButton, Tooltip } from "@mui/material"
import EditIcon from "@mui/icons-material/Edit"
import DeleteIcon from "@mui/icons-material/Delete"
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder"
import FolderIcon from "@mui/icons-material/Folder"
import FolderOpenIcon from "@mui/icons-material/FolderOpen"
import TerminalIcon from "@mui/icons-material/Terminal"
import { alpha } from "@mui/material/styles"
import type { SessionInfoData } from "../../api/client.js"
import { SidebarIconButton } from "./SidebarIconButton.js"

interface SessionCardProps {
  session: SessionInfoData
  isSelected: boolean
  onOpen: (sessionName: string) => void
  onRename: (sessionName: string) => void
  onKill: (sessionName: string) => void
  onSubmitRename: (sessionName: string, newName: string) => Promise<void>
  onBuildProject: (sessionName: string) => void
  hasProject?: boolean
}

export const SessionCard = memo(function SessionCard({
  session,
  isSelected,
  onOpen,
  onRename,
  onKill,
  onSubmitRename,
  onBuildProject,
  hasProject = false,
}: SessionCardProps) {
  const sname = session.name ?? ""
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState("")
  const nameRef = useRef<HTMLSpanElement | null>(null)
  const [isNameOverflowing, setIsNameOverflowing] = useState(false)

  if (!sname) return null

  const handleStartRename = () => {
    onRename(sname)
    setIsRenaming(true)
    setRenameValue(sname)
  }

  const handleSubmitRename = async () => {
    const newName = renameValue.trim()
    if (!newName || newName === sname) {
      setIsRenaming(false)
      setRenameValue("")
      return
    }
    await onSubmitRename(sname, newName)
    setIsRenaming(false)
    setRenameValue("")
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmitRename()
    if (e.key === "Escape") {
      setIsRenaming(false)
      setRenameValue("")
    }
  }

  const updateNameOverflow = () => {
    const nameElement = nameRef.current
    if (!nameElement) return
    setIsNameOverflowing(nameElement.scrollWidth > nameElement.clientWidth + 1)
  }

  return (
    <Box
      className={`session-card${isSelected ? " is-selected" : ""}`}
      data-testid={`session-card-${sname}`}
      sx={{
        width: "100%",
        borderRadius: "var(--radius-sm)",
        border: "1px solid",
        borderColor: isSelected
          ? "var(--color-session-card-selected-border)"
          : "var(--color-session-card-border)",
        bgcolor: isSelected ? "var(--color-session-card-selected)" : "var(--color-session-card-bg)",
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
        position: "relative",
        overflow: "hidden",
        "&:hover": {
          bgcolor: isSelected
            ? "var(--color-session-card-selected)"
            : "var(--color-session-card-hover)",
          borderColor: isSelected
            ? "var(--color-session-card-selected-border)"
            : "var(--color-surface-border-hover)",
          boxShadow: isSelected ? "var(--color-session-card-selected-glow)" : "var(--shadow-sm)",
          transform: "translateX(2px)",
        },
        "&:hover .session-card-icon": {
          transform: "scale(1.08)",
        },
      }}
    >
      {isRenaming ? (
        <Box
          className="session-card-rename"
          sx={{
            p: "var(--spacing-sm)",
            animation: "fadeIn 150ms ease",
          }}
        >
          <TextField
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={handleSubmitRename}
            onKeyDown={handleRenameKeyDown}
            autoFocus
            className="session-rename-input"
            data-testid={`rename-session-input-${sname}`}
            sx={{
              "& .MuiInputBase-root": {
                bgcolor: "background.paper",
                borderRadius: "var(--radius-sm)",
                fontSize: "var(--font-size-xs)",
                fontFamily: "var(--font-mono)",
                color: "text.primary",
                border: "1px solid",
                borderColor: "primary.main",
                boxShadow: "0 0 0 3px var(--color-accent-subtle)",
                "& fieldset": { border: "none" },
              },
            }}
          />
        </Box>
      ) : (
        <ListItemButton
          className="session-card-body"
          onClick={() => onOpen(sname)}
          data-testid={`session-open-${sname}`}
          selected={isSelected}
          sx={{
            flexDirection: "row",
            alignItems: "center",
            gap: 1.25,
            py: 1,
            px: 1.25,
            minWidth: 0,
            borderRadius: "var(--radius-sm)",
            bgcolor: "transparent",
            transition: "background-color var(--transition-fast)",
            "&.Mui-selected": { bgcolor: "transparent" },
            "&.Mui-selected:hover": { bgcolor: "transparent" },
            "&:hover": { bgcolor: "transparent" },
          }}
        >
          {/* Prompt glyph + name */}
          <Box
            sx={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 1.25,
              pr: 9,
            }}
          >
            <Box
              className="session-card-icon"
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
              {hasProject ? (
                <FolderIcon
                  data-testid="session-icon-project"
                  sx={{
                    fontSize: 16,
                    color: isSelected ? "#fff" : "var(--color-text-muted)",
                    transition: "color var(--transition-base)",
                  }}
                />
              ) : (
                <TerminalIcon
                  data-testid="session-icon-terminal"
                  sx={{
                    fontSize: 16,
                    color: isSelected ? "#fff" : "var(--color-text-muted)",
                    transition: "color var(--transition-base)",
                  }}
                />
              )}
            </Box>
            <Tooltip
              title={isNameOverflowing ? sname : ""}
              placement="top-start"
              enterDelay={800}
              disableInteractive
              arrow
              slotProps={{
                popper: {
                  modifiers: [
                    {
                      name: "preventOverflow",
                      options: {
                        boundary: "viewport",
                        padding: 8,
                      },
                    },
                  ],
                },
                tooltip: {
                  sx: {
                    maxWidth: "min(260px, calc(100vw - 16px))",
                    overflowWrap: "anywhere",
                  },
                },
              }}
            >
              <Typography
                ref={nameRef}
                className="session-card-name"
                variant="body2"
                onMouseEnter={updateNameOverflow}
                onFocus={updateNameOverflow}
                sx={{
                  fontSize: "var(--font-size-sm)",
                  fontWeight: isSelected
                    ? "var(--font-weight-semibold)"
                    : "var(--font-weight-medium)",
                  color: isSelected ? "var(--color-accent)" : "var(--color-text)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  lineHeight: 1.3,
                  flex: 1,
                  minWidth: 0,
                  transition: "color var(--transition-base), font-weight var(--transition-base)",
                  ".session-card:hover &": {
                    color: isSelected ? "var(--color-accent)" : "var(--color-text)",
                  },
                }}
                noWrap
              >
                {sname}
              </Typography>
            </Tooltip>
          </Box>

          {/* Compact timestamp */}
          {session.intelligenceUpdatedAt && (
            <Typography
              className="session-card-time"
              component="span"
              sx={{
                flexShrink: 0,
                fontSize: "var(--font-size-2xs)",
                color: "text.disabled",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "0.01em",
                lineHeight: 1,
                transition: "opacity var(--transition-base)",
                ".session-card:hover &": { opacity: 0 },
              }}
            >
              {formatRelativeTime(session.intelligenceUpdatedAt)}
            </Typography>
          )}

          {/* Hover action buttons — visible on hover */}
          <Stack
            direction="row"
            className="session-card-actions"
            spacing={0.25}
            sx={{
              position: "absolute",
              right: 8,
              opacity: 0,
              pointerEvents: "none",
              transition: "opacity var(--transition-fast)",
              ".session-card:hover &": {
                opacity: 1,
                pointerEvents: "auto",
              },
            }}
          >
            <SidebarIconButton
              className="session-action-btn"
              icon={hasProject ? FolderOpenIcon : CreateNewFolderIcon}
              variant="row"
              onClick={(e) => {
                e.stopPropagation()
                onBuildProject(sname)
              }}
              aria-label={hasProject ? `Open project from ${sname}` : `Build project from ${sname}`}
              title={hasProject ? "Open project" : "Build project"}
              data-testid={`build-project-${sname}`}
              sx={{
                width: 24,
                height: 24,
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-muted)",
                "& .MuiSvgIcon-root": { fontSize: 13 },
                "&:hover": {
                  bgcolor: "var(--color-surface-hover)",
                  color: "var(--color-accent)",
                },
              }}
            />
            <SidebarIconButton
              className="session-action-btn"
              icon={EditIcon}
              variant="row"
              onClick={(e) => {
                e.stopPropagation()
                handleStartRename()
              }}
              aria-label={`Rename ${sname}`}
              title="Rename"
              data-testid={`rename-session-${sname}`}
              sx={{
                width: 24,
                height: 24,
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-muted)",
                "& .MuiSvgIcon-root": { fontSize: 13 },
                "&:hover": {
                  bgcolor: "var(--color-surface-hover)",
                  color: "var(--color-accent)",
                },
              }}
            />
            <SidebarIconButton
              className="session-action-btn session-action-danger"
              icon={DeleteIcon}
              variant="row"
              danger
              onClick={(e) => {
                e.stopPropagation()
                onKill(sname)
              }}
              aria-label={`Kill ${sname}`}
              title="Kill session"
              data-testid={`kill-session-${sname}`}
              sx={{
                width: 24,
                height: 24,
                borderRadius: "var(--radius-sm)",
                color: "var(--color-text-muted)",
                "& .MuiSvgIcon-root": { fontSize: 13 },
                "&:hover": { bgcolor: "rgba(239,68,68,0.12)", color: "var(--color-danger)" },
              }}
            />
          </Stack>
        </ListItemButton>
      )}
    </Box>
  )
})

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHour = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHour / 24)

  if (diffSec < 60) return "now"
  if (diffMin < 60) return `${diffMin}m`
  if (diffHour < 24) return `${diffHour}h`
  if (diffDay < 7) return `${diffDay}d`
  return date.toLocaleDateString()
}
