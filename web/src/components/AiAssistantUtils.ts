export const LAUNCHER_POS_STORAGE_KEY = "wmux-launcher-pos"
export const LAUNCHER_POS_CHANGE_EVENT = "wmux:launcher-pos-change"

export const LAUNCHER_ELEM_SIZE = { width: 42, height: 42 }
const VIEWPORT_MARGIN_PX = 16

export type AssistantPos = { x: number; y: number }

function defaultLauncherPos(): AssistantPos {
  if (typeof window === "undefined") return { x: VIEWPORT_MARGIN_PX, y: VIEWPORT_MARGIN_PX }
  return {
    x: window.innerWidth - LAUNCHER_ELEM_SIZE.width - VIEWPORT_MARGIN_PX,
    y: window.innerHeight - LAUNCHER_ELEM_SIZE.height - VIEWPORT_MARGIN_PX,
  }
}

export function clampAssistantPos(
  pos: AssistantPos,
  size: { width: number; height: number },
): AssistantPos {
  if (typeof window === "undefined") return pos
  const maxX = window.innerWidth - size.width - VIEWPORT_MARGIN_PX
  const maxY = window.innerHeight - size.height - VIEWPORT_MARGIN_PX
  return {
    x: Math.round(Math.max(VIEWPORT_MARGIN_PX, Math.min(maxX, pos.x))),
    y: Math.round(Math.max(VIEWPORT_MARGIN_PX, Math.min(maxY, pos.y))),
  }
}

export function scalePosOnResize(
  pos: AssistantPos,
  size: { width: number; height: number },
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): AssistantPos {
  if (typeof window === "undefined") return pos
  const oldRangeX = oldWidth - size.width - 2 * VIEWPORT_MARGIN_PX
  const oldRangeY = oldHeight - size.height - 2 * VIEWPORT_MARGIN_PX

  let px = 1
  let py = 1

  if (oldRangeX > 0) {
    px = (pos.x - VIEWPORT_MARGIN_PX) / oldRangeX
  }
  if (oldRangeY > 0) {
    py = (pos.y - VIEWPORT_MARGIN_PX) / oldRangeY
  }

  px = Math.max(0, Math.min(1, px))
  py = Math.max(0, Math.min(1, py))

  const newRangeX = newWidth - size.width - 2 * VIEWPORT_MARGIN_PX
  const newRangeY = newHeight - size.height - 2 * VIEWPORT_MARGIN_PX

  const scaledPos = {
    x: Math.round(VIEWPORT_MARGIN_PX + px * newRangeX),
    y: Math.round(VIEWPORT_MARGIN_PX + py * newRangeY),
  }

  return clampAssistantPos(scaledPos, size)
}

export function loadLauncherPos(): AssistantPos {
  try {
    const raw = localStorage.getItem(LAUNCHER_POS_STORAGE_KEY)
    if (!raw) return defaultLauncherPos()
    const parsed = JSON.parse(raw) as Partial<AssistantPos>
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") {
      return defaultLauncherPos()
    }
    return clampAssistantPos({ x: parsed.x, y: parsed.y }, LAUNCHER_ELEM_SIZE)
  } catch {
    return defaultLauncherPos()
  }
}

export function saveLauncherPos(pos: AssistantPos): void {
  try {
    localStorage.setItem(LAUNCHER_POS_STORAGE_KEY, JSON.stringify(pos))
  } catch {}
}

export function emitLauncherPosChange(pos: AssistantPos): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent<AssistantPos>(LAUNCHER_POS_CHANGE_EVENT, { detail: pos }))
}

export function dialogPosFromLauncher(
  launcherPos: AssistantPos,
  dialogSize: { width: number; height: number },
): AssistantPos {
  return clampAssistantPos(
    {
      x: launcherPos.x + LAUNCHER_ELEM_SIZE.width - dialogSize.width,
      y: launcherPos.y + LAUNCHER_ELEM_SIZE.height - dialogSize.height,
    },
    dialogSize,
  )
}

export function launcherPosFromDialog(
  dialogPos: AssistantPos,
  dialogSize: { width: number; height: number },
): AssistantPos {
  return clampAssistantPos(
    {
      x: dialogPos.x + dialogSize.width - LAUNCHER_ELEM_SIZE.width,
      y: dialogPos.y + dialogSize.height - LAUNCHER_ELEM_SIZE.height,
    },
    LAUNCHER_ELEM_SIZE,
  )
}
