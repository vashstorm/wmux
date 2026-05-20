import { Badge, IconButton, Box } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import DescriptionIcon from "@mui/icons-material/Description";
import { alpha } from "@mui/material/styles";

interface SidebarFooterProps {
  errorLogCount: number;
  onOpenSettings: () => void;
  onOpenErrorLogs: () => void;
  themeToggle?: React.ReactNode;
}

export function SidebarFooter({
  errorLogCount,
  onOpenSettings,
  onOpenErrorLogs,
  themeToggle,
}: SidebarFooterProps) {
  return (
    <Box
      sx={{
        minHeight: "var(--app-shell-header-height, 42px)",
        display: "flex",
        alignItems: "center",
        px: "var(--spacing-md)",
        borderTop: 1,
        borderColor: "divider",
        flexShrink: 0,
        justifyContent: "flex-end",
        gap: 1,
        background: (theme) =>
          `linear-gradient(to top, ${alpha(theme.palette.common.white, theme.palette.mode === "dark" ? 0.04 : 0.8)}, transparent)`,
      }}
    >
      <IconButton
        onClick={onOpenSettings}
        data-testid="open-settings-button"
        aria-label="Settings"
        title="Settings"
        size="small"
        sx={{ width: 28, height: 28, color: "text.secondary", "&:hover": { color: "primary.main" } }}
      >
        <SettingsIcon sx={{ fontSize: 16 }} />
      </IconButton>
      <Badge
        badgeContent={errorLogCount > 0 ? (errorLogCount > 99 ? "99+" : errorLogCount) : undefined}
        color="error"
        data-testid="error-logs-badge"
        sx={{
          "& .MuiBadge-badge": {
            bgcolor: "error.main",
            color: "#fff",
            border: (theme) => `1px solid ${theme.palette.background.paper}`,
            fontSize: "9px",
            fontWeight: 700,
            minWidth: 16,
            height: 16,
          },
        }}
      >
        <IconButton
          className={`sidebar-footer-action sidebar-error-logs-button${errorLogCount > 0 ? " has-badge" : ""}`}
          onClick={onOpenErrorLogs}
          data-testid="open-error-logs-button"
          aria-label={errorLogCount > 0 ? `Logs (${errorLogCount})` : "Logs"}
          title={errorLogCount > 0 ? `Logs (${errorLogCount})` : "Logs"}
          size="small"
          sx={{ width: 28, height: 28, color: "text.secondary", "&:hover": { color: "primary.main" } }}
        >
          <DescriptionIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Badge>
      {themeToggle}
    </Box>
  );
}
