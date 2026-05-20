# Sidebar MUI 主题系统重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Sidebar 从 CSS 变量样式迁移到纯 MUI 主题系统，同时拆分为多个独立子组件。

**Architecture:** 保持数据流不变（通过 AppContext），将 UI 拆分为 6 个子组件 + 1 个主容器。样式全部使用 MUI `sx` prop 和主题值，CSS 类名仅保留用于测试选择器。

**Tech Stack:** React 18, MUI v9, TypeScript strict

---

## 文件结构

### 新建文件
- `web/src/components/sidebar/SidebarFooter.tsx` — 底部设置/日志/主题切换
- `web/src/components/sidebar/SessionSearch.tsx` — 搜索输入框
- `web/src/components/sidebar/NewSessionForm.tsx` — 新建会话折叠表单
- `web/src/components/sidebar/SessionCard.tsx` — 单个会话卡片
- `web/src/components/sidebar/SessionList.tsx` — 会话列表容器（含空状态）
- `web/src/components/sidebar/SidebarHeader.tsx` — 顶部品牌 + 视图切换
- `web/src/components/sidebar/index.tsx` — 统一导出

### 修改文件
- `web/src/components/Sidebar.tsx` — 改为重定向文件（从 sidebar/index 导出）
- `web/src/components/sidebar/Sidebar.tsx` — 新的主容器（从原 Sidebar.tsx 重构）
- `web/src/styles/components.css` — 删除 Sidebar 相关 CSS 类
- `web/src/components/Sidebar.test.tsx` — 更新 CSS 类断言

---

## Task 1: 创建 SidebarFooter 组件

**Files:**
- Create: `web/src/components/sidebar/SidebarFooter.tsx`

**Context:** 底部工具栏包含设置按钮、错误日志按钮（带 Badge）、主题切换插槽。

- [ ] **Step 1: 创建文件**

```tsx
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
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/sidebar/SidebarFooter.tsx
git commit -m "feat(sidebar): add SidebarFooter component with MUI styling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: 创建 SessionSearch 组件

**Files:**
- Create: `web/src/components/sidebar/SessionSearch.tsx`

**Context:** 搜索输入框，带 Search 图标。

- [ ] **Step 1: 创建文件**

```tsx
import { TextField, InputAdornment, Box } from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";

interface SessionSearchProps {
  value: string;
  onChange: (value: string) => void;
}

export function SessionSearch({ value, onChange }: SessionSearchProps) {
  return (
    <Box
      sx={{
        py: "var(--spacing-sm)",
        px: "var(--spacing-md)",
        mx: "calc(-1 * var(--spacing-md))",
        display: "flex",
        alignItems: "center",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <TextField
        fullWidth
        size="small"
        placeholder="Search sessions"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid="session-search"
        aria-label="Search sessions"
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
              </InputAdornment>
            ),
          },
        }}
        sx={{
          "& .MuiInputBase-root": {
            pl: 0.5,
            bgcolor: "background.paper",
            borderRadius: 1,
            transition: "box-shadow 200ms ease, border-color 200ms ease",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "divider",
            },
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
            },
            "&.Mui-focused": {
              boxShadow: (theme) => `0 0 0 3px ${alpha(theme.palette.primary.main, 0.1)}`,
            },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
              borderColor: "primary.main",
              borderWidth: 2,
            },
            "& input": {
              color: "text.primary",
              fontSize: "var(--font-size-xs)",
              py: "8px",
            },
            "& input::placeholder": {
              color: "text.disabled",
            },
          },
        }}
      />
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/sidebar/SessionSearch.tsx
git commit -m "feat(sidebar): add SessionSearch component with MUI styling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: 创建 NewSessionForm 组件

**Files:**
- Create: `web/src/components/sidebar/NewSessionForm.tsx`

**Context:** 折叠的新建会话表单，包含输入框和 Cancel/Create 按钮。

- [ ] **Step 1: 创建文件**

```tsx
import { TextField, Button, Stack, Box } from "@mui/material";
import { alpha } from "@mui/material/styles";

interface NewSessionFormProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export function NewSessionForm({ value, onChange, onSubmit, onCancel }: NewSessionFormProps) {
  return (
    <Box
      component="form"
      onSubmit={onSubmit}
      sx={{
        p: "var(--spacing-md)",
        bgcolor: "action.hover",
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        my: "var(--spacing-xs)",
      }}
    >
      <TextField
        fullWidth
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Session name"
        autoFocus
        data-testid="new-session-name-input"
        sx={{
          mb: "var(--spacing-sm)",
          "& .MuiInputBase-root": {
            bgcolor: "background.paper",
            borderRadius: 1,
            fontSize: "var(--font-size-xs)",
            color: "text.primary",
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: "divider",
            },
            "&:focus-within .MuiOutlinedInput-notchedOutline": {
              borderColor: "primary.main",
              boxShadow: (theme) => `0 0 0 2px ${alpha(theme.palette.primary.main, 0.1)}`,
            },
            "& input::placeholder": {
              color: "text.disabled",
            },
          },
        }}
      />
      <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
        <Button
          type="button"
          onClick={onCancel}
          size="small"
          variant="outlined"
          sx={{
            px: 1,
            fontSize: "var(--font-size-xs)",
            borderColor: "divider",
            color: "text.primary",
            "&:hover": {
              bgcolor: "action.hover",
              borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
              color: "primary.main",
            },
          }}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="small"
          variant="contained"
          sx={{
            px: 1,
            fontSize: "var(--font-size-xs)",
            bgcolor: "primary.main",
            "&:hover": {
              bgcolor: "primary.dark",
            },
          }}
        >
          Create
        </Button>
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/sidebar/NewSessionForm.tsx
git commit -m "feat(sidebar): add NewSessionForm component with MUI styling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: 创建 SessionCard 组件

**Files:**
- Create: `web/src/components/sidebar/SessionCard.tsx`

**Context:** 最复杂的子组件。渲染会话卡片，包含重命名输入、hover 操作按钮、智能状态 badge、注意力标记等。保留 CSS 类名用于测试选择器。

- [ ] **Step 1: 创建文件**

```tsx
import { Box, Stack, Typography, Chip, IconButton, ListItemButton, TextField } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { alpha } from "@mui/material/styles";
import { type SessionInfoData } from "../../api/client.js";
import { formatRelativeTime } from "../../ui/time.js";

