import { forwardRef } from "react"
import { IconButton } from "@mui/material"
import type { IconButtonProps } from "@mui/material/IconButton"
import type { SvgIconProps } from "@mui/material/SvgIcon"
import type { ComponentType } from "react"

type SidebarIconButtonVariant = "nav" | "compact" | "row"

interface SidebarIconButtonProps extends Omit<IconButtonProps, "children" | "size"> {
  icon: ComponentType<SvgIconProps>
  variant?: SidebarIconButtonVariant
  active?: boolean
  danger?: boolean
}

export const SidebarIconButton = forwardRef<HTMLButtonElement, SidebarIconButtonProps>(
  function SidebarIconButton(
    { icon: Icon, variant = "nav", active = false, danger = false, className, ...props },
    ref,
  ) {
    const classes = [
      "sidebar-icon-button",
      `sidebar-icon-button-${variant}`,
      active ? "is-active" : "",
      danger ? "is-danger" : "",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ")

    return (
      <IconButton ref={ref} className={classes} size="small" {...props}>
        <Icon className="sidebar-icon" fontSize="inherit" />
      </IconButton>
    )
  },
)
