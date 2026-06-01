import { Stack, Typography, Box } from "@mui/material"
import FolderIcon from "@mui/icons-material/Folder"
import TerminalIcon from "@mui/icons-material/Terminal"
import BarChartIcon from "@mui/icons-material/BarChart"
import SmartToyIcon from "@mui/icons-material/SmartToy"
import { alpha } from "@mui/material/styles"
import { SidebarIconButton } from "./SidebarIconButton.js"
import { memo } from "react"

type SidebarView = "projects" | "session" | "stats" | "ai_logs"

interface SidebarHeaderProps {
  activeView: SidebarView
  onViewChange: (view: SidebarView) => void
}

const NAV_ITEMS: { view: SidebarView; Icon: typeof FolderIcon; label: string; testId: string }[] = [
  { view: "projects", Icon: FolderIcon, label: "Projects", testId: "open-projects-button" },
  { view: "session", Icon: TerminalIcon, label: "Session", testId: "open-session-button" },
  { view: "stats", Icon: BarChartIcon, label: "Analysis", testId: "open-stats-button" },
  { view: "ai_logs", Icon: SmartToyIcon, label: "AI Logs", testId: "open-ai-logs-button" },
]

export const SidebarHeader = memo(function SidebarHeader({ activeView, onViewChange }: SidebarHeaderProps) {
  return (
    <Box
      className="sidebar-header"
      sx={{
        minHeight: 48,
        display: "flex",
        alignItems: "center",
        px: "var(--spacing-lg)",
        borderBottom: "1px solid",
        borderColor: "divider",
        boxShadow: "var(--shadow-header-bottom)",
        background: (theme) =>
          theme.palette.mode === "dark"
            ? "linear-gradient(to bottom, rgba(255,255,255,0.03) 0%, transparent 100%)"
            : "linear-gradient(to bottom, rgba(255,255,255,0.9) 0%, transparent 100%)",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", width: "100%", gap: 0.5 }}
      >
        {/* Brand */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
          <Box
            className="sidebar-brand-glyph"
            sx={{
              width: 22,
              height: 22,
              borderRadius: "6px",
              background: "var(--color-accent-gradient)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              boxShadow: (theme) =>
                theme.palette.mode === "dark"
                  ? "0 2px 8px rgba(107, 130, 245, 0.4)"
                  : "0 2px 8px rgba(79, 107, 237, 0.3)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <rect x="1" y="1" width="4" height="4" rx="1" fill="white" fillOpacity="0.9" />
              <rect x="7" y="1" width="4" height="4" rx="1" fill="white" fillOpacity="0.6" />
              <rect x="1" y="7" width="4" height="4" rx="1" fill="white" fillOpacity="0.6" />
              <rect x="7" y="7" width="4" height="4" rx="1" fill="white" fillOpacity="0.9" />
            </svg>
          </Box>
          <Typography
            className="sidebar-brand"
            variant="subtitle1"
            sx={{
              fontFamily: "var(--font-display)",
              fontSize: "var(--font-size-md)",
              fontWeight: "var(--font-weight-bold)",
              background: "var(--color-accent-gradient)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              flexShrink: 0,
              lineHeight: 1,
            }}
          >
            Wmux
          </Typography>
        </Box>

        {/* Nav view tabs — pill style with active indicator */}
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.25 }}>
          {NAV_ITEMS.map(({ view, Icon, label, testId }) => {
            const isActive = activeView === view
            return (
              <Box
                key={view}
                sx={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <SidebarIconButton
                  className="sidebar-header-action"
                  icon={Icon}
                  active={isActive}
                  onClick={() => onViewChange(view)}
                  data-testid={testId}
                  aria-label={label}
                  aria-pressed={isActive}
                  title={label}
                  sx={{
                    color: isActive ? "primary.main" : "text.secondary",
                    bgcolor: isActive
                      ? (theme) => alpha(theme.palette.primary.main, 0.1)
                      : "transparent",
                    transition:
                      "color var(--transition-base), background-color var(--transition-base), transform var(--transition-fast)",
                    "&:hover": {
                      color: "primary.main",
                      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                      transform: "translateY(-1px)",
                    },
                    "&:active": { transform: "translateY(0)" },
                  }}
                />
                {/* Active bottom indicator */}
                <Box
                  sx={{
                    position: "absolute",
                    bottom: -4,
                    left: "50%",
                    transform: isActive
                      ? "translateX(-50%) scaleX(1)"
                      : "translateX(-50%) scaleX(0)",
                    width: 16,
                    height: 2.5,
                    borderRadius: "var(--radius-full)",
                    background: "var(--color-accent-gradient)",
                    transition: "transform var(--transition-spring)",
                    transformOrigin: "center",
                  }}
                />
              </Box>
            )
          })}
        </Stack>
      </Stack>
    </Box>
  )
})