const INTELLIGENCE_STATUS_LABELS: Record<string, string> = {
  waiting: "Waiting",
  dead_loop: "Loop",
  blocked: "Blocked",
  waiting_confirm: "Confirm",
  waiting_idle: "Idle",
  running: "Running",
};

const APP_BADGE_ORDER = ["claude", "codex", "opencode", "zsh"] as const;

interface SessionCardProps {
  session: SessionInfoData;
  isSelected: boolean;
  isRenaming: boolean;
  renameValue: string;
  onOpen: () => void;
  onRename: () => void;
  onKill: () => void;
  onRenameSubmit: () => void;
  onRenameCancel: () => void;
  onRenameChange: (value: string) => void;
}

export function SessionCard({
  session,
  isSelected,
  isRenaming,
  renameValue,
  onOpen,
  onRename,
  onKill,
  onRenameSubmit,
  onRenameCancel,
  onRenameChange,
}: SessionCardProps) {
  const sname = session.name ?? "";
  if (!sname) return null;

  const hasAttention = session.attentionState === "attention" || session.attentionState === "explicit";

  if (isRenaming) {
    return (
      <Box
        className={`session-card${session.attentionState === "explicit" ? " is-attention-explicit" : ""}${session.attentionState === "attention" ? " is-attention" : ""}${isSelected ? " is-selected" : ""}`}
        data-testid={`session-card-${sname}`}
        sx={{
          mb: 0.75,
          borderRadius: 2,
          border: 1,
          borderColor: isSelected ? "primary.main" : "divider",
          bgcolor: isSelected ? alpha("primary.main", 0.08) : "background.paper",
          transition: "border-color 200ms ease, background-color 200ms ease, box-shadow 200ms ease",
          boxShadow: isSelected ? (theme) => `0 0 0 1px ${theme.palette.primary.main}, ${theme.shadows[1]}` : "none",
          position: "relative",
          overflow: "hidden",
          ...(session.attentionState === "explicit" && {
            borderColor: "error.main",
            boxShadow: (theme) => `0 0 0 1px ${theme.palette.error.main}`,
          }),
          ...(session.attentionState === "attention" && !isSelected && {
            borderColor: "warning.main",
          }),
        }}
      >
        <Box sx={{ p: "var(--spacing-sm)" }}>
          <TextField
            fullWidth
            size="small"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRenameSubmit();
              if (e.key === "Escape") onRenameCancel();
            }}
            autoFocus
            data-testid={`rename-session-input-${sname}`}
            sx={{
              "& .MuiInputBase-root": {
                bgcolor: "background.paper",
                borderRadius: 1,
                fontSize: "var(--font-size-xs)",
                color: "text.primary",
                border: 1,
                borderColor: "primary.main",
                "& fieldset": { border: "none" },
              },
            }}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box
      className={`session-card${session.attentionState === "explicit" ? " is-attention-explicit" : ""}${session.attentionState === "attention" ? " is-attention" : ""}${isSelected ? " is-selected" : ""}`}
      data-testid={`session-card-${sname}`}
      sx={{
        mb: 0.75,
        borderRadius: 2,
        border: 1,
        borderColor: isSelected ? "primary.main" : "divider",
        bgcolor: isSelected ? alpha("primary.main", 0.08) : "background.paper",
        transition: "border-color 200ms ease, background-color 200ms ease, box-shadow 200ms ease",
        boxShadow: isSelected ? (theme) => `0 0 0 1px ${theme.palette.primary.main}, ${theme.shadows[1]}` : "none",
        position: "relative",
        overflow: "hidden",
        ...(session.attentionState === "explicit" && {
          borderColor: "error.main",
          boxShadow: (theme) => `0 0 0 1px ${theme.palette.error.main}`,
        }),
        ...(session.attentionState === "attention" && !isSelected && {
          borderColor: "warning.main",
        }),
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", position: "relative" }}>
        <ListItemButton
          onClick={onOpen}
          data-testid={`session-open-${sname}`}
          selected={isSelected}
          sx={{
            flexDirection: "column",
            alignItems: "stretch",
            gap: "6px",
            py: "12px",
            px: "14px",
            minWidth: 0,
            borderRadius: 2,
            bgcolor: "transparent",
            transition: "background-color 150ms ease",
            "&.Mui-selected": { bgcolor: "transparent" },
            "&.Mui-selected:hover": { bgcolor: "action.hover" },
            "&:hover": { bgcolor: "action.hover" },
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: "center", justifyContent: "space-between", minWidth: 0 }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0, flex: 1 }}>
              <Typography
                variant="body2"
                title={sname}
                noWrap
                sx={{
                  fontSize: "var(--font-size-sm)",
                  fontWeight: 700,
                  color: "text.primary",
                  lineHeight: 1.2,
                }}
              >
                {sname}
              </Typography>
              {typeof session.windowCount === "number" && session.windowCount > 0 && (
                <Chip
                  label={`${session.windowCount} w`}
                  size="small"
                  className="window-count-badge"
                  sx={{
                    fontSize: "10px",
                    fontWeight: 600,
                    color: "text.secondary",
                    bgcolor: "background.paper",
                    border: 1,
                    borderColor: "divider",
                    minHeight: 18,
                    height: 18,
                    minWidth: 18,
                  }}
                />
              )}
              {((session.intelligenceStatus && session.intelligenceStatus !== "none" && INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus]) || session.intelligenceError) && (
                <Chip
                  label={session.intelligenceError ? "Error" : INTELLIGENCE_STATUS_LABELS[session.intelligenceStatus ?? ""] ?? session.intelligenceStatus}
                  size="small"
                  className={`intelligence-badge${session.intelligenceError ? " is-error" : session.intelligenceStatus ? ` is-${session.intelligenceStatus}` : ""}`}
                  sx={{
                    fontSize: "10px",
                    fontWeight: 600,
                    minHeight: 18,
                    height: 18,
                    ...(session.intelligenceError && { bgcolor: "error.main", color: "error.contrastText" }),
                    ...(session.intelligenceStatus === "dead_loop" && { bgcolor: "error.main", color: "error.contrastText" }),
                    ...(session.intelligenceStatus === "blocked" && { bgcolor: "warning.main", color: "warning.contrastText" }),
                    ...(session.intelligenceStatus === "waiting_confirm" && { bgcolor: "info.main", color: "info.contrastText" }),
                    ...(session.intelligenceStatus === "waiting_idle" && { bgcolor: "action.hover", color: "text.secondary", opacity: 0.7 }),
                    ...(session.intelligenceStatus === "running" && { bgcolor: "success.main", color: "success.contrastText" }),
                    ...(session.intelligenceStatus === "waiting" && { bgcolor: "action.hover", color: "text.secondary" }),
                    ...(session.intelligenceStatus === "stale" && { bgcolor: "action.disabled", color: "text.disabled" }),
                  }}
                />
              )}
            </Stack>
            {session.intelligenceUpdatedAt && (
              <Typography
                variant="caption"
                sx={{
                  fontSize: "10px",
                  color: "text.secondary",
                  flexShrink: 0,
                  opacity: 0.6,
                  fontWeight: 500,
                }}
              >
                {formatRelativeTime(session.intelligenceUpdatedAt)}
              </Typography>
            )}
          </Stack>

          {session.intelligenceSummary && (
            <Typography
              component="p"
              className="session-intelligence-summary"
              title={`${session.intelligenceSummary}${session.intelligenceError ? " [error]" : ""}${session.intelligenceStale ? " [stale]" : ""}${session.intelligenceSource ? ` via ${session.intelligenceSource}` : ""}`}
              sx={{
                fontSize: "11px",
                color: "text.secondary",
                m: "2px 0",
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "100%",
                opacity: 0.9,
                fontFamily: "var(--font-stack)",
                lineHeight: 1.5,
                py: "4px",
              }}
            >
              {session.intelligenceSummary}
            </Typography>
          )}

          <Stack
            direction="row"
            spacing={1}
            className="session-card-meta"
            sx={{
              alignItems: "center",
              flexWrap: "wrap",
              minHeight: "18px",
            }}
          >
            {hasAttention && typeof session.attentionCount === "number" && session.attentionCount > 0 && (
              <Chip
                label={session.attentionCount}
                size="small"
                className={`attention-badge${session.attentionState === "attention" ? " is-soft" : ""}`}
                sx={{
                  fontSize: "10px",
                  minHeight: 18,
                  height: 18,
                  ...(session.attentionState === "explicit"
                    ? { bgcolor: "error.main", color: "error.contrastText" }
                    : { bgcolor: "warning.main", color: "warning.contrastText", opacity: 0.8 }),
                }}
              />
            )}
            {session.intelligenceAppCounts && APP_BADGE_ORDER.map((app) => {
              const count = session.intelligenceAppCounts![app];
              if (typeof count !== "number" || count <= 0) return null;
              return (
                <Chip
                  key={app}
                  label={`${app} ${count}`}
                  size="small"
                  className={`app-count-badge is-${app}`}
                  sx={{
                    fontSize: "10px",
                    minHeight: 18,
                    height: 18,
                  }}
                />
              );
            })}
          </Stack>
        </ListItemButton>

        <Stack
          direction="row"
          spacing={0.5}
          className="session-card-actions"
          sx={{
            alignItems: "center",
            position: "absolute",
            right: 0,
            top: 0,
            height: "100%",
            px: "10px",
            opacity: 0,
            transform: "translateX(4px)",
            transition: "opacity 200ms cubic-bezier(0.4, 0, 0.2, 1), transform 200ms cubic-bezier(0.4, 0, 0.2, 1)",
            background: (theme) => `linear-gradient(to left, ${isSelected ? alpha(theme.palette.primary.main, 0.08) : theme.palette.background.paper} 70%, transparent)`,
            ".session-card:hover &": {
              opacity: 1,
              transform: "translateX(0)",
            },
          }}
        >
          <IconButton
            onClick={(e) => { e.stopPropagation(); onRename(); }}
            title="Rename"
            data-testid={`rename-session-${sname}`}
            size="small"
            sx={{
              width: 24,
              height: 24,
              color: "text.secondary",
              "&:hover": {
                bgcolor: "action.hover",
                color: "text.primary",
              },
            }}
          >
            <EditIcon sx={{ fontSize: 14 }} />
          </IconButton>
          <IconButton
            onClick={(e) => { e.stopPropagation(); onKill(); }}
            title="Kill session"
            data-testid={`kill-session-${sname}`}
            size="small"
            sx={{
              width: 24,
              height: 24,
              color: "text.secondary",
              "&:hover": {
                bgcolor: "error.main",
                color: "error.contrastText",
              },
            }}
          >
            <DeleteIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/sidebar/SessionCard.tsx
git commit -m "feat(sidebar): add SessionCard component with MUI styling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: 创建 SessionList 组件

**Files:**
- Create: `web/src/components/sidebar/SessionList.tsx`

**Context:** 会话列表容器，包含 Sessions 头部（标签 + 计数 badge + 新建按钮）、会话卡片列表、空状态。

- [ ] **Step 1: 创建文件**

```tsx
import { Box, Stack, Typography, Chip, IconButton, List, Collapse } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { alpha } from "@mui/material/styles";
import { type SessionInfoData } from "../../api/client.js";
import { SessionCard } from "./SessionCard.js";
import { NewSessionForm } from "./NewSessionForm.js";

interface SessionListProps {
  sessions: SessionInfoData[];
  searchQuery: string;
  selectedTargetName: string | null;
  selectedPaneSession: string | null;
  renamingSession: string | null;
  renameValue: string;
  showNewSessionForm: boolean;
  newSessionName: string;
  onSearchChange: (value: string) => void;
  onToggleNewSessionForm: () => void;
  onNewSessionNameChange: (value: string) => void;
  onCreateSession: (e: React.FormEvent) => void;
  onCancelNewSession: () => void;
  onOpenSession: (sessionName: string) => void;
  onRenameSession: (sessionName: string) => void;
  onKillSession: (sessionName: string) => void;
  onRenameSubmit: (sessionName: string) => void;
  onRenameCancel: () => void;
  onRenameChange: (value: string) => void;
}

export function SessionList({
  sessions,
  searchQuery,
  selectedTargetName,
  selectedPaneSession,
  renamingSession,
  renameValue,
  showNewSessionForm,
  newSessionName,
  onSearchChange,
  onToggleNewSessionForm,
  onNewSessionNameChange,
  onCreateSession,
  onCancelNewSession,
  onOpenSession,
  onRenameSession,
  onKillSession,
  onRenameSubmit,
  onRenameCancel,
  onRenameChange,
}: SessionListProps) {
  const filteredSessions = searchQuery.trim()
    ? sessions.filter((s) => s.name?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
    : sessions;

  return (
    <Box sx={{ px: "var(--spacing-sm)" }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          justifyContent: "space-between",
          py: "var(--spacing-xs)",
          px: "var(--spacing-sm)",
          mb: 0.5,
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontSize: "var(--font-size-xs)",
            fontWeight: 600,
            color: "text.secondary",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Sessions
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          {filteredSessions.length > 0 && (
            <Chip
              label={filteredSessions.length}
              size="small"
              className="sidebar-session-count"
              sx={{
                fontSize: "10px",
                fontWeight: 600,
                color: "text.disabled",
                bgcolor: "action.hover",
                border: 1,
                borderColor: "divider",
                minHeight: 20,
                height: 20,
              }}
            />
          )}
          <IconButton
            onClick={onToggleNewSessionForm}
            data-testid="new-session-button"
            aria-label="New Session"
            title="New Session"
            size="small"
            sx={{
              width: 22,
              height: 22,
              bgcolor: "action.hover",
              border: 1,
              borderColor: "divider",
              color: "text.secondary",
              "&:hover": {
                bgcolor: "action.selected",
                color: "primary.main",
                borderColor: (theme) => alpha(theme.palette.primary.main, 0.3),
                boxShadow: (theme) => `0 0 12px ${alpha(theme.palette.primary.main, 0.25)}`,
              },
            }}
          >
            <AddIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Stack>
      </Stack>

      <Collapse in={showNewSessionForm} timeout={250} unmountOnExit>
        <NewSessionForm
          value={newSessionName}
          onChange={onNewSessionNameChange}
          onSubmit={onCreateSession}
          onCancel={onCancelNewSession}
        />
      </Collapse>

      {filteredSessions.length === 0 ? (
        <Box
          className="sidebar-empty-small"
          sx={{
            p: "var(--spacing-md) var(--spacing-sm)",
            textAlign: "center",
            color: "text.secondary",
            fontSize: "var(--font-size-xs)",
            bgcolor: "action.hover",
            borderRadius: 1,
            mt: "var(--spacing-xs)",
          }}
        >
          {searchQuery ? "No sessions match your search" : "No sessions yet"}
        </Box>
      ) : (
        <List className="session-card-list" disablePadding sx={{ mt: "var(--spacing-sm)" }}>
          {filteredSessions.map((session) => {
            const sname = session.name ?? "";
            if (!sname) return null;
            const isSelected = selectedPaneSession === sname;
            return (
              <SessionCard
                key={sname}
                session={session}
                isSelected={isSelected}
                isRenaming={renamingSession === sname}
                renameValue={renameValue}
                onOpen={() => onOpenSession(sname)}
                onRename={() => onRenameSession(sname)}
                onKill={() => onKillSession(sname)}
                onRenameSubmit={() => onRenameSubmit(sname)}
                onRenameCancel={onRenameCancel}
                onRenameChange={onRenameChange}
              />
            );
          })}
        </List>
      )}
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/sidebar/SessionList.tsx
git commit -m "feat(sidebar): add SessionList component with MUI styling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: 创建 SidebarHeader 组件

**Files:**
- Create: `web/src/components/sidebar/SidebarHeader.tsx`

**Context:** 顶部品牌 Wmux + 三个视图切换按钮。

- [ ] **Step 1: 创建文件**

```tsx
import { Box, Stack, Typography, IconButton } from "@mui/material";
import FolderIcon from "@mui/icons-material/Folder";
import TerminalIcon from "@mui/icons-material/Terminal";
import BarChartIcon from "@mui/icons-material/BarChart";
import { alpha } from "@mui/material/styles";

export type SidebarView = "projects" | "session" | "stats";

interface SidebarHeaderProps {
  activeView: SidebarView;
  onChangeView: (view: SidebarView) => void;
}

export function SidebarHeader({ activeView, onChangeView }: SidebarHeaderProps) {
  const viewButtons: Array<{ view: SidebarView; icon: typeof FolderIcon; label: string; testId: string }> = [
    { view: "projects", icon: FolderIcon, label: "Projects", testId: "open-projects-button" },
    { view: "session", icon: TerminalIcon, label: "Session", testId: "open-session-button" },
    { view: "stats", icon: BarChartIcon, label: "Stats", testId: "open-stats-button" },
  ];

  return (
    <Box
      sx={{
        minHeight: "var(--app-shell-header-height, 42px)",
        display: "flex",
        alignItems: "center",
        px: "var(--spacing-md)",
        borderBottom: 1,
        borderColor: "divider",
        flexShrink: 0,
        background: (theme) =>
          `linear-gradient(to bottom, ${alpha(theme.palette.common.white, theme.palette.mode === "dark" ? 0.04 : 0.8)}, transparent)`,
      }}
    >
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", width: "100%", gap: 0.5 }}>
        <Typography
          variant="subtitle1"
          sx={{
            fontFamily: "var(--font-display)",
            fontSize: "var(--font-size-md)",
            fontWeight: 700,
            color: "primary.main",
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            flexShrink: 0,
            mr: 0.5,
          }}
        >
          Wmux
        </Typography>

        <Stack direction="row" sx={{ alignItems: "center", gap: 0.25 }}>
          {viewButtons.map(({ view, icon: Icon, label, testId }) => {
            const isActive = activeView === view;
            return (
              <IconButton
                key={view}
                className={`sidebar-header-action${isActive ? " is-active" : ""}`}
                onClick={() => onChangeView(view)}
                data-testid={testId}
                aria-label={label}
                title={label}
                size="small"
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: 1,
                  color: isActive ? "primary.main" : "text.secondary",
                  bgcolor: isActive ? alpha("primary.main", 0.1) : "transparent",
                  "&:hover": { color: "primary.main", bgcolor: alpha("primary.main", 0.1) },
                }}
              >
                <Icon sx={{ fontSize: 16 }} />
              </IconButton>
            );
          })}
        </Stack>
      </Stack>
    </Box>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/sidebar/SidebarHeader.tsx
git commit -m "feat(sidebar): add SidebarHeader component with MUI styling

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: 重构 Sidebar.tsx 主容器

**Files:**
- Modify: `web/src/components/sidebar/Sidebar.tsx` (new file, replacing the old one in spirit)
- Delete: the old `web/src/components/Sidebar.tsx` will become a redirect in Task 8

**Context:** 主容器保留所有状态管理和数据加载逻辑，组合所有子组件。样式全部使用 MUI 主题值。

- [ ] **Step 1: 创建新的 Sidebar.tsx 主容器**

```tsx
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Paper, Box, Collapse } from "@mui/material";
import {
  listConnections,
  listConnectionHealth,
  listSessions,
  listWindows,
  listPanes,
  createSession,
  killSession,
  renameSession,
  fetchErrorLogs,
  type PaneInfo,
} from "../../api/client.js";
import { getErrorMessage } from "../../api/errors.js";
import { useAppState } from "../../state/store.js";
import { SidebarHeader, type SidebarView } from "./SidebarHeader.js";
import { SessionSearch } from "./SessionSearch.js";
import { SessionList } from "./SessionList.js";
import { SidebarFooter } from "./SidebarFooter.js";

const SESSION_SYNC_INTERVAL_MS = 2000;

function isApiError(err: unknown): err is Error & { code: string; message: string } {
  return err instanceof Error && "code" in err && "message" in err;
}

interface SidebarProps {
  themeToggle?: React.ReactNode;
}

export function Sidebar({ themeToggle }: SidebarProps) {
  const {
    connections,
    setConnections,
    selectedTargetName,
    setSelectedTargetName,
    setLoading,
    setError,
    setShowSettingsPanel,
    setShowErrorLogsPanel,
    errorLogCount,
    setErrorLogCount,
    showConfirm,
    setConnectionHealth,
    sessions,
    setSessions,
    setSelectedPane,
    selectedPane,
    setWindows,
    setPanes,
  } = useAppState();

  const [searchQuery, setSearchQuery] = useState("");
  const [newSessionName, setNewSessionName] = useState("");
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);
  const [activeView, setActiveView] = useState<SidebarView>("session");
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const prevSelectedRef = useRef<string | null>(null);

  const refreshErrorLogBadge = useCallback(async () => {
    try {
      const response = await fetchErrorLogs();
      setErrorLogCount(response.enabled ? response.lines.length : 0);
    } catch {
      setErrorLogCount(0);
    }
  }, [setErrorLogCount]);

  // Auto-select first connection on mount / when selected connection is removed
  useEffect(() => {
    if (connections.length === 0) {
      setSelectedTargetName(null);
      return;
    }
    if (selectedTargetName && connections.some((c) => c.targetName === selectedTargetName)) {
      return;
    }
    setSelectedTargetName(connections[0]?.targetName ?? null);
  }, [connections, selectedTargetName, setSelectedTargetName]);

  const loadHealth = useCallback(async () => {
    try {
      const healthData = await listConnectionHealth();
      const healthMap: Record<string, { targetName: string; status: "online" | "offline"; checkedAt: string; errorCode?: string; message?: string }> = {};
      for (const h of healthData) {
        healthMap[h.targetName] = h;
      }
      setConnectionHealth(healthMap);
    } catch {
      /* noop */
    }
  }, [setConnectionHealth]);

  const loadConnectionsList = useCallback(async () => {
    setLoading("connections", true);
    try {
      const data = await listConnections();
      setConnections(data);
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      } else {
        setError({ code: "unknown_error", message: err instanceof Error ? err.message : "Unknown error" });
      }
    } finally {
      setLoading("connections", false);
    }
    loadHealth();
  }, [setConnections, setError, setLoading, loadHealth]);

  const loadSessionsForTarget = useCallback(async (targetName: string) => {
    try {
      const response = await listSessions(targetName);
      setSessions(targetName, response.data ?? []);
    } catch (err) {
      if (isApiError(err)) {
        if (err.code !== "connection_failed" && err.code !== "unknown_error") {
          setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
        }
      }
    }
  }, [setSessions, setError]);

  // Initial load of connections list
  useEffect(() => {
    loadConnectionsList();
  }, [loadConnectionsList]);

  useEffect(() => {
    void refreshErrorLogBadge();
    const intervalId = window.setInterval(() => {
      void refreshErrorLogBadge();
    }, 10000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshErrorLogBadge]);

  // Load sessions when selected connection changes
  useEffect(() => {
    if (!selectedTargetName) return;
    const prevId = prevSelectedRef.current;
    prevSelectedRef.current = selectedTargetName;

    if (prevId && prevId !== selectedTargetName) {
      setShowNewSessionForm(false);
      setSearchQuery("");
      setSelectedPane(null);
    }

    loadSessionsForTarget(selectedTargetName);
  }, [selectedTargetName, loadSessionsForTarget, setSelectedPane]);

  useEffect(() => {
    if (!selectedTargetName) return;

    let cancelled = false;
    let inFlight = false;
    const syncSessions = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        await loadSessionsForTarget(selectedTargetName);
      } finally {
        inFlight = false;
      }
    };

    const intervalId = window.setInterval(() => {
      void syncSessions();
    }, SESSION_SYNC_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedTargetName, loadSessionsForTarget]);

  const targetSessions = useMemo(() => {
    if (!selectedTargetName) return [];
    return sessions[selectedTargetName] ?? [];
  }, [sessions, selectedTargetName]);

  useEffect(() => {
    if (!selectedTargetName || selectedPane?.targetName !== selectedTargetName) return;
    if (!sessions[selectedTargetName]) return;
    if (targetSessions.some((session) => session.name === selectedPane.session)) return;

    setSelectedPane(null);
  }, [targetSessions, selectedTargetName, selectedPane, sessions, setSelectedPane]);

  const handleOpenSession = async (sessionName: string) => {
    if (!selectedTargetName) return;
    const targetName = selectedTargetName;

    try {
      const windowsResponse = await listWindows(targetName, sessionName);
      const windows = windowsResponse.data ?? [];

      if (windows.length === 0) {
        setSelectedPane({ targetName, session: sessionName });
        return;
      }

      const initialWindow = windows[0];
      if (!initialWindow) {
        setSelectedPane({ targetName, session: sessionName });
        return;
      }
      const initialWindowID = initialWindow.ID;

      const panesResponse = await listPanes(targetName, sessionName, initialWindowID);
      const panes = panesResponse.data ?? [];

      setWindows(targetName, sessionName, windows);
      setPanes(targetName, sessionName, initialWindowID, panes);

      const initialPane = panes[0];

      setSelectedPane({
        targetName,
        session: sessionName,
        window: initialWindowID,
        pane: initialPane?.ID,
      });
    } catch (err) {
      setSelectedPane(null);
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      } else {
        setError({ code: "unknown_error", message: err instanceof Error ? err.message : "Failed to open session" });
      }
    }
  };

  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTargetName || !newSessionName.trim()) return;
    const targetName = selectedTargetName;
    try {
      await createSession(targetName, newSessionName.trim());
      setNewSessionName("");
      setShowNewSessionForm(false);
      const response = await listSessions(targetName);
      setSessions(targetName, response.data ?? []);
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      }
    }
  };

  const reloadSessions = useCallback(async () => {
    if (!selectedTargetName) return;
    const targetName = selectedTargetName;
    try {
      const response = await listSessions(targetName);
      setSessions(targetName, response.data ?? []);
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      }
    }
  }, [selectedTargetName, setSessions, setError]);

  const handleKillSession = (sessionName: string) => {
    if (!selectedTargetName) return;
    const targetName = selectedTargetName;
    showConfirm({
      title: "Kill Session",
      message: `Are you sure you want to kill session "${sessionName}"?`,
      confirmText: "Kill",
      confirmVariant: "danger",
      onConfirm: async () => {
        try {
          await killSession(targetName, sessionName);
          await reloadSessions();
        } catch (err) {
          if (isApiError(err)) {
            setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
          }
        }
      },
    });
  };

  const handleRenameSession = (sessionName: string) => {
    setRenamingSession(sessionName);
    setRenameValue(sessionName);
  };

  const submitRename = async (sessionName: string) => {
    if (!selectedTargetName) return;
    const targetName = selectedTargetName;
    const newName = renameValue.trim();
    if (!newName || newName === sessionName) {
      setRenamingSession(null);
      setRenameValue("");
      return;
    }
    try {
      await renameSession(targetName, sessionName, newName);
      await reloadSessions();
    } catch (err) {
      if (isApiError(err)) {
        setError({ code: err.code, message: getErrorMessage(err.code, err.message) });
      }
    } finally {
      setRenamingSession(null);
      setRenameValue("");
    }
  };

  return (
    <Paper
      component="aside"
      className="sidebar"
      data-testid="sidebar"
      elevation={0}
      square
      sx={{
        width: 320,
        minWidth: 320,
        maxWidth: 320,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
        borderRight: 1,
        borderColor: "divider",
        overflow: "hidden",
        bgcolor: "background.paper",
      }}
    >
      <SidebarHeader activeView={activeView} onChangeView={setActiveView} />

      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          px: "var(--spacing-md)",
          py: "var(--spacing-sm)",
          scrollbarGutter: "stable",
        }}
      >
        {activeView === "projects" ? (
          <Box data-testid="projects-view" sx={{ minHeight: 1 }} />
        ) : activeView === "stats" ? (
          <Box data-testid="stats-view" sx={{ minHeight: 1 }} />
        ) : selectedTargetName ? (
          <>
            <SessionSearch value={searchQuery} onChange={setSearchQuery} />
            <SessionList
              sessions={targetSessions}
              searchQuery={searchQuery}
              selectedTargetName={selectedTargetName}
              selectedPaneSession={selectedPane?.session ?? null}
              renamingSession={renamingSession}
              renameValue={renameValue}
              showNewSessionForm={showNewSessionForm}
              newSessionName={newSessionName}
              onSearchChange={setSearchQuery}
              onToggleNewSessionForm={() => setShowNewSessionForm(!showNewSessionForm)}
              onNewSessionNameChange={setNewSessionName}
              onCreateSession={handleCreateSession}
              onCancelNewSession={() => {
                setShowNewSessionForm(false);
                setNewSessionName("");
              }}
              onOpenSession={handleOpenSession}
              onRenameSession={handleRenameSession}
              onKillSession={handleKillSession}
              onRenameSubmit={submitRename}
              onRenameCancel={() => {
                setRenamingSession(null);
                setRenameValue("");
              }}
              onRenameChange={setRenameValue}
            />
          </>
        ) : (
          <Box
            sx={{
              p: "var(--spacing-xl) var(--spacing-md)",
              textAlign: "center",
              color: "text.secondary",
              fontSize: "var(--font-size-sm)",
              bgcolor: "action.hover",
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 2,
              mt: "var(--spacing-md)",
            }}
          >
            {connections.length === 0 ? "No connections configured" : "Loading..."}
          </Box>
        )}
      </Box>

      <SidebarFooter
        errorLogCount={errorLogCount}
        onOpenSettings={() => setShowSettingsPanel(true)}
        onOpenErrorLogs={() => setShowErrorLogsPanel(true)}
        themeToggle={themeToggle}
      />
    </Paper>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/sidebar/Sidebar.tsx
git commit -m "feat(sidebar): refactor main Sidebar container with MUI styling

- Extract state management into composed subcomponents
- Replace all CSS variable styles with MUI theme values

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: 创建 sidebar/index.tsx 入口并更新重定向

**Files:**
- Create: `web/src/components/sidebar/index.tsx`
- Modify: `web/src/components/Sidebar.tsx`

**Context:** 创建统一的入口文件，修改旧的 Sidebar.tsx 为重定向以保持向后兼容。

- [ ] **Step 1: 创建 index.tsx**

```tsx
export { Sidebar } from "./Sidebar.js";
export type { SidebarView } from "./SidebarHeader.js";
```

- [ ] **Step 2: 修改旧的 Sidebar.tsx 为重定向**

将 `web/src/components/Sidebar.tsx` 的内容替换为：

```tsx
export { Sidebar } from "./sidebar/index.js";
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/sidebar/index.tsx web/src/components/Sidebar.tsx
git commit -m "refactor(sidebar): add sidebar index export and redirect

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: 清理 components.css

**Files:**
- Modify: `web/src/styles/components.css`

**Context:** 删除 Sidebar 相关的 CSS 类定义（约 350 行）。保留其他组件（MainPanel、SettingsPanel、Terminal 等）的 CSS。

- [ ] **Step 1: 删除以下 CSS 类**

从 `components.css` 中删除以下选择器及其规则：

- `.sidebar-header`（如果存在具体规则）
- `.sidebar-toolbar`
- `.sidebar-search`
- `.sidebar-session-form`
- `.sidebar-session-form-actions`
- `.sidebar-sessions-section`
- `.sidebar-sessions-header`
- `.sidebar-session-count`
- `.sidebar-sessions-header-actions`
- `.sidebar-session-create-button`
- `.sidebar-empty-small`
- `.computed-name-display`
- `.session-card-list`
- `.session-card` 及其所有子类（`.session-card-body`, `.session-card-top`, `.session-card-name`, `.session-card-meta`, `.session-card-meta-count`, `.session-card-time`, `.session-card-badges`, `.session-card-actions`, `.session-card-rename`, `.session-intelligence-summary`）
- `.window-count-badge`
- `.attention-badge`
- `.intelligence-badge`
- `.app-count-badge`

注意：`.sidebar`、`.sidebar-content`、`.sidebar-footer-action`、`.sidebar-error-logs-button`、`.sidebar-header-action` 等没有实际 CSS 规则（仅用于测试选择器或已被 sx prop 替代），可以直接删除。

- [ ] **Step 2: Commit**

```bash
git add web/src/styles/components.css
git commit -m "refactor(styles): remove Sidebar-related CSS classes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: 更新测试中的 CSS 类断言

**Files:**
- Modify: `web/src/components/Sidebar.test.tsx`

**Context:** 测试中使用了 `toHaveClass` 来检查 CSS 类。由于我们保留了这些类名（用于测试选择器），但样式已通过 sx prop 定义，需要更新测试以验证正确的类名仍然存在。

- [ ] **Step 1: 更新 CSS 类断言**

在 `Sidebar.test.tsx` 中，以下断言需要保留（因为类名仍然存在于元素上）：

```tsx
// Line 307: attention class assertions - KEEP (className still applied)
expect(screen.getByTestId("session-card-session1")).toHaveClass("is-attention");
expect(screen.getByTestId("session-card-session1")).not.toHaveClass("is-attention-explicit");

// Line 327-328: explicit attention - KEEP
expect(screen.getByTestId("session-card-session1")).toHaveClass("is-attention-explicit");
expect(screen.getByTestId("session-card-session1")).not.toHaveClass("is-attention");
```

以下查询需要更新为使用 `data-testid` 或其他稳定选择器：

```tsx
// Line 348-350: attention badge
// BEFORE:
const badge = document.querySelector(".attention-badge");
// AFTER:
const badge = screen.getByText("2").closest(".MuiChip-root");

// Line 392-394: intelligence badge waiting
// BEFORE:
const badge = document.querySelector(".intelligence-badge.is-waiting");
// AFTER:
const badge = screen.getByText("Waiting").closest(".MuiChip-root");

// Line 413-415: intelligence badge dead_loop
// BEFORE:
const badge = document.querySelector(".intelligence-badge.is-dead_loop");
// AFTER:
const badge = screen.getByText("Loop").closest(".MuiChip-root");

// Line 435-437: intelligence badge blocked
// BEFORE:
const badge = document.querySelector(".intelligence-badge.is-blocked");
// AFTER:
const badge = screen.getByText("Blocked").closest(".MuiChip-root");

// Line 457-459: intelligence badge running
// BEFORE:
const badge = document.querySelector(".intelligence-badge.is-running");
// AFTER:
const badge = screen.getByText("Running").closest(".MuiChip-root");

// Line 479-480: intelligence badge none
// BEFORE:
const badge = document.querySelector(".intelligence-badge");
// AFTER:
const badge = document.querySelector(".intelligence-badge"); // or use queryAllByText

// Line 500-502: intelligence summary
// BEFORE:
const summary = document.querySelector(".session-intelligence-summary");
// AFTER:
const summary = screen.getByText("Waiting for input");

// Line 523-525: stale title
// BEFORE:
const summary = document.querySelector(".session-intelligence-summary");
// AFTER:
const summary = screen.getByText("Waiting");

// Line 546-553: error indicator
// BEFORE:
const summary = document.querySelector(".session-intelligence-summary");
const badge = document.querySelector(".intelligence-badge.is-error");
// AFTER:
const summary = screen.getByText("Failed");
const badge = screen.getByText("Error").closest(".MuiChip-root");
```

- [ ] **Step 2: 运行单元测试**

```bash
cd web && bun run test src/components/Sidebar.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Sidebar.test.tsx
git commit -m "test(sidebar): update CSS class selectors for MUI refactor

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: 运行验证

**Files:**
- All modified files

- [ ] **Step 1: 运行 TypeScript 类型检查**

```bash
make typecheck
```

- [ ] **Step 2: 运行单元测试**

```bash
cd web && bun run test
```

- [ ] **Step 3: 构建前端**

```bash
make build
```

- [ ] **Step 4: 运行 E2E 测试**

```bash
make e2e
```

注意：`connection-management.spec.ts:30` 和 `user-interactions.spec.ts:119` 使用了 `.session-card` 和 `.session-card-list` CSS 类选择器。这些类名在重构后仍然保留在元素上（通过 `className` prop），因此 E2E 测试应该仍然通过。如果出现失败，检查类名是否正确传递。

- [ ] **Step 5: Commit 任何修复**

```bash
git add -A
git commit -m "fix(sidebar): address test and type issues from MUI refactor

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review Checklist

### Spec Coverage
- [x] SidebarFooter — Task 1
- [x] SessionSearch — Task 2
- [x] NewSessionForm — Task 3
- [x] SessionCard — Task 4
- [x] SessionList — Task 5
- [x] SidebarHeader — Task 6
- [x] Sidebar 主容器 — Task 7
- [x] 入口文件和重定向 — Task 8
- [x] CSS 清理 — Task 9
- [x] 测试更新 — Task 10
- [x] 验证 — Task 11

### Placeholder Scan
- [x] 无 TBD/TODO
- [x] 无 "implement later"
- [x] 每个任务包含完整代码
- [x] 无 "Similar to Task N" 引用

### Type Consistency
- [x] `SidebarView` 类型在 Task 6 定义，在 Task 7 使用
- [x] `SessionInfoData` 导入路径一致
- [x] Props 接口命名一致
