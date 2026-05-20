# Sidebar MUI 主题系统重构设计

## 背景

SettingsPanel 已在近期提交（`3b7e2ac`）中完成 MUI 主题系统迁移。Sidebar 目前虽然使用了 MUI 组件，但样式仍大量依赖 CSS 变量（`var(--color-panel)` 等），与 SettingsPanel 的纯 MUI 风格不一致。本次重构将 Sidebar 统一为 MUI 主题系统，并在过程中拆分巨型组件。

## 目标

1. 将 Sidebar 从 CSS 变量样式迁移到纯 MUI 主题值
2. 将 `Sidebar.tsx`（1100+ 行）拆分为多个独立子组件
3. 删除 `components.css` 中 Sidebar 相关的 CSS 类（约 350 行）
4. 保持功能和行为完全一致

## 组件拆分

### 文件结构

```
web/src/components/sidebar/
  index.tsx          — 统一导出 Sidebar
  Sidebar.tsx        — 主容器，管理状态，组合子组件
  SidebarHeader.tsx  — 品牌 Wmux + 视图切换按钮
  SessionSearch.tsx  — 搜索输入框
  NewSessionForm.tsx — 新建会话折叠表单
  SessionList.tsx    — 会话列表容器（含空状态）
  SessionCard.tsx    — 单个会话卡片（含重命名、hover 操作按钮）
  SidebarFooter.tsx  — 设置 / 日志 / 主题切换
```

### 各组件职责

| 组件 | 职责 |
|------|------|
| `Sidebar` | 通过 `useAppState()` 获取状态；管理 `searchQuery`、`showNewSessionForm`、`renamingSession` 等局部状态；组合所有子组件；保留数据加载逻辑（`loadConnectionsList`、`loadSessionsForTarget`、`loadHealth` 等） |
| `SidebarHeader` | 渲染品牌名称和三个视图切换按钮（Projects / Session / Stats） |
| `SessionSearch` | 渲染搜索输入框，接收 `value` 和 `onChange` |
| `NewSessionForm` | 渲染折叠的新建会话表单，接收表单状态和控制回调 |
| `SessionList` | 渲染会话列表头部（Sessions 标签 + 计数 + 新建按钮）和会话卡片列表；处理空状态 |
| `SessionCard` | 渲染单个会话卡片：名称、窗口计数、智能状态、摘要、注意力标记、hover 操作按钮（重命名/kill）；处理重命名输入状态 |
| `SidebarFooter` | 渲染设置按钮、错误日志按钮（带 Badge）、主题切换插槽 |

## 数据流

保持不变。所有状态仍通过 `useAppState()` 获取，子组件通过 props 接收数据和回调。不涉及 Context 或全局状态改动。

## 样式迁移映射

### 颜色

| 原 CSS 变量 | MUI 主题值 |
|------------|-----------|
| `var(--color-panel)` | `"background.paper"` |
| `var(--color-panel-border)` | `"divider"` |
| `var(--color-surface)` | `"action.hover"` |
| `var(--color-surface-hover)` | `"action.selected"` |
| `var(--color-surface-border)` | `"divider"` |
| `var(--color-surface-border-hover)` | `"primary.main"` (hover 边框) |
| `var(--color-accent)` | `"primary.main"` |
| `var(--color-accent-hover)` | `"primary.dark"` |
| `var(--color-accent-subtle)` | `alpha("primary.main", 0.1)` |
| `var(--color-glass-highlight)` | `alpha("common.white", 0.04)` |
| `var(--color-text)` | `"text.primary"` |
| `var(--color-text-muted)` | `"text.secondary"` |
| `var(--color-text-disabled)` | `"text.disabled"` |
| `var(--color-input-bg)` | `"background.paper"` |
| `var(--color-input-border)` | `"divider"` |
| `var(--color-input-border-focus)` | `"primary.main"` |
| `var(--color-input-text)` | `"text.primary"` |
| `var(--color-input-placeholder)` | `"text.disabled"` |
| `var(--color-danger)` | `"error.main"` |
| `var(--color-success)` | `"success.main"` |
| `var(--color-warning)` | `"warning.main"` |
| `var(--color-attention-explicit)` | `"error.main"` |
| `var(--color-attention)` | `"warning.main"` |
| `var(--color-online)` | `"success.main"` |
| `var(--color-offline)` | `"error.main"` |

### 会话卡片特定颜色

| 原 CSS 变量 | MUI 主题值 |
|------------|-----------|
| `var(--color-session-card-bg)` | `"background.paper"` |
| `var(--color-session-card-border)` | `"divider"` |
| `var(--color-session-card-hover)` | `"action.hover"` |
| `var(--color-session-card-selected)` | `alpha("primary.main", 0.08)` |
| `var(--color-session-card-selected-border)` | `"primary.main"` |

### 形状与阴影

| 原 CSS 变量 | MUI 等价 |
|------------|---------|
| `var(--radius-sm)` | `theme.shape.borderRadius` (4px) |
| `var(--radius-md)` | `theme.shape.borderRadius * 2` (8px) |
| `var(--radius-lg)` | `theme.shape.borderRadius * 3` (12px) |
| `var(--shadow-sm)` | `theme.shadows[1]` |
| `var(--color-shadow-glow)` | `0 0 12px ${alpha("primary.main", 0.25)}` |

### 字体与间距

字体大小和间距保持使用 CSS 变量（`var(--font-size-sm)`、`var(--spacing-md)` 等），因为这些是结构 token，不随主题变化，且 SettingsPanel 也保留了这些变量。

## 需要删除的 CSS 类

从 `components.css` 中移除以下类定义（约 350 行）：

- `.sidebar-header`（无实际样式规则，只有类名）
- `.sidebar-toolbar`
- `.sidebar-search`（无实际样式规则）
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
- `.session-card` 及其全部子类：
  - `.session-card-body`
  - `.session-card-top`
  - `.session-card-name`
  - `.session-card-meta`
  - `.session-card-meta-count`
  - `.session-card-time`
  - `.session-card-badges`
  - `.session-card-actions`
  - `.session-card-rename`
  - `.session-intelligence-summary`
- `.window-count-badge`
- `.attention-badge`
- `.intelligence-badge`
- `.app-count-badge`

## 测试影响

- 测试中的 `data-testid` 保持不变
- 选择器依赖的类名（如 `.session-card`）需要更新为 `data-testid` 或其他稳定选择器
- E2E 测试中若使用 CSS 类选择器，需要同步更新

## 边界条件

- 无连接时显示空状态
- 搜索无结果时显示提示
- 重命名时按 Escape 取消、Enter 提交、Blur 提交
- Kill session 时弹出确认对话框（通过 `showConfirm`）
- 新建会话表单展开/折叠的动画（`Collapse` 组件）保持

## 不做的范围

- 不改动 MainPanel、WindowTabs、PaneCanvas、Terminal 等其他区域
- 不改动 AppContext 或全局状态
- 不引入新的 MUI 组件（如 TreeView、DataGrid 等）
- 不改变现有的视觉设计（颜色、间距、布局保持用户感知一致）
