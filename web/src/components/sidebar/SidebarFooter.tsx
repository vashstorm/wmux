import { Badge, Box, Stack, Tooltip } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import DescriptionIcon from "@mui/icons-material/Description";
import { SidebarIconButton } from "./SidebarIconButton.js";

interface SidebarFooterProps {
  errorLogCount: number;
  onOpenSettings: () => void;
  onOpenErrorLogs: () => void;
  themeToggle?: React.ReactNode;
  terminalThemeToggle?: React.ReactNode;
}

export function SidebarFooter({
  errorLogCount,
  onOpenSettings,
  onOpenErrorLogs,
  themeToggle,
  terminalThemeToggle,
}: SidebarFooterProps) {
  return (
    <Box
      sx={{
        minHeight: "var(--app-shell-header-height, 42px)",
        display: "flex",
        alignItems: "center",
        px: "var(--spacing-md)",
        borderTop: "1px solid",
        borderColor: "divider",
        flexShrink: 0,
        justifyContent: "flex-end",
        boxShadow: "var(--shadow-footer-top)",
        background: (theme) =>
          theme.palette.mode === "dark"
            ? "linear-gradient(to top, rgba(255,255,255,0.03) 0%, transparent 100%)"
            : "linear-gradient(to top, rgba(255,255,255,0.9) 0%, transparent 100%)",
      }}
    >
      <Stack direction="row" spacing={0.25} sx={{ alignItems: "center" }}>
      <Tooltip title="Settings" arrow placement="top">
        <SidebarIconButton
          icon={SettingsIcon}
          onClick={onOpenSettings}
          data-testid="open-settings-button"
          aria-label="Settings"
          sx={{
            color: "text.secondary",
            transition: "color var(--transition-fast), background-color var(--transition-fast), transform var(--transition-spring)",
            "&:hover": {
              color: "primary.main",
              transform: "rotate(30deg)",
            },
          }}
        />
      </Tooltip>
      <Tooltip title={errorLogCount > 0 ? `Logs (${errorLogCount})` : "Logs"} arrow placement="top">
        <Badge
          badgeContent={errorLogCount > 0 ? (errorLogCount > 99 ? "99+" : errorLogCount) : undefined}
          color="error"
          data-testid="error-logs-badge"
          sx={{
            "& .MuiBadge-badge": {
              bgcolor: "error.main",
              color: "#fff",
              border: (theme) => `1.5px solid ${theme.palette.background.paper}`,
              fontSize: "var(--font-size-2xs)",
              fontWeight: 700,
              minWidth: 16,
              height: 16,
              boxShadow: (theme) =>
                errorLogCount > 0
                  ? `0 0 8px ${theme.palette.error.main}66`
                  : "none",
            },
          }}
        >
          <SidebarIconButton
            className={`sidebar-footer-action sidebar-error-logs-button${errorLogCount > 0 ? " has-badge" : ""}`}
            icon={DescriptionIcon}
            onClick={onOpenErrorLogs}
            data-testid="open-error-logs-button"
            aria-label={errorLogCount > 0 ? `Logs (${errorLogCount})` : "Logs"}
            sx={{
              color: errorLogCount > 0 ? "error.main" : "text.secondary",
              transition: "color var(--transition-fast), transform var(--transition-fast)",
              "&:hover": {
                color: "primary.main",
                transform: "scale(1.05)",
              },
            }}
          />
        </Badge>
      </Tooltip>
      {themeToggle && <>{themeToggle}</>}
      {terminalThemeToggle && <>{terminalThemeToggle}</>}
      </Stack>
    </Box>
  );
}
